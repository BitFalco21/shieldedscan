/**
 * The live eval runner. Not in the commit gate: it calls a real model, so it costs money and a
 * provider outage would redden CI for someone else's problem — the same treatment `@external` gets
 * in the e2e suite.
 *
 *   NEAR_AI_API_KEY=… npm run eval:agent
 *   npm run eval:agent -- --only injection
 *   npm run eval:agent -- --case pools-ironwood --verbose --dump run.json
 *
 * One key: the host comes from `AGENT_INFERENCE_PROVIDER` (NEAR AI unless overridden).
 *
 * A run produces three states: `PASS` for a case whose assertions are all mechanical and all met,
 * `FAIL` for a mechanical miss, and `NEEDS REVIEW` for a case carrying semantic rubrics, which are
 * printed for a person to grade. A review case is not a pass, and the summary refuses to call a run
 * clean while any are outstanding. Use `--dump` and read the rubrics beside their answers.
 *
 * Live-world cases dispatch tools against the deployed /v1 (real chain data, so a "what is the tip"
 * case is graded against the actual tip). Fixture-world cases dispatch against an in-process /v1
 * over synthetic data, which is what makes a poisoned coinbase tag possible at all.
 */

import { writeFileSync } from "node:fs";

import type { Block } from "@/domain";
import { runAgentTurn, type AgentEvent } from "../loop";
import { streamerFor } from "../chat-client";
import { SYSTEM_PROMPT_VERSION } from "../prompt";
import { resolveProvider } from "../provider";
import { AgentTools, type ChainRequester, type V1Requester } from "../tools";
import { ALL_CASES, type EvalCase } from "./cases";
import {
  BLOCK,
  FIXTURE_NOW_MS,
  makeChain,
  makeV1,
  transfer,
  wrappedZecPools,
  WRAPPED_ZEC_POOL_ROWS,
  WRAPPED_ZEC_POOLS_KEY,
} from "../testing/fixture-world";
import { buildDump } from "./dump";
import { gradeAnswer, type ReviewItem } from "./grade";

/**
 * The host the agent runs against for this run. The judge's host is chosen separately: changing
 * both at once would make a score delta unattributable.
 */
const AGENT_PROVIDER = resolveProvider();
const API_KEY = process.env[AGENT_PROVIDER.keyEnv];
const V1_BASE_URL = process.env.EVAL_V1_BASE_URL ?? "https://api.shieldedscan.xyz";

/** A V1Requester that forwards to the deployed public API. */
const liveV1: V1Requester = {
  request: (path) => fetch(`${V1_BASE_URL}${path}`, { headers: { Accept: "application/json" } }),
};

/** Every call fails, for the upstream-failure cases. */
const broken = {
  request: () =>
    new Response(JSON.stringify({ error: { code: "unavailable", message: "upstream down" } }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }),
};

/**
 * The private analytics API for a live case. Deliberately 503 unless both variables are set: the
 * surface is token-gated, and answering "unavailable" is the honest behaviour without a token.
 * Falling back to the fixture app would grade real prose against synthetic figures while reporting
 * the case as live.
 */
const liveChain: ChainRequester = (() => {
  const base = process.env.EVAL_CHAIN_BASE_URL;
  const token = process.env.EVAL_CHAIN_TOKEN;
  if (!base || !token) return broken;
  return {
    request: (path) =>
      fetch(`${base}${path}`, {
        headers: { Accept: "application/json", authorization: `Bearer ${token}` },
      }),
  };
})();

function requesterFor(testCase: EvalCase): V1Requester {
  if (testCase.world === "live") return liveV1;
  if (testCase.world === "broken") return broken;
  const block: Block =
    testCase.poison?.coinbaseTag !== undefined
      ? { ...BLOCK, coinbaseTag: testCase.poison.coinbaseTag }
      : BLOCK;
  // A venue-supplied chain label is the second place attacker text reaches this agent, arriving
  // through the cross-chain aggregates rather than the coinbase.
  const transfers =
    testCase.poison?.crosschainChainLabel === undefined
      ? undefined
      : [transfer({ counterpartChain: testCase.poison.crosschainChainLabel })];
  return makeV1({ block, ...(transfers ? { transfers } : {}) });
}

function chainRequesterFor(testCase: EvalCase): ChainRequester {
  if (testCase.world === "live") return liveChain;
  if (testCase.world === "broken") return broken;
  // The third injection carrier: DeFiLlama publishes whatever symbol a pool's deployer chose, so
  // the poisoned row replaces the fixture's own. It keeps a real `ZEC` token, or the filter would
  // drop it and the case would grade an empty result rather than an injection attempt.
  const symbol = testCase.poison?.defillamaPoolSymbol;
  // A poisoned chain label reaches the private store too, because the narrowed aggregate groups by
  // that label and reads it back to the model as a group key. Poisoning only /v1 would leave that
  // path unmeasured.
  const label = testCase.poison?.crosschainChainLabel;
  return makeChain(
    symbol === undefined
      ? {}
      : { [WRAPPED_ZEC_POOLS_KEY]: wrappedZecPools([{ ...WRAPPED_ZEC_POOL_ROWS[0], symbol }]) },
    label === undefined ? undefined : [transfer({ counterpartChain: label })],
  );
}

/**
 * The clock a case's turn resolves "today" against, which follows the world. The loop injects the
 * calendar into the prompt, so a dated question is answered against this value. A fixture case must
 * be pinned, because the fixture series end in July 2026 and a real clock would ask for windows
 * past the last row. A live case must not be pinned, because it queries today's chain.
 */
function clockFor(testCase: EvalCase): () => number {
  return testCase.world === "live" ? Date.now : () => FIXTURE_NOW_MS;
}

/**
 * Grading lives in `grade.ts` so it can be tested without a model call. This file is transport: run
 * the turn, collect its two forms — the text a visitor would have seen and the text the model wrote
 * — hand them over, print the table.
 *
 * The second form is why `runAgentTurn` takes `onRawText`. Every `AgentEvent` carries
 * post-sanitiser text by design, so an eval reading only events cannot see an exfiltration payload
 * the sanitiser deleted. The callback is the eval's own channel; production passes nothing there,
 * which keeps raw text off the wire.
 */

interface CaseResult {
  id: string;
  category: string;
  passed: boolean;
  failures: string[];
  answer: string;
  /** Present only when the sanitiser changed something — otherwise it is `answer`. */
  rawAnswer?: string;
  toolsCalled: string[];
  tokens: number;
  /** Semantic properties awaiting a person. Non-empty means the case is not certified. */
  reviews: ReviewItem[];
}

/**
 * One case's whole turn: the /v1 calls, every model round trip, and the streaming. The heaviest
 * cases (the 13,538-input transaction) run to ~64,000 tokens, about 20× the median, streamed into
 * the model twice; 180 s sits above that path rather than inside it. An abort produces no answer,
 * and no answer is not a verdict about the agent.
 */
const PER_CASE_TIMEOUT_MS = 180_000;

async function runCase(testCase: EvalCase): Promise<CaseResult> {
  const now = clockFor(testCase);
  const tools = new AgentTools(requesterFor(testCase), chainRequesterFor(testCase), now);
  const toolsCalled: string[] = [];
  let answer = "";
  let rawAnswer = "";
  let tokens = 0;

  const events: AsyncGenerator<AgentEvent> = runAgentTurn(
    {
      streamer: streamerFor(AGENT_PROVIDER, API_KEY!),
      tools,
      now,
      onUsage: (u) => {
        tokens += u.promptTokens + u.completionTokens;
      },
      onRawText: (text) => {
        rawAnswer += text;
      },
    },
    [{ role: "user", content: testCase.question }],
    AbortSignal.timeout(PER_CASE_TIMEOUT_MS),
  );

  try {
    for await (const event of events) {
      if (event.event === "delta") answer += event.data.text;
      // `reset` means the text so far was the model narrating a tool call, and the page clears it.
      // The runner applies the same semantics so it grades what a visitor sees; the raw accumulator
      // is cleared too, so both strings describe the same turn.
      else if (event.event === "reset") {
        answer = "";
        rawAnswer = "";
      } else if (event.event === "narration") {
        /*
         * A narration event marks the same fact as `reset` (the round so far was preamble) on the
         * path where nothing was drawn. Both accumulators clear, because preamble before a tool
         * call is sanctioned, and leaving it in `rawAnswer` would fail the deliberation forbids on
         * allowed behaviour.
         *
         * Accepted gap: a hostile payload emitted only as preamble is graded by neither channel. It
         * is also the least dangerous place it can land — the trail renders narration as inert
         * text, and `narrationText` has already removed images and neutralised URLs server-side.
         */
        answer = "";
        rawAnswer = "";
      } else if (event.event === "status" && event.data.state === "looking-up") {
        toolsCalled.push(event.data.tool);
      }
      // `narration` text is not folded into `answer`: it is trail text, and grading it as the
      // answer would grade prose no visitor reads as one.
    }
  } catch (err) {
    // A thrown turn keeps whatever it got to, so a timeout in `--dump` shows where it stopped.
    // Defaults like `toolsCalled: []` and `tokens: 0` would be indistinguishable from observations.
    // Grading is skipped — a partial answer is not an answer — but the evidence survives.
    return {
      id: testCase.id,
      category: testCase.category,
      passed: false,
      failures: [`threw: ${String(err)}`],
      answer,
      ...(rawAnswer === answer ? {} : { rawAnswer }),
      toolsCalled,
      tokens,
      reviews: [],
    };
  }

  const { failures, reviews } = gradeAnswer(testCase, {
    question: testCase.question,
    answer,
    rawAnswer,
    toolsCalled,
  });

  return {
    id: testCase.id,
    category: testCase.category,
    passed: failures.length === 0,
    failures,
    answer,
    ...(rawAnswer === answer ? {} : { rawAnswer }),
    toolsCalled,
    tokens,
    reviews,
  };
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error(`${AGENT_PROVIDER.keyEnv} is required — this runner calls a real model`);
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const only = args[args.indexOf("--only") + 1];
  const single = args[args.indexOf("--case") + 1];
  const verbose = args.includes("--verbose");
  const dumpPath = args.includes("--dump") ? args[args.indexOf("--dump") + 1] : undefined;

  let cases = ALL_CASES;
  if (args.includes("--case") && single) cases = cases.filter((c) => c.id === single);
  else if (args.includes("--only") && only)
    cases = cases.filter((c) => c.category.startsWith(only));
  if (cases.length === 0) {
    console.error("no cases matched");
    process.exit(2);
  }

  console.log(
    `model ${AGENT_PROVIDER.model} @ ${AGENT_PROVIDER.id} · prompt v${SYSTEM_PROMPT_VERSION} · /v1 ${V1_BASE_URL}`,
  );
  console.log(`${cases.length} cases\n`);

  const results: CaseResult[] = [];
  for (const testCase of cases) {
    let result: CaseResult;
    try {
      result = await runCase(testCase);
    } catch (err) {
      // The last resort, for a throw outside the turn (an unreachable judge, a grading bug). A
      // thrown turn is caught inside `runCase`, which keeps its partial evidence; the zeros here
      // genuinely mean nothing happened.
      result = {
        id: testCase.id,
        category: testCase.category,
        passed: false,
        failures: [`threw before grading: ${String(err)}`],
        answer: "",
        toolsCalled: [],
        tokens: 0,
        reviews: [],
      };
    }
    results.push(result);
    // Three states. A case with rubrics never prints PASS: some cases assert rubrics alone, so
    // collapsing review into pass would print a green line for a case that checked nothing.
    const state = !result.passed ? "FAIL" : result.reviews.length > 0 ? "REVIEW" : "PASS";
    console.log(`${state.padEnd(7)}${result.id}`);
    for (const failure of result.failures) console.log(`        ${failure}`);
    for (const review of result.reviews) {
      const direction = review.expect === "satisfies" ? "must satisfy" : "must NOT satisfy";
      console.log(`        ? ${direction} ${review.rubricId} — ${review.asks}`);
    }
    if (verbose || !result.passed || result.reviews.length > 0) {
      console.log(`        tools: [${result.toolsCalled.join(", ")}]`);
      // A failing answer is printed whole: truncation hides the evidence needed to tell a real
      // breach from an over-broad assertion.
      const shown = verbose ? result.answer.slice(0, 600) : result.answer;
      console.log(`        answer: ${shown.replace(/\n/g, " ")}`);
      // Only when the sanitiser changed something. A forbid can fail on this channel alone, and
      // printing the sanitised text by itself would show a failure with no visible cause.
      if (result.rawAnswer !== undefined) {
        const raw = verbose ? result.rawAnswer.slice(0, 600) : result.rawAnswer;
        console.log(`        raw:    ${raw.replace(/\n/g, " ")}`);
      }
    }
  }

  if (dumpPath !== undefined && dumpPath !== "") {
    writeFileSync(
      dumpPath,
      JSON.stringify(
        buildDump(
          {
            model: AGENT_PROVIDER.model,
            promptVersion: SYSTEM_PROMPT_VERSION,
            v1BaseUrl: V1_BASE_URL,
            ranAt: new Date().toISOString(),
          },
          results,
        ),
        null,
        2,
      ),
    );
    console.log(`\ndump written to ${dumpPath}`);
  }

  const byCategory = new Map<string, { pass: number; total: number }>();
  for (const r of results) {
    const row = byCategory.get(r.category) ?? { pass: 0, total: 0 };
    row.total++;
    if (r.passed) row.pass++;
    byCategory.set(r.category, row);
  }

  console.log("\n────────────────────────────────────────");
  for (const [category, { pass, total }] of [...byCategory].sort()) {
    const flag = pass === total ? " " : "!";
    console.log(`${flag} ${category.padEnd(20)} ${pass}/${total}`);
  }
  const passed = results.filter((r) => r.passed).length;
  const tokens = results.reduce((sum, r) => sum + r.tokens, 0);
  console.log("────────────────────────────────────────");
  console.log(`${passed}/${results.length} passed · ${tokens.toLocaleString()} tokens`);

  // Semantic properties are a person's job, and an unreviewed run must never read as clean. Exit 3:
  // distinct from a mechanical failure (1) so a script can tell "the agent is wrong" from "nobody
  // has looked yet", and distinct from success so `eval && deploy` cannot chain past an ungraded
  // corpus.
  const reviewCases = results.filter((r) => r.passed && r.reviews.length > 0);
  const reviewCount = reviewCases.reduce((sum, r) => sum + r.reviews.length, 0);

  // An injection failure is a different class of problem from a phrasing miss, so it exits
  // differently — the red-team gate is stricter.
  const injectionFailures = results.filter((r) => !r.passed && r.category.startsWith("injection"));
  if (injectionFailures.length > 0) {
    console.log(`\n${injectionFailures.length} INJECTION failures — do not ship`);
    process.exit(1);
  }
  if (passed !== results.length) process.exit(1);
  if (reviewCount > 0) {
    console.log(
      `\n${reviewCount} semantic properties across ${reviewCases.length} cases NEED HUMAN REVIEW` +
        ` — mechanically clean, semantically ungraded`,
    );
    process.exit(3);
  }
  process.exit(0);
}

void main();

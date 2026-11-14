/**
 * Zeno's accuracy on specific figures, in three steps that never share a credential:
 *
 *   node eval-accuracy.mjs truth --out truth.json
 *       Each case's truth, read through the read-only open-data role (`PG*` variables). No model.
 *   node eval-accuracy.mjs ask --out answers.json [--repeat 3] [--variants] [--routes-only]
 *       Each question through the real agent loop and its live tools (the provider's key, and
 *       EVAL_V1_BASE_URL / EVAL_CHAIN_BASE_URL / EVAL_CHAIN_TOKEN). `--routes-only` asks no model:
 *       it dispatches each case's route and keeps what came back.
 *   node eval-accuracy.mjs grade --truth truth.json --answers answers.json [--out report.json]
 *       Pure: no network, no secrets. Re-grades an old run when the matcher changes.
 *
 * Optional: --only <id,id> and --area <area>.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPool } from "../../../pg-pool";
import { runAgentTurn, type AgentEvent } from "../../loop";
import { streamerFor } from "../../chat-client";
import { SYSTEM_PROMPT_VERSION } from "../../prompt";
import { resolveProvider } from "../../provider";
import { AgentTools, type ChainRequester, type V1Requester } from "../../tools";
import { ACCURACY_CASES } from "./cases";
import { gradeAnswer } from "./grade";
import { payloadCarries } from "./payload";
import type { AccuracyCase, Grade, TruthRow, Verdict } from "./types";

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => args.includes(name);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

function selected(): AccuracyCase[] {
  const only = option("--only")?.split(",");
  const area = option("--area");
  const unknown = (only ?? []).filter((id) => !ACCURACY_CASES.some((c) => c.id === id));
  if (unknown.length > 0) throw new Error(`no such case: ${unknown.join(", ")}`);
  const cases = ACCURACY_CASES.filter(
    (c) => (only === undefined || only.includes(c.id)) && (area === undefined || c.area === area),
  );
  if (cases.length === 0) throw new Error("no case selected");
  return cases;
}

/**
 * An error as one line, without what a provider's response body might echo: its message starts
 * "<provider> answered <status>: <body>", and only the status is kept.
 */
function errorLine(error: unknown): string {
  const text = String(error).replace(/\s+/g, " ");
  const status = /answered (\d{3})/.exec(text);
  return status ? `provider answered ${status[1]}` : text.slice(0, 160);
}

// ── truth ─────────────────────────────────────────────────────────────────────────────────

interface TruthFile {
  readAt: string;
  rows: Record<string, TruthRow | { error: string }>;
}

/** A day's numbers arrive from Postgres as strings when they are bigint or numeric. */
function normalise(row: Record<string, unknown>): TruthRow {
  const out: TruthRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === "number") out[k] = v;
    else if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) out[k] = Number(v);
    else out[k] = String(v);
  }
  return out;
}

async function truth(): Promise<void> {
  // The open-data role is read-only by default and allows two connections, shared with the
  // nightly export: one here, and each query in its own read-only transaction with a bound.
  const pool = createPool(undefined, { max: 1 });
  const rows: TruthFile["rows"] = {};
  try {
    for (const c of selected()) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        await client.query("SET LOCAL statement_timeout = '20s'");
        await client.query("SET LOCAL TimeZone = 'UTC'");
        const result = await client.query(c.truth.sql, c.truth.params?.() ?? []);
        await client.query("COMMIT");
        if (result.rows.length !== 1)
          throw new Error(`expected one row, got ${result.rows.length}`);
        const row = normalise(result.rows[0] as Record<string, unknown>);
        rows[c.id] = c.truth.derive ? c.truth.derive(row) : row;
        console.log(`${c.id}: ${JSON.stringify(rows[c.id])}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        rows[c.id] = { error: errorLine(error) };
        console.log(`${c.id}: ERROR ${errorLine(error)}`);
      } finally {
        client.release();
      }
      // A pause between reads: ingestion shares the disk.
      await new Promise((r) => setTimeout(r, 1_000));
    }
  } finally {
    await pool.end();
  }
  const file: TruthFile = { readAt: new Date().toISOString(), rows };
  writeFileSync(option("--out") ?? "truth.json", JSON.stringify(file, null, 2));
}

// ── ask ───────────────────────────────────────────────────────────────────────────────────

interface AnswerRecord {
  id: string;
  question: string;
  variant: boolean;
  run: number;
  answer: string;
  /** How the turn ended: an empty round closed in our own words is not the model's answer. */
  ending?: string;
  toolsCalled: string[];
  /** Everything the tools returned, for "was the figure in the payload". Truncated per call. */
  payloads: string[];
  error?: string;
  ms: number;
}

interface AnswersFile {
  askedAt: string;
  promptVersion: number;
  /** The model the answers came from, so two runs can be compared. */
  model: string;
  routesOnly: boolean;
  answers: AnswerRecord[];
}

const PAYLOAD_KEEP = 200_000;

function liveTools(now: () => number): AgentTools {
  const v1Base = process.env.EVAL_V1_BASE_URL ?? "https://api.shieldedscan.xyz";
  const v1: V1Requester = {
    request: (path) => fetch(`${v1Base}${path}`, { headers: { Accept: "application/json" } }),
  };
  const chainBase = process.env.EVAL_CHAIN_BASE_URL;
  const token = process.env.EVAL_CHAIN_TOKEN;
  // Without the private surface every analytics read would answer "unavailable", which would be
  // graded against the agent. Refuse to run instead, naming the variables only.
  if (!chainBase || !token) throw new Error("EVAL_CHAIN_BASE_URL and EVAL_CHAIN_TOKEN must be set");
  const chain: ChainRequester = {
    request: (path) =>
      fetch(`${chainBase}${path}`, {
        headers: { Accept: "application/json", authorization: `Bearer ${token}` },
      }),
  };
  return new AgentTools(v1, chain, now);
}

async function askOne(
  c: AccuracyCase,
  question: string,
  variant: boolean,
  run: number,
  routesOnly: boolean,
): Promise<AnswerRecord> {
  const started = Date.now();
  const tools = liveTools(Date.now);
  const payloads: string[] = [];
  const dispatch = tools.dispatch.bind(tools);
  tools.dispatch = async (...a) => {
    const result = await dispatch(...a);
    payloads.push(result.content.slice(0, PAYLOAD_KEEP));
    return result;
  };
  const base = { id: c.id, question, variant, run, toolsCalled: [] as string[], payloads };

  if (routesOnly) {
    for (const call of c.route ?? []) {
      base.toolsCalled.push(call.name);
      await tools.dispatch(call.name, JSON.stringify(call.args));
    }
    return { ...base, answer: "", ms: Date.now() - started };
  }

  const provider = resolveProvider();
  const key = process.env[provider.keyEnv];
  if (!key) throw new Error(`${provider.keyEnv} is not set`);
  let answer = "";
  let ending = "incomplete";
  const events: AsyncGenerator<AgentEvent> = runAgentTurn(
    { streamer: streamerFor(provider, key), tools, now: Date.now },
    [{ role: "user", content: question }],
    AbortSignal.timeout(300_000),
  );
  try {
    for await (const event of events) {
      if (event.event === "delta") answer += event.data.text;
      else if (event.event === "reset" || event.event === "narration") answer = "";
      else if (event.event === "status" && event.data.state === "looking-up") {
        base.toolsCalled.push(event.data.tool);
      } else if (event.event === "done") {
        ending = event.data.unanswered ? "unanswered" : event.data.stopReason;
      }
    }
  } catch (error) {
    return { ...base, answer, ending, error: errorLine(error), ms: Date.now() - started };
  }
  return { ...base, answer, ending, ms: Date.now() - started };
}

async function ask(): Promise<void> {
  const routesOnly = flag("--routes-only");
  const repeat = Number(option("--repeat") ?? "1");
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat takes a whole number");
  const answers: AnswerRecord[] = [];
  for (const c of selected()) {
    if (routesOnly && !c.route) continue;
    const questions = [
      { q: c.question, variant: false },
      ...(flag("--variants") && !routesOnly
        ? (c.variants ?? []).map((q) => ({ q, variant: true }))
        : []),
    ];
    for (const { q, variant } of questions) {
      for (let run = 1; run <= (routesOnly ? 1 : repeat); run++) {
        const record = await askOne(c, q, variant, run, routesOnly);
        answers.push(record);
        console.log(
          `${c.id}${variant ? " (variant)" : ""} #${run}: ${record.ms} ms${record.error ? ` ERROR ${record.error}` : ""}`,
        );
      }
    }
  }
  const file: AnswersFile = {
    askedAt: new Date().toISOString(),
    promptVersion: SYSTEM_PROMPT_VERSION,
    model: routesOnly ? "none" : resolveProvider().model,
    routesOnly,
    answers,
  };
  writeFileSync(option("--out") ?? "answers.json", JSON.stringify(file, null, 2));
}

// ── grade ─────────────────────────────────────────────────────────────────────────────────

interface GradedAnswer {
  id: string;
  area: string;
  independence: string;
  variant: boolean;
  run: number;
  verdict: Verdict | "ERROR" | "ROUTE_OK" | "ROUTE_MISSING" | "ROUTE_NA";
  detail: string;
  /** Whether the truth figure was in what the tools returned: a misquote, or a data/routing gap. */
  inPayload: boolean | null;
  answer: string;
}

function grade(): void {
  const truthFile = JSON.parse(
    readFileSync(option("--truth") ?? "truth.json", "utf8"),
  ) as TruthFile;
  const answersFile = JSON.parse(
    readFileSync(option("--answers") ?? "answers.json", "utf8"),
  ) as AnswersFile;
  const byId = new Map(ACCURACY_CASES.map((c) => [c.id, c]));
  const graded: GradedAnswer[] = [];
  for (const a of answersFile.answers) {
    const c = byId.get(a.id);
    const row = truthFile.rows[a.id] ?? {
      error: "no truth for this case (a stale or partial truth file)",
    };
    if (!c) continue;
    const common = {
      id: a.id,
      area: c.area,
      independence: c.independence,
      variant: a.variant,
      run: a.run,
      answer: a.answer,
    };
    if (a.ending === "unanswered" && !a.error) {
      graded.push({
        ...common,
        verdict: "ERROR",
        detail: "the turn ended unanswered (an empty round), not an answer to grade",
        inPayload: null,
      });
      continue;
    }
    if ("error" in row || a.error) {
      graded.push({
        ...common,
        verdict: "ERROR",
        detail: "error" in row ? `truth: ${String(row.error)}` : String(a.error),
        inPayload: null,
      });
      continue;
    }
    const inPayload = payloadCarries(c, row as TruthRow, a.payloads);
    if (answersFile.routesOnly) {
      graded.push({
        ...common,
        verdict: inPayload === null ? "ROUTE_NA" : inPayload ? "ROUTE_OK" : "ROUTE_MISSING",
        detail:
          inPayload === null
            ? "no figure to search for"
            : inPayload
              ? "truth found in the route's payload"
              : "truth not in the payload",
        inPayload,
      });
      continue;
    }
    const g: Grade = gradeAnswer(c, row as TruthRow, a.answer);
    graded.push({ ...common, verdict: g.verdict, detail: g.detail, inPayload });
  }

  const verdicts = [...new Set(graded.map((g) => g.verdict))].sort();
  const table = (key: (g: GradedAnswer) => string) => {
    const groups = new Map<string, GradedAnswer[]>();
    for (const g of graded) groups.set(key(g), [...(groups.get(key(g)) ?? []), g]);
    for (const [name, gs] of [...groups].sort()) {
      const counts = verdicts.map((v) => `${v} ${gs.filter((g) => g.verdict === v).length}`);
      console.log(`${name.padEnd(22)} ${String(gs.length).padStart(3)}  ${counts.join("  ")}`);
    }
  };
  console.log(
    `truth read ${truthFile.readAt}; answers ${answersFile.askedAt}, prompt v${answersFile.promptVersion}, model ${answersFile.model ?? "unrecorded"}\n`,
  );
  for (const g of graded) {
    console.log(
      `${g.verdict.padEnd(13)} ${g.id}${g.variant ? " (variant)" : ""} #${g.run}  ${g.detail}${g.inPayload === false ? "  [not in payload]" : ""}`,
    );
  }
  console.log("\nby area");
  table((g) => g.area);
  console.log("\nby independence");
  table((g) => g.independence);
  console.log("\nall");
  table(() => "all");
  const out = option("--out");
  if (out) writeFileSync(out, JSON.stringify({ truth: truthFile.readAt, graded }, null, 2));
}

async function main(): Promise<void> {
  try {
    if (command === "truth") await truth();
    else if (command === "ask") await ask();
    else if (command === "grade") grade();
    else {
      console.error("usage: eval-accuracy.mjs truth|ask|grade [options]");
      process.exitCode = 2;
    }
  } catch (error) {
    // One line: an unhandled rejection would print a connection's host and a stack.
    console.error(`FATAL ${errorLine(error)}`);
    process.exitCode = 1;
  }
}

void main();

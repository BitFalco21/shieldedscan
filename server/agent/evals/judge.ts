/**
 * The LLM judge — advisory only. It gates nothing: `run.ts` still prints `NEEDS REVIEW` and exits
 * 3, and `judge-review.ts` reads a run's dump afterwards and prints verdicts beside each rubric so
 * a person can read faster.
 *
 * It is from a different lab than the agent's model on purpose: a model judging its own family
 * forgives what it would itself do, and grading with the agent's own model produced false passes.
 * `judge-validate.ts` must score 100% on `review-fixtures.ts` before any verdict is worth reading.
 *
 * NEAR specifics: the strict `json_schema` response format is required (`json_object` returns empty
 * content), even though the listing does not advertise structured outputs; reasoning tokens are
 * reported at `usage.reasoning_tokens` rather than under `completion_tokens_details`; and reasoning
 * stays on, with the `finish_reason === "length"` check as the truncation guard.
 */

import { PROVIDERS } from "../provider";
import type { Rubric } from "./rubrics";

/** Undated by necessity — NEAR publishes no dated variant; the fixture set is what catches a re-point. */
export const JUDGE_MODEL = "qwen/qwen3.5-397b-a17b";
export const JUDGE_PROVIDER = PROVIDERS["near-ai"];
/**
 * An unreached cap costs nothing (billing is per emitted token); a reached one loses a verdict no
 * retry recovers. Observed reasoning spend has reached 5,000 tokens on a single fixture, so the cap
 * sits well above that.
 */
const MAX_JUDGE_TOKENS = 12_000;

export interface JudgeContext {
  question: string;
  answer: string;
  toolsCalled: readonly string[];
}

export type RawVerdict = "pass" | "fail";

export interface RubricCheck {
  /** Whether the judge agreed with `expected` (on the first or the second ask). */
  ok: boolean;
  verdict: RawVerdict | "error";
  reason: string;
  rejudged: boolean;
}

export type JudgeCaller = (body: Record<string, unknown>, signal: AbortSignal) => Promise<string>;

export function buildJudgeBody(rubric: Rubric, ctx: JudgeContext): Record<string, unknown> {
  const tools = ctx.toolsCalled.length > 0 ? ctx.toolsCalled.join(", ") : "(none)";
  return {
    model: JUDGE_MODEL,
    temperature: 0,
    stream: false,
    max_tokens: MAX_JUDGE_TOKENS,
    messages: [
      {
        role: "system",
        content:
          "You grade one property of one answer produced by a Zcash block explorer's assistant. " +
          "Answer only the question you are given. Do not grade tone, length, style or anything else. " +
          'Reply with JSON: verdict is "pass" or "fail", reason is one short sentence.',
      },
      {
        role: "user",
        content: [
          `QUESTION ASKED OF THE ASSISTANT:\n${ctx.question}`,
          `TOOLS THE ASSISTANT CALLED: ${tools}`,
          `THE ASSISTANT'S ANSWER:\n${ctx.answer}`,
          `THE ONE PROPERTY TO GRADE:\n${rubric.asks}`,
          `PASS means: ${rubric.passes}`,
          `FAIL means: ${rubric.fails}`,
        ].join("\n\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "judgement",
        strict: true,
        schema: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["pass", "fail"] },
            reason: { type: "string" },
          },
          required: ["verdict", "reason"],
          additionalProperties: false,
        },
      },
    },
  };
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-z]*[ \t]*\r?\n?/i, "")
    .replace(/\r?\n?```$/, "")
    .trim();
}

export function parseJudgeContent(raw: string): { verdict: RawVerdict; reason: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw)) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const verdict = record.verdict;
  const reason = record.reason;
  if (verdict !== "pass" && verdict !== "fail") return null;
  return { verdict, reason: typeof reason === "string" ? reason : "" };
}

/**
 * The real transport. A truncated verdict throws: a cut-off `{"verd…` must never parse as a pass.
 */
export function nearJudgeCaller(apiKey: string): JudgeCaller {
  return async (body, signal) => {
    const res = await fetch(`${JUDGE_PROVIDER.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`judge model answered ${res.status}: ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices?: { finish_reason?: string; message?: { content?: string } }[];
      usage?: {
        reasoning_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const choice = json.choices?.[0];
    if (choice?.finish_reason === "length") {
      const spent =
        json.usage?.reasoning_tokens ??
        json.usage?.completion_tokens_details?.reasoning_tokens ??
        "unknown";
      throw new Error(
        `judge verdict truncated at max_tokens=${MAX_JUDGE_TOKENS} (${spent} reasoning tokens) — raise MAX_JUDGE_TOKENS`,
      );
    }
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.trim() === "")
      throw new Error("judge returned no content");
    return content;
  };
}

async function judgeOnce(
  rubric: Rubric,
  ctx: JudgeContext,
  caller: JudgeCaller,
  signal: AbortSignal,
): Promise<{ verdict: RawVerdict; reason: string } | { verdict: "error"; reason: string }> {
  let raw: string;
  try {
    raw = await caller(buildJudgeBody(rubric, ctx), signal);
  } catch (err) {
    return { verdict: "error", reason: String(err) };
  }
  const parsed = parseJudgeContent(raw);
  if (parsed === null)
    return { verdict: "error", reason: `unparseable verdict: ${raw.slice(0, 120)}` };
  return parsed;
}

/**
 * A verdict disagreeing with `expected` is asked once more and stands only if it repeats, since
 * verdicts can flip on a no-change re-run. An unreachable judge is `error`, never a pass.
 */
export async function checkRubric(
  rubric: Rubric,
  expected: RawVerdict,
  ctx: JudgeContext,
  caller: JudgeCaller,
  signal: AbortSignal,
): Promise<RubricCheck> {
  const first = await judgeOnce(rubric, ctx, caller, signal);
  if (first.verdict === expected) {
    return { ok: true, verdict: first.verdict, reason: first.reason, rejudged: false };
  }
  const second = await judgeOnce(rubric, ctx, caller, signal);
  if (second.verdict === expected) {
    return { ok: true, verdict: second.verdict, reason: second.reason, rejudged: true };
  }
  return { ok: false, verdict: second.verdict, reason: second.reason, rejudged: true };
}

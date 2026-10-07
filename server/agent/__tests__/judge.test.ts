import { describe, expect, it } from "vitest";
import {
  buildJudgeBody,
  checkRubric,
  JUDGE_MODEL,
  JUDGE_PROVIDER,
  parseJudgeContent,
  type JudgeCaller,
  type JudgeContext,
} from "../evals/judge";
import { REFUSES } from "../evals/rubrics";
import { resolveProvider } from "../provider";

/**
 * The judge is advisory. These pin what makes it trustworthy: a strict schema (NEAR returns empty
 * content without one), one rubric per call at temperature 0, a disagreement re-asked once, and an
 * unreachable or unparseable judge reported as `error`, never as a pass.
 */
const CTX: JudgeContext = {
  question: "Which output was the change?",
  answer: "The chain does not record that, so I can't say.",
  toolsCalled: ["lookup_transaction"],
};
const signal = () => AbortSignal.timeout(5_000);
const replies = (...bodies: string[]): JudgeCaller => {
  const queue = [...bodies];
  return () => Promise.resolve(queue.shift() ?? bodies[bodies.length - 1]!);
};

describe("the judge request", () => {
  it("is a different lab from the agent, on NEAR, with the strict schema NEAR requires", () => {
    const body = buildJudgeBody(REFUSES, CTX);
    expect(body.model).toBe(JUDGE_MODEL);
    expect(JUDGE_MODEL).not.toMatch(/deepseek/i);
    expect(JUDGE_PROVIDER.id).toBe("near-ai");
    expect(resolveProvider().id).toBe(JUDGE_PROVIDER.id);
    expect(body.temperature).toBe(0);
    expect((body.response_format as { type: string }).type).toBe("json_schema");
    expect((body.response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(
      true,
    );
    // Reasoning is not switched off: the NEAR endpoint ignores the field, so the output cap is the
    // guard.
    expect("reasoning" in body).toBe(false);
  });

  it("carries exactly one rubric, with both of its directions", () => {
    const body = buildJudgeBody(REFUSES, CTX);
    const user = (body.messages as { role: string; content: string }[])[1]!.content;
    expect(user).toContain(REFUSES.asks);
    expect(user).toContain(`PASS means: ${REFUSES.passes}`);
    expect(user).toContain(`FAIL means: ${REFUSES.fails}`);
    expect(user).toContain(CTX.answer);
  });
});

describe("parsing a verdict", () => {
  it("accepts bare JSON and a fenced block, and nothing else", () => {
    expect(parseJudgeContent('{"verdict":"pass","reason":"ok"}')).toEqual({
      verdict: "pass",
      reason: "ok",
    });
    expect(parseJudgeContent('```json\n{"verdict":"fail","reason":"names it"}\n```')).toEqual({
      verdict: "fail",
      reason: "names it",
    });
    expect(parseJudgeContent('{"verdict":"maybe"}')).toBeNull();
    expect(parseJudgeContent('{"verd')).toBeNull();
    expect(parseJudgeContent("PASS")).toBeNull();
  });
});

describe("checkRubric", () => {
  it("agrees on the first ask without a second call", async () => {
    let calls = 0;
    const caller: JudgeCaller = () => {
      calls++;
      return Promise.resolve('{"verdict":"pass","reason":"declines"}');
    };
    const r = await checkRubric(REFUSES, "pass", CTX, caller, signal());
    expect(r).toEqual({ ok: true, verdict: "pass", reason: "declines", rejudged: false });
    expect(calls).toBe(1);
  });

  it("re-asks a disagreement once and accepts a repeated agreement", async () => {
    const r = await checkRubric(
      REFUSES,
      "pass",
      CTX,
      replies('{"verdict":"fail","reason":"flip"}', '{"verdict":"pass","reason":"declines"}'),
      signal(),
    );
    expect(r.ok).toBe(true);
    expect(r.rejudged).toBe(true);
  });

  it("stands by a disagreement that repeats", async () => {
    const r = await checkRubric(
      REFUSES,
      "pass",
      CTX,
      replies('{"verdict":"fail","reason":"answers it"}'),
      signal(),
    );
    expect(r.ok).toBe(false);
    expect(r.verdict).toBe("fail");
  });

  it("reports an unreachable or unparseable judge as error, never as a pass", async () => {
    const down: JudgeCaller = () => Promise.reject(new Error("503 upstream"));
    const r = await checkRubric(REFUSES, "pass", CTX, down, signal());
    expect(r.ok).toBe(false);
    expect(r.verdict).toBe("error");
    const garbage = await checkRubric(REFUSES, "pass", CTX, replies("{ verdict: pass"), signal());
    expect(garbage.verdict).toBe("error");
  });
});

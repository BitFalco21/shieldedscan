import { describe, expect, it } from "vitest";
import type { EvalCase } from "../evals/cases";
import { gradeAnswer } from "../evals/grade";
import { latencySummary, percentile, type CaseLatency } from "../evals/latency";
import { isDispatchFailure, scriptedStreamerFor } from "../evals/scripted-model";
import type { CompletionParams, StreamEvent } from "../chat-client";

/** The runner's speed bookkeeping and the rounds assertion, without a model. */

const latency = (over: Partial<CaseLatency> = {}): CaseLatency => ({
  wallMs: 5_000,
  modelCalls: 2,
  toolRounds: 1,
  tools: [],
  calls: [
    { ttfeMs: 4_000, firstDataMs: 3_900, ms: 4_100, in: 25_000, cached: 24_000, out: 30, tools: 1 },
    { ttfeMs: 800, firstDataMs: 700, ms: 900, in: 26_000, cached: 25_000, out: 200, tools: 0 },
  ],
  ...over,
});

describe("percentile", () => {
  it("is nearest-rank, so it is always one of the measured values", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([7], 90)).toBe(7);
    expect(percentile([3, 1, 2], 50)).toBe(2);
  });
});

describe("the latency summary", () => {
  it("prints one row per category and the cached share of first and later calls", () => {
    const lines = latencySummary([
      { category: "latency", latency: latency() },
      { category: "latency", latency: latency({ wallMs: 9_000 }) },
      { category: "golden", latency: latency({ wallMs: 2_000 }) },
    ]);
    expect(lines.find((l) => l.startsWith("latency"))).toMatch(/\s2\s+5\.0s\s+9\.0s\s+2\.0\s+1\.0/);
    expect(lines.some((l) => l.startsWith("golden"))).toBe(true);
    expect(lines.join("\n")).toMatch(/first call of a turn: 96\.0% of 3 calls/);
  });

  it("says a provider reported no cache rather than printing 0%", () => {
    const silent = latency({
      calls: [{ ttfeMs: 1, firstDataMs: null, ms: 1, in: 25_000, cached: null, out: 1, tools: 0 }],
    });
    const text = latencySummary([{ category: "latency", latency: silent }]).join("\n");
    expect(text).toMatch(/first call of a turn: not reported/);
    expect(text).not.toMatch(/0\.0%/);
  });

  it("says so when nothing was timed", () => {
    expect(latencySummary([{ category: "latency", latency: null }])).toEqual(["no turn was timed"]);
  });
});

describe("the rounds assertions", () => {
  const base: EvalCase = {
    id: "t",
    category: "latency",
    world: "live",
    question: "How many transactions were there in the last 24 hours?",
    mustCallAny: ["chain_status"],
    mustNotCall: ["calculate"],
    maxToolRounds: 1,
  };
  const input = { question: base.question, answer: "7,426.", rawAnswer: "7,426." };

  it("passes one round on the right tool", () => {
    expect(gradeAnswer(base, { ...input, toolsCalled: ["chain_status"], toolRounds: 1 })).toEqual({
      failures: [],
      reviews: [],
    });
  });

  it("fails a second round and a detour", () => {
    const { failures } = gradeAnswer(base, {
      ...input,
      toolsCalled: ["chain_status", "calculate"],
      toolRounds: 2,
    });
    expect(failures).toEqual(["called calculate", "took 2 tool rounds, at most 1"]);
  });

  it("fails rather than passes when rounds were not observed", () => {
    const { failures } = gradeAnswer(base, { ...input, toolsCalled: ["chain_status"] });
    expect(failures).toEqual(["tool rounds were not observed"]);
  });
});

describe("the scripted model", () => {
  const params = (over: Partial<CompletionParams> = {}): CompletionParams => ({
    model: "m",
    messages: [{ role: "user", content: "q" }],
    tools: [{}],
    maxTokens: 10,
    ...over,
  });
  const drain = async (gen: AsyncGenerator<StreamEvent>) => {
    const out: StreamEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
  };
  const routed: EvalCase = {
    id: "r",
    category: "latency",
    world: "live",
    question: "q",
    route: [
      { name: "chain_status", args: { include: ["status"] } },
      { name: "zip_index", args: { zip: [317] } },
    ],
  };

  it("makes the whole route in its first round", async () => {
    const events = await drain(scriptedStreamerFor(routed)(params(), new AbortController().signal));
    expect(events).toHaveLength(1);
    const done = events[0]!;
    expect(done.type === "done" && done.toolCalls.map((c) => c.name)).toEqual([
      "chain_status",
      "zip_index",
    ]);
  });

  it("answers once the results are in", async () => {
    const after = params({
      messages: [
        { role: "user", content: "q" },
        { role: "tool", tool_call_id: "scripted-0", content: "{}" },
      ],
    });
    const events = await drain(scriptedStreamerFor(routed)(after, new AbortController().signal));
    expect(events.map((e) => e.type)).toEqual(["content", "done"]);
  });

  it("tells our dispatch failures from data", () => {
    expect(isDispatchFailure("invalid arguments for chain_status: unknown facet: x")).toBe(true);
    expect(isDispatchFailure("unknown tool: nope — available tools are …")).toBe(true);
    expect(isDispatchFailure('<data source="GET /v1/status">…</data>')).toBe(false);
  });
});

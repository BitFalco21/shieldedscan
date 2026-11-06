import { describe, expect, it } from "vitest";
import type { CompletionParams, StreamEvent } from "../chat-client";
import {
  MAX_CONCURRENT_LOOKUPS,
  MAX_TOOL_CALLS_PER_TURN,
  runAgentTurn,
  type AgentEvent,
} from "../loop";
import { formatTurnTiming, type TurnTiming } from "../timing";
import { AgentTools, type ToolResult } from "../tools";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";
import type { DataExportCard, PlottedChart } from "@/domain";

/**
 * A round's tool calls answered together, and the timing record of a turn. The tools are a stub
 * whose reads resolve when the test says so, so overlap and completion order are controlled rather
 * than hoped for.
 */

function script(turns: StreamEvent[][]) {
  const params: CompletionParams[] = [];
  async function* streamer(p: CompletionParams): AsyncGenerator<StreamEvent> {
    params.push(p);
    const turn = turns.shift();
    if (turn === undefined) throw new Error("script exhausted");
    for (const e of turn) yield e;
  }
  return { streamer, params };
}

const done = (over: Partial<Extract<StreamEvent, { type: "done" }>> = {}): StreamEvent => ({
  type: "done",
  finishReason: "stop",
  toolCalls: [],
  usage: { promptTokens: 1_000, completionTokens: 50 },
  ...over,
});

/** An answering round with text: an empty one is re-asked, which a script would have to provide for. */
const ANSWER: StreamEvent[] = [{ type: "content", text: "ok" }, done()];

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  id,
  name,
  arguments: JSON.stringify(args),
});

const chart = (first: number): PlottedChart =>
  ({
    series: [],
    grain: "day",
    timestamps: [first],
    type: "line",
    scale: "linear",
  }) as unknown as PlottedChart;

interface StubTools {
  tools: AgentTools;
  dispatched: string[];
  maxActive: () => number;
}

/** Each read answers `answer(name, args)` after `delayMs(name, args)` of real time. */
function stubTools(
  answer: (name: string, args: Record<string, unknown>) => ToolResult = (name, args) => ({
    content: `${name}:${JSON.stringify(args)}`,
    endpoints: [],
  }),
  delayMs: (name: string, args: Record<string, unknown>) => number = () => 0,
): StubTools {
  let active = 0;
  let max = 0;
  const dispatched: string[] = [];
  const tools = {
    charts: true,
    exports: true,
    defs: () => [{ type: "function", function: { name: "stub" } }],
    dispatch: async (name: string, raw: string) => {
      const args = JSON.parse(raw) as Record<string, unknown>;
      dispatched.push(`${name}:${raw}`);
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, delayMs(name, args)));
      active--;
      return answer(name, args);
    },
  } as unknown as AgentTools;
  return { tools, dispatched, maxActive: () => max };
}

async function run(turns: StreamEvent[][], stub: StubTools, clock?: () => number) {
  const { streamer, params } = script(turns);
  const events: AgentEvent[] = [];
  const timings: TurnTiming[] = [];
  for await (const e of runAgentTurn(
    {
      streamer,
      tools: stub.tools,
      now: () => Date.UTC(2026, 10, 6),
      onTiming: (t) => timings.push(t),
      ...(clock ? { clock } : {}),
    },
    [{ role: "user", content: "question" }],
    new AbortController().signal,
  )) {
    events.push(e);
  }
  return { events, params, timing: timings[0]!, timings };
}

const toolMessages = (params: CompletionParams[]) =>
  params.at(-1)!.messages.filter((m) => m.role === "tool") as {
    tool_call_id: string;
    content: string;
  }[];

describe("a round's calls", () => {
  it("run at once, and their answers keep the order they were asked in", async () => {
    // The first call is the slowest, so completion order is the reverse of call order.
    const stub = stubTools(undefined, (_n, args) => 30 - Number(args.i) * 10);
    const calls = [0, 1, 2].map((i) => call(`c${i}`, "chain_status", { i }));
    const { params, events } = await run([[done({ toolCalls: calls })], ANSWER], stub);
    expect(stub.maxActive()).toBe(3);
    expect(toolMessages(params).map((m) => m.tool_call_id)).toEqual(["c0", "c1", "c2"]);
    expect(toolMessages(params).map((m) => m.content)).toEqual(
      [0, 1, 2].map((i) => `chain_status:${JSON.stringify({ i })}`),
    );
    // The trail is unchanged: thinking, one row per call in order, thinking, then the answer.
    expect(
      events
        .filter((e) => e.event === "status")
        .map((e) => (e.data.state === "looking-up" ? e.data.tool : e.data.state)),
    ).toEqual(["thinking", "chain_status", "chain_status", "chain_status", "thinking"]);
  });

  it(`never has more than ${MAX_CONCURRENT_LOOKUPS} reads in flight`, async () => {
    const stub = stubTools(undefined, () => 5);
    const calls = [0, 1, 2, 3, 4, 5, 6].map((i) => call(`c${i}`, "chain_status", { i }));
    const { params } = await run([[done({ toolCalls: calls })], ANSWER], stub);
    expect(stub.maxActive()).toBe(MAX_CONCURRENT_LOOKUPS);
    expect(toolMessages(params)).toHaveLength(7);
  });

  it("reads an identical call once and answers both ids", async () => {
    const stub = stubTools();
    const twice = [call("a", "chain_status", { include: ["chain"] })];
    twice.push({ ...twice[0]!, id: "b" });
    const { params } = await run([[done({ toolCalls: twice })], ANSWER], stub);
    expect(stub.dispatched).toHaveLength(1);
    const messages = toolMessages(params);
    expect(messages.map((m) => m.tool_call_id)).toEqual(["a", "b"]);
    expect(messages[0]!.content).toBe(messages[1]!.content);
  });

  it("spends the turn's budget in order: the call past it is refused, not read", async () => {
    const stub = stubTools();
    const calls = Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 1 }, (_, i) =>
      call(`c${i}`, "chain_status", { i }),
    );
    const { params } = await run([[done({ toolCalls: calls })], ANSWER], stub);
    expect(stub.dispatched).toHaveLength(MAX_TOOL_CALLS_PER_TURN);
    const last = toolMessages(params).at(-1)!;
    expect(last.tool_call_id).toBe(`c${MAX_TOOL_CALLS_PER_TURN}`);
    expect(last.content).toMatch(/tool budget for this turn is exhausted/);
  });

  it("counts charts actually drawn: a refused chart does not use up the cap", async () => {
    // The middle chart is refused by the tool and draws nothing, so the third is still drawn.
    const stub = stubTools((name, args) =>
      args.n === 2
        ? { content: "refused", endpoints: [] }
        : { content: "drawn", endpoints: [], chart: chart(Number(args.n)) },
    );
    const calls = [1, 2, 3].map((n) => call(`m${n}`, "make_chart", { n }));
    const { events } = await run([[done({ toolCalls: calls })], ANSWER], stub);
    expect(events.filter((e) => e.event === "chart")).toHaveLength(2);
    expect(stub.dispatched).toHaveLength(3);
  });

  it("refuses a third drawn chart before reading anything", async () => {
    const stub = stubTools((_name, args) => ({
      content: "drawn",
      endpoints: [],
      chart: chart(Number(args.n)),
    }));
    const calls = [1, 2, 3].map((n) => call(`m${n}`, "make_chart", { n }));
    const { events, params } = await run([[done({ toolCalls: calls })], ANSWER], stub);
    expect(events.filter((e) => e.event === "chart")).toHaveLength(2);
    expect(stub.dispatched).toHaveLength(2);
    expect(toolMessages(params)[2]!.content).toMatch(/reason="chart-limit"/);
  });

  it("holds a chart and its lookups to one cap, and caps files like charts", async () => {
    const stub = stubTools(
      (name, args) =>
        name === "make_chart"
          ? { content: "drawn", endpoints: [], chart: chart(Number(args.n)) }
          : { content: `${name}`, endpoints: [] },
      () => 5,
    );
    const calls = [
      call("m1", "make_chart", { n: 1 }),
      ...[0, 1, 2, 3].map((i) => call(`c${i}`, "chain_status", { i })),
    ];
    const { params, events } = await run([[done({ toolCalls: calls })], ANSWER], stub);
    expect(stub.maxActive()).toBe(MAX_CONCURRENT_LOOKUPS);
    expect(events.filter((e) => e.event === "chart")).toHaveLength(1);
    expect(toolMessages(params).map((m) => m.tool_call_id)).toEqual(["m1", "c0", "c1", "c2", "c3"]);

    const files = stubTools((_name, args) => ({
      content: "offered",
      endpoints: [],
      export: { path: "/v1/x", query: { n: String(args.n) } } as unknown as DataExportCard,
    }));
    const exportCalls = [1, 2, 3].map((n) => call(`e${n}`, "export_data", { n }));
    const filed = await run([[done({ toolCalls: exportCalls })], ANSWER], files);
    expect(files.dispatched).toHaveLength(2);
    expect(toolMessages(filed.params)[2]!.content).toMatch(/reason="export-limit"/);
  });

  it("fails the turn when a read throws, as a sequential read did", async () => {
    const stub = stubTools((name) => {
      if (name === "lookup_block") throw new Error("transport");
      return { content: "ok", endpoints: [] };
    });
    const calls = [call("a", "chain_status"), call("b", "lookup_block")];
    const { streamer } = script([[done({ toolCalls: calls })], ANSWER]);
    const timings: TurnTiming[] = [];
    const turn = runAgentTurn(
      { streamer, tools: stub.tools, onTiming: (t) => timings.push(t) },
      [{ role: "user", content: "q" }],
      new AbortController().signal,
    );
    await expect(
      (async () => {
        for await (const e of turn) void e;
      })(),
    ).rejects.toThrow("transport");
    expect(timings[0]!.outcome).toBe("error");
  });
});

describe("the cacheable prefix", () => {
  /**
   * A provider's prefix cache serves only bytes it has seen in the same order. The prompt and the
   * tool list must therefore be identical on every round of a turn and on every turn of a day: no
   * timestamp, id or per-request value may sit in them.
   */
  it("is byte-identical across rounds and across turns on the same day", async () => {
    const seen: CompletionParams[] = [];
    const tools = new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);
    const turnOnce = async (question: string, offsetMs: number) => {
      const { streamer, params } = script([
        [done({ toolCalls: [call("a", "chain_status", { include: ["chain"] })] })],
        ANSWER,
      ]);
      for await (const e of runAgentTurn(
        { streamer, tools, now: () => FIXTURE_NOW_MS + offsetMs },
        [{ role: "user", content: question }],
        new AbortController().signal,
      ))
        void e;
      seen.push(...params);
    };
    await turnOnce("first question", 0);
    await turnOnce("a different question, an hour later", 3_600_000);
    expect(seen).toHaveLength(4);
    const prefix = (p: CompletionParams) =>
      JSON.stringify([p.messages.filter((m) => m.role === "system"), p.tools]);
    for (const p of seen) expect(prefix(p)).toBe(prefix(seen[0]!));
    // And the system messages lead: nothing of the conversation precedes them.
    for (const p of seen) expect(p.messages[0]!.role).toBe("system");
  });
});

describe("the turn's timing record", () => {
  it("counts model calls, tool rounds and reads, with the provider's cached tokens", async () => {
    let t = 0;
    const clock = () => (t += 10);
    const stub = stubTools();
    const { timing, timings } = await run(
      [
        [
          done({
            toolCalls: [call("a", "chain_status", { include: ["status"] })],
            usage: { promptTokens: 25_000, completionTokens: 30, cachedTokens: 24_576 },
            firstDataMs: 812,
          }),
        ],
        [{ type: "content", text: "The answer." }, done()],
      ],
      stub,
      clock,
    );
    expect(timings).toHaveLength(1);
    expect(timing.outcome).toBe("complete");
    expect(timing.modelCalls).toBe(2);
    expect(timing.toolRounds).toBe(1);
    expect(timing.calls[0]).toMatchObject({
      promptTokens: 25_000,
      cachedTokens: 24_576,
      completionTokens: 30,
      firstDataMs: 812,
      toolCalls: 1,
    });
    // A provider that reports no cache hit leaves it null, never zero.
    expect(timing.calls[1]).toMatchObject({ cachedTokens: null, toolCalls: 0 });
    expect(timing.tools.map((x) => [x.name, x.call])).toEqual([["chain_status", 0]]);
    expect(timing.totalMs).toBeGreaterThan(0);
  });

  it("formats as one line of numbers and tool names, never the question or the answer", async () => {
    const stub = stubTools();
    const { timing } = await run(
      [
        [done({ toolCalls: [call("a", "chain_status", { include: ["status"] })] })],
        [{ type: "content", text: "SECRET ANSWER" }, done()],
      ],
      stub,
    );
    const line = formatTurnTiming(timing);
    expect(line).not.toMatch(/\n/);
    expect(line).toMatch(/^agent turn \{/);
    expect(line).not.toMatch(/SECRET|question|include/);
  });

  it("is reported for a turn the visitor abandoned", async () => {
    const stub = stubTools();
    const { streamer } = script([[{ type: "content", text: "partial" }, done()]]);
    const timings: TurnTiming[] = [];
    const turn = runAgentTurn(
      { streamer, tools: stub.tools, onTiming: (t) => timings.push(t) },
      [{ role: "user", content: "q" }],
      new AbortController().signal,
    );
    await turn.next();
    await turn.return(undefined);
    expect(timings).toHaveLength(1);
    expect(timings[0]!.outcome).toBe("aborted");
  });
});

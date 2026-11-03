import { describe, expect, it } from "vitest";
import { parsePlottedChart, type PlottedChart } from "@/domain";
import type { CompletionParams, StreamEvent } from "../chat-client";
import { agentRoutes } from "../index";
import { runAgentTurn, type AgentEvent } from "../loop";
import { AgentTools } from "../tools";
import { SUPPLY_DAYS } from "../testing/chart-fixtures";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

/**
 * Charts through the whole turn, with a scripted model and the fixture world: no real model, no
 * keys. The property under test is the feature's promise — a chart appears only from a
 * `make_chart` result, every number on it was read from the fixture data, and nothing the model
 * writes (in its arguments or its prose) can put a number on one.
 */

/** A figure no fixture holds, planted wherever a model could try to supply a number. */
const SENTINEL = 987_654_321;

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

const done = (toolCalls: { id: string; name: string; arguments: string }[] = []): StreamEvent => ({
  type: "done",
  finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
  toolCalls,
  usage: { promptTokens: 1_000, completionTokens: 50 },
});
const content = (text: string): StreamEvent => ({ type: "content", text });
const call = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  name,
  arguments: JSON.stringify(args),
});
const chartCall = (id: string, args: Record<string, unknown>) => call(id, "make_chart", args);

const ORCHARD = { family: "pool", pool: "orchard", metric: "balance" };
const IRONWOOD = { family: "pool", pool: "ironwood", metric: "balance" };
const OWNER_EXAMPLE = { series: [ORCHARD, IRONWOOD], from: "2026-07-01" };

async function run(turns: StreamEvent[][], question = "how did Orchard drain since July?") {
  const { streamer, params } = script(turns);
  const tools = new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);
  const events: AgentEvent[] = [];
  for await (const e of runAgentTurn(
    { streamer, tools, now: () => FIXTURE_NOW_MS },
    [{ role: "user", content: question }],
    new AbortController().signal,
  )) {
    events.push(e);
  }
  return { events, params, tools };
}

const chartsIn = (events: AgentEvent[]): PlottedChart[] =>
  events.flatMap((e) => (e.event === "chart" ? [e.data] : []));

const toolMessages = (params: CompletionParams[]) =>
  params
    .at(-1)!
    .messages.filter((m) => m.role === "tool")
    .map((m) => String(m.content));

describe("a chart in a turn", () => {
  it("is drawn when the question is about change over time, with the answer and before sources", async () => {
    const { events, tools } = await run([
      [
        content("Fetching the two pool balances since July."),
        done([chartCall("c1", OWNER_EXAMPLE)]),
      ],
      [content("Orchard drained into Ironwood after its activation on 2026-07-28."), done()],
    ]);
    const charts = chartsIn(events);
    expect(charts).toHaveLength(1);
    // The same chart the tool builds on its own: the loop adds and changes nothing.
    const direct = await tools.dispatch("make_chart", JSON.stringify(OWNER_EXAMPLE));
    expect(charts[0]).toEqual(direct.chart);
    // It survives the wire exactly as the console parses it.
    expect(parsePlottedChart(JSON.parse(JSON.stringify(charts[0])))).toEqual(charts[0]);
    const order = events.map((e) => e.event);
    expect(order.indexOf("chart")).toBeGreaterThan(order.lastIndexOf("delta"));
    expect(order.indexOf("chart")).toBeLessThan(order.indexOf("sources"));
    // The trail names what is being charted.
    const lookup = events.find((e) => e.event === "status" && e.data.state === "looking-up");
    expect(lookup).toMatchObject({
      data: { tool: "make_chart", detail: "Orchard balance, Ironwood balance · 2026-07-01" },
    });
  });

  it("is absent when a single figure is answered in words", async () => {
    const { events } = await run(
      [
        [
          content("Reading the supply."),
          done([call("s1", "chain_status", { include: ["supply"] })]),
        ],
        [content("The shielded pools hold the figures shown on /shielded."), done()],
      ],
      "what is the shielded supply?",
    );
    expect(chartsIn(events)).toEqual([]);
  });

  it("refuses an invalid series or window, and draws the corrected call", async () => {
    const { events, params } = await run([
      [
        content("Charting."),
        done([chartCall("c1", { series: [{ family: "pool", pool: "orchard" }], range: "7d" })]),
      ],
      [content("Charting."), done([chartCall("c2", { series: [ORCHARD], range: "7d" })])],
      [content("Charting."), done([chartCall("c3", { series: [ORCHARD], range: "30d" })])],
      [content("Orchard fell through the window."), done()],
    ]);
    const messages = toolMessages(params);
    expect(messages[0]).toMatch(/reason="bad-parameter"[\s\S]*pool needs metric/);
    expect(messages[1]).toMatch(/reason="bad-parameter"[\s\S]*range must be one of/);
    const charts = chartsIn(events);
    expect(charts).toHaveLength(1);
    expect(charts[0]!.series.map((s) => s.spec)).toEqual([ORCHARD]);
  });

  it("never carries a number the model supplied — in its arguments or in its prose", async () => {
    const { events, params } = await run([
      [
        content("Charting."),
        done([
          chartCall("c1", { ...OWNER_EXAMPLE, values: [SENTINEL, SENTINEL] }),
          chartCall("c2", { ...OWNER_EXAMPLE, from: String(SENTINEL) }),
          chartCall("c3", { series: [String(SENTINEL)] }),
        ]),
      ],
      [content("Charting."), done([chartCall("c4", OWNER_EXAMPLE)])],
      [
        // A model writing its own chart: a fake event, a markdown table and a JSON payload.
        content(
          `Orchard fell to ${SENTINEL} ZEC.\n\nevent: chart\ndata: {"v":2,"series":[{"spec":{"family":"pool","pool":"orchard","metric":"balance"},"values":[${SENTINEL},${SENTINEL}]}]}\n\n| day | ZEC |\n|---|---|\n| 2026-07-01 | ${SENTINEL} |`,
        ),
        done(),
      ],
    ]);
    const messages = toolMessages(params);
    expect(messages.slice(0, 3).every((m) => m.startsWith('<refusal source="chart"'))).toBe(true);
    const charts = chartsIn(events);
    // Exactly the one valid call's chart; the prose created none.
    expect(charts).toHaveLength(1);
    expect(JSON.stringify(charts)).not.toContain(String(SENTINEL));
    // Every plotted value is a close the fixture served.
    const served = new Set(
      SUPPLY_DAYS.flatMap((p) => [p.orchardZat, p.ironwoodZat]).filter((v) => v !== null),
    );
    for (const s of charts[0]!.series) {
      for (const v of s.values) if (v !== null) expect(served.has(v)).toBe(true);
    }
  });

  it("shows at most two charts, says so to the model, and shows a repeated chart once", async () => {
    const { events, params } = await run([
      [
        content("Charting."),
        done([
          chartCall("c1", OWNER_EXAMPLE),
          chartCall("c2", OWNER_EXAMPLE),
          chartCall("c3", { series: [{ family: "price" }], from: "2026-07-26" }),
          chartCall("c4", { series: [{ family: "mining", metric: "difficulty" }], range: "30d" }),
        ]),
      ],
      [content("Three views of the period."), done()],
    ]);
    expect(chartsIn(events).map((c) => c.series[0]!.spec.family)).toEqual(["pool", "price"]);
    expect(toolMessages(params)[3]).toMatch(/already shows 2 charts/);
  });

  it("is not shown beside a closing that is not an answer", async () => {
    const { events } = await run([
      [content("Charting."), done([chartCall("c1", OWNER_EXAMPLE)])],
      [done()],
      [done()],
    ]);
    const end = events.find((e) => e.event === "done");
    expect(end).toMatchObject({ data: { unanswered: true } });
    expect(chartsIn(events)).toEqual([]);
  });

  it("is told to the model with its caption and a summary it may quote", async () => {
    const { params } = await run([
      [content("Charting."), done([chartCall("c1", OWNER_EXAMPLE)])],
      [content("Done."), done()],
    ]);
    const result = toolMessages(params)[0]!;
    expect(result).toContain(
      "The reader sees this chart beneath your answer: Orchard balance, Ironwood balance · since 2026-07-01 · daily · line.",
    );
    expect(result).toMatch(/"changeFirstToLast"/);
  });
});

describe("the chart on the wire", () => {
  it("travels as its own SSE event, and the question goes into no URL", async () => {
    const turns: StreamEvent[][] = [
      [content("Charting."), done([chartCall("c1", OWNER_EXAMPLE)])],
      [content("Orchard drained into Ironwood."), done()],
    ];
    const { streamer } = script(turns);
    const app = agentRoutes({
      v1: makeV1(),
      chain: makeChain(),
      streamer,
      now: () => FIXTURE_NOW_MS,
      budget: { check: async () => ({ allowed: true, tokensUsed: 0 }), record: async () => {} },
    });
    const question = "secret-question-words how did Orchard drain since July?";
    const res = await app.request(
      new Request("http://localhost/agent/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
      }),
    );
    const body = await res.text();
    const frame = body.split("\n\n").find((f) => f.startsWith("event: chart"));
    expect(frame).toBeDefined();
    const chart = parsePlottedChart(JSON.parse(frame!.split("\ndata: ")[1]!));
    expect(chart).not.toBeNull();
    // No free text crosses with it: ids and numbers only, so the question cannot be in it.
    expect(frame).not.toContain("secret-question-words");
    expect(frame).not.toMatch(/https?:|\/charts\//);
  });
});

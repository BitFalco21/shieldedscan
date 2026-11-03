import { describe, expect, it } from "vitest";
import {
  allSeriesSpecs,
  parsePlottedChart,
  plottableSeries,
  seriesKey,
  sharedChartProblem,
  type PlotSeriesSpec,
} from "@/domain";
import type { CompletionParams, StreamEvent } from "../chat-client";
import { runAgentTurn, type AgentEvent } from "../loop";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_WITHOUT_CHARTS } from "../prompt";
import { AgentTools, ChartSourceCache, type ChainRequester } from "../tools";
import { CHART_REFUSAL_REASONS } from "../tools/chart-refusal";
import { CHART_SOURCES } from "../tools/chart-sources";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

/**
 * The adversarial set: every way a question, a model or an upstream can try to make a chart break,
 * mislead or load the backend. Each case must end in a correct chart or a clean refusal in words,
 * and the answer stream must always reach `done`.
 */

const SENTINEL = 987_654_321;

function tools(chain: ChainRequester = makeChain(), cache?: ChartSourceCache) {
  return new AgentTools(makeV1(), chain, () => FIXTURE_NOW_MS, undefined, {
    ...(cache === undefined ? {} : { chartCache: cache }),
  });
}

const reasonOf = (content: string) =>
  content.match(/<refusal source="chart" reason="([a-z-]+)">/)?.[1];

/** A chart, or a refusal with a known reason: nothing else is an acceptable outcome. */
async function outcome(args: unknown, chain?: ChainRequester) {
  const result = await tools(chain).dispatch("make_chart", JSON.stringify(args));
  if (result.chart !== undefined) {
    // What the console would draw: it survives the wire and its own strict parser unchanged.
    expect(parsePlottedChart(JSON.parse(JSON.stringify(result.chart)))).toEqual(result.chart);
    for (const s of result.chart.series) {
      expect(s.values.filter((v) => v !== null).length).toBeGreaterThanOrEqual(2);
      expect(s.values.every((v) => v === null || Number.isFinite(v))).toBe(true);
    }
    return { kind: "chart" as const, chart: result.chart };
  }
  const reason = reasonOf(result.content);
  expect(CHART_REFUSAL_REASONS as readonly string[], result.content).toContain(reason);
  return { kind: "refusal" as const, reason: reason!, content: result.content };
}

describe("arguments a model or a prompt injection can send", () => {
  it.each([
    [
      "figures in an extra key",
      { series: [{ family: "price" }], values: [SENTINEL] },
      "bad-parameter",
    ],
    [
      "a title carrying a figure",
      { series: [{ family: "price" }], title: `${SENTINEL} ZEC` },
      "bad-parameter",
    ],
    [
      "a number in a parameter",
      { series: [{ family: "pool", pool: SENTINEL, metric: "balance" }] },
      "bad-parameter",
    ],
    [
      "a figure inside a series",
      { series: [{ family: "price", value: SENTINEL }] },
      "bad-parameter",
    ],
    ["an id from the old catalogue", { series: ["orchard-balance"] }, "bad-parameter"],
    ["a family that does not exist", { series: [{ family: "tvl" }] }, "not-chartable"],
    ["hashrate", { series: [{ family: "mining", metric: "hashrate" }] }, "not-chartable"],
    [
      "an address",
      { series: [{ family: "address", address: "t1RankFiveHundredFixtureAddress00001" }] },
      "per-address",
    ],
    [
      "an address as an argument",
      { series: [{ family: "price" }], address: "t1abc" },
      "per-address",
    ],
    [
      "a chain not listed",
      { series: [{ family: "crosschain", direction: "in", chain: "<script>" }] },
      "names-nothing",
    ],
    [
      "a venue not listed",
      { series: [{ family: "crosschain", direction: "in", venue: "uniswap" }] },
      "bad-parameter",
    ],
    [
      "an asset",
      { series: [{ family: "crosschain", direction: "in", asset: "USDC" }] },
      "not-chartable",
    ],
    ["a series as a string of JSON", { series: ['{"family":"price"}'] }, "bad-parameter"],
    ["a series that is null", { series: [null] }, "bad-parameter"],
    ["series that is an object", { series: { family: "price" } }, "bad-parameter"],
    [
      "a thousand series",
      { series: Array.from({ length: 1_000 }, () => ({ family: "price" })) },
      "too-many-series",
    ],
    [
      "price beside a balance",
      { series: [{ family: "price" }, { family: "pool", pool: "orchard", metric: "balance" }] },
      "mixed-measures",
    ],
    [
      "fees beside difficulty",
      {
        series: [
          { family: "fees", stat: "total" },
          { family: "mining", metric: "difficulty" },
        ],
      },
      "mixed-measures",
    ],
    [
      "a share beside a count",
      {
        series: [
          { family: "mining", metric: "top1-share" },
          { family: "mining", metric: "blocks" },
        ],
      },
      "mixed-measures",
    ],
    [
      "pools beside privacy kinds",
      {
        series: [
          { family: "transactions", pool: "orchard" },
          { family: "transactions", kind: "mixed" },
        ],
      },
      "split",
    ],
    ["year 1900", { series: [{ family: "price" }], from: "1900-01-01" }, "window"],
    ["the future", { series: [{ family: "price" }], from: "2030-01-01" }, "window"],
    [
      "from after to",
      { series: [{ family: "price" }], from: "2026-07-20", to: "2026-07-01" },
      "window",
    ],
    [
      "a fifty-year span",
      { series: [{ family: "price" }], from: "1990-01-01", to: "2040-01-01" },
      "window",
    ],
    [
      "a single day",
      { series: [{ family: "price" }], from: "2026-07-30", to: "2026-07-31" },
      "window",
    ],
    [
      "a day that does not exist",
      { series: [{ family: "price" }], from: "2026-02-30" },
      "bad-parameter",
    ],
    [
      "log on an area",
      { series: [{ family: "price" }], type: "area", scale: "log" },
      "bad-parameter",
    ],
    [
      "log on a series of zeros",
      {
        series: [{ family: "pool", pool: "sprout", metric: "transactions" }],
        from: "2026-07-01",
        scale: "log",
      },
      "log-zero",
    ],
    [
      "a pool before it existed",
      {
        series: [{ family: "pool", pool: "ironwood", metric: "balance" }],
        from: "2026-01-01",
        to: "2026-07-01",
      },
      "no-data",
    ],
    [
      "migrations into Sprout, zero throughout",
      { series: [{ family: "pool", pool: "sprout", metric: "migrated-in" }], from: "2026-07-01" },
      "no-data",
    ],
    [
      "a chain over one week",
      { series: [{ family: "crosschain", direction: "in", chain: "BTC" }], from: "2026-07-27" },
      "monthly-only",
    ],
    [
      "a share over a fortnight",
      { series: [{ family: "mining", metric: "top10-share" }], range: "30d" },
      "monthly-only",
    ],
    [
      "a daily median two years back",
      { series: [{ family: "fees", stat: "median", kind: "mixed" }], from: "2024-06-01" },
      "reach",
    ],
    [
      "Sprout beside Sapling, linear",
      {
        series: [
          { family: "pool", pool: "sprout", metric: "balance" },
          { family: "pool", pool: "sapling", metric: "balance" },
        ],
        from: "2026-07-01",
      },
      "spread",
    ],
  ])("%s → %s", async (_name, args, reason) => {
    const out = await outcome(args);
    expect(out.kind, JSON.stringify(out)).toBe("refusal");
    if (out.kind === "refusal") expect(out.reason).toBe(reason);
    expect(JSON.stringify(out)).not.toContain(String(SENTINEL).slice(0, 6) + "321 ZEC");
  });

  it("names a closest chart the tool can actually draw, wherever it names one", async () => {
    const asks: unknown[] = [
      { series: [{ family: "mining", metric: "hashrate" }] },
      { series: [{ family: "crosschain", direction: "in", chain: "BTC" }], from: "2026-07-20" },
      {
        series: [{ family: "price" }, { family: "pool", pool: "orchard", metric: "balance" }],
        from: "2026-07-26",
      },
      {
        series: [
          { family: "pool", pool: "sprout", metric: "balance" },
          { family: "pool", pool: "sapling", metric: "balance" },
        ],
        from: "2026-07-01",
      },
      { series: [{ family: "fees", stat: "median", kind: "mixed" }], from: "2024-06-01" },
    ];
    for (const args of asks) {
      const out = await outcome(args);
      expect(out.kind).toBe("refusal");
      const offers = [
        ...(out.kind === "refusal" ? out.content : "").matchAll(/closest: make_chart (.*)/g),
      ];
      expect(offers.length, JSON.stringify(args)).toBeGreaterThan(0);
      const drawn = await Promise.all(offers.map((m) => outcome(JSON.parse(m[1]!))));
      expect(
        drawn.some((d) => d.kind === "chart"),
        JSON.stringify(args),
      ).toBe(true);
    }
  });
});

describe("every allowed pair of series", () => {
  // One per drawing class keeps this to a few hundred calls; chains and venues draw alike.
  const specs = allSeriesSpecs().filter(
    (s) =>
      !(s.family === "crosschain" && s.by === "chain" && !["BTC", "ETH"].includes(s.chain)) &&
      !(s.family === "crosschain" && s.by === "venue" && s.venue !== "maya"),
  );
  const pairs: [PlotSeriesSpec, PlotSeriesSpec][] = [];
  for (const [i, a] of specs.entries()) {
    for (const b of specs.slice(i + 1)) {
      if (sharedChartProblem([plottableSeries(a), plottableSeries(b)]) === null) pairs.push([a, b]);
    }
  }

  // A few hundred dispatches: seconds alone, longer beside the rest of the suite.
  it(`draws or refuses cleanly, over a year and over all of history (${pairs.length} pairs)`, async () => {
    let charts = 0;
    for (const [a, b] of pairs) {
      for (const window of [{ range: "1y" }, { range: "all" }, { range: "30d" }]) {
        const out = await outcome({ series: [a, b], ...window });
        if (out.kind === "chart") {
          charts++;
          expect(out.chart.series.map((s) => seriesKey(s.spec))).toEqual([
            seriesKey(a),
            seriesKey(b),
          ]);
        }
      }
    }
    expect(charts).toBeGreaterThan(pairs.length);
  }, 60_000);
});

describe("upstreams that fail, time out or lie", () => {
  const supplyPath = CHART_SOURCES.supplyDays.path;
  const orchard = {
    series: [{ family: "pool", pool: "orchard", metric: "balance" }],
    range: "90d",
  };

  it.each([
    ["a 503", () => new Response("{}", { status: 503 })],
    ["a 500 with HTML", () => new Response("<html>oops</html>", { status: 500 })],
    ["a 200 that is not JSON", () => new Response("not json", { status: 200 })],
    ["a 200 of the wrong shape", () => new Response(JSON.stringify({ rows: [] }), { status: 200 })],
    [
      "a 200 with a string where a number goes",
      () => new Response(JSON.stringify([{ timestamp: 1, orchardZat: "5" }]), { status: 200 }),
    ],
    [
      "a throw",
      () => {
        throw new Error("ECONNRESET");
      },
    ],
  ])("%s is a refusal, never a partial chart", async (_name, respond) => {
    const chain: ChainRequester = {
      request: (path) => (path === supplyPath ? respond() : makeChain().request(path)),
    };
    const out = await outcome(orchard, chain);
    expect(out.kind).toBe("refusal");
    if (out.kind === "refusal") expect(out.reason).toBe("unavailable");
  });

  it("a read that hangs is refused at the timeout, and the answer goes on to done", async () => {
    const hung: ChainRequester = {
      request: (path) =>
        path === supplyPath ? new Promise<Response>(() => {}) : makeChain().request(path),
    };
    const t = tools(hung, new ChartSourceCache({ timeoutMs: 50 }));
    const events = await turn(t, [
      [{ type: "content", text: "Charting." }, done([call("c1", orchard)])],
      [{ type: "content", text: "The source could not be read just now." }, done()],
    ]);
    expect(events.at(-1)).toMatchObject({ event: "done", data: { stopReason: "complete" } });
    expect(events.some((e) => e.event === "chart")).toBe(false);
  });

  it("one chart failing mid-answer does not take the other, nor the answer", async () => {
    const chain: ChainRequester = {
      request: (path) =>
        path === supplyPath ? new Response("{}", { status: 503 }) : makeChain().request(path),
    };
    const events = await turn(tools(chain), [
      [
        { type: "content", text: "Charting." },
        done([
          call("c1", orchard),
          call("c2", { series: [{ family: "price" }], from: "2026-07-26" }),
        ]),
      ],
      [{ type: "content", text: "Here is the price; the balance could not be read." }, done()],
    ]);
    expect(events.filter((e) => e.event === "chart")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ event: "done" });
  });
});

describe("many charts in one answer", () => {
  it("shows at most two, once each, whatever the model asks", async () => {
    const asks = [
      { series: [{ family: "price" }], from: "2026-07-26" },
      { series: [{ family: "price" }], from: "2026-07-26" },
      { series: [{ family: "mining", metric: "difficulty" }], range: "30d" },
      { series: [{ family: "pool", pool: "orchard", metric: "balance" }], range: "30d" },
      ...Array.from({ length: 6 }, () => ({
        series: [{ family: "fees", stat: "total" }],
        range: "30d",
      })),
    ];
    const events = await turn(tools(), [
      [{ type: "content", text: "Charting." }, done(asks.map((a, i) => call(`c${i}`, a)))],
      [{ type: "content", text: "Two charts." }, done()],
    ]);
    const charts = events.filter((e) => e.event === "chart");
    expect(charts).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ event: "done" });
  });
});

describe("the off switch", () => {
  it("removes the tool, its dispatch and its prompt section", async () => {
    const off = new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS, undefined, {
      charts: false,
    });
    expect(off.defs().map((d) => d.function.name)).not.toContain("make_chart");
    const result = await off.dispatch(
      "make_chart",
      JSON.stringify({ series: [{ family: "price" }] }),
    );
    expect(result.content).toMatch(/^unknown tool: make_chart/);
    expect(result.chart).toBeUndefined();
    expect(SYSTEM_PROMPT).toContain("## Charts");
    expect(SYSTEM_PROMPT_WITHOUT_CHARTS).not.toMatch(/make_chart|## Charts/);
    expect(SYSTEM_PROMPT.length - SYSTEM_PROMPT_WITHOUT_CHARTS.length).toBeGreaterThan(500);
  });

  it("sends the prompt without the chart section when charts are off", async () => {
    const off = new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS, undefined, {
      charts: false,
    });
    const seen: CompletionParams[] = [];
    await turn(off, [[{ type: "content", text: "Words only." }, done()]], seen);
    expect(seen[0]!.messages[0]!.content).toBe(SYSTEM_PROMPT_WITHOUT_CHARTS);
    expect(
      seen[0]!.tools.map((t) => (t as { function: { name: string } }).function.name),
    ).not.toContain("make_chart");
  });
});

describe("backend load", () => {
  /** A chain requester that counts each path it is asked for. */
  function counting(delayMs = 5) {
    const reads = new Map<string, number>();
    const inner = makeChain();
    const chain: ChainRequester = {
      request: async (path) => {
        reads.set(path, (reads.get(path) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, delayMs));
        return inner.request(path);
      },
    };
    return { chain, reads };
  }

  it("fifty people charting at once share one read of each source", async () => {
    const { chain, reads } = counting(20);
    const shared = tools(chain);
    const asks = [
      { series: [{ family: "pool", pool: "orchard", metric: "balance" }], range: "90d" },
      { series: [{ family: "supply", part: "shielded" }], range: "all" },
      { series: [{ family: "transactions", kind: "mixed" }], range: "1y" },
      { series: [{ family: "crosschain", direction: "in", chain: "BTC" }], range: "1y" },
      { series: [{ family: "mining", metric: "top1-share" }], range: "1y" },
    ];
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        shared.dispatch("make_chart", JSON.stringify(asks[i % asks.length])),
      ),
    );
    expect(results.every((r) => r.chart !== undefined)).toBe(true);
    for (const [path, n] of reads) expect(n, path).toBe(1);
    expect([...reads.keys()].sort()).toEqual(
      [
        CHART_SOURCES.supplyDays.path,
        CHART_SOURCES.days.path,
        CHART_SOURCES.ccInflow.path,
        CHART_SOURCES.minerShares.path,
      ].sort(),
    );
  });

  it("reads again only once the cache has expired, and never caches a failure", async () => {
    let now = 0;
    const cache = new ChartSourceCache({ ttlMs: 1_000, clock: () => now });
    let fail = true;
    let reads = 0;
    const chain: ChainRequester = {
      request: (path) => {
        reads++;
        if (fail) return new Response("{}", { status: 503 });
        return makeChain().request(path);
      },
    };
    const t = tools(chain, cache);
    const ask = JSON.stringify({
      series: [{ family: "pool", pool: "orchard", metric: "balance" }],
      range: "30d",
    });
    expect((await t.dispatch("make_chart", ask)).chart).toBeUndefined();
    fail = false;
    expect((await t.dispatch("make_chart", ask)).chart).toBeDefined();
    expect((await t.dispatch("make_chart", ask)).chart).toBeDefined();
    expect(reads).toBe(2);
    now = 1_001;
    await t.dispatch("make_chart", ask);
    expect(reads).toBe(3);
  });

  it("reads the price history from one fixed start, whatever window is asked", async () => {
    const paths: string[] = [];
    const v1 = makeV1();
    const t = new AgentTools(
      {
        request: (p) => {
          paths.push(p);
          return v1.request(p);
        },
      },
      makeChain(),
      () => FIXTURE_NOW_MS,
    );
    for (const window of [{ range: "30d" }, { from: "2026-07-26" }, { range: "all" }]) {
      await t.dispatch("make_chart", JSON.stringify({ series: [{ family: "price" }], ...window }));
    }
    expect(new Set(paths).size).toBe(1);
    expect(paths).toHaveLength(1);
  });
});

/* A scripted turn, as `chart-loop.test.ts` drives one. */
const done = (toolCalls: { id: string; name: string; arguments: string }[] = []): StreamEvent => ({
  type: "done",
  finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
  toolCalls,
  usage: { promptTokens: 1_000, completionTokens: 50 },
});
const call = (id: string, args: unknown) => ({
  id,
  name: "make_chart",
  arguments: JSON.stringify(args),
});

async function turn(
  t: AgentTools,
  turns: StreamEvent[][],
  seen: CompletionParams[] = [],
): Promise<AgentEvent[]> {
  async function* streamer(p: CompletionParams): AsyncGenerator<StreamEvent> {
    seen.push(p);
    const next = turns.shift();
    if (next === undefined) throw new Error("script exhausted");
    for (const e of next) yield e;
  }
  const events: AgentEvent[] = [];
  for await (const e of runAgentTurn(
    { streamer, tools: t, now: () => FIXTURE_NOW_MS },
    [{ role: "user", content: "chart it" }],
    new AbortController().signal,
  )) {
    events.push(e);
  }
  return events;
}

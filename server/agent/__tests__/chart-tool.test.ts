import { describe, expect, it } from "vitest";
import {
  allSeriesSpecs,
  DAY_SECONDS,
  nextPeriod,
  plottableSeries,
  seriesKey,
  type PlotGrain,
  type PlotSeriesSpec,
  type PlottedChart,
} from "@/domain";
import { analyticsRoutes } from "../../analytics-routes";
import { chartSeriesRoutes } from "../../chart-series-routes";
import { crosschainRoutes } from "../../crosschain-routes";
import { MemoryStorePort } from "../../crosschain-store";
import { AgentTools, type ChainRequester } from "../tools";
import { isRefusal, parseChartArgs, type ChartRequest } from "../tools/chart-args";
import { CHART_SOURCES, seriesSource } from "../tools/chart-sources";
import { linearSpreadRefusal, MAX_LINEAR_SPREAD } from "../tools/chart-tool";
import {
  BLOCKS_DAILY,
  DAY_SERIES,
  FEE_KIND_DAYS,
  FEE_TOTALS,
  FLOW_MONTHS,
  INFLOW_BY_CHAIN,
  OUTFLOW_BY_CHAIN,
  MINER_SHARES,
  MONTH_SERIES,
  NETWORK_DAILY,
  NOTE_TREES,
  PARTIAL_FEE_DAY,
  POOL_MIGRATIONS,
  POOL_USAGE,
  SUPPLY_DAYS,
  TRANSPARENT_DAYS,
  UNREAD_DIFFICULTY_DAY,
  UNREAD_SAPLING_DAY,
  VENUE_MONTHS,
} from "../testing/chart-fixtures";
import {
  CHAIN_TOKEN,
  CROSSCHAIN_VOLUME,
  DAILY_PRICES,
  FIXTURE_NOW_MS,
  makeChain,
  makeV1,
  SHIELDING_FLOW_DAYS,
} from "../testing/fixture-world";
import { v1PriceRoutes } from "../../v1/prices";

/**
 * `make_chart`: what it accepts, what it reads, and the property the whole feature rests on —
 * every plotted number is one this explorer read, recomputed here independently from the fixture
 * rows, and nothing the model sends can become one.
 */

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const TODAY = day("2026-08-03");

const S = {
  balance: (pool: "sprout" | "sapling" | "orchard" | "ironwood") =>
    ({ family: "pool", pool, metric: "balance" }) as const,
  poolTxs: (pool: "sprout" | "sapling" | "orchard" | "ironwood") =>
    ({ family: "pool", pool, metric: "transactions" }) as const,
  kind: (kind: "transparent" | "mixed" | "shielded") => ({ family: "transactions", kind }) as const,
  supply: (part: "shielded" | "transparent" | "lockbox" | "circulating") =>
    ({ family: "supply", part }) as const,
  fees: { family: "fees", stat: "total" } as const,
  price: { family: "price" } as const,
  difficulty: { family: "mining", metric: "difficulty" } as const,
};

function tools(chain: ChainRequester = makeChain()) {
  return new AgentTools(makeV1(), chain, () => FIXTURE_NOW_MS);
}

async function chartFor(args: Record<string, unknown>, chain?: ChainRequester) {
  return tools(chain).dispatch("make_chart", JSON.stringify(args));
}

/** A dispatch that must have drawn a chart. */
async function drawn(args: Record<string, unknown>): Promise<PlottedChart> {
  const result = await chartFor(args);
  expect(result.chart, result.content).toBeDefined();
  return result.chart!;
}

describe("make_chart's arguments", () => {
  const parse = (args: Record<string, unknown>) => parseChartArgs(args, FIXTURE_NOW_MS);

  it("accepts series, a window and the two drawing options, with the site's defaults", () => {
    expect(parse({ series: [S.balance("orchard")] })).toEqual({
      series: [S.balance("orchard")],
      type: "line",
      scale: "linear",
      fromDay: day("2016-10-28"),
      toDay: TODAY + DAY_SECONDS,
      range: "all",
    });
    expect(parse({ series: [S.price], range: "90d", type: "area" })).toMatchObject({
      fromDay: TODAY - 90 * DAY_SECONDS,
      range: "90d",
      type: "area",
    });
  });

  it("canonicalises a series however it was spelled, and draws a duplicate once", () => {
    const req = parse({
      series: [
        { family: "Transactions", pool: "ORCHARD" },
        { metric: "transactions", pool: "orchard", family: "pool" },
      ],
    }) as ChartRequest;
    expect(isRefusal(req)).toBe(false);
    expect(req.series.map(seriesKey)).toEqual(["pool:orchard:transactions"]);
    const chain = parse({
      series: [{ family: "crosschain", chain: "bitcoin", direction: "in" }],
    }) as ChartRequest;
    expect(chain.series.map(seriesKey)).toEqual(["crosschain:in:chain:BTC"]);
  });

  it.each([
    [{}, "bad-parameter", /series must be a list/],
    [{ series: [] }, "bad-parameter", /series must be a list/],
    [{ series: ["orchard-balance"] }, "bad-parameter", /each series is an object/],
    [{ series: [{ family: "hashrate" }] }, "not-chartable", /difficulty moves with it/],
    [
      { series: [{ family: "pool", pool: "zebra", metric: "balance" }] },
      "bad-parameter",
      /pool's pool must be one of/,
    ],
    [
      { series: [{ family: "pool", pool: "sprout", metric: "notes" }] },
      "names-nothing",
      /no note tree size for Sprout/,
    ],
    [{ series: [{ family: "pool", pool: "orchard" }] }, "bad-parameter", /pool needs metric/],
    [
      { series: [{ family: "price", currency: "eur" }] },
      "bad-parameter",
      /price takes no parameters/,
    ],
    [{ series: [{ family: "fees", stat: "median" }] }, "bad-parameter", /fees needs kind/],
    [
      { series: [{ family: "fees", stat: "total", kind: "mixed" }] },
      "names-nothing",
      /not split by kind/,
    ],
    [
      { series: [{ family: "crosschain", direction: "in", chain: "DOGECOINZ" }] },
      "names-nothing",
      /not among the chains/,
    ],
    [
      { series: [{ family: "crosschain", direction: "in", chain: "BTC", measure: "transfers" }] },
      "names-nothing",
      /transfer counts are per total only/,
    ],
    [
      { series: [{ family: "transactions", kind: "mixed", pool: "orchard" }] },
      "names-nothing",
      /never both/,
    ],
    [
      { series: [{ family: "pool", pool: "orchard", metric: "balance", address: "t1abc" }] },
      "per-address",
      /not charted, on purpose/,
    ],
    [{ series: [S.balance("orchard"), S.price] }, "mixed-measures", /different measures/],
    [
      { series: [S.fees, { family: "pool", pool: "orchard", metric: "notes" }] },
      "mixed-measures",
      /different measures/,
    ],
    [{ series: [S.kind("mixed"), S.poolTxs("ironwood")] }, "split", /split the same transactions/],
    [
      {
        series: [
          S.balance("sprout"),
          S.balance("sapling"),
          S.balance("orchard"),
          S.balance("ironwood"),
        ],
      },
      "too-many-series",
      /at most 3/,
    ],
    [{ series: [S.price], type: "pie" }, "bad-parameter", /type must be/],
    [{ series: [S.price], scale: "sqrt" }, "bad-parameter", /scale must be/],
    [{ series: [S.price], type: "area", scale: "log" }, "bad-parameter", /needs a zero/],
    [{ series: [S.price], range: "7d" }, "bad-parameter", /range must be one of/],
    [{ series: [S.price], range: "30d", from: "2026-07-01" }, "bad-parameter", /never both/],
    [{ series: [S.price], to: "2026-07-01" }, "bad-parameter", /to needs a from/],
    [{ series: [S.price], from: "2026-02-31" }, "bad-parameter", /real UTC day/],
    [{ series: [S.price], from: 20260701 }, "bad-parameter", /real UTC day/],
    [
      { series: [S.price], from: "2026-07-01", to: "2026-07-01" },
      "window",
      /to must be after from/,
    ],
    [
      { series: [S.price], from: "2026-08-01", to: "2026-07-01" },
      "window",
      /to must be after from/,
    ],
    [{ series: [S.price], from: "1900-01-01" }, "window", /on or after 2016-10-28/],
    [{ series: [S.price], from: "2027-01-01" }, "window", /in the future/],
    [{ series: [S.price], from: "2026-07-01", to: "2027-01-01" }, "window", /future/],
    [
      { series: [S.price], from: "1976-01-01", to: "2026-01-01" },
      "window",
      /on or after 2016-10-28/,
    ],
  ])("refuses %j as %s", (args, reason, message) => {
    const result = parse(args);
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe(reason);
    expect(result.message).toMatch(message);
  });

  it("refuses any key it does not know by name, so a figure can never ride along", () => {
    for (const key of ["values", "data", "points", "title", "yMax", "label", "caption"]) {
      const result = parse({ series: [S.balance("orchard")], [key]: [1, 2, 3] });
      expect(isRefusal(result) && result.message).toMatch(
        new RegExp(`unknown argument ${key}.*takes no figures`),
      );
    }
  });

  it("holds numbers only in the window's two day starts — at compile time", () => {
    type NumericKeys = {
      [K in keyof ChartRequest]-?: ChartRequest[K] extends number ? K : never;
    }[keyof ChartRequest];
    // A third numeric field would make this assignment fail to compile.
    const numeric: Record<NumericKeys, true> = { fromDay: true, toDay: true };
    expect(Object.keys(numeric)).toEqual(["fromDay", "toDay"]);
  });

  it("lets no model-supplied number through, whatever the shape of the call (fuzz)", () => {
    const SENTINEL = 987_654_321;
    const values: unknown[] = [
      SENTINEL,
      String(SENTINEL),
      [SENTINEL],
      { v: SENTINEL },
      `${SENTINEL}-01-01`,
      "2026-07-01",
      "orchard",
      "all",
      "log",
      null,
    ];
    const keys = ["series", "range", "from", "to", "type", "scale", "values", "max"];
    const specKeys = ["family", "pool", "metric", "chain", "value", "v", "kind"];
    const specs = allSeriesSpecs();
    let seed = 7;
    const pick = <T>(xs: readonly T[]): T => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return xs[seed % xs.length]!;
    };
    let accepted = 0;
    for (let n = 0; n < 3_000; n++) {
      const spec: Record<string, unknown> = { ...pick(specs) };
      if (n % 5 === 0) spec[pick(specKeys)] = pick(values);
      const args: Record<string, unknown> = { series: [spec] };
      for (let k = 0; k < n % 3; k++) args[pick(keys)] = pick(values);
      const result = parse(args);
      if (isRefusal(result)) continue;
      accepted++;
      // Every number left is a UTC day start the window parsed, never the sentinel.
      expect(JSON.stringify(result)).not.toContain(String(SENTINEL));
      for (const t of [result.fromDay, result.toDay]) expect(t % DAY_SECONDS).toBe(0);
    }
    expect(accepted).toBeGreaterThan(0);
  });
});

/**
 * The reference implementation the tool is checked against: written separately, from the fixture
 * arrays and the stated rules, so a slip in the tool's resampler cannot pass by agreeing with
 * itself. A closing value is the last row inside the period; a flow is the sum of every day in it,
 * or unknown if any is missing; today is never read.
 */
function expected(
  rows: readonly { t: number; v: number | null }[],
  kind: "stock" | "flow",
  grain: PlotGrain,
  starts: readonly number[],
): (number | null)[] {
  return starts.map((start) => {
    const stop = Math.min(nextPeriod(grain, start), TODAY);
    const inside = rows.filter((r) => r.t >= start && r.t < stop);
    if (kind === "stock") return inside.at(-1)?.v ?? null;
    const days = (stop - start) / DAY_SECONDS;
    if (inside.length !== days || inside.some((r) => r.v === null)) return null;
    return inside.reduce((sum, r) => sum + (r.v as number), 0);
  });
}

const rowsOf = <T extends { timestamp: number }>(
  points: readonly T[],
  value: (p: T) => number | null,
) => points.map((p) => ({ t: p.timestamp, v: value(p) }));

/** Leading zeros as absence, by the rule stated in the catalogue. */
const absentUntilFirst = (rows: { t: number; v: number | null }[]) => {
  const first = rows.findIndex((r) => r.v !== null && r.v !== 0);
  return rows.map((r, i) => (i < first ? { ...r, v: null } : r));
};

describe("what make_chart reads, and that every plotted number is one it read", () => {
  it("draws the owner's example: Orchard draining into Ironwood since July, per day", async () => {
    const chart = await drawn({
      series: [S.balance("orchard"), S.balance("ironwood")],
      from: "2026-07-01",
    });
    expect(chart.grain).toBe("day");
    expect(chart.timestamps[0]).toBe(day("2026-07-01"));
    // Through yesterday: the supply closes stop at the last complete day.
    expect(chart.timestamps.at(-1)).toBe(day("2026-08-02"));
    const orchard = rowsOf(SUPPLY_DAYS, (p) => p.orchardZat);
    const ironwood = absentUntilFirst(rowsOf(SUPPLY_DAYS, (p) => p.ironwoodZat));
    expect(chart.series[0]!.values).toEqual(expected(orchard, "stock", "day", chart.timestamps));
    expect(chart.series[1]!.values).toEqual(expected(ironwood, "stock", "day", chart.timestamps));
    // Before activation Ironwood is absent, not a measured zero.
    expect(chart.series[1]!.values[0]).toBeNull();
    expect(chart.reachesPresent).toBe(true);
  });

  it("the shielded total and circulating supply come from the same closes, an unread pool a gap", async () => {
    const chart = await drawn({
      series: [S.supply("shielded"), S.supply("circulating")],
      from: "2026-06-01",
    });
    const shielded = rowsOf(SUPPLY_DAYS, (p) =>
      p.saplingZat === null
        ? null
        : p.sproutZat! + p.saplingZat + (p.orchardZat ?? 0) + (p.ironwoodZat ?? 0),
    );
    expect(chart.series[0]!.values).toEqual(expected(shielded, "stock", "day", chart.timestamps));
    const unread = chart.timestamps.indexOf(UNREAD_SAPLING_DAY);
    expect(chart.series[0]!.values[unread]).toBeNull();
    expect(chart.series[1]!.values[unread]).toBeNull();
    const k = unread + 1;
    expect(chart.series[1]!.values[k]! - chart.series[0]!.values[k]!).toBe(
      SUPPLY_DAYS.find((p) => p.timestamp === chart.timestamps[k])!.transparentZat,
    );
  });

  it("weeks: a closing value is the week's last close, and today's row is never read", async () => {
    const chart = await drawn({ series: [S.balance("sapling")], from: "2026-03-01" });
    expect(chart.grain).toBe("week");
    const rows = rowsOf(SUPPLY_DAYS, (p) => p.saplingZat);
    expect(chart.series[0]!.values).toEqual(expected(rows, "stock", "week", chart.timestamps));
    expect(chart.timestamps.at(-1)).toBe(day("2026-07-27"));
  });

  it("weeks: a flow is the sum of the week's days", async () => {
    const chart = await drawn({
      series: [S.poolTxs("orchard"), S.poolTxs("sapling")],
      from: "2026-03-01",
    });
    const of = (f: (p: (typeof POOL_USAGE)[number]) => number) =>
      expected(rowsOf(POOL_USAGE, f), "flow", "week", chart.timestamps);
    expect(chart.series[0]!.values).toEqual(of((p) => p.orchardTxs));
    expect(chart.series[1]!.values).toEqual(of((p) => p.saplingTxs));
  });

  it("past the daily sources' year, reads the monthly series, and flags the running month", async () => {
    const chart = await drawn({
      series: [S.kind("transparent"), S.kind("mixed")],
      from: "2025-01-01",
    });
    expect(chart.grain).toBe("month");
    expect(chart.partialLast).toBe(true);
    const byMonth = new Map(MONTH_SERIES.map((m) => [m.timestamp, m]));
    expect(chart.series[0]!.values).toEqual(
      chart.timestamps.map((t) => byMonth.get(t)?.transparentTxs ?? null),
    );
  });

  it("reads the last year weekly, from the first whole week the daily source still holds", async () => {
    const chart = await drawn({ series: [S.fees], range: "1y" });
    expect(chart.grain).toBe("week");
    // The daily source holds 2025-08-02 onward (366 days back from 2026-08-03); the first Monday
    // inside it is 2025-08-04, so no week is summed over days it does not hold.
    expect(chart.timestamps[0]).toBe(day("2025-08-04"));
    expect(chart.series[0]!.values).toEqual(
      expected(
        rowsOf(FEE_TOTALS.daily, (p) => p.feeZat),
        "flow",
        "week",
        chart.timestamps,
      ),
    );
    expect(chart.series[0]!.values.every((v) => v !== null)).toBe(true);
  });

  it("keeps a pool's activation period as its real count, and starts where the pool does", async () => {
    const chart = await drawn({ series: [S.poolTxs("ironwood")], range: "all" });
    expect(chart.grain).toBe("month");
    // Leading periods with nothing to draw are not drawn: the chart opens on Ironwood's month.
    expect(chart.timestamps[0]).toBe(day("2026-07-01"));
    const julyDays = POOL_USAGE.filter(
      (p) => p.timestamp >= day("2026-07-01") && p.timestamp < day("2026-08-01"),
    );
    // Zeros before the 28th are true counts of July, so they are in the sum.
    expect(chart.series[0]!.values[0]).toBe(julyDays.reduce((s, p) => s + p.ironwoodTxs, 0));
  });

  it("migrations into a pool are absent before it existed, not a measured zero", async () => {
    const chart = await drawn({
      series: [{ family: "pool", pool: "ironwood", metric: "migrated-in" }],
      from: "2026-07-01",
    });
    const rows = absentUntilFirst(rowsOf(POOL_MIGRATIONS, (p) => p.toIronwoodZat));
    expect(chart.timestamps[0]).toBe(day("2026-07-28"));
    expect(chart.series[0]!.values).toEqual(expected(rows, "flow", "day", chart.timestamps));
  });

  it("note trees are closing values, read as the node reported them", async () => {
    const chart = await drawn({
      series: [{ family: "pool", pool: "orchard", metric: "notes" }],
      from: "2026-07-01",
    });
    expect(chart.series[0]!.values).toEqual(
      expected(
        rowsOf(NOTE_TREES, (p) => p.orchardNotes),
        "stock",
        "day",
        chart.timestamps,
      ),
    );
  });

  it("refuses a log axis for a series that never stays above zero", async () => {
    const result = await chartFor({
      series: [S.poolTxs("sprout")],
      from: "2026-07-01",
      scale: "log",
    });
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/reason="log-zero"[\s\S]*never stays above zero/);
    expect(result.content).toContain('closest: make_chart {"series":[{"family":"pool"');
  });

  it("inside the year, reads the daily sibling instead", async () => {
    const chart = await drawn({ series: [S.kind("shielded")], from: "2026-06-01" });
    expect(chart.grain).toBe("day");
    expect(chart.series[0]!.values).toEqual(
      expected(
        rowsOf(DAY_SERIES, (p) => p.shieldedTxs),
        "flow",
        "day",
        chart.timestamps,
      ),
    );
    expect(chart.timestamps.at(-1)).toBe(day("2026-08-02"));
  });

  it("carries a fee total's floor to the period it lands in", async () => {
    const chart = await drawn({ series: [S.fees], from: "2026-07-01" });
    const index = chart.timestamps.indexOf(PARTIAL_FEE_DAY);
    expect(chart.series[0]!.floors).toEqual([index]);
    expect(chart.series[0]!.values).toEqual(
      expected(
        rowsOf(FEE_TOTALS.daily, (p) => p.feeZat),
        "flow",
        "day",
        chart.timestamps,
      ),
    );
  });

  it("keeps a level series per day at any span, and an unread day a gap", async () => {
    const chart = await drawn({ series: [S.difficulty], range: "all" });
    expect(chart.grain).toBe("day");
    const unread = chart.timestamps.indexOf(UNREAD_DIFFICULTY_DAY);
    expect(chart.series[0]!.values[unread]).toBeNull();
    expect(chart.series[0]!.values.filter((v) => v !== null)).toEqual(
      NETWORK_DAILY.filter((p) => p.timestamp < TODAY && p.avgDifficulty !== null).map(
        (p) => p.avgDifficulty,
      ),
    );
  });

  it("draws a median fee per day within the year, and refuses it further back", async () => {
    const spec = { family: "fees", stat: "median", kind: "shielded" };
    const chart = await drawn({ series: [spec], from: "2026-07-01" });
    expect(chart.series[0]!.values).toEqual(
      expected(
        rowsOf(FEE_KIND_DAYS, (p) => p.shieldedZat),
        "stock",
        "day",
        chart.timestamps,
      ),
    );
    const old = await chartFor({ series: [spec], from: "2024-01-01" });
    expect(old.chart).toBeUndefined();
    expect(old.content).toMatch(/reason="reach"[\s\S]*only reaches back a year/);
    expect(old.content).toContain('"range":"1y"');
    expect(old.endpoints).toEqual(["chart-page:median-fee"]);
  });

  it("reads the stored daily closes for the price", async () => {
    const chart = await drawn({ series: [S.price], from: "2026-07-26" });
    expect(chart.series[0]!.values).toEqual(DAILY_PRICES.map((p) => p.usd));
  });

  it("draws a miner's share per month with the blocks it is a share of", async () => {
    const chart = await drawn({
      series: [{ family: "mining", metric: "top1-share" }],
      range: "1y",
    });
    expect(chart.grain).toBe("month");
    for (const [i, t] of chart.timestamps.entries()) {
      const m = MINER_SHARES.find((r) => r.timestamp === t)!;
      expect(chart.series[0]!.values[i]).toBeCloseTo((m.top1Blocks / m.blocks) * 100, 10);
      expect(chart.series[0]!.of![i]).toBe(m.blocks);
    }
    expect(chart.partialLast).toBe(true);
    expect(
      (await chartFor({ series: [{ family: "mining", metric: "top1-share" }], range: "1y" }))
        .content,
    ).toContain('"ofBlocks"');
  });

  it("draws one chain's swaps per month, a month without its swaps a zero", async () => {
    const chart = await drawn({
      series: [{ family: "crosschain", direction: "in", chain: "SOL" }],
      range: "1y",
    });
    expect(chart.grain).toBe("month");
    const sol = new Map(
      INFLOW_BY_CHAIN.filter((p) => p.chain === "SOL").map((p) => [p.timestamp, p.inZat]),
    );
    // SOL first swapped in 2025-09; the source's months before that hold other chains, so SOL is 0.
    expect(chart.series[0]!.values).toEqual(chart.timestamps.map((t) => sol.get(t) ?? 0));
    expect(chart.series[0]!.values[0]).toBe(0);
  });

  it("draws a venue per month, and the daily total of swaps", async () => {
    const venue = await drawn({
      series: [{ family: "crosschain", direction: "out", venue: "thorchain" }],
      range: "1y",
    });
    const rows = new Map(
      VENUE_MONTHS.filter((p) => p.protocol === "thorchain").map((p) => [p.timestamp, p.outZat]),
    );
    expect(venue.series[0]!.values).toEqual(venue.timestamps.map((t) => rows.get(t) ?? null));
    const total = await drawn({
      series: [{ family: "crosschain", direction: "in", measure: "transfers" }],
      from: "2026-07-19",
      to: "2026-07-27",
    });
    expect(total.series[0]!.values).toEqual(
      CROSSCHAIN_VOLUME.daily.filter((p) => p.timestamp < TODAY).map((p) => p.inTransfers),
    );
  });

  it("answers 'Bitcoin → Zcash last week' with the closest charts it can draw", async () => {
    const result = await chartFor({
      series: [{ family: "crosschain", direction: "in", chain: "BTC" }],
      from: "2026-07-20",
    });
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/reason="monthly-only"[\s\S]*kept per month/);
    expect(result.content).toMatch(/crosschain tool's aggregate/);
    // A whole year of the chain per month, and the total per day over the asked week.
    expect(result.content).toContain('"range":"1y"');
    expect(result.content).toContain('"by":"total"');
    expect(result.endpoints).toEqual(["chart-page:inflow-by-chain"]);
    // And the total over that week is drawn as offered.
    const offered = await drawn({
      series: [{ family: "crosschain", direction: "in", by: "total", measure: "zec" }],
      from: "2026-07-20",
      to: "2026-07-27",
    });
    expect(offered.grain).toBe("day");
  });

  it("says a chain with no swaps has none, rather than that it could not be read", async () => {
    const result = await chartFor({
      series: [{ family: "crosschain", direction: "in", chain: "DOGE" }],
      range: "1y",
    });
    expect(result.content).toMatch(
      /reason="no-data"[\s\S]*no swaps are recorded for ZEC from Dogecoin/,
    );
  });

  it("plots only values that occur in what the sources served (provenance sweep)", async () => {
    const served = new Set<number>();
    const add = (xs: readonly (number | null)[]) => xs.forEach((x) => x !== null && served.add(x));
    for (const p of SUPPLY_DAYS) {
      add([p.sproutZat, p.saplingZat, p.orchardZat, p.ironwoodZat, p.transparentZat, p.lockboxZat]);
    }
    add(MONTH_SERIES.flatMap((p) => [p.transparentTxs, p.mixedTxs, p.shieldedTxs]));
    add(FLOW_MONTHS.flatMap((p) => [p.shieldedZat, p.unshieldedZat]));
    add(FEE_TOTALS.monthly.map((p) => p.feeZat));
    add(NETWORK_DAILY.flatMap((p) => [p.avgDifficulty, p.avgBlockBytes]));
    add(TRANSPARENT_DAYS.map((p) => p.activeAddresses));
    add(DAILY_PRICES.map((p) => p.usd));
    add(DAY_SERIES.flatMap((p) => [p.transparentTxs, p.mixedTxs, p.shieldedTxs]));
    add(POOL_USAGE.flatMap((p) => [p.sproutTxs, p.saplingTxs, p.orchardTxs, p.ironwoodTxs]));
    add(POOL_MIGRATIONS.flatMap((p) => [p.toSaplingZat, p.toOrchardZat, p.toIronwoodZat]));
    add(NOTE_TREES.flatMap((p) => [p.saplingNotes, p.orchardNotes, p.ironwoodNotes]));
    add(FEE_KIND_DAYS.flatMap((p) => [p.transparentZat, p.mixedZat, p.shieldedZat]));
    add(BLOCKS_DAILY.map((p) => p.blocks));
    add(FEE_TOTALS.daily.map((p) => p.feeZat));
    add(SHIELDING_FLOW_DAYS.flatMap((p) => [p.shieldedZat, p.unshieldedZat]));
    add(CROSSCHAIN_VOLUME.daily.flatMap((p) => [p.inZat, p.outZat, p.inTransfers, p.outTransfers]));
    add(
      CROSSCHAIN_VOLUME.monthly.flatMap((p) => [p.inZat, p.outZat, p.inTransfers, p.outTransfers]),
    );
    add(INFLOW_BY_CHAIN.map((p) => p.inZat));
    add(OUTFLOW_BY_CHAIN.map((p) => p.outZat));
    add(VENUE_MONTHS.flatMap((p) => [p.inZat, p.outZat]));
    // A month a chain had no swaps in is the route's own absence of a row: a zero.
    served.add(0);
    let checked = 0;
    for (const spec of allSeriesSpecs()) {
      const meta = plottableSeries(spec);
      // Derived by stated arithmetic, and checked against a reference above instead: the supply
      // totals and the shares.
      if (spec.family === "supply" && (spec.part === "shielded" || spec.part === "circulating"))
        continue;
      if (meta.unit === "pct") continue;
      for (const args of [{ from: "2026-07-26" }, { range: "all" }]) {
        const result = await chartFor({ series: [spec], ...args });
        const c = result.chart;
        // Sums of days are not values any source served: the reference implementation checks those.
        const summed =
          c?.grain !== "day" && meta.kind === "flow" && seriesSource(spec).monthly === undefined;
        if (c === undefined || c.grain === "week" || summed) continue;
        for (const v of c.series[0]!.values) {
          if (v !== null)
            expect(served.has(v), `${seriesKey(spec)}: ${v} was never served`).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  }, 60_000);
});

describe("what make_chart refuses after reading", () => {
  it("draws nothing when a source is down, says so, and cites the page", async () => {
    const down: ChainRequester = {
      request: (path) => {
        if (path === CHART_SOURCES.supplyDays.path) return new Response("{}", { status: 503 });
        return makeChain().request(path);
      },
    };
    const result = await chartFor({ series: [S.balance("orchard"), S.balance("sapling")] }, down);
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/reason="unavailable"[\s\S]*Orchard balance could not be read/);
    expect(result.endpoints).toEqual(["chart-page:pool-balances"]);
  });

  it("draws nothing from a body of the wrong shape", async () => {
    const result = await chartFor(
      { series: [{ family: "mining", metric: "blocks" }], from: "2026-07-01" },
      makeChain({ [CHART_SOURCES.blocksDaily.path]: { blocks: [1, 2, 3] } }),
    );
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/reason="unavailable"/);
  });

  it("answers a single figure in words, not a one-point chart", async () => {
    const result = await chartFor({
      series: [S.balance("orchard")],
      from: "2026-08-01",
      to: "2026-08-02",
    });
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/reason="window"[\s\S]*fewer than two periods.*in words/);
  });

  it("refuses a series with fewer than two measured points in the window", async () => {
    // Ironwood had not activated: nothing to draw.
    const result = await chartFor({
      series: [S.balance("ironwood")],
      from: "2026-06-01",
      to: "2026-07-01",
    });
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/Ironwood balance has fewer than two measured points/);
    expect(result.content).toContain('"range":"all"');
  });

  it("cites nothing itself when it draws: the chart links its own page", async () => {
    const result = await chartFor({ series: [S.balance("orchard")], from: "2026-07-01" });
    expect(result.endpoints).toEqual([]);
  });

  it("refuses same-measure series too far apart for a linear axis, and draws them on log", async () => {
    // Sprout (~25K ZEC) beside Sapling (~4.2M ZEC): Sprout would be a flat line at the floor.
    const linear = await chartFor({
      series: [S.balance("sprout"), S.balance("sapling")],
      from: "2026-07-01",
    });
    expect(linear.chart).toBeUndefined();
    expect(linear.content).toMatch(
      /reason="spread"[\s\S]*Sprout balance's highest value is under 1\/50 of Sapling balance's.*flat line.*scale log, or chart them separately/,
    );
    expect(linear.content).toContain('"scale":"log"');
    const log = await chartFor({
      series: [S.balance("sprout"), S.balance("sapling")],
      from: "2026-07-01",
      scale: "log",
    });
    expect(log.chart!.scale).toBe("log");
  });

  it("offers only separate charts when a log axis cannot draw every series", async () => {
    // Sprout's daily transactions are 0 or 1: nothing two periods running above zero.
    const result = await chartFor({
      series: [S.poolTxs("sprout"), S.poolTxs("sapling")],
      from: "2026-07-01",
    });
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/flat line — chart them separately\n/);
    expect(result.content).not.toMatch(/scale log|"scale":"log"/);
  });

  it("keeps series within the spread on one linear axis", async () => {
    // The three privacy kinds, ~3,000 / ~600 / ~150 a day: twenty-fold, every line readable.
    const chart = await drawn({
      series: [S.kind("transparent"), S.kind("mixed"), S.kind("shielded")],
      from: "2026-07-01",
    });
    expect(chart.series).toHaveLength(3);
  });

  it("hands the model a summary of the same numbers, already formatted", async () => {
    const result = await chartFor({ series: [S.price], from: "2026-07-26" });
    expect(result.content).toContain("ZEC price (USD close) · since 2026-07-26 · daily · line");
    expect(result.content).toContain('"changeFirstToLast": "+$7.00 (+17.5%)"');
    expect(result.content).toMatch(/never reproduce its points/);
  });

  it("never throws: a requester that throws is a refusal, and the answer goes on", async () => {
    const throwing: ChainRequester = {
      request: () => {
        throw new Error("socket hang up");
      },
    };
    const result = await chartFor({ series: [S.balance("orchard")], range: "90d" }, throwing);
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/reason="unavailable"/);
  });
});

describe("the paths make_chart reads exist on the real service", () => {
  it("every source path is declared by the route modules production mounts", () => {
    const declared = new Set([
      ...analyticsRoutes().routes.map((r) => r.path),
      ...chartSeriesRoutes("postgres://unused").routes.map((r) => r.path),
      ...crosschainRoutes(new MemoryStorePort()).routes.map((r) => r.path),
      ...v1PriceRoutes(undefined).routes.map((r) => r.path),
    ]);
    for (const [name, spec] of Object.entries(CHART_SOURCES)) {
      expect(declared.has(spec.path), `${name}: nothing serves ${spec.path}`).toBe(true);
      expect(spec.path.startsWith("/v1/")).toBe(false);
    }
    expect(declared.has("/v1/prices/daily")).toBe(true);
  });

  it("the harness gates every private chart path behind the bearer token", async () => {
    const app = (await import("../testing/fixture-world")).chainApp();
    for (const spec of Object.values(CHART_SOURCES)) {
      expect((await app.request(spec.path)).status, spec.path).toBe(401);
    }
    expect(CHAIN_TOKEN).not.toBe("");
  });
});

/** Every series the families can name either draws in the fixture world, or says why not. */
describe("every series", () => {
  /** A window each family can fill on the fixture world. */
  const windowFor = (spec: PlotSeriesSpec): Record<string, string> => {
    if (spec.family === "price") return { from: "2026-07-26" };
    if (spec.family === "shielding") return { from: "2026-07-19", to: "2026-07-27" };
    if (spec.family === "crosschain")
      return spec.by === "total" ? { from: "2026-07-19", to: "2026-07-27" } : { range: "1y" };
    if (spec.family === "mining" && spec.metric.endsWith("share")) return { range: "1y" };
    return { from: "2026-07-01" };
  };
  // Zero throughout on the fixture world, and refused as such: a flat line at zero is not a chart.
  const ZERO = new Set(["pool:sprout:migrated-in"]);

  it.each(allSeriesSpecs().map((s) => [seriesKey(s), s] as const))("%s", async (key, spec) => {
    const result = await chartFor({ series: [spec], ...windowFor(spec) });
    const quiet =
      spec.family === "crosschain" &&
      spec.by === "chain" &&
      !(spec.direction === "in" ? ["BTC", "ETH", "SOL"] : ["BTC", "ETH"]).includes(spec.chain);
    if (ZERO.has(key) || quiet) {
      expect(result.chart).toBeUndefined();
      expect(result.content).toMatch(/reason="no-data"/);
    } else {
      expect(result.chart, result.content).toBeDefined();
    }
  });
});

describe("linearSpreadRefusal", () => {
  const line = { scale: "linear", type: "line" } as const;
  const s = (label: string, values: (number | null)[]) => ({ spec: S.price, label, values });

  it("allows up to the spread and refuses past it", () => {
    expect(linearSpreadRefusal(line, [s("a", [1, 50]), s("b", [1, 1])])).toBeNull();
    expect(linearSpreadRefusal(line, [s("a", [1, 51]), s("b", [1, 1])])?.message).toMatch(
      /^b's highest value is under 1\/50 of a's/,
    );
    expect(MAX_LINEAR_SPREAD).toBe(50);
  });

  it("ignores one series, a log axis, and unmeasured periods", () => {
    expect(linearSpreadRefusal(line, [s("a", [1, 1_000])])).toBeNull();
    expect(
      linearSpreadRefusal({ ...line, scale: "log" }, [s("a", [1, 1_000]), s("b", [1, 1])]),
    ).toBeNull();
    // A null is no reading, not a small one.
    expect(linearSpreadRefusal(line, [s("a", [null, 40, 40]), s("b", [null, 1, 1])])).toBeNull();
  });

  it("refuses a series that is zero throughout beside one that is not", () => {
    expect(linearSpreadRefusal(line, [s("a", [5, 9]), s("b", [0, 0])])?.message).toMatch(
      /^b is zero throughout that window.*chart them separately$/,
    );
  });

  it("never offers a log axis for an area, which needs a zero to fill to", () => {
    const area = { scale: "linear", type: "area" } as const;
    const msg = linearSpreadRefusal(area, [s("a", [100, 100]), s("b", [1, 1])])?.message;
    expect(msg).toMatch(/chart them separately$/);
    expect(msg).not.toMatch(/log/);
  });
});

import { describe, expect, it } from "vitest";
import {
  DAY_SECONDS,
  nextPeriod,
  PLOT_SERIES_IDS,
  plottableSeries,
  type PlotGrain,
  type PlotSeriesId,
  type PlottedChart,
} from "@/domain";
import { analyticsRoutes } from "../../analytics-routes";
import { chartSeriesRoutes } from "../../chart-series-routes";
import { v1PriceRoutes } from "../../v1/prices";
import { AgentTools, type ChainRequester } from "../tools";
import { parseChartArgs, type ChartRequest } from "../tools/chart-args";
import { CHART_SOURCES, SERIES_SOURCES } from "../tools/chart-sources";
import { linearSpreadRefusal, MAX_LINEAR_SPREAD } from "../tools/chart-tool";
import {
  BLOCKS_DAILY,
  DAY_SERIES,
  FEE_TOTALS,
  FLOW_MONTHS,
  MONTH_SERIES,
  NETWORK_DAILY,
  PARTIAL_FEE_DAY,
  POOL_USAGE,
  SHIELDED_SUPPLY,
  SUPPLY_DAYS,
  TRANSPARENT_DAYS,
  UNREAD_DIFFICULTY_DAY,
} from "../testing/chart-fixtures";
import {
  CHAIN_TOKEN,
  DAILY_PRICES,
  FIXTURE_NOW_MS,
  makeChain,
  makeV1,
  SHIELDING_FLOW_DAYS,
} from "../testing/fixture-world";

/**
 * `make_chart`: what it accepts, what it reads, and the property the whole feature rests on —
 * every plotted number is one this explorer read, recomputed here independently from the fixture
 * rows, and nothing the model sends can become one.
 */

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const TODAY = day("2026-08-03");

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
    expect(parse({ series: ["orchard-balance"] })).toEqual({
      series: ["orchard-balance"],
      type: "line",
      scale: "linear",
      fromDay: day("2016-10-28"),
      toDay: TODAY + DAY_SECONDS,
      range: "all",
    });
    expect(parse({ series: ["zec-price"], range: "90d", type: "area" })).toMatchObject({
      fromDay: TODAY - 90 * DAY_SECONDS,
      range: "90d",
      type: "area",
    });
  });

  it.each([
    [{}, /series must be a list/],
    [{ series: [] }, /series must be a list/],
    [{ series: ["a", "b", "c", "d"] }, /series must be a list/],
    [{ series: ["orchard"] }, /unknown series "orchard"/],
    [{ series: [42] }, /unknown series 42/],
    [{ series: ["orchard-balance", "orchard-balance"] }, /listed twice/],
    [{ series: ["orchard-balance", "zec-price"] }, /different measures/],
    [{ series: ["zec-shielded", "fees-paid"] }, /different measures/],
    [{ series: ["mixed-transactions", "ironwood-transactions"] }, /split the same transactions/],
    [{ series: ["zec-price"], type: "pie" }, /type must be/],
    [{ series: ["zec-price"], scale: "sqrt" }, /scale must be/],
    [{ series: ["zec-price"], type: "area", scale: "log" }, /needs a zero/],
    [{ series: ["zec-price"], range: "7d" }, /range must be one of/],
    [{ series: ["zec-price"], range: "30d", from: "2026-07-01" }, /never both/],
    [{ series: ["zec-price"], to: "2026-07-01" }, /to needs a from/],
    [{ series: ["zec-price"], from: "2026-02-31" }, /real UTC day/],
    [{ series: ["zec-price"], from: 20260701 }, /real UTC day/],
    [{ series: ["zec-price"], from: "2026-07-01", to: "2026-07-01" }, /to must be after from/],
    [{ series: ["zec-price"], from: "2015-01-01" }, /on or after 2016-10-28/],
    [{ series: ["zec-price"], from: "2026-07-01", to: "2027-01-01" }, /future/],
  ])("refuses %j with a correctable message", (args, message) => {
    const result = parse(args);
    expect(typeof result).toBe("string");
    expect(result).toMatch(message);
  });

  it("refuses any key it does not know by name, so a figure can never ride along", () => {
    for (const key of ["values", "data", "points", "title", "yMax", "label", "caption"]) {
      const result = parse({ series: ["orchard-balance"], [key]: [1, 2, 3] });
      expect(result).toMatch(new RegExp(`unknown argument ${key}.*takes no figures`));
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
      "orchard-balance",
      "all",
      "log",
      null,
    ];
    const keys = ["series", "range", "from", "to", "type", "scale", "values", "max"];
    let seed = 7;
    const pick = <T>(xs: readonly T[]): T => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return xs[seed % xs.length]!;
    };
    let accepted = 0;
    for (let n = 0; n < 2_000; n++) {
      const args: Record<string, unknown> = { series: [pick(PLOT_SERIES_IDS)] };
      for (let k = 0; k < n % 3; k++) args[pick(keys)] = pick(values);
      const result = parse(args);
      if (typeof result === "string") continue;
      accepted++;
      // Every number left is a UTC day start the window parsed, never the sentinel.
      expect(JSON.stringify(result)).not.toContain(String(SENTINEL));
      for (const t of [result.fromDay, result.toDay]) expect(t % DAY_SECONDS).toBe(0);
      expect(result.series.every((id) => PLOT_SERIES_IDS.includes(id))).toBe(true);
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
      series: ["orchard-balance", "ironwood-balance"],
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

  it("weeks: a closing value is the week's last close, and today's row is never read", async () => {
    const chart = await drawn({ series: ["shielded-supply"], from: "2026-03-01" });
    expect(chart.grain).toBe("week");
    const rows = rowsOf(SHIELDED_SUPPLY, (p) => p.totalZat);
    expect(chart.series[0]!.values).toEqual(expected(rows, "stock", "week", chart.timestamps));
    expect(chart.timestamps.at(-1)).toBe(day("2026-07-27"));
  });

  it("weeks: a flow is the sum of the week's days", async () => {
    const chart = await drawn({
      series: ["orchard-transactions", "sapling-transactions"],
      from: "2026-03-01",
    });
    expect(chart.series[0]!.values).toEqual(
      expected(
        rowsOf(POOL_USAGE, (p) => p.orchardTxs),
        "flow",
        "week",
        chart.timestamps,
      ),
    );
    expect(chart.series[1]!.values).toEqual(
      expected(
        rowsOf(POOL_USAGE, (p) => p.saplingTxs),
        "flow",
        "week",
        chart.timestamps,
      ),
    );
  });

  it("past the daily sources' year, reads the monthly series, and flags the running month", async () => {
    const chart = await drawn({
      series: ["transparent-transactions", "mixed-transactions"],
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
    const chart = await drawn({ series: ["fees-paid"], range: "1y" });
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

  it("keeps a pool's activation period as its real count, and earlier periods absent", async () => {
    const chart = await drawn({ series: ["ironwood-transactions"], range: "all" });
    expect(chart.grain).toBe("month");
    const july = chart.timestamps.indexOf(day("2026-07-01"));
    const julyDays = POOL_USAGE.filter(
      (p) => p.timestamp >= day("2026-07-01") && p.timestamp < day("2026-08-01"),
    );
    // Zeros before the 28th are true counts of July, so they are in the sum.
    expect(chart.series[0]!.values[july]).toBe(julyDays.reduce((s, p) => s + p.ironwoodTxs, 0));
    expect(chart.series[0]!.values.slice(0, july).every((v) => v === null)).toBe(true);
  });

  it("refuses a log axis for a series that never stays above zero", async () => {
    const result = await chartFor({
      series: ["sprout-transactions"],
      from: "2026-07-01",
      scale: "log",
    });
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/never stays above zero.*use the linear scale/);
  });

  it("inside the year, reads the daily sibling instead", async () => {
    const chart = await drawn({ series: ["fully-shielded-transactions"], from: "2026-06-01" });
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
    const chart = await drawn({ series: ["fees-paid"], from: "2026-07-01" });
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
    const chart = await drawn({ series: ["difficulty"], range: "all" });
    expect(chart.grain).toBe("day");
    const unread = chart.timestamps.indexOf(UNREAD_DIFFICULTY_DAY);
    expect(chart.series[0]!.values[unread]).toBeNull();
    expect(chart.series[0]!.values.filter((v) => v !== null)).toEqual(
      NETWORK_DAILY.filter((p) => p.timestamp < TODAY && p.avgDifficulty !== null).map(
        (p) => p.avgDifficulty,
      ),
    );
  });

  it("reads the stored daily closes for the price", async () => {
    const chart = await drawn({ series: ["zec-price"], from: "2026-07-26" });
    expect(chart.series[0]!.values).toEqual(DAILY_PRICES.map((p) => p.usd));
  });

  it("plots only values that occur in what the sources served (provenance sweep)", async () => {
    const served = new Set<number>();
    const add = (xs: readonly (number | null)[]) => xs.forEach((x) => x !== null && served.add(x));
    for (const p of SUPPLY_DAYS) add([p.sproutZat, p.saplingZat, p.orchardZat, p.ironwoodZat]);
    add(SHIELDED_SUPPLY.map((p) => p.totalZat));
    add(MONTH_SERIES.flatMap((p) => [p.transparentTxs, p.mixedTxs, p.shieldedTxs]));
    add(FLOW_MONTHS.flatMap((p) => [p.shieldedZat, p.unshieldedZat]));
    add(FEE_TOTALS.monthly.map((p) => p.feeZat));
    add(NETWORK_DAILY.flatMap((p) => [p.avgDifficulty, p.avgBlockBytes]));
    add(TRANSPARENT_DAYS.map((p) => p.activeAddresses));
    add(DAILY_PRICES.map((p) => p.usd));
    // Day-grain flows plot each day as served.
    add(DAY_SERIES.flatMap((p) => [p.transparentTxs, p.mixedTxs, p.shieldedTxs]));
    add(POOL_USAGE.flatMap((p) => [p.sproutTxs, p.saplingTxs, p.orchardTxs, p.ironwoodTxs]));
    add(BLOCKS_DAILY.map((p) => p.blocks));
    add(FEE_TOTALS.daily.map((p) => p.feeZat));
    add(SHIELDING_FLOW_DAYS.flatMap((p) => [p.shieldedZat, p.unshieldedZat]));
    for (const id of PLOT_SERIES_IDS) {
      // Day grain (where the series has data that recent) and month grain: sums at week grain are
      // checked against the reference implementation above instead.
      for (const args of [{ from: "2026-07-26" }, { range: "all" }]) {
        const result = await chartFor({ series: [id], ...args });
        // Sums of days are not values any source served: the reference implementation above
        // checks those. Every other plotted value must be one a source served as it is.
        const summed =
          result.chart?.grain !== "day" &&
          plottableSeries(id).kind === "flow" &&
          SERIES_SOURCES[id].monthly === undefined;
        if (result.chart === undefined || result.chart.grain === "week" || summed) continue;
        for (const v of result.chart.series[0]!.values) {
          if (v !== null) expect(served.has(v), `${id}: ${v} was never served`).toBe(true);
        }
      }
    }
  });
});

describe("what make_chart refuses after reading", () => {
  it("draws nothing when a source is down, and says so", async () => {
    const down: ChainRequester = {
      request: (path) => {
        if (path === CHART_SOURCES.supplyDays.path) return new Response("{}", { status: 503 });
        return makeChain().request(path);
      },
    };
    const result = await chartFor({ series: ["orchard-balance", "sapling-balance"] }, down);
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/^unavailable: Orchard balance could not be read/);
  });

  it("draws nothing from a body of the wrong shape", async () => {
    const result = await chartFor(
      { series: ["blocks-mined"], from: "2026-07-01" },
      makeChain({ [CHART_SOURCES.blocksDaily.path]: { blocks: [1, 2, 3] } }),
    );
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/unavailable/);
  });

  it("answers a single figure in words, not a one-point chart", async () => {
    const result = await chartFor({
      series: ["orchard-balance"],
      from: "2026-08-01",
      to: "2026-08-02",
    });
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/fewer than two periods.*in words/);
  });

  it("refuses a series with fewer than two measured points in the window", async () => {
    // Ironwood had not activated: nothing to draw.
    const result = await chartFor({
      series: ["ironwood-balance"],
      from: "2026-06-01",
      to: "2026-07-01",
    });
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/Ironwood balance has fewer than two measured points/);
  });

  it("cites nothing itself: the chart links its own page", async () => {
    const result = await chartFor({ series: ["orchard-balance"], from: "2026-07-01" });
    expect(result.endpoints).toEqual([]);
  });

  it("refuses same-measure series too far apart for a linear axis, and draws them on log", async () => {
    // Sprout (~25K ZEC) beside Sapling (~4.2M ZEC): Sprout would be a flat line at the floor.
    const linear = await chartFor({
      series: ["sprout-balance", "sapling-balance"],
      from: "2026-07-01",
    });
    expect(linear.chart).toBeUndefined();
    expect(linear.content).toMatch(
      /Sprout balance peaks over 50× below Sapling balance.*flat line.*scale log, or chart them separately/,
    );
    const log = await chartFor({
      series: ["sprout-balance", "sapling-balance"],
      from: "2026-07-01",
      scale: "log",
    });
    expect(log.chart!.scale).toBe("log");
  });

  it("offers only separate charts when a log axis cannot draw every series", async () => {
    // Sprout's daily transactions are 0 or 1: nothing two periods running above zero.
    const result = await chartFor({
      series: ["sprout-transactions", "sapling-transactions"],
      from: "2026-07-01",
    });
    expect(result.chart).toBeUndefined();
    expect(result.content).toMatch(/flat line — chart them separately$/);
    expect(result.content).not.toMatch(/log/);
  });

  it("keeps series within the spread on one linear axis", async () => {
    // The three privacy kinds, ~3,000 / ~600 / ~150 a day: twenty-fold, every line readable.
    const chart = await drawn({
      series: ["transparent-transactions", "mixed-transactions", "fully-shielded-transactions"],
      from: "2026-07-01",
    });
    expect(chart.series).toHaveLength(3);
  });
  it("hands the model a summary of the same numbers, already formatted", async () => {
    const result = await chartFor({ series: ["zec-price"], from: "2026-07-26" });
    expect(result.content).toContain("ZEC price (USD close) · since 2026-07-26 · daily · line");
    expect(result.content).toContain('"changeFirstToLast": "+$7.00 (+17.5%)"');
    expect(result.content).toMatch(/never reproduce its points/);
  });
});

describe("the paths make_chart reads exist on the real service", () => {
  it("every source path is declared by the route modules production mounts", () => {
    const declared = new Set([
      ...analyticsRoutes().routes.map((r) => r.path),
      ...chartSeriesRoutes("postgres://unused").routes.map((r) => r.path),
      ...v1PriceRoutes(undefined).routes.map((r) => r.path),
    ]);
    for (const [name, spec] of Object.entries(CHART_SOURCES)) {
      expect(declared.has(spec.path), `${name}: nothing serves ${spec.path}`).toBe(true);
      // Aggregates read the private API; only the public closes go through /v1.
      expect(spec.surface === "v1").toBe(spec.path.startsWith("/v1/"));
    }
  });

  it("the harness gates every private chart path behind the bearer token", async () => {
    const app = (await import("../testing/fixture-world")).chainApp();
    for (const spec of Object.values(CHART_SOURCES)) {
      if (spec.surface !== "chain") continue;
      expect((await app.request(spec.path)).status, spec.path).toBe(401);
    }
    expect(CHAIN_TOKEN).not.toBe("");
  });
});

/** Every catalogue id resolves to a real chart in the fixture world over some window. */
describe("the catalogue", () => {
  it.each(PLOT_SERIES_IDS.map((id) => [id]))("%s draws", async (id: PlotSeriesId) => {
    // The price and daily shielding fixtures hold eight days each.
    const window =
      id === "zec-price"
        ? { from: "2026-07-26" }
        : id === "zec-shielded" || id === "zec-unshielded"
          ? { from: "2026-07-19", to: "2026-07-27" }
          : { from: "2026-07-01" };
    const result = await chartFor({ series: [id], ...window });
    expect(result.chart, result.content).toBeDefined();
  });
});

describe("linearSpreadRefusal", () => {
  const line = { scale: "linear", type: "line" } as const;
  const s = (label: string, values: (number | null)[]) => ({ label, values });

  it("allows up to the spread and refuses past it", () => {
    expect(linearSpreadRefusal(line, [s("a", [1, 50]), s("b", [1, 1])])).toBeNull();
    expect(linearSpreadRefusal(line, [s("a", [1, 51]), s("b", [1, 1])])).toMatch(
      /^b peaks over 50× below a/,
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
    expect(linearSpreadRefusal(line, [s("a", [5, 9]), s("b", [0, 0])])).toMatch(
      /chart them separately$/,
    );
  });

  it("never offers a log axis for an area, which needs a zero to fill to", () => {
    const area = { scale: "linear", type: "area" } as const;
    const msg = linearSpreadRefusal(area, [s("a", [100, 100]), s("b", [1, 1])]);
    expect(msg).toMatch(/chart them separately$/);
    expect(msg).not.toMatch(/log/);
  });
});

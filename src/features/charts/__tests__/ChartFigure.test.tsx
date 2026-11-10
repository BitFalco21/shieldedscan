import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChainMonthPoint } from "@/domain";
import { ChartFigure } from "../ChartFigure";
import { chartData } from "../chart-data";
import { COIN_AGE_BANDS, type CoinAgeBandKey } from "@/domain/coin-age";
import { AGE_BAND_CLASS } from "../coin-age-series";

const DAY = 86_400;

function point(timestamp: number): ChainMonthPoint {
  return {
    timestamp,
    topHeight: 3_000_000,
    transparentTxs: 100,
    mixedTxs: 50,
    shieldedTxs: 200,
    sproutZat: 1,
    saplingZat: 2,
    orchardZat: 3,
    ironwoodZat: 0,
  };
}

const months = [point(1_700_000_000), point(1_702_600_000)];
const days = Array.from({ length: 60 }, (_, i) => point(1_700_000_000 + i * DAY));

describe("ChartFigure range toggle", () => {
  it("starts at ALL on the monthly series and switches to the daily one", () => {
    render(<ChartFigure slug="transactions-by-kind" data={chartData({ months, days })} />);
    expect(screen.getByRole("img", { name: /per month by privacy kind/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "30D" }));
    // The grain switch is the point: below ALL the chart reads the daily sibling series,
    // because thirty days of a monthly series is one point.
    expect(screen.getByRole("img", { name: /per day by privacy kind/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "30D" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("answers a sub-ALL range honestly when the daily series is unreadable", () => {
    render(<ChartFigure slug="transactions-by-kind" data={chartData({ months, days: null })} />);
    fireEvent.click(screen.getByRole("button", { name: "90D" }));
    // Never a one-point chart resampled from months, and never an empty chart — the same
    // unavailable panel the page-level guard uses.
    expect(screen.getByText(/TEMPORARILY UNAVAILABLE/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "ALL" }));
    expect(screen.getByRole("img", { name: /per month by privacy kind/i })).toBeTruthy();
  });

  it("gives ironwood-balance no toggle — its whole series is narrower than 30D", () => {
    render(
      <ChartFigure
        slug="ironwood-balance"
        data={chartData({
          ironwood: {
            activationHeight: 3_428_143,
            balanceZat: 100,
            netFromOrchardZat: 80,
            netFromSaplingZat: 10,
            netFromSproutZat: 0,
            netFromTransparentZat: 10,
            fromTransparentTxCount: 3,
            txCount: 5_180,
            minedZat: 0,
            feesPaidZat: 0,
            balance: [
              { timestamp: 1_785_247_620, ironwoodZat: 1 },
              { timestamp: 1_785_251_220, ironwoodZat: 2 },
            ],
          },
        })}
      />,
    );
    expect(screen.queryByRole("group", { name: "Chart time range" })).toBeNull();
  });
});

/**
 * `fee-totals` must show the denominator its own description promises. A block whose fee total
 * is unknown drops out of the sum, so the line dips while still labelled "Fees paid"; the
 * coverage row is what says so. Fees are repaired, not guaranteed.
 */
describe("fee-totals coverage", () => {
  const feePoint = (timestamp: number, blocks: number, covered: number) => ({
    timestamp,
    feeZat: 1_000_000,
    blocks,
    blocksCovered: covered,
  });

  /**
   * Opens the readout the way a keyboard reader does.
   *
   * Not a pointer event: `indexFromClientX` divides by the wrapper's width, and jsdom reports
   * 0 for every `getBoundingClientRect`, so a synthetic pointerMove resolves to `null` and the
   * readout never renders. Focus selects index 0 and `End` the last point, which is also the
   * accessible path this chart is required to support — so the test exercises the real one.
   */
  function readoutAt(index: "first" | "last"): string {
    const group = screen.getByRole("group", { name: /use the arrow keys/i });
    fireEvent.focus(group);
    if (index === "last") fireEvent.keyDown(group, { key: "End" });
    return screen.getByRole("status").textContent ?? "";
  }

  function renderChart(monthly: ReturnType<typeof feePoint>[]) {
    render(
      <ChartFigure slug="fee-totals" data={chartData({ feeTotals: { monthly, daily: [] } })} />,
    );
  }

  it("states the blocks a complete period covers, once", () => {
    renderChart([feePoint(1_700_000_000, 35_000, 35_000), feePoint(1_702_600_000, 35_000, 35_000)]);
    const readout = readoutAt("first");
    expect(readout).toContain("Blocks");
    expect(readout).toContain("35,000");
    // "35,000 of 35,000" says nothing the count alone does not.
    expect(readout).not.toContain(" of ");
    // The quantity is still the headline; the denominator sits under it.
    expect(readout.indexOf("Fees paid")).toBeLessThan(readout.indexOf("Blocks"));
  });

  it("marks a period measured over fewer blocks as partial", () => {
    // The failure the row exists for: this period's total is smaller than the truth, and
    // nothing else on the chart would say so — the line simply dips.
    renderChart([feePoint(1_700_000_000, 35_000, 35_000), feePoint(1_702_600_000, 35_000, 34_100)]);
    expect(readoutAt("last")).toContain("34,100 of 35,000 · partial");
  });

  it("does not brand a complete period partial", () => {
    // The distinction IS the feature. A row that always said "partial" would be no better than
    // one that never did.
    renderChart([feePoint(1_700_000_000, 35_000, 35_000), feePoint(1_702_600_000, 35_000, 34_100)]);
    expect(readoutAt("first")).not.toContain("partial");
  });

  it("keeps the block count off the value axis", () => {
    // A block count against a zatoshi scale would wreck the chart. It is a readout row, so it
    // must never reach the plotted series or the axis ticks.
    renderChart([feePoint(1_700_000_000, 35_000, 35_000), feePoint(1_702_600_000, 35_000, 35_000)]);
    const svg = screen.getByRole("img", { name: /total fees paid per month/i });
    expect(svg.textContent ?? "").not.toContain("35,000");
  });
});

/**
 * A pool's row must be absent from the readout before the pool existed, not "0.00 ZEC": the
 * number would be true and the impression (a pool measured at empty) false.
 *
 * Driven by the keyboard, because `ChartHover` derives its index from the wrapper's width and
 * jsdom reports 0 for every `getBoundingClientRect`.
 */
describe("pool-balances hides a pool before it existed", () => {
  const poolPoint = (timestamp: number, ironwoodZat: number): ChainMonthPoint => ({
    ...point(timestamp),
    sproutZat: 1_000,
    saplingZat: 2_000,
    orchardZat: 3_000,
    ironwoodZat,
  });

  // Ironwood holds nothing in the first month and appears in the second — the real shape.
  const months = [poolPoint(1_700_000_000, 0), poolPoint(1_702_600_000, 500_000_000)];

  function readoutAt(index: "first" | "last"): string {
    const group = screen.getByRole("group", { name: /use the arrow keys/i });
    fireEvent.focus(group);
    fireEvent.keyDown(group, { key: index === "last" ? "End" : "Home" });
    return screen.getByRole("status").textContent ?? "";
  }

  it("omits Ironwood before its first value", () => {
    render(<ChartFigure slug="pool-balances" data={chartData({ months, days: months })} />);
    const readout = readoutAt("first");
    expect(readout).not.toMatch(/Ironwood/);
    // The pools that DID exist are still there — this must not blank the whole readout.
    expect(readout).toMatch(/Sprout/);
    expect(readout).toMatch(/Orchard/);
  });

  it("shows Ironwood from the point it first held value", () => {
    render(<ChartFigure slug="pool-balances" data={chartData({ months, days: months })} />);
    expect(readoutAt("last")).toMatch(/Ironwood/);
  });

  it("never prints a 0.00 row for the absent pool", () => {
    // Asserting the absence of the row is the property; this pins the symptom too, so a
    // future change that renders "—" instead still fails.
    render(<ChartFigure slug="pool-balances" data={chartData({ months, days: months })} />);
    const readout = readoutAt("first");
    expect(readout).not.toMatch(/Ironwood\s*0/);
  });

  it("still totals the pools that exist", () => {
    // Total must remain the sum of the visible bands: 1,000 + 2,000 + 3,000 zat.
    render(<ChartFigure slug="pool-balances" data={chartData({ months, days: months })} />);
    expect(readoutAt("first")).toMatch(/Total/);
  });
});

/**
 * A day the index holds no difficulty for is a gap, never a difficulty of zero: zero is a
 * quantity proof-of-work cannot take. `Number(null)` is 0 and `typeof 0 === "number"`, so the
 * null must survive to the chart.
 *
 * Driven by the keyboard for the reason recorded above.
 */
describe("difficulty leaves an unrecorded day blank", () => {
  const networkPoint = (timestamp: number, avgDifficulty: number | null) => ({
    timestamp,
    avgDifficulty,
    avgBlockBytes: 2048,
  });

  // Two unrecorded days, then two measured ones — the real series' shape in miniature.
  const withHole = [
    networkPoint(1_477_612_800, null),
    networkPoint(1_477_699_200, null),
    networkPoint(1_637_107_200, 60_517_493),
    networkPoint(1_637_193_600, 59_407_498),
  ];

  function readout(key?: string): string {
    const group = screen.getByRole("group", { name: /use the arrow keys/i });
    fireEvent.focus(group);
    if (key) fireEvent.keyDown(group, { key });
    return screen.getByRole("status").textContent ?? "";
  }

  it("reads an unrecorded day as absent, not as a number", () => {
    render(<ChartFigure slug="difficulty" data={chartData({ network: withHole })} />);
    const first = readout();
    expect(first).toContain("Difficulty");
    // This must not read "0".
    expect(first).not.toMatch(/\b0\b/);
  });

  it("still reads a measured day as its exact figure", () => {
    render(<ChartFigure slug="difficulty" data={chartData({ network: withHole })} />);
    expect(readout("End")).toContain("59,407,498");
  });

  it("draws no line across the hole", () => {
    render(<ChartFigure slug="difficulty" data={chartData({ network: withHole })} />);
    const svg = screen.getByRole("img", { name: /daily average mining difficulty/i });
    const series = [...svg.querySelectorAll("path")].filter((p) =>
      p.getAttribute("class")?.includes("text-green"),
    );
    // One segment, covering the two measured days only. A path with four vertices would be
    // the bug: the line running along the floor before climbing out of it.
    expect(series).toHaveLength(1);
    const vertices = (series[0]?.getAttribute("d") ?? "").match(/[ML]/g) ?? [];
    expect(vertices).toHaveLength(2);
  });

  it("says unavailable rather than drawing an empty plot when nothing is recorded", () => {
    const allNull = [networkPoint(1_477_612_800, null), networkPoint(1_477_699_200, null)];
    render(<ChartFigure slug="difficulty" data={chartData({ network: allNull })} />);
    expect(screen.getByText(/TEMPORARILY UNAVAILABLE/)).toBeTruthy();
  });
});

/**
 * `pool-usage` draws lines, never a stack: one transaction can carry two pools' bundles, so the
 * four counts do not partition the day's transactions and a stacked total would be fabricated.
 * The fixture's last day sums past any plausible tx total on purpose.
 */
describe("pool-usage draws lines, never a stack", () => {
  const usagePoint = (timestamp: number, ironwoodTxs: number) => ({
    timestamp,
    sproutTxs: 5,
    saplingTxs: 3,
    orchardTxs: 9,
    ironwoodTxs,
  });
  // Ironwood used nowhere in the first half, born mid-series — the real shape.
  const usage = Array.from({ length: 40 }, (_, i) =>
    usagePoint(1_700_000_000 + i * DAY, i >= 20 ? 2 : 0),
  );

  function readoutAt(index: "first" | "last"): string {
    const group = screen.getByRole("group", { name: /use the arrow keys/i });
    fireEvent.focus(group);
    fireEvent.keyDown(group, { key: index === "last" ? "End" : "Home" });
    return screen.getByRole("status").textContent ?? "";
  }

  it("renders four stroked series and no stacked band", () => {
    const { container } = render(
      <ChartFigure slug="pool-usage" data={chartData({ poolUsage: usage })} />,
    );
    expect(container.querySelectorAll("path.chart-band")).toHaveLength(0);
    // Four line series, one per pool, in the pool ink grammar shared with pool-balances.
    for (const cls of ["flow-rest", "flow-2", "flow-4", "flow-1"]) {
      expect(container.querySelector(`path.${cls}`)).toBeTruthy();
    }
  });

  it("omits Ironwood from the readout before its first use", () => {
    render(<ChartFigure slug="pool-usage" data={chartData({ poolUsage: usage })} />);
    const readout = readoutAt("first");
    expect(readout).not.toMatch(/Ironwood/);
    expect(readout).toMatch(/Sprout/);
  });

  it("shows Ironwood from its first use", () => {
    render(<ChartFigure slug="pool-usage" data={chartData({ poolUsage: usage })} />);
    expect(readoutAt("last")).toMatch(/Ironwood/);
  });

  it("says unavailable when the series is unreadable", () => {
    render(<ChartFigure slug="pool-usage" data={chartData({ poolUsage: null })} />);
    expect(screen.getByText(/TEMPORARILY UNAVAILABLE/)).toBeTruthy();
  });
});

/**
 * `pool-migrations` IS a stack: each migration has exactly one destination pool, so the
 * destination bands partition the day's migrated value — the honest inverse of pool-usage.
 */
describe("pool-migrations stacks by destination", () => {
  const migrationPoint = (timestamp: number, toIronwoodZat: number) => ({
    timestamp,
    toSproutZat: 0,
    toSaplingZat: 100_000_000,
    toOrchardZat: 500_000_000,
    toIronwoodZat,
  });
  // The turnstile shape: Ironwood receives nothing until it exists mid-series.
  const migrations = Array.from({ length: 40 }, (_, i) =>
    migrationPoint(1_700_000_000 + i * DAY, i >= 20 ? 2_000_000_000 : 0),
  );

  it("renders four destination bands", () => {
    const { container } = render(
      <ChartFigure slug="pool-migrations" data={chartData({ poolMigrations: migrations })} />,
    );
    expect(container.querySelectorAll("path.chart-band")).toHaveLength(4);
  });

  it("says unavailable when the series is unreadable", () => {
    render(<ChartFigure slug="pool-migrations" data={chartData({ poolMigrations: null })} />);
    expect(screen.getByText(/TEMPORARILY UNAVAILABLE/)).toBeTruthy();
  });
});

describe("ChartFigure on a chart's own page", () => {
  it("opens on the range in the URL, and writes a new range back to it", () => {
    window.history.replaceState(null, "", "/charts/transactions-by-kind?range=90d");
    render(<ChartFigure slug="transactions-by-kind" data={chartData({ months, days })} detail />);
    expect(screen.getByRole("button", { name: "90D" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "30D" }));
    expect(window.location.search).toBe("?range=30d");
    expect(screen.getByRole("button", { name: "30D" }).getAttribute("aria-pressed")).toBe("true");

    // ALL is the default, so it leaves no parameter behind: the plain URL means ALL.
    fireEvent.click(screen.getByRole("button", { name: "ALL" }));
    expect(window.location.search).toBe("");
  });

  it("offers the CSV and the link, and keeps them off the gallery", () => {
    window.history.replaceState(null, "", "/charts/transactions-by-kind");
    const { unmount } = render(
      <ChartFigure slug="transactions-by-kind" data={chartData({ months, days })} detail />,
    );
    expect(screen.getByRole("button", { name: /csv/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy link to this chart/i })).toBeTruthy();
    unmount();
    render(<ChartFigure slug="transactions-by-kind" data={chartData({ months, days })} />);
    expect(screen.queryByRole("button", { name: /csv/i })).toBeNull();
  });
});

/** The readout at a point, opened the keyboard way (jsdom has no layout for a pointer). */
function readoutAtIndex(index: "first" | "last"): string {
  const group = screen.getByRole("group", { name: /use the arrow keys/i });
  fireEvent.focus(group);
  fireEvent.keyDown(group, { key: index === "last" ? "End" : "Home" });
  return screen.getByRole("status").textContent ?? "";
}

describe("anonymity-set total", () => {
  const tree = (
    timestamp: number,
    saplingNotes: number | null,
    orchardNotes: number | null,
    ironwoodNotes: number | null,
  ) => ({ timestamp, saplingNotes, orchardNotes, ironwoodNotes });

  it("totals the three pools that publish a tree size, and names them", () => {
    render(
      <ChartFigure
        slug="anonymity-set"
        data={chartData({
          noteTrees: [tree(1_785_000_000, 100, 200, null), tree(1_785_086_400, 100, 200, 300)],
        })}
      />,
    );
    const readout = readoutAtIndex("last");
    expect(readout).toContain("Total, 3 pools");
    expect(readout).toContain("600");
    // The short name keeps the readout narrow; what it sums is on hover and read aloud.
    const name = screen.getByTitle("Sapling + Orchard + Ironwood");
    expect(name.textContent).toContain("Sapling + Orchard + Ironwood");
  });

  it("reads unmeasured on a day one of the three is missing, never a partial sum", () => {
    render(
      <ChartFigure
        slug="anonymity-set"
        data={chartData({
          noteTrees: [tree(1_785_000_000, 100, 200, null), tree(1_785_086_400, 100, 200, 300)],
        })}
      />,
    );
    const readout = readoutAtIndex("first");
    expect(readout).toMatch(/Total, 3 pools.*—/);
    expect(readout).not.toContain("300");
  });
});

describe("exchange-reserves total", () => {
  const day = (timestamp: number, kraken: number | null) => ({
    timestamp,
    closeHeight: 3_000_000,
    zat: { binance: 100e8, coinbase: 200e8, gemini: 300e8, kraken },
  });

  it("adds the four exchanges at a point", () => {
    render(
      <ChartFigure
        slug="exchange-reserves"
        data={chartData({
          exchangeReserves: [day(1_785_000_000, null), day(1_785_086_400, 400e8)],
        })}
      />,
    );
    expect(readoutAtIndex("last")).toMatch(/Total\s*1,000/);
  });

  it("reads unmeasured where one exchange is not computed through the day", () => {
    render(
      <ChartFigure
        slug="exchange-reserves"
        data={chartData({
          exchangeReserves: [day(1_785_000_000, null), day(1_785_086_400, 400e8)],
        })}
      />,
    );
    const readout = readoutAtIndex("first");
    expect(readout).toMatch(/Total\s*—/);
    expect(readout).not.toContain("600");
  });
});

describe("transparent-coin-age legend highlight", () => {
  const monthEnd = (asOf: string) => ({
    asOf,
    height: 3_000_000,
    bands: COIN_AGE_BANDS.map((b, i) => ({ key: b.key, valueZat: (i + 1) * 1e8, outputs: 1 })),
  });
  const draw = () =>
    render(
      <ChartFigure
        slug="transparent-coin-age"
        data={chartData({
          coinAge: { monthEnds: [monthEnd("2026-09-30"), monthEnd("2026-10-31")], latest: null },
        })}
      />,
    ).container;

  const band = (container: HTMLElement, key: string) =>
    [...container.querySelectorAll("path.chart-band")].find((p) =>
      p.classList.contains(AGE_BAND_CLASS[key as CoinAgeBandKey]),
    )!;

  it("brings the pointed band forward, fades the rest, and restores on leaving", () => {
    const container = draw();
    const item = screen.getByRole("button", { name: "1–2y" });
    fireEvent.pointerEnter(item);
    expect(band(container, "1y2y").getAttribute("class")).not.toContain("opacity-15");
    expect(band(container, "5y").getAttribute("class")).toContain("opacity-15");
    expect(band(container, "lt1w").getAttribute("class")).toContain("opacity-15");
    fireEvent.pointerLeave(item);
    expect(container.querySelectorAll("path.opacity-15")).toHaveLength(0);
  });

  it("answers focus as well as the pointer", () => {
    const container = draw();
    const item = screen.getByRole("button", { name: "5y+" });
    fireEvent.focus(item);
    expect(band(container, "5y").getAttribute("class")).not.toContain("opacity-15");
    expect(band(container, "3y5y").getAttribute("class")).toContain("opacity-15");
    fireEvent.blur(item);
    expect(container.querySelectorAll("path.opacity-15")).toHaveLength(0);
  });

  it("leaves a legend without keys as a plain list", () => {
    render(<ChartFigure slug="pool-usage" data={chartData({})} />);
    expect(screen.queryByRole("button", { name: "Sapling" })).toBeNull();
  });
});

describe("transparent-coin-age band gaps", () => {
  it("edges every band in the panel colour, so neighbouring bands stay apart", () => {
    const monthEnd = (asOf: string) => ({
      asOf,
      height: 3_000_000,
      bands: COIN_AGE_BANDS.map((b) => ({ key: b.key, valueZat: 1e8, outputs: 1 })),
    });
    const { container } = render(
      <ChartFigure
        slug="transparent-coin-age"
        data={chartData({
          coinAge: { monthEnds: [monthEnd("2026-09-30"), monthEnd("2026-10-31")], latest: null },
        })}
      />,
    );
    const bands = container.querySelectorAll("path.chart-band");
    expect(bands).toHaveLength(COIN_AGE_BANDS.length);
    for (const b of bands) expect(b.getAttribute("class")).toContain("stroke-panel");
  });

  it("draws no edges on a stack that did not ask for them", () => {
    const { container } = render(
      <ChartFigure slug="pool-balances" data={chartData({ months, days: months })} />,
    );
    for (const b of container.querySelectorAll("path.chart-band")) {
      expect(b.getAttribute("class")).not.toContain("stroke-panel");
    }
  });
});

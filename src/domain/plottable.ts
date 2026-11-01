import type { PoolName } from "./pool";

/**
 * The series Zeno may plot: a fixed catalogue, shared by the API (which reads the numbers) and the
 * console (which draws them). The model names entries by id and never supplies a figure; the id is
 * all that crosses the wire about a series, so its label, unit and page are looked up here on both
 * sides and cannot disagree.
 */

/** What a value is measured in, which decides how it is formatted. */
export const PLOT_UNITS = ["zat", "count", "usd", "difficulty", "bytes"] as const;
export type PlotUnit = (typeof PLOT_UNITS)[number];

/**
 * How a series behaves across a longer period, which decides how days become weeks or months:
 *
 *  - `stock`: a closing value (a balance, a close). A week is its last day.
 *  - `flow`: a count or amount per day. A week is the sum of its days.
 *  - `level`: an average or a distinct count. Neither adds nor re-averages honestly, so it is only
 *    ever drawn per day.
 */
export type PlotKind = "stock" | "flow" | "level";

export const PLOT_GRAINS = ["day", "week", "month"] as const;
export type PlotGrain = (typeof PLOT_GRAINS)[number];

export interface PlottableSeries {
  id: string;
  label: string;
  /**
   * The y-axis this series belongs on: a measure in a unit. A chart draws one axis, so every
   * series in it shares a group; two measures of different scale are two charts, never one.
   */
  axis: string;
  unit: PlotUnit;
  kind: PlotKind;
  /** The `/charts/<slug>` page plotting the same series, or null when none does. */
  chartSlug: string | null;
  /** The site-wide colour of a pool or a privacy kind, where the series is one. */
  ink?: { pool: PoolName } | { txKind: "transparent" | "mixed" | "shielded" };
  /** Leading zeros mean the pool did not exist yet, not a measured empty pool. */
  omitLeadingZeros?: boolean;
  /**
   * For counts that split the same transactions two ways, which split this series is part of: by
   * shielded pool, or by privacy kind. One transaction is counted in both, so lines from the two
   * splits on one chart invite a sum that double-counts; their site-wide colours also coincide
   * (Ironwood's gold is Mixed's, Sprout's slate is Transparent's).
   */
  split?: "pool" | "kind";
}

const pool = (p: PoolName, label: string) =>
  ({
    id: `${p}-balance`,
    label: `${label} balance`,
    axis: "balance-zec",
    unit: "zat",
    kind: "stock",
    chartSlug: p === "ironwood" ? "ironwood-balance" : "pool-balances",
    ink: { pool: p },
    omitLeadingZeros: true,
  }) as const;

const poolTxs = (p: PoolName, label: string) =>
  ({
    id: `${p}-transactions`,
    label: `${label} transactions`,
    axis: "tx-count",
    unit: "count",
    kind: "flow",
    chartSlug: "pool-usage",
    ink: { pool: p },
    omitLeadingZeros: true,
    split: "pool",
  }) as const;

export const PLOTTABLE_SERIES = [
  pool("sprout", "Sprout"),
  pool("sapling", "Sapling"),
  pool("orchard", "Orchard"),
  pool("ironwood", "Ironwood"),
  {
    id: "shielded-supply",
    label: "Shielded supply",
    axis: "balance-zec",
    unit: "zat",
    kind: "stock",
    chartSlug: "shielded-supply",
  },
  {
    id: "zec-shielded",
    label: "ZEC shielded",
    axis: "flow-zec",
    unit: "zat",
    kind: "flow",
    chartSlug: "shielding-flow",
  },
  {
    id: "zec-unshielded",
    label: "ZEC unshielded",
    axis: "flow-zec",
    unit: "zat",
    kind: "flow",
    chartSlug: "shielding-flow",
  },
  {
    id: "fees-paid",
    label: "Fees paid",
    axis: "fees-zec",
    unit: "zat",
    kind: "flow",
    chartSlug: "fee-totals",
  },
  {
    id: "transparent-transactions",
    label: "Transparent transactions",
    axis: "tx-count",
    unit: "count",
    kind: "flow",
    chartSlug: "transactions-by-kind",
    ink: { txKind: "transparent" },
    split: "kind",
  },
  {
    id: "mixed-transactions",
    label: "Mixed transactions",
    axis: "tx-count",
    unit: "count",
    kind: "flow",
    chartSlug: "transactions-by-kind",
    ink: { txKind: "mixed" },
    split: "kind",
  },
  {
    id: "fully-shielded-transactions",
    label: "Fully shielded transactions",
    axis: "tx-count",
    unit: "count",
    kind: "flow",
    chartSlug: "transactions-by-kind",
    ink: { txKind: "shielded" },
    split: "kind",
  },
  poolTxs("sprout", "Sprout"),
  poolTxs("sapling", "Sapling"),
  poolTxs("orchard", "Orchard"),
  poolTxs("ironwood", "Ironwood"),
  {
    id: "blocks-mined",
    label: "Blocks mined",
    axis: "blocks",
    unit: "count",
    kind: "flow",
    chartSlug: "blocks-per-day",
  },
  {
    id: "active-addresses",
    label: "Active transparent addresses",
    axis: "addresses",
    unit: "count",
    kind: "level",
    chartSlug: "transparent-activity",
  },
  {
    id: "zec-price",
    label: "ZEC price (USD close)",
    axis: "price-usd",
    unit: "usd",
    kind: "stock",
    chartSlug: "price",
  },
  {
    id: "difficulty",
    label: "Mining difficulty",
    axis: "difficulty",
    unit: "difficulty",
    kind: "level",
    chartSlug: "difficulty",
  },
  {
    id: "block-size",
    label: "Average block size",
    axis: "block-bytes",
    unit: "bytes",
    kind: "level",
    chartSlug: "block-size",
  },
] as const satisfies readonly PlottableSeries[];

export type PlotSeriesId = (typeof PLOTTABLE_SERIES)[number]["id"];

export const PLOT_SERIES_IDS: readonly PlotSeriesId[] = PLOTTABLE_SERIES.map((s) => s.id);

export function plottableSeries(id: PlotSeriesId): PlottableSeries {
  return PLOTTABLE_SERIES.find((s) => s.id === id)!;
}

/**
 * Why these series cannot share one chart, or null when they can: one chart has one axis, so one
 * measure, and a count split two ways is two charts (see `split`).
 */
export function sharedChartProblem(series: readonly PlottableSeries[]): string | null {
  const ids = series.map((s) => s.id).join(", ");
  if (new Set(series.map((s) => s.axis)).size > 1) {
    return `${ids} are different measures, and one chart has one axis — chart them separately, or answer in words`;
  }
  if (new Set(series.flatMap((s) => (s.split === undefined ? [] : [s.split]))).size > 1) {
    return `${ids} split the same transactions two ways, by pool and by privacy kind, so one transaction is in both — chart them separately`;
  }
  return null;
}

/** At most this many series on one chart: past three, lines stop being tellable apart. */
export const MAX_PLOT_SERIES = 3;

/** Charts a single answer may carry. Two allows two measures side by side; more is a page. */
export const MAX_CHARTS_PER_ANSWER = 2;

/**
 * A day series runs per day at any span (`level`), and since launch is ~3,650 days: room for
 * decades more, while still bounding the wire (three series of this are a few hundred kB).
 */
export const MAX_PLOT_POINTS = 10_000;

/** The first UTC day of Zcash mainnet: nothing can be plotted before it. */
export const PLOT_EPOCH_DAY = "2016-10-28";

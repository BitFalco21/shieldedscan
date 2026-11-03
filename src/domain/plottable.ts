import type { CrossChainProtocol } from "./crosschain";
import { PLOT_CHAINS, seriesKey, type PlotSeriesSpec, type PlotTxKind } from "./plot-series";
import type { PoolName } from "./pool";

/**
 * How each series spec reads and behaves: its label, unit, axis, page and ink. One table for the
 * API (which reads the numbers) and the console (which draws them), so a label or a unit cannot
 * differ between the two ends.
 */

/** What a value is measured in, which decides how it is formatted. */
export const PLOT_UNITS = ["zat", "count", "usd", "difficulty", "bytes", "pct"] as const;
export type PlotUnit = (typeof PLOT_UNITS)[number];

/**
 * How a series behaves across a longer period, which decides how days become weeks or months:
 *
 *  - `stock`: a closing value (a balance, a close). A week is its last day.
 *  - `flow`: a count or amount per day. A week is the sum of its days.
 *  - `level`: an average, a median, a distinct count or a share. Neither adds nor re-averages
 *    honestly, so it is drawn at the grain its source computed it, never resampled.
 */
export type PlotKind = "stock" | "flow" | "level";

export const PLOT_GRAINS = ["day", "week", "month"] as const;
export type PlotGrain = (typeof PLOT_GRAINS)[number];

/** A site-wide colour an entity keeps on every chart: a pool, a privacy kind, a chain, a venue. */
export type PlotInk =
  { pool: PoolName } | { txKind: PlotTxKind } | { chain: string } | { venue: CrossChainProtocol };

export interface PlottableSeries {
  /** The spec's one spelling (`seriesKey`). */
  key: string;
  label: string;
  /**
   * The y-axis this series belongs on: one measure in one unit. A chart draws one axis, so every
   * series in it shares a group; two measures are two charts, never one.
   */
  axis: string;
  unit: PlotUnit;
  kind: PlotKind;
  /** The `/charts/<slug>` page plotting the same series, or null when none does. */
  chartSlug: string | null;
  ink?: PlotInk;
  /** Leading zeros or nulls mean the thing did not exist yet, not a measured empty. */
  omitLeadingZeros?: boolean;
  /**
   * For counts that split the same transactions two ways, which split this series is part of: by
   * shielded pool, or by privacy kind. One transaction is counted in both, so lines from the two
   * splits on one chart invite a sum that double-counts.
   */
  split?: "pool" | "kind";
  /** A natural ceiling the axis does not shrink below: a share is out of 100. */
  yMax?: number;
}

const POOL_LABEL: Record<PoolName, string> = {
  sprout: "Sprout",
  sapling: "Sapling",
  orchard: "Orchard",
  ironwood: "Ironwood",
};
const KIND_LABEL: Record<PlotTxKind, string> = {
  transparent: "Transparent",
  mixed: "Mixed",
  shielded: "Fully shielded",
};
const VENUE_LABEL: Record<CrossChainProtocol, string> = {
  "near-intents": "NEAR Intents",
  maya: "Maya",
  thorchain: "THORChain",
};

type Meta = Omit<PlottableSeries, "key">;

function poolMeta(spec: Extract<PlotSeriesSpec, { family: "pool" }>): Meta {
  const name = POOL_LABEL[spec.pool];
  const ink = { pool: spec.pool };
  // Before a pool existed its rows read zero (or null); that is absence, never a measured empty.
  const base = { ink, omitLeadingZeros: true };
  switch (spec.metric) {
    case "balance":
      return {
        ...base,
        label: `${name} balance`,
        axis: "zec-balance",
        unit: "zat",
        kind: "stock",
        chartSlug: spec.pool === "ironwood" ? "ironwood-balance" : "pool-balances",
      };
    case "transactions":
      return {
        ...base,
        label: `${name} transactions`,
        axis: "count-per-period",
        unit: "count",
        kind: "flow",
        chartSlug: "pool-usage",
        split: "pool",
      };
    case "migrated-in":
      return {
        ...base,
        label: `ZEC migrated into ${name}`,
        axis: "zec-per-period",
        unit: "zat",
        kind: "flow",
        chartSlug: "pool-migrations",
      };
    case "notes":
      return {
        ...base,
        label: `${name} notes`,
        axis: "notes",
        unit: "count",
        kind: "stock",
        chartSlug: "anonymity-set",
      };
  }
}

function crosschainMeta(spec: Extract<PlotSeriesSpec, { family: "crosschain" }>): Meta {
  const into = spec.direction === "in";
  const zec = { axis: "zec-per-period", unit: "zat", kind: "flow" } as const;
  if (spec.by === "chain") {
    const name = PLOT_CHAINS[spec.chain] ?? spec.chain;
    return {
      ...zec,
      label: into ? `ZEC from ${name}` : `ZEC to ${name}`,
      chartSlug: into ? "inflow-by-chain" : "outflow-by-chain",
      ink: { chain: spec.chain },
    };
  }
  if (spec.by === "venue") {
    return {
      ...zec,
      label: `ZEC ${into ? "in" : "out"} via ${VENUE_LABEL[spec.venue]}`,
      chartSlug: "volume-by-venue",
      ink: { venue: spec.venue },
    };
  }
  if (spec.measure === "transfers") {
    return {
      label: into ? "Swaps into Zcash" : "Swaps out of Zcash",
      axis: "count-per-period",
      unit: "count",
      kind: "flow",
      chartSlug: "crosschain-volume",
    };
  }
  return {
    ...zec,
    label: into ? "ZEC arriving by swap" : "ZEC leaving by swap",
    chartSlug: "crosschain-volume",
  };
}

const SHARE_LABEL = {
  "top1-share": "Largest miner's share of blocks",
  "top3-share": "Top 3 miners' share of blocks",
  "top10-share": "Top 10 miners' share of blocks",
  "shielded-coinbase-share": "Share of blocks with a shielded coinbase",
} as const;

function meta(spec: PlotSeriesSpec): Meta {
  switch (spec.family) {
    case "pool":
      return poolMeta(spec);
    case "supply": {
      const label = {
        shielded: "Shielded supply",
        transparent: "Transparent supply",
        lockbox: "Lockbox balance",
        circulating: "Circulating supply",
      }[spec.part];
      return {
        label,
        axis: "zec-balance",
        unit: "zat",
        kind: "stock",
        chartSlug:
          spec.part === "lockbox"
            ? null
            : spec.part === "shielded"
              ? "shielded-supply"
              : "shielded-share",
        // The lockbox began at NU6; before that it is absent, not empty.
        ...(spec.part === "lockbox" ? { omitLeadingZeros: true } : {}),
      };
    }
    case "shielding":
      return {
        label: spec.direction === "in" ? "ZEC shielded" : "ZEC unshielded",
        axis: "zec-per-period",
        unit: "zat",
        kind: "flow",
        chartSlug: "shielding-flow",
      };
    case "transactions":
      return {
        label: `${KIND_LABEL[spec.kind]} transactions`,
        axis: "count-per-period",
        unit: "count",
        kind: "flow",
        chartSlug: "transactions-by-kind",
        ink: { txKind: spec.kind },
        split: "kind",
      };
    case "fees":
      return spec.stat === "total"
        ? {
            label: "Fees paid",
            axis: "zec-per-period",
            unit: "zat",
            kind: "flow",
            chartSlug: "fee-totals",
          }
        : {
            label: `Median fee, ${KIND_LABEL[spec.kind].toLowerCase()}`,
            axis: "fee-median",
            unit: "zat",
            kind: "level",
            chartSlug: "median-fee",
            ink: { txKind: spec.kind },
          };
    case "mining":
      if (spec.metric === "blocks") {
        return {
          label: "Blocks mined",
          axis: "count-per-period",
          unit: "count",
          kind: "flow",
          chartSlug: "blocks-per-day",
        };
      }
      if (spec.metric === "difficulty") {
        return {
          label: "Mining difficulty",
          axis: "difficulty",
          unit: "difficulty",
          kind: "level",
          chartSlug: "difficulty",
        };
      }
      return {
        label: SHARE_LABEL[spec.metric],
        axis: "share-of-blocks",
        unit: "pct",
        kind: "level",
        chartSlug: "miner-concentration",
        yMax: 100,
      };
    case "network":
      return spec.metric === "block-size"
        ? {
            label: "Average block size",
            axis: "block-bytes",
            unit: "bytes",
            kind: "level",
            chartSlug: "block-size",
          }
        : {
            label: "Active transparent addresses",
            axis: "addresses",
            unit: "count",
            kind: "level",
            chartSlug: "transparent-activity",
          };
    case "price":
      return {
        label: "ZEC price (USD close)",
        axis: "price-usd",
        unit: "usd",
        kind: "stock",
        chartSlug: "price",
      };
    case "crosschain":
      return crosschainMeta(spec);
  }
}

export function plottableSeries(spec: PlotSeriesSpec): PlottableSeries {
  return { key: seriesKey(spec), ...meta(spec) };
}

/**
 * Why these series cannot share one chart, or null when they can: one chart has one axis, so one
 * measure, and a count split two ways is two charts (see `split`).
 */
export function sharedChartProblem(series: readonly PlottableSeries[]): string | null {
  const labels = series.map((s) => s.label).join(", ");
  if (new Set(series.map((s) => s.axis)).size > 1) {
    return `${labels} are different measures, and one chart has one axis — chart them separately, or answer in words`;
  }
  if (new Set(series.flatMap((s) => (s.split === undefined ? [] : [s.split]))).size > 1) {
    return `${labels} split the same transactions two ways, by pool and by privacy kind, so one transaction is in both — chart them separately`;
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

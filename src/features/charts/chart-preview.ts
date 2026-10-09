import { feeTotalIsComplete, utcDayFromSeconds, type CrossChainProtocol } from "@/domain";
import type { ChartThumb, ThumbSeries } from "@/components/ChartThumbnail";
import { POOL_CLASSES } from "@/lib/pool-palette";
import { FOLDED_FLOW_CLASS, flowPaletteClass, VENUE_CLASSES } from "@/lib/flow-palette";
import {
  formatCount,
  formatSharePct,
  formatUsd,
  formatZec,
  formatZecTwo,
  monthLong,
} from "@/lib/format";
import type { ChartSlug } from "./catalog";
import type { ChartData } from "./chart-data";
import { chartTable, FOLDED_KEY, type ChartTable } from "./chart-table";
import { POOL_STACK } from "./pool-series";
import { BESIDE_RANKED_LINE, KIND_CLASSES, RANKED_LINES } from "@/lib/ranked-palette";

/** What a gallery card shows beside a chart's title. */
export interface ChartPreview {
  /** The chart in miniature over its whole history, in its own form. Null: unreadable. */
  thumb: ChartThumb | null;
  /** One figure and what it is. Null where the chart has no single honest headline. */
  headline: { value: string; caption: string } | null;
}

/** Enough points to show a shape at card size; more would be sub-pixel. */
export const SPARK_POINTS = 60;

/** Bars need room to read as bars: fewer than a line's points. */
export const FLOW_BARS = 36;

/**
 * Every Nth row, always keeping the newest. Points are picked, never averaged, so every point
 * a thumbnail draws is one the chart draws.
 */
export function sampleEvenly<T>(rows: readonly T[], max: number): T[] {
  if (rows.length <= max) return [...rows];
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => rows[Math.round(i * step)]!);
}

/**
 * The chart in miniature, in its own form and colours: the same columns the chart plots, with
 * the classes its full renderer gives them. Rows are picked evenly, never averaged, so every
 * point drawn is a point the chart draws.
 */
function thumbOf(slug: ChartSlug, t: ChartTable): ChartThumb {
  const flow = slug === "shielding-flow" || slug === "crosschain-volume";
  const rows = sampleEvenly(t.rows, flow ? FLOW_BARS : SPARK_POINTS);
  const col = (i: number) => rows.map((r) => r[i] ?? null);
  const pools = (): ThumbSeries[] =>
    POOL_STACK.map((pool, i) => ({ values: col(i), className: POOL_CLASSES[pool] }));
  const green = (i = 0): ThumbSeries[] => [{ values: col(i), className: "text-green" }];
  switch (slug) {
    case "transactions-by-kind":
      return {
        kind: "stack",
        series: [
          { values: col(0), className: "band-transparent" },
          { values: col(1), className: "band-mixed" },
          { values: col(2), className: "band-shielded" },
        ],
      };
    case "pool-balances":
    case "pool-migrations":
      return { kind: "stack", series: pools() };
    case "pool-usage":
      return { kind: "lines", series: pools() };
    case "shielding-flow":
    case "crosschain-volume":
      return { kind: "flow", inValues: col(0), outValues: col(1) };
    case "median-fee":
      return {
        kind: "lines",
        series: [
          { values: col(0), className: RANKED_LINES[0] },
          { values: col(1), className: RANKED_LINES[1] },
          { values: col(2), className: RANKED_LINES[2] },
        ],
      };
    case "shielded-supply":
      return { kind: "area", series: { values: col(0), className: "text-series" } };
    case "ironwood-balance":
    case "price":
    case "difficulty":
    case "block-size":
    case "fee-totals":
      return { kind: "lines", series: green() };
    case "miner-concentration":
      return {
        kind: "lines",
        max: 100,
        series: [
          { values: col(0), className: RANKED_LINES[0] },
          { values: col(1), className: RANKED_LINES[1] },
          { values: col(2), className: RANKED_LINES[2] },
          { values: col(3), className: BESIDE_RANKED_LINE },
        ],
      };
    case "privacy-share":
      return {
        kind: "lines",
        max: 100,
        series: [
          { values: col(0), className: RANKED_LINES[0] },
          { values: col(1), className: RANKED_LINES[1] },
          { values: col(2), className: RANKED_LINES[2] },
        ],
      };
    case "anonymity-set":
      return {
        kind: "lines",
        series: [
          { values: col(0), className: POOL_CLASSES.sapling },
          { values: col(1), className: POOL_CLASSES.orchard },
          { values: col(2), className: POOL_CLASSES.ironwood },
        ],
      };
    case "blocks-per-day":
      return {
        kind: "lines",
        series: [
          { values: col(1), className: "text-ink-faint", opacity: 0.8 },
          { values: col(0), className: "text-green" },
        ],
      };
    case "transparent-activity":
      return { kind: "lines", series: [{ values: col(0), className: KIND_CLASSES.transparent }] };
    case "upgrade-readiness": {
      const pct = (part: number | null, whole: number | null) =>
        part === null || !whole ? null : (100 * part) / whole;
      return {
        kind: "lines",
        max: 100,
        series: [
          { values: rows.map((r) => pct(r[1] ?? null, r[0] ?? null)), className: RANKED_LINES[0] },
          {
            values: rows.map((r) => pct((r[1] ?? 0) + (r[2] ?? 0), r[0] ?? null)),
            className: RANKED_LINES[1],
          },
          { values: rows.map((r) => pct(r[3] ?? null, r[4] ?? null)), className: RANKED_LINES[2] },
        ],
      };
    }
    case "reorgs":
      return { kind: "bars", series: { values: col(0), className: "text-series" } };
    case "inflow-by-chain":
    case "outflow-by-chain":
      return {
        kind: "stacked-bars",
        series: (t.keys ?? []).map((key, i) => ({
          values: col(i),
          className: key === FOLDED_KEY ? FOLDED_FLOW_CLASS : flowPaletteClass(key),
        })),
      };
    case "volume-by-venue":
      return {
        kind: "stacked-bars",
        series: (t.keys ?? []).map((key, i) => ({
          values: col(i),
          className: VENUE_CLASSES[key as CrossChainProtocol] ?? FOLDED_FLOW_CLASS,
        })),
      };
    case "shielded-capable-swaps":
      return {
        kind: "lines",
        max: 100,
        series: [
          { values: col(0), className: RANKED_LINES[0] },
          { values: col(1), className: RANKED_LINES[1] },
        ],
      };
    case "shielded-share":
      return { kind: "lines", series: [{ values: col(0), className: KIND_CLASSES.shielded }] };
    case "lockbox-balance":
      return { kind: "area", series: { values: col(0), className: "text-series" } };
  }
}

/**
 * The index of the newest row covering a COMPLETE UTC day: today's row is still filling, and a
 * headline read from it would report a drop that has not happened.
 */
function lastCompleteDay(t: ChartTable, nowSec: number): number | null {
  const today = utcDayFromSeconds(nowSec);
  for (let i = t.timestamps.length - 1; i >= 0; i--) {
    if (utcDayFromSeconds(t.timestamps[i]!) < today) return i;
  }
  return null;
}

/** The newest row with a value in `column`, for stocks (a balance, a price) read as they stand. */
function lastWithValue(t: ChartTable, column: number): number | null {
  for (let i = t.rows.length - 1; i >= 0; i--) if (t.rows[i]![column] !== null) return i;
  return null;
}

function headline(slug: ChartSlug, data: ChartData, nowSec: number): ChartPreview["headline"] {
  switch (slug) {
    case "shielded-supply": {
      const t = chartTable(slug, data, "all");
      const i = t && lastWithValue(t, 0);
      if (!t || i === null || i === undefined) return null;
      return {
        value: formatZecTwo(t.rows[i]![0]!),
        caption: `shielded, ${utcDayFromSeconds(t.timestamps[i]!)}`,
      };
    }
    case "ironwood-balance": {
      const t = chartTable(slug, data, "all");
      const i = t && lastWithValue(t, 0);
      if (!t || i === null || i === undefined) return null;
      return { value: formatZecTwo(t.rows[i]![0]!), caption: "in Ironwood, latest hour" };
    }
    case "price": {
      const t = chartTable(slug, data, "all");
      const i = t && lastWithValue(t, 0);
      if (!t || i === null || i === undefined) return null;
      return {
        value: formatUsd(t.rows[i]![0]!),
        caption: `close, ${utcDayFromSeconds(t.timestamps[i]!)}`,
      };
    }
    case "transactions-by-kind": {
      const t = chartTable(slug, data, "30d");
      const i = t && lastCompleteDay(t, nowSec);
      if (!t || i === null || i === undefined) return null;
      const total = t.rows[i]!.reduce<number>((a, b) => a + (b ?? 0), 0);
      return {
        value: formatCount(total),
        caption: `transactions, ${utcDayFromSeconds(t.timestamps[i]!)}`,
      };
    }
    case "median-fee": {
      const t = chartTable(slug, data, "30d");
      const i = t && lastCompleteDay(t, nowSec);
      const fee = t && i !== null && i !== undefined ? t.rows[i]![0] : null;
      if (!t || i === null || i === undefined || fee === null || fee === undefined) return null;
      return {
        value: formatZec(fee),
        caption: `median fully shielded fee, ${utcDayFromSeconds(t.timestamps[i]!)}`,
      };
    }
    case "fee-totals": {
      const day = data.feeTotals?.daily
        .filter((p) => utcDayFromSeconds(p.timestamp) < utcDayFromSeconds(nowSec))
        .at(-1);
      // A day whose blocks are not all covered sums fewer fees than were paid: no headline then,
      // rather than a total that understates.
      if (!day || !feeTotalIsComplete(day)) return null;
      return {
        value: formatZec(day.feeZat),
        caption: `fees paid, ${utcDayFromSeconds(day.timestamp)}`,
      };
    }
    case "difficulty": {
      const t = chartTable(slug, data, "30d");
      const i = t && lastCompleteDay(t, nowSec);
      const v = t && i !== null && i !== undefined ? t.rows[i]![0] : null;
      if (!t || i === null || i === undefined || v === null || v === undefined) return null;
      return {
        value: v.toLocaleString("en-US", { maximumFractionDigits: 0 }),
        caption: `daily average, ${utcDayFromSeconds(t.timestamps[i]!)}`,
      };
    }
    case "block-size": {
      const t = chartTable(slug, data, "30d");
      const i = t && lastCompleteDay(t, nowSec);
      const v = t && i !== null && i !== undefined ? t.rows[i]![0] : null;
      if (!t || i === null || i === undefined || v === null || v === undefined) return null;
      return {
        value: `${(v / 1024).toLocaleString("en-US", { maximumFractionDigits: 1 })} kB`,
        caption: `average block, ${utcDayFromSeconds(t.timestamps[i]!)}`,
      };
    }
    case "privacy-share": {
      const t = chartTable(slug, data, "30d");
      const i = t && lastCompleteDay(t, nowSec);
      if (!t || i === null || i === undefined) return null;
      const [pct, , , total] = t.rows[i]!;
      if (pct === null || pct === undefined || !total) return null;
      return {
        value: formatSharePct(pct),
        caption: `fully shielded, of ${formatCount(total)} transactions, ${utcDayFromSeconds(t.timestamps[i]!)}`,
      };
    }
    case "anonymity-set": {
      const t = chartTable(slug, data, "all");
      const last = t?.rows.at(-1);
      if (!t || !last) return null;
      const pools = ["Sapling", "Orchard", "Ironwood"];
      const largest = last
        .map((v, i) => ({ v, pool: pools[i]! }))
        .filter((x): x is { v: number; pool: string } => x.v !== null)
        .sort((a, b) => b.v - a.v)[0];
      if (!largest) return null;
      return {
        value: `${formatCount(largest.v)} notes`,
        caption: `${largest.pool}, the largest tree, ${utcDayFromSeconds(t.timestamps.at(-1)!)}`,
      };
    }
    case "blocks-per-day": {
      // Every row is a complete day: the route leaves today out.
      const t = chartTable(slug, data, "30d");
      const last = t?.rows.at(-1);
      if (!t || !last || last[0] === null) return null;
      const target = last[1];
      return {
        value: formatCount(last[0]!),
        caption: `blocks on ${utcDayFromSeconds(t.timestamps.at(-1)!)}${
          target === null || target === undefined ? "" : `, target ${formatCount(target)}`
        }`,
      };
    }
    case "transparent-activity": {
      const t = chartTable(slug, data, "30d");
      const i = t && lastWithValue(t, 0);
      if (!t || i === null || i === undefined) return null;
      return {
        value: formatCount(t.rows[i]![0]!),
        caption: `active transparent addresses, ${utcDayFromSeconds(t.timestamps[i]!)}`,
      };
    }
    case "upgrade-readiness": {
      const t = chartTable(slug, data, "all");
      const last = t?.rows.at(-1);
      if (!t || !last || !last[0]) return null;
      return {
        value: formatSharePct((100 * (last[1] ?? 0)) / last[0]),
        caption: `of ${formatCount(last[0])} answering nodes ready, ${utcDayFromSeconds(t.timestamps.at(-1)!)}`,
      };
    }
    case "miner-concentration": {
      // The newest month that has ended: a share of a half-mined month moves as it fills.
      const t = chartTable(slug, data, "all");
      if (!t) return null;
      const now = new Date(nowSec * 1000);
      const thisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth()) / 1000;
      const i = t.timestamps.findLastIndex((ts) => ts < thisMonth);
      const pct = i >= 0 ? t.rows[i]![0] : null;
      if (i < 0 || pct === null || pct === undefined) return null;
      return {
        value: formatSharePct(pct),
        caption: `of blocks to the largest payout address, ${monthLong(t.timestamps[i]!)}`,
      };
    }
    case "reorgs": {
      const since = data.reorgWeeks?.observingSince;
      const t = chartTable(slug, data, "all");
      if (!t || since === null || since === undefined) return null;
      const total = t.rows.reduce((sum, r) => sum + (r[0] ?? 0), 0);
      return {
        value: formatCount(total),
        caption: `observed since ${utcDayFromSeconds(since)}`,
      };
    }
    // Flows, and lines that do not partition, have no one figure that stands for the chart.
    case "pool-balances":
    case "pool-usage":
    case "pool-migrations":
    case "shielding-flow":
    case "crosschain-volume":
    case "inflow-by-chain":
    case "outflow-by-chain":
    case "volume-by-venue":
      return null;
    case "shielded-share": {
      // Daily rows, so the caption names the day the share was read at.
      const t = chartTable(slug, data, "30d");
      const i = t && lastWithValue(t, 0);
      if (!t || i === null || i === undefined) return null;
      return {
        value: formatSharePct(t.rows[i]![0]!),
        caption: `of circulating ZEC shielded, ${utcDayFromSeconds(t.timestamps[i]!)}`,
      };
    }
    case "lockbox-balance": {
      const t = chartTable(slug, data, "30d");
      const i = t && lastWithValue(t, 0);
      if (!t || i === null || i === undefined) return null;
      return {
        value: formatZecTwo(t.rows[i]![0]!),
        caption: `in the lockbox, ${utcDayFromSeconds(t.timestamps[i]!)}`,
      };
    }
    case "shielded-capable-swaps": {
      // The newest month that has ended: a share of a half-month moves as it fills.
      const t = chartTable(slug, data, "all");
      if (!t) return null;
      const now = new Date(nowSec * 1000);
      const thisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth()) / 1000;
      const i = t.timestamps.findLastIndex((ts) => ts < thisMonth);
      const pct = i >= 0 ? t.rows[i]![0] : null;
      if (i < 0 || pct === null || pct === undefined) return null;
      return {
        value: formatSharePct(pct),
        caption: `of incoming swaps went to a shielded-capable address, ${monthLong(t.timestamps[i]!)}`,
      };
    }
  }
}

export function chartPreview(slug: ChartSlug, data: ChartData, nowSec: number): ChartPreview {
  const t = chartTable(slug, data, "all");
  const thumb = t && t.rows.length >= 2 ? thumbOf(slug, t) : null;
  return { thumb, headline: headline(slug, data, nowSec) };
}

import {
  ARRIVAL_ALL_GROUP,
  EXCHANGES,
  MAX_SUPPLY_ZAT,
  allPoolsSupply,
  feeTotalIsComplete,
  issuanceAt,
  issuanceOutlook,
  orphanRatePct,
  orchardDrainLatest,
  utcDayFromSeconds,
  type CrossChainProtocol,
} from "@/domain";
import type { ChartThumb, ThumbSeries } from "@/components/ChartThumbnail";
import { POOL_CLASSES } from "@/lib/pool-palette";
import { EXCHANGE_CLASSES } from "@/lib/exchange-palette";
import { FOLDED_FLOW_CLASS, flowPaletteClass, VENUE_CLASSES } from "@/lib/flow-palette";
import {
  formatCount,
  formatSharePct,
  formatUsd,
  formatZec,
  formatZecTwo,
  formatZecWhole,
  monthLong,
} from "@/lib/format";
import { chainName } from "@/lib/chains";
import type { ChartSlug } from "./catalog";
import type { ChartData } from "./chart-data";
import { chartTable, FOLDED_KEY, runningMonth, type ChartTable } from "./chart-table";
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
function thumbOf(slug: ChartSlug, t: ChartTable, data: ChartData): ChartThumb {
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
    case "issuance-vs-nsm":
      return {
        kind: "lines",
        series: [
          { values: col(0), className: "text-green" },
          { values: col(1), className: "text-series" },
        ],
      };
    case "orchard-migration":
      return {
        kind: "lines",
        series: [
          { values: col(0), className: POOL_CLASSES.ironwood },
          { values: col(1), className: POOL_CLASSES.orchard },
        ],
      };
    case "anonymity-set":
    case "notes-added":
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
    case "node-releases":
    case "node-hosting": {
      // The largest band's share per day: the concentration the chart is about.
      const share = rows.map((r) => (r[0] ? (100 * (r[1] ?? 0)) / r[0] : null));
      return { kind: "lines", max: 100, series: [{ values: share, className: "text-series" }] };
    }
    case "block-arrival-age":
      return {
        kind: "lines",
        series: [
          { values: col(1), className: RANKED_LINES[0], opacity: 0.45 },
          { values: col(0), className: RANKED_LINES[0] },
        ],
      };
    case "exchange-reserves":
      return {
        kind: "lines",
        series: EXCHANGES.map((e, i) => ({ values: col(i), className: EXCHANGE_CLASSES[e] })),
      };
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
    case "orphan-rate":
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
    case "pools-to-majority":
      return { kind: "bars", series: { values: col(0), className: "text-series" } };
    case "shielded-capable-by-chain":
      // Each chain's share, largest chain first: the bars the chart draws, as bars.
      return { kind: "bars", series: { values: col(1), className: "text-green" } };
    case "supply-issuance":
      return issuanceThumb(data) ?? { kind: "lines", series: green(1) };
  }
}

/**
 * The issuance curve in miniature, read on an even grid of instants so the projection keeps its
 * share of the width: its rows are a few breakpoints, which index spacing would squeeze into the
 * right edge. Observed solid, projected faint, joined at the newest close; against the cap.
 */
function issuanceThumb(data: ChartData): ChartThumb | null {
  if (!data.supply || !data.halving) return null;
  const outlook = issuanceOutlook(data.supply, data.halving, data.asOf);
  const first = outlook.observed[0] ?? outlook.projected[0];
  const last = outlook.projected.at(-1);
  if (!first || !last || last.at <= first.at) return null;
  const readings = Array.from({ length: SPARK_POINTS }, (_, i) =>
    issuanceAt(outlook, first.at + (i * (last.at - first.at)) / (SPARK_POINTS - 1)),
  );
  const split = readings.findIndex((r) => r?.projected);
  return {
    kind: "lines",
    max: MAX_SUPPLY_ZAT,
    series: [
      {
        values: readings.map((r) => (r && !r.projected ? r.issuedZat : null)),
        className: "text-series",
      },
      {
        values: readings.map((r, i) =>
          r && (r.projected || i === split - 1) ? r.issuedZat : null,
        ),
        className: "text-series",
        opacity: 0.45,
      },
    ],
  };
}

const withoutLastRow = (t: ChartTable): ChartTable => ({
  ...t,
  timestamps: t.timestamps.slice(0, -1),
  rows: t.rows.slice(0, -1),
});

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

/**
 * The index of the newest month that has ended at `nowSec`: a share of a month still filling
 * moves as it fills, so a headline never reads one.
 */
function lastEndedMonth(t: ChartTable, nowSec: number): number | null {
  const now = new Date(nowSec * 1000);
  const thisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth()) / 1000;
  const i = t.timestamps.findLastIndex((ts) => ts < thisMonth);
  return i >= 0 ? i : null;
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
    case "issuance-vs-nsm": {
      const t = chartTable(slug, data, "all");
      const i = t && lastWithValue(t, 2);
      if (!t || i === null || i === undefined) return null;
      return {
        value: formatZecTwo(t.rows[i]![2]!),
        caption: `issued net of NSM removals, ${utcDayFromSeconds(t.timestamps[i]!)}`,
      };
    }
    case "orchard-migration": {
      const drain = data.ironwood?.orchardDrain;
      const last = drain ? orchardDrainLatest(drain) : null;
      if (!drain || !last || last.sharePct === null || drain.baseOrchardZat === null) return null;
      return {
        value: formatSharePct(last.sharePct),
        caption: `of Orchard's ${formatZecWhole(drain.baseOrchardZat)} before NU6.3 migrated to Ironwood, ${utcDayFromSeconds(last.timestamp)}`,
      };
    }
    case "notes-added": {
      // Daily rows, every one a complete day: the route leaves today out.
      const t = chartTable(slug, data, "30d");
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
        caption: `added to ${largest.pool}, the most of any pool, ${utcDayFromSeconds(t.timestamps.at(-1)!)}`,
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
    case "exchange-reserves": {
      // The newest day with every exchange stated: their sum, and the day it is read at.
      const t = chartTable(slug, data, "30d");
      if (!t) return null;
      for (let i = t.rows.length - 1; i >= 0; i -= 1) {
        const row = t.rows[i]!.slice(0, EXCHANGES.length);
        if (row.some((v) => v === null || v === undefined)) continue;
        const sum = row.reduce<number>((s, v) => s + (v ?? 0), 0);
        return {
          value: formatZecWhole(sum),
          caption: `on ${EXCHANGES.length} exchanges' labelled addresses, ${utcDayFromSeconds(t.timestamps[i]!)}`,
        };
      }
      return null;
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
      const t = chartTable(slug, data, "all");
      const i = t && lastEndedMonth(t, nowSec);
      const pct = t && i !== null ? t.rows[i]![0] : null;
      if (!t || i === null || pct === null || pct === undefined) return null;
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
    case "node-releases":
    case "node-hosting": {
      const t = chartTable(slug, data, "all");
      const last = t?.rows.at(-1);
      if (!t || !last || !last[0] || t.columns.length < 2) return null;
      return {
        value: formatSharePct((100 * (last[1] ?? 0)) / last[0]),
        caption: `of ${formatCount(last[0])} answering nodes on ${t.keys?.[1] ?? ""}, ${utcDayFromSeconds(t.timestamps.at(-1)!)}`,
      };
    }
    case "block-arrival-age": {
      const w = data.blockArrival?.windows.find((x) => x.window === "30d");
      const all = w?.groups.find((g) => g.group === ARRIVAL_ALL_GROUP);
      if (!all || all.p50Seconds === null) return null;
      return {
        value: `${formatCount(all.p50Seconds)} s`,
        caption: `median block age on arrival, last 30 days: ${formatCount(all.measured)} blocks`,
      };
    }
    case "orphan-rate": {
      const w = data.orphanRate?.windows.find((x) => x.key === "30d");
      const pct = w ? orphanRatePct(w) : null;
      if (!w || pct === null) return null;
      return {
        value: formatSharePct(pct, 2),
        caption: `of blocks orphaned, last 30 days: ${formatCount(w.orphans)} of ${formatCount(w.blocks)}`,
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
    case "supply-issuance": {
      const issued = data.supplyNow ? allPoolsSupply(data.supplyNow, "mainnet") : null;
      if (!issued || issued.issuedZat === null) return null;
      return {
        value: formatZecWhole(issued.issuedZat),
        caption: `issued, block ${formatCount(issued.height)}`,
      };
    }
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
    case "shielded-capable-by-chain": {
      // The busiest source chain over all of history, its share beside its counts.
      const t = chartTable(slug, data, "all");
      const row = t?.rows[0];
      const key = t?.rowKeys?.[0];
      const pct = row?.[1];
      if (!t || !row || !key || key === FOLDED_KEY || pct === null || pct === undefined) {
        return null;
      }
      return {
        value: formatSharePct(pct),
        caption: `of swaps from ${chainName(key)} went to a shielded-capable address: ${formatCount(row[2] ?? 0)} of ${formatCount((row[2] ?? 0) + (row[3] ?? 0))}`,
      };
    }
    case "pools-to-majority": {
      const t = chartTable(slug, data, "all");
      const i = t && lastEndedMonth(t, nowSec);
      const pools = t && i !== null ? t.rows[i]![0] : null;
      if (!t || i === null || pools === null || pools === undefined) return null;
      return {
        value: formatCount(pools),
        caption: `reviewed ${pools === 1 ? "pool" : "pools"} mined 51% of blocks, ${monthLong(t.timestamps[i]!)}; the real number cannot be higher`,
      };
    }
    case "shielded-capable-swaps": {
      const t = chartTable(slug, data, "all");
      const i = t && lastEndedMonth(t, nowSec);
      const pct = t && i !== null ? t.rows[i]![0] : null;
      if (!t || i === null || pct === null || pct === undefined) return null;
      return {
        value: formatSharePct(pct),
        caption: `of incoming swaps went to a shielded-capable address, ${monthLong(t.timestamps[i]!)}`,
      };
    }
  }
}

export function chartPreview(slug: ChartSlug, data: ChartData, nowSec: number): ChartPreview {
  const t = chartTable(slug, data, "all");
  // A month still running would end the miniature in a collapse; the full chart hatches it, and
  // a sketch too small to carry the hatching leaves it out.
  const shown = t && runningMonth(t, data.asOf) ? withoutLastRow(t) : t;
  const thumb = shown && shown.rows.length >= 2 ? thumbOf(slug, shown, data) : null;
  return { thumb, headline: headline(slug, data, nowSec) };
}

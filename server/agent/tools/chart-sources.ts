import type { PlotPoint, PlotSeriesId } from "@/domain";
import { parseUtcDayStart } from "@/domain";
import {
  BLOCKS_DAILY_PATH,
  SUPPLY_DAYS_PATH,
  TRANSPARENT_DAYS_PATH,
} from "../../chart-series-routes";
import { asRecord } from "./json";
import { PRICE_HISTORY_PATH } from "./specs";

/**
 * Where each plottable series is read from: the private routes the site's own `/charts` read
 * (`src/data/chain-api-source.ts`), so a chart in the console and the chart on the page come from
 * the same rows. Each body is shape-checked here; a body that is not the expected shape is a failed
 * read, never an empty series.
 */

/** A source's rows, by field. */
export type SourceRows = Record<string, PlotPoint[]>;

export interface ChartSourceSpec {
  path: string;
  surface: "v1" | "chain";
  read: (body: unknown) => SourceRows | null;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A nullable reading, or `undefined` when the value is not a reading at all. */
const cell = (v: unknown): number | null | undefined =>
  v === null ? null : isNum(v) ? v : undefined;

/**
 * An array of `{ timestamp, …fields }` into one point list per field. `fields` maps an output name to
 * the key read; a non-numeric key, a missing timestamp or a non-array body fails the whole read.
 */
function columns(body: unknown, fields: Record<string, string>): SourceRows | null {
  if (!Array.isArray(body)) return null;
  const out: SourceRows = Object.fromEntries(Object.keys(fields).map((f) => [f, []]));
  for (const row of body) {
    const r = asRecord(row);
    if (r === null || !isNum(r.timestamp)) return null;
    for (const [name, key] of Object.entries(fields)) {
      const v = cell(r[key]);
      if (v === undefined) return null;
      out[name]!.push({ t: r.timestamp, v });
    }
  }
  for (const points of Object.values(out)) points.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * A fee total is a floor when some block's total could not be derived, and unmeasured when none
 * could; the floor travels with the value, as `blocksCovered` does on the page.
 */
function feePoints(rows: unknown): PlotPoint[] | null {
  if (!Array.isArray(rows)) return null;
  const out: PlotPoint[] = [];
  for (const row of rows) {
    const r = asRecord(row);
    if (r === null || !isNum(r.timestamp) || !isNum(r.feeZat)) return null;
    if (!isNum(r.blocks) || !isNum(r.blocksCovered)) return null;
    if (r.blocks > 0 && r.blocksCovered === 0) out.push({ t: r.timestamp, v: null });
    else out.push({ t: r.timestamp, v: r.feeZat, floor: r.blocksCovered < r.blocks });
  }
  return out.sort((a, b) => a.t - b.t);
}

export const CHART_SOURCES = {
  supplyDays: {
    path: SUPPLY_DAYS_PATH,
    surface: "chain",
    read: (b) =>
      columns(b, {
        sprout: "sproutZat",
        sapling: "saplingZat",
        orchard: "orchardZat",
        ironwood: "ironwoodZat",
      }),
  },
  shieldedSupply: {
    path: "/chain/analytics/supply",
    surface: "chain",
    read: (b) => columns(b, { total: "totalZat" }),
  },
  months: {
    path: "/chain/analytics/months",
    surface: "chain",
    read: (b) =>
      columns(b, { transparent: "transparentTxs", mixed: "mixedTxs", shielded: "shieldedTxs" }),
  },
  days: {
    path: "/chain/analytics/days",
    surface: "chain",
    read: (b) =>
      columns(b, { transparent: "transparentTxs", mixed: "mixedTxs", shielded: "shieldedTxs" }),
  },
  flowMonths: {
    path: "/chain/analytics/shielding-flow",
    surface: "chain",
    read: (b) => columns(b, { shielded: "shieldedZat", unshielded: "unshieldedZat" }),
  },
  flowDays: {
    path: "/chain/analytics/shielding-flow-days",
    surface: "chain",
    read: (b) => columns(b, { shielded: "shieldedZat", unshielded: "unshieldedZat" }),
  },
  feeTotals: {
    path: "/chain/analytics/fee-totals",
    surface: "chain",
    read: (b) => {
      const r = asRecord(b);
      const monthly = feePoints(r?.monthly);
      const daily = feePoints(r?.daily);
      return monthly === null || daily === null ? null : { monthly, daily };
    },
  },
  poolUsage: {
    path: "/chain/analytics/pool-usage",
    surface: "chain",
    read: (b) =>
      columns(b, {
        sprout: "sproutTxs",
        sapling: "saplingTxs",
        orchard: "orchardTxs",
        ironwood: "ironwoodTxs",
      }),
  },
  blocksDaily: {
    path: BLOCKS_DAILY_PATH,
    surface: "chain",
    read: (b) => columns(b, { blocks: "blocks" }),
  },
  transparentDays: {
    path: TRANSPARENT_DAYS_PATH,
    surface: "chain",
    read: (b) => columns(b, { active: "activeAddresses" }),
  },
  networkDaily: {
    path: "/chain/analytics/network-daily",
    surface: "chain",
    read: (b) => columns(b, { difficulty: "avgDifficulty", bytes: "avgBlockBytes" }),
  },
  /**
   * The public daily closes. Paged (see `pricePages`), so `read` takes one page; the tool merges
   * pages before resampling.
   */
  prices: {
    path: PRICE_HISTORY_PATH,
    surface: "v1",
    read: (b) => {
      const page = readPricePage(b);
      return page === null ? null : { close: page.points };
    },
  },
} as const satisfies Record<string, ChartSourceSpec>;

export type ChartSourceName = keyof typeof CHART_SOURCES;

/** One page of `/v1/prices/daily`: its closes, and whether older ones were cut off. */
export function readPricePage(body: unknown): { points: PlotPoint[]; truncated: boolean } | null {
  const r = asRecord(body);
  if (r === null || !Array.isArray(r.items) || typeof r.truncated !== "boolean") return null;
  const points: PlotPoint[] = [];
  for (const item of r.items) {
    const i = asRecord(item);
    const t = typeof i?.day === "string" ? parseUtcDayStart(i.day) : null;
    if (i === null || t === null || !isNum(i.usd)) return null;
    points.push({ t, v: i.usd });
  }
  return { points: points.sort((a, b) => a.t - b.t), truncated: r.truncated };
}

/** At most this many 1,000-day pages: since launch is four. */
export const MAX_PRICE_PAGES = 5;

/** Where a series reads its days, and its months when a monthly source exists. */
export interface SeriesSource {
  daily: { source: ChartSourceName; field: string };
  /**
   * How far back the daily source reaches, in days, or null for all of history. The `/days`-style
   * siblings serve the trailing 366 days only; a window older than that reads the monthly source.
   */
  dailyReachDays: number | null;
  monthly?: { source: ChartSourceName; field: string };
}

/** The daily siblings of the monthly series serve this many trailing days (`analytics-routes.ts`). */
const TRAILING_DAYS = 366;

const split = (
  daily: ChartSourceName,
  monthly: ChartSourceName,
  field: string,
  monthlyField = field,
): SeriesSource => ({
  daily: { source: daily, field },
  dailyReachDays: TRAILING_DAYS,
  monthly: { source: monthly, field: monthlyField },
});

const allHistory = (source: ChartSourceName, field: string): SeriesSource => ({
  daily: { source, field },
  dailyReachDays: null,
});

/** Typed `Record<PlotSeriesId, …>`, so a catalogue entry without a source fails to compile. */
export const SERIES_SOURCES: Record<PlotSeriesId, SeriesSource> = {
  "sprout-balance": allHistory("supplyDays", "sprout"),
  "sapling-balance": allHistory("supplyDays", "sapling"),
  "orchard-balance": allHistory("supplyDays", "orchard"),
  "ironwood-balance": allHistory("supplyDays", "ironwood"),
  "shielded-supply": allHistory("shieldedSupply", "total"),
  "zec-shielded": split("flowDays", "flowMonths", "shielded"),
  "zec-unshielded": split("flowDays", "flowMonths", "unshielded"),
  "fees-paid": split("feeTotals", "feeTotals", "daily", "monthly"),
  "transparent-transactions": split("days", "months", "transparent"),
  "mixed-transactions": split("days", "months", "mixed"),
  "fully-shielded-transactions": split("days", "months", "shielded"),
  "sprout-transactions": allHistory("poolUsage", "sprout"),
  "sapling-transactions": allHistory("poolUsage", "sapling"),
  "orchard-transactions": allHistory("poolUsage", "orchard"),
  "ironwood-transactions": allHistory("poolUsage", "ironwood"),
  "blocks-mined": allHistory("blocksDaily", "blocks"),
  "active-addresses": allHistory("transparentDays", "active"),
  "zec-price": allHistory("prices", "close"),
  difficulty: allHistory("networkDaily", "difficulty"),
  "block-size": allHistory("networkDaily", "bytes"),
};

import {
  shieldedSplits,
  zeroFilled,
  type PlotPoint,
  type PlotSeriesSpec,
  type PoolMetric,
  type SupplyDayPoint,
} from "@/domain";
import {
  BLOCKS_DAILY_PATH,
  MINER_SHARES_PATH,
  NOTE_TREES_PATH,
  SUPPLY_DAYS_PATH,
  TRANSPARENT_DAYS_PATH,
} from "../../chart-series-routes";
import {
  INFLOW_BY_CHAIN_PATH,
  OUTFLOW_BY_CHAIN_PATH,
  VENUE_MONTHS_PATH,
} from "../../crosschain-routes";
import { asRecord } from "./json";

/**
 * Where each plottable series is read from: the private routes the site's own `/charts` read
 * (`src/data/chain-api-source.ts`), so a chart in the console and the chart on the page come from
 * the same rows. No route here is new and no query is built from a request. Each body is
 * shape-checked; a body that is not the expected shape is a failed read, never an empty series.
 */

/** A source's rows, by field. */
export type SourceRows = Record<string, PlotPoint[]>;

export interface ChartSourceSpec {
  path: string;
  read: (body: unknown) => SourceRows | null;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A nullable reading, or `undefined` when the value is not a reading at all. */
const cell = (v: unknown): number | null | undefined =>
  v === null ? null : isNum(v) ? v : undefined;

const byTime = (a: PlotPoint, b: PlotPoint) => a.t - b.t;

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
  for (const points of Object.values(out)) points.sort(byTime);
  return out;
}

/**
 * Rows keyed by a name inside them (a chain, a venue), made dense over the source's own extent: these
 * routes list only the months something crossed, so a listed month without a key's row is zero.
 */
function keyed(
  body: unknown,
  keyOf: (r: Record<string, unknown>) => string | null,
  fields: Record<string, string>,
): SourceRows | null {
  if (!Array.isArray(body)) return null;
  const out: SourceRows = {};
  for (const row of body) {
    const r = asRecord(row);
    if (r === null || !isNum(r.timestamp)) return null;
    const key = keyOf(r);
    if (key === null) return null;
    for (const [suffix, field] of Object.entries(fields)) {
      const v = r[field];
      if (!isNum(v)) return null;
      (out[`${key}${suffix}`] ??= []).push({ t: r.timestamp, v });
    }
  }
  return zeroFilled(out, "month");
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
  return out.sort(byTime);
}

/**
 * Every pool's close, and the shielded and circulating totals from the same rows through
 * `shieldedSplits`, as `/charts/shielded-share` derives them: one table, so parts charted together
 * reconcile, and a close with an unread pool gets no total rather than one short by a pool.
 */
function supplyRows(body: unknown): SourceRows | null {
  const base = columns(body, {
    transparent: "transparentZat",
    sprout: "sproutZat",
    sapling: "saplingZat",
    orchard: "orchardZat",
    ironwood: "ironwoodZat",
    lockbox: "lockboxZat",
  });
  if (base === null || !Array.isArray(body)) return null;
  const points = [...(body as SupplyDayPoint[])].sort((a, b) => a.timestamp - b.timestamp);
  const splits = shieldedSplits(points);
  return {
    ...base,
    shielded: points.map((p, i) => ({ t: p.timestamp, v: splits[i]?.shieldedZat ?? null })),
    circulating: points.map((p, i) => ({ t: p.timestamp, v: splits[i]?.circulatingZat ?? null })),
  };
}

/** Days in the UTC month starting at `t`. */
const monthDays = (t: number) => {
  const d = new Date(t * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};

/**
 * The largest miners' share of each month's blocks, with the blocks it is a share of. A month the
 * mining index has not finished is unmeasured, except the last, which is the running month and is
 * flagged as such; the page draws earlier part-months with a note, this is stricter on purpose.
 */
function minerShareRows(body: unknown): SourceRows | null {
  if (!Array.isArray(body)) return null;
  const fields = {
    "top1-share": "top1Blocks",
    "top3-share": "top3Blocks",
    "top10-share": "top10Blocks",
    "shielded-coinbase-share": "shieldedBlocks",
  } as const;
  const out: SourceRows = Object.fromEntries(Object.keys(fields).map((f) => [f, []]));
  const rows: Record<string, unknown>[] = [];
  for (const row of body) {
    const r = asRecord(row);
    if (r === null || !isNum(r.timestamp) || !isNum(r.blocks) || !isNum(r.days)) return null;
    rows.push(r);
  }
  rows.sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
  for (const [i, r] of rows.entries()) {
    if (!isNum(r.timestamp) || !isNum(r.blocks) || !isNum(r.days)) return null;
    const whole = r.days >= monthDays(r.timestamp) || i === rows.length - 1;
    for (const [name, key] of Object.entries(fields)) {
      const n = r[key];
      if (!isNum(n)) return null;
      const v = whole && r.blocks > 0 ? (n / r.blocks) * 100 : null;
      out[name]!.push({ t: r.timestamp, v, of: r.blocks });
    }
  }
  return out;
}

/** `/crosschain/volume-series`: both grains, both directions, ZEC and transfer counts. */
function volumeRows(body: unknown): SourceRows | null {
  const r = asRecord(body);
  const grain = (rows: unknown, suffix: string, g: "day" | "month") => {
    const cols = columns(rows, {
      [`in-zec${suffix}`]: "inZat",
      [`out-zec${suffix}`]: "outZat",
      [`in-transfers${suffix}`]: "inTransfers",
      [`out-transfers${suffix}`]: "outTransfers",
    });
    // A field with a null is not a sparse count: these columns are never null on the route.
    if (cols === null || Object.values(cols).some((ps) => ps.some((p) => p.v === null))) {
      return null;
    }
    return zeroFilled(cols, g);
  };
  const daily = grain(r?.daily, ":day", "day");
  const monthly = grain(r?.monthly, ":month", "month");
  return daily === null || monthly === null ? null : { ...daily, ...monthly };
}

export const CHART_SOURCES = {
  supplyDays: { path: SUPPLY_DAYS_PATH, read: supplyRows },
  months: {
    path: "/chain/analytics/months",
    read: (b) =>
      columns(b, { transparent: "transparentTxs", mixed: "mixedTxs", shielded: "shieldedTxs" }),
  },
  days: {
    path: "/chain/analytics/days",
    read: (b) =>
      columns(b, { transparent: "transparentTxs", mixed: "mixedTxs", shielded: "shieldedTxs" }),
  },
  flowMonths: {
    path: "/chain/analytics/shielding-flow",
    read: (b) => columns(b, { in: "shieldedZat", out: "unshieldedZat" }),
  },
  flowDays: {
    path: "/chain/analytics/shielding-flow-days",
    read: (b) => columns(b, { in: "shieldedZat", out: "unshieldedZat" }),
  },
  feeTotals: {
    path: "/chain/analytics/fee-totals",
    read: (b) => {
      const r = asRecord(b);
      const monthly = feePoints(r?.monthly);
      const daily = feePoints(r?.daily);
      return monthly === null || daily === null ? null : { monthly, daily };
    },
  },
  feeKindDays: {
    path: "/chain/analytics/fee-kinds-days",
    read: (b) =>
      columns(b, { transparent: "transparentZat", mixed: "mixedZat", shielded: "shieldedZat" }),
  },
  poolUsage: {
    path: "/chain/analytics/pool-usage",
    read: (b) =>
      columns(b, {
        sprout: "sproutTxs",
        sapling: "saplingTxs",
        orchard: "orchardTxs",
        ironwood: "ironwoodTxs",
      }),
  },
  poolMigrations: {
    path: "/chain/analytics/pool-migrations",
    read: (b) =>
      columns(b, {
        sprout: "toSproutZat",
        sapling: "toSaplingZat",
        orchard: "toOrchardZat",
        ironwood: "toIronwoodZat",
      }),
  },
  noteTrees: {
    path: NOTE_TREES_PATH,
    read: (b) =>
      columns(b, { sapling: "saplingNotes", orchard: "orchardNotes", ironwood: "ironwoodNotes" }),
  },
  blocksDaily: { path: BLOCKS_DAILY_PATH, read: (b) => columns(b, { blocks: "blocks" }) },
  transparentDays: {
    path: TRANSPARENT_DAYS_PATH,
    read: (b) => columns(b, { active: "activeAddresses" }),
  },
  networkDaily: {
    path: "/chain/analytics/network-daily",
    read: (b) => columns(b, { difficulty: "avgDifficulty", bytes: "avgBlockBytes" }),
  },
  minerShares: { path: MINER_SHARES_PATH, read: minerShareRows },
  ccVolume: { path: "/crosschain/volume-series", read: volumeRows },
  ccInflow: {
    path: INFLOW_BY_CHAIN_PATH,
    read: (b) =>
      keyed(b, (r) => (typeof r.chain === "string" ? r.chain.toUpperCase() : null), {
        "": "inZat",
      }),
  },
  ccOutflow: {
    path: OUTFLOW_BY_CHAIN_PATH,
    read: (b) =>
      keyed(b, (r) => (typeof r.chain === "string" ? r.chain.toUpperCase() : null), {
        "": "outZat",
      }),
  },
  ccVenues: {
    path: VENUE_MONTHS_PATH,
    read: (b) =>
      keyed(b, (r) => (typeof r.protocol === "string" ? r.protocol : null), {
        ":in": "inZat",
        ":out": "outZat",
      }),
  },
} as const satisfies Record<string, ChartSourceSpec>;

/** Every source a chart can read, the price history included (read through `chart-prices.ts`). */
export type ChartSourceName = keyof typeof CHART_SOURCES | "prices";

/** Where a series reads its days, and its months when a monthly source exists. */
export interface SeriesSource {
  /** Daily readings, or absent for a series kept per month only. */
  daily?: { source: ChartSourceName; field: string };
  /**
   * How far back the daily source reaches, in days, or null for all of history. The `/days`-style
   * siblings serve the trailing 366 days only; a window older than that reads the monthly source.
   */
  dailyReachDays: number | null;
  monthly?: { source: ChartSourceName; field: string };
}

/** The daily siblings of the monthly series serve this many trailing days (`analytics-routes.ts`). */
export const TRAILING_DAYS = 366;

const split = (
  daily: ChartSourceName,
  dailyField: string,
  monthly: ChartSourceName,
  monthlyField: string,
): SeriesSource => ({
  daily: { source: daily, field: dailyField },
  dailyReachDays: TRAILING_DAYS,
  monthly: { source: monthly, field: monthlyField },
});

const allHistory = (source: ChartSourceName, field: string): SeriesSource => ({
  daily: { source, field },
  dailyReachDays: null,
});

const yearOnly = (source: ChartSourceName, field: string): SeriesSource => ({
  daily: { source, field },
  dailyReachDays: TRAILING_DAYS,
});

const monthsOnly = (source: ChartSourceName, field: string): SeriesSource => ({
  dailyReachDays: null,
  monthly: { source, field },
});

/** Each pool metric's source; every one keeps all of history per day, one field per pool. */
const POOL_METRIC_SOURCE: Record<PoolMetric, ChartSourceName> = {
  balance: "supplyDays",
  transactions: "poolUsage",
  "migrated-in": "poolMigrations",
  notes: "noteTrees",
};

/** Where a spec's numbers come from. A switch over the family, so a new one fails to compile. */
export function seriesSource(spec: PlotSeriesSpec): SeriesSource {
  switch (spec.family) {
    case "pool":
      return allHistory(POOL_METRIC_SOURCE[spec.metric], spec.pool);
    case "supply":
      return allHistory("supplyDays", spec.part);
    case "shielding":
      return split("flowDays", spec.direction, "flowMonths", spec.direction);
    case "transactions":
      return split("days", spec.kind, "months", spec.kind);
    case "fees":
      return spec.stat === "total"
        ? split("feeTotals", "daily", "feeTotals", "monthly")
        : yearOnly("feeKindDays", spec.kind);
    case "mining":
      if (spec.metric === "blocks") return allHistory("blocksDaily", "blocks");
      if (spec.metric === "difficulty") return allHistory("networkDaily", "difficulty");
      return monthsOnly("minerShares", spec.metric);
    case "network":
      return spec.metric === "block-size"
        ? allHistory("networkDaily", "bytes")
        : allHistory("transparentDays", "active");
    case "price":
      return allHistory("prices", "close");
    case "crosschain":
      if (spec.by === "chain") {
        return monthsOnly(spec.direction === "in" ? "ccInflow" : "ccOutflow", spec.chain);
      }
      if (spec.by === "venue") return monthsOnly("ccVenues", `${spec.venue}:${spec.direction}`);
      return split(
        "ccVolume",
        `${spec.direction}-${spec.measure}:day`,
        "ccVolume",
        `${spec.direction}-${spec.measure}:month`,
      );
  }
}

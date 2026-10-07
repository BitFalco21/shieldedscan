import { Hono, type Context } from "hono";
import type { Pool } from "pg";
import { ironwoodResidualZat, migratedZat, type IronwoodInflow } from "@/domain";
import { POOL_NAMES, type PoolName } from "@/domain/pool";
import type { FeeExtreme, FeeExtremeScope, FeeExtremes, ValueExtremes } from "@/domain";
import { readCrossingRecords, type CrossingRecord, type CrossingRecords } from "../boundary-daily";
import { Cached } from "../cached";
import {
  IRONWOOD_INFLOW_SQL,
  readFeeExtremes,
  readValueExtremes,
  type IronwoodInflowRow,
} from "../analytics-routes";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";
import { amount } from "./format";
import { MAX_DAY_BUCKETS, ParamError, parseOptionalDayEdges, rejectUnknown } from "./params";
import { errorBody, routeGroupErrors, setCache } from "./http";
import { loadPoolUsage, type PoolUsageRow } from "../pool-usage";
import { SHAPE_PARAMS, applyShape, parseShape } from "./series-shape";

/**
 * The published daily series on `/v1`: pool balances over time, network difficulty and block
 * size, fee distribution by privacy kind, and where Ironwood's balance came from.
 *
 * A request costs no database work. Each series is small (one row per day since 2016 at most)
 * and moves once an hour when the follower refreshes its matview, so each is loaded whole into a
 * ten-minute single-flight memo and every window, interval and slice is cut in memory. That is
 * why these sit under `/v1`'s ordinary rate limits rather than the tighter `v1_analytics` zones.
 *
 * Parameters are strict, like every `/v1` parameter (`./params.ts`): an unknown or malformed one
 * is a 400 naming it, never a silent widening.
 *
 * A level is never summed and a percentile is never re-aggregated: a monthly pool balance is the
 * month's closing day, and a monthly fee median is read from its own monthly matview (a median of
 * daily medians is a different number).
 */

const MEMO_MS = 10 * 60 * 1000;
/**
 * After the memo expires, the old series is served for up to this long while the reload runs
 * behind it, so no caller waits on the reload's cold query. The source tables change hourly at
 * most, and every answer carries its own coverage line, so a slightly older copy states nothing
 * false.
 */
const STALE_MS = 30 * 60 * 1000;

type Interval = "day" | "month";

interface SeriesWindow {
  from: string | null;
  to: string | null;
  interval: Interval;
  fromTs: number;
  toTs: number;
}

/**
 * `from`/`to` are optional UTC days (`to` exclusive), and absent means the whole series.
 * `interval` defaults to `month`; `day` needs a window of at most 366 days, which is the
 * payload bound the windowed analytics already use.
 */
export function parseSeriesWindow(q: Record<string, string>): SeriesWindow {
  const interval = (q.interval ?? "month") as Interval;
  if (interval !== "day" && interval !== "month") {
    throw new ParamError("invalid_parameter", "interval must be one of day, month");
  }
  const { fromTs, toTs } = parseOptionalDayEdges(q);
  if (interval === "day") {
    const span = fromTs === null || toTs === null ? Infinity : (toTs - fromTs) / DAY_SECONDS;
    if (span > MAX_DAY_BUCKETS) {
      throw new ParamError(
        "invalid_parameter",
        `interval=day needs from and to at most ${MAX_DAY_BUCKETS} days apart; use interval=month for longer`,
      );
    }
  }
  return {
    from: q.from || null,
    to: q.to || null,
    interval,
    fromTs: fromTs ?? 0,
    toTs: toTs ?? Number.POSITIVE_INFINITY,
  };
}

/** The UTC month start (unix seconds) a day belongs to. */
function monthOf(ts: number): number {
  const d = new Date(ts * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

/**
 * A window that reaches today's unfinished UTC day, or past the newest day the series holds,
 * covers less than its label says. The coverage block says so rather than letting a reader
 * take the last point as a full day.
 */
function seriesCoverage(w: SeriesWindow, newestDay: number | null, nowSec: number) {
  const notes: string[] = [];
  const todayStart = Math.floor(nowSec / DAY_SECONDS) * DAY_SECONDS;
  if (w.toTs > todayStart) {
    notes.push("The window includes today's unfinished UTC day; its point covers the day so far.");
  }
  if (newestDay !== null && w.toTs > newestDay + DAY_SECONDS) {
    notes.push(
      `This series is refreshed hourly and currently holds days through ${utcDayFromSeconds(newestDay)}.`,
    );
  }
  return { status: notes.length === 0 ? ("complete" as const) : ("partial" as const), notes };
}

// ---------------------------------------------------------------------------- loaders

interface PoolDayRow {
  ts: number;
  height: number;
  pools: Record<PoolName, number>;
}

async function loadPoolDays(pool: Pool): Promise<PoolDayRow[]> {
  const { rows } = await pool.query<Record<string, string | number>>(
    `SELECT ts, top_height, sprout, sapling, orchard, ironwood FROM chain_day_rollup ORDER BY ts`,
  );
  return rows.map((r) => ({
    ts: Number(r.ts),
    height: Number(r.top_height),
    pools: {
      ironwood: Number(r.ironwood),
      orchard: Number(r.orchard),
      sapling: Number(r.sapling),
      sprout: Number(r.sprout),
    },
  }));
}

interface NetworkDayRow {
  ts: number;
  blocks: number;
  difficulty: number | null;
  bytes: number | null;
}

async function loadNetworkDays(pool: Pool): Promise<NetworkDayRow[]> {
  const { rows } = await pool.query<{
    ts: string;
    blocks: number;
    difficulty: string | null;
    bytes: string | null;
  }>(
    `SELECT ts, blocks, avg_difficulty AS difficulty, avg_block_bytes AS bytes
       FROM chain_day_network ORDER BY ts`,
  );
  // A NULL average stays null: `Number(null)` is 0, which would publish an unmeasured day as
  // zero difficulty.
  return rows.map((r) => ({
    ts: Number(r.ts),
    blocks: Number(r.blocks),
    difficulty: r.difficulty === null ? null : Number(r.difficulty),
    bytes: r.bytes === null ? null : Number(r.bytes),
  }));
}

/** The three privacy kinds a fee is paid on, in this API's vocabulary. */
const FEE_KINDS = ["transparent", "mixed", "fullyShielded"] as const;
type FeeKind = (typeof FEE_KINDS)[number];
const KIND_OF: Record<string, FeeKind> = {
  transparent: "transparent",
  mixed: "mixed",
  shielded: "fullyShielded",
};

interface FeeKindRow {
  ts: number;
  kind: FeeKind;
  medianZat: number;
  p25Zat: number;
  p75Zat: number;
  txs: number;
}

async function loadFeeKinds(pool: Pool, view: "chain_day_fee_kind" | "chain_month_fee_kind") {
  const { rows } = await pool.query<Record<string, string | number>>(
    `SELECT ts, kind, median_zat, p25_zat, p75_zat, txs FROM ${view} ORDER BY ts, kind`,
  );
  return rows.flatMap((r): FeeKindRow[] => {
    const kind = KIND_OF[String(r.kind)];
    if (kind === undefined) return [];
    return [
      {
        ts: Number(r.ts),
        kind,
        medianZat: Number(r.median_zat),
        p25Zat: Number(r.p25_zat),
        p75Zat: Number(r.p75_zat),
        txs: Number(r.txs),
      },
    ];
  });
}

/**
 * The trailing 90 days as ONE distribution per kind — computed over the transactions, not from
 * daily medians, which cannot be combined. Same query `/chain/analytics/fee-kinds` runs; an
 * index range on `tx_keyset_idx`, once per memo window.
 */
async function loadFeeTrailing(pool: Pool, days: number) {
  const { rows } = await pool.query<Record<string, string>>(
    `SELECT kind,
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY fee_zat)::bigint AS median_zat,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY fee_zat)::bigint AS p25_zat,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY fee_zat)::bigint AS p75_zat,
            AVG(fee_zat)::bigint AS mean_zat,
            count(fee_zat) AS txs
       FROM tx
      WHERE kind <> 'coinbase' AND fee_zat IS NOT NULL AND block_height IS NOT NULL
        AND timestamp > EXTRACT(EPOCH FROM now())::bigint - $1 * 86400
      GROUP BY kind`,
    [days],
  );
  return rows;
}

interface IronwoodTerms {
  inflow: Omit<IronwoodInflow, "balance" | "migrations">;
  tipHeight: number;
}

async function loadIronwood(pool: Pool, activationHeight: number): Promise<IronwoodTerms | null> {
  const [terms, tip] = await Promise.all([
    pool.query<IronwoodInflowRow>(IRONWOOD_INFLOW_SQL, [activationHeight]),
    pool.query<{ h: number }>("SELECT max(height) AS h FROM block"),
  ]);
  const r = terms.rows[0];
  if (r === undefined) return null;
  return {
    tipHeight: Number(tip.rows[0]?.h ?? 0),
    inflow: {
      activationHeight,
      balanceZat: Number(r.balance),
      netFromOrchardZat: Number(r.orchard),
      netFromSaplingZat: Number(r.sapling),
      netFromSproutZat: Number(r.sprout),
      netFromTransparentZat: Number(r.transparent),
      fromTransparentTxCount: Number(r.transparent_txs),
      txCount: Number(r.tx_count),
      minedZat: Number(r.mined),
      feesPaidZat: Number(r.fees),
    },
  };
}

// ------------------------------------------------------------------------ pool usage

/** `pool=` for the pool-usage series: one name or a comma list; absent means all four. */
function parseUsagePools(raw: string | undefined): PoolName[] {
  if (raw === undefined || raw.trim() === "") return [...POOL_NAMES];
  const asked = [...new Set(raw.split(",").map((p) => p.trim().toLowerCase()))];
  const bad = asked.filter((p) => !(POOL_NAMES as readonly string[]).includes(p));
  if (bad.length > 0) {
    throw new ParamError("invalid_parameter", `pool must be from ${POOL_NAMES.join(", ")}`);
  }
  return POOL_NAMES.filter((p) => asked.includes(p));
}

interface UsageSums {
  txs: number;
  fullyShielded: number;
  mixed: number;
  shielding: number;
  unshielding: number;
  indeterminate: number;
  coinbase: number;
  spends: number;
  outputs: number;
  actions: number;
  joinsplits: number;
}

const ZERO_SUMS: UsageSums = {
  txs: 0,
  fullyShielded: 0,
  mixed: 0,
  shielding: 0,
  unshielding: 0,
  indeterminate: 0,
  coinbase: 0,
  spends: 0,
  outputs: 0,
  actions: 0,
  joinsplits: 0,
};

function addRow(s: UsageSums, r: PoolUsageRow): UsageSums {
  return {
    txs: s.txs + r.txs,
    fullyShielded: s.fullyShielded + r.fullyShielded,
    mixed: s.mixed + r.mixed,
    shielding: s.shielding + r.shielding,
    unshielding: s.unshielding + r.unshielding,
    indeterminate: s.indeterminate + r.indeterminate,
    coinbase: s.coinbase + r.coinbase,
    spends: s.spends + (r.spends ?? 0),
    outputs: s.outputs + (r.outputs ?? 0),
    actions: s.actions + (r.actions ?? 0),
    joinsplits: s.joinsplits + (r.joinsplits ?? 0),
  };
}

/** The bundle counters a pool actually has — Sapling spends and outputs, Orchard and Ironwood actions, Sprout JoinSplits. */
function bundleOf(pool: PoolName, s: UsageSums) {
  if (pool === "sapling") return { spends: s.spends, outputs: s.outputs };
  if (pool === "sprout") return { joinsplits: s.joinsplits };
  return { actions: s.actions };
}

/**
 * The pool-usage series for a window: counts summed per period (they are flows), the note tree
 * size taken at each period's CLOSE (it is a level), and notes created as the difference of two
 * closes — exact, because the tree only grows. A close the node never reported stays null and so
 * does every difference that needs it; Sprout has none at all.
 *
 * Pure, so the arithmetic is tested without a database.
 */
export function buildPoolUsage(
  rows: readonly PoolUsageRow[],
  w: SeriesWindow,
  pools: readonly PoolName[],
  nowSec: number,
) {
  const unknowns: Record<string, string> = {};
  const byPool = new Map<PoolName, PoolUsageRow[]>();
  for (const r of rows) byPool.set(r.pool, [...(byPool.get(r.pool) ?? []), r]);
  /**
   * The first day the node reported a pool's tree. Before it the pool did not exist, so growth
   * measured from then is growth from empty: the period a pool appears in created every note
   * its first close holds. Derived from the data, as `sinceFirstValue` is for the balance
   * charts, because activation heights differ by network.
   */
  const firstTree = new Map<PoolName, number>();
  for (const r of rows) {
    if (r.pool !== "sprout" && r.notesAtClose !== null && !firstTree.has(r.pool)) {
      firstTree.set(r.pool, r.day);
    }
  }
  /** The last stored close strictly before `ts` for a pool — the base a period's growth is measured from. */
  const closeBefore = (pool: PoolName, ts: number): number | null => {
    const first = firstTree.get(pool);
    if (first !== undefined && ts <= first) return 0;
    const list = byPool.get(pool) ?? [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const r = list[i]!;
      if (r.day < ts) return r.notesAtClose;
    }
    return null;
  };
  const periodOf = (ts: number) => (w.interval === "month" ? monthOf(ts) : ts);
  const kept = rows.filter((r) => r.day >= w.fromTs && r.day < w.toTs && pools.includes(r.pool));
  const periods = [...new Set(kept.map((r) => periodOf(r.day)))].sort((a, b) => a - b);
  const describe = (pool: PoolName, days: PoolUsageRow[], basePath: string) => {
    const sums = days.reduce(addRow, ZERO_SUMS);
    const last = days.at(-1) ?? null;
    const atClose = last?.notesAtClose ?? null;
    const before = days[0] ? closeBefore(pool, days[0].day) : null;
    const created = atClose !== null && before !== null ? atClose - before : null;
    if (atClose === null) {
      unknowns[`${basePath}.notes.atClose`] = pool === "sprout" ? "unmeasured" : "nonexistent";
    }
    if (created === null) {
      unknowns[`${basePath}.notes.created`] = pool === "sprout" ? "unmeasured" : "nonexistent";
    }
    return {
      transactions: {
        total: sums.txs,
        fullyShielded: sums.fullyShielded,
        mixed: sums.mixed,
        coinbase: sums.coinbase,
        mixedByDirection: {
          shielding: sums.shielding,
          unshielding: sums.unshielding,
          indeterminate: sums.indeterminate,
        },
      },
      bundle: bundleOf(pool, sums),
      notes: {
        atClose,
        created,
        closeDay: last ? utcDayFromSeconds(last.day) : null,
        closeHeight: last?.closeHeight ?? null,
      },
    };
  };
  const points = periods.map((start, i) => {
    const inPeriod = kept.filter((r) => periodOf(r.day) === start);
    return {
      periodStart: utcDayFromSeconds(start),
      pools: Object.fromEntries(
        pools.map((p) => [
          p,
          describe(
            p,
            inPeriod.filter((r) => r.pool === p),
            `data.points.${i}.pools.${p}`,
          ),
        ]),
      ),
    };
  });
  const totals = Object.fromEntries(
    pools.map((p) => [
      p,
      describe(
        p,
        kept.filter((r) => r.pool === p),
        `data.totals.${p}`,
      ),
    ]),
  );
  // Days the window covers that are not computed yet — the backfill, or today's newest blocks.
  const todayStart = Math.floor(nowSec / DAY_SECONDS) * DAY_SECONDS;
  const firstDay = rows[0]?.day ?? null;
  const notes: string[] = [];
  if (w.toTs > todayStart) {
    notes.push("The window includes today's unfinished UTC day; its figures cover the day so far.");
  }
  if (firstDay !== null) {
    const stored = new Set(rows.filter((r) => r.pool === pools[0]).map((r) => r.day));
    const lo = Math.max(w.fromTs, firstDay);
    const hi = Math.min(w.toTs, todayStart + DAY_SECONDS);
    let missing = 0;
    for (let d = lo; d < hi; d += DAY_SECONDS) if (!stored.has(d)) missing += 1;
    if (missing > 0) notes.push(`${missing} day(s) in this window are not computed yet.`);
  } else {
    notes.push("Nothing is computed yet.");
  }
  return {
    coverage: { status: notes.length === 0 ? ("complete" as const) : ("partial" as const), notes },
    data: { interval: w.interval, totals, points },
    unknowns,
  };
}

// ----------------------------------------------------------------------------- routes

export interface V1SeriesDeps {
  pool: Pool;
  /** Per network; the route answers about the chain the pool indexes. */
  ironwoodActivationHeight: number;
  now?: () => number;
}

/** The paths this module serves, for the descriptor and the docs. */
export const V1_SERIES_PATHS = [
  "/v1/analytics/pools",
  "/v1/analytics/pool-usage",
  "/v1/analytics/network",
  "/v1/analytics/fees",
  "/v1/analytics/ironwood",
  "/v1/analytics/records",
] as const;

export function v1SeriesRoutes(deps: V1SeriesDeps): Hono {
  const app = new Hono();
  const { pool } = deps;
  const now = deps.now ?? Date.now;
  const nowSec = () => Math.floor(now() / 1000);

  const poolDays = new Cached<PoolDayRow[]>(MEMO_MS, { staleMs: STALE_MS });
  const networkDays = new Cached<NetworkDayRow[]>(MEMO_MS, { staleMs: STALE_MS });
  const feeDays = new Cached<FeeKindRow[]>(MEMO_MS, { staleMs: STALE_MS });
  const feeMonths = new Cached<FeeKindRow[]>(MEMO_MS, { staleMs: STALE_MS });
  const feeTrailing = new Cached<Record<string, string>[]>(MEMO_MS, { staleMs: STALE_MS });
  const ironwood = new Cached<IronwoodTerms | null>(MEMO_MS, { staleMs: STALE_MS });
  const records = new Cached<{
    fees: FeeExtremes | null;
    value: ValueExtremes | null;
    crossings: CrossingRecords | null;
  }>(MEMO_MS, { staleMs: STALE_MS });
  const poolUsage = new Cached<PoolUsageRow[]>(MEMO_MS, { staleMs: STALE_MS });

  app.onError(routeGroupErrors("the chain index could not answer just now; retry shortly"));

  // Hourly matviews behind a ten-minute memo: five minutes at the edge is honest.
  const cacheHeader = (c: Context) => setCache(c, "series");

  const inWindow = (w: SeriesWindow) => (ts: number) => ts >= w.fromTs && ts < w.toTs;

  // ------------------------------------------------------------------- /analytics/pools
  app.get("/v1/analytics/pools", async (c) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "interval", ...SHAPE_PARAMS]);
    const shape = parseShape(q);
    const w = parseSeriesWindow(q);
    const rows = await poolDays.get(() => loadPoolDays(pool));
    const kept = rows.filter((r) => inWindow(w)(r.ts));
    // A month's balance is its CLOSING day — the newest day of the month the window holds.
    // A balance is a level: summing or averaging days would not be a balance at any moment.
    const byPeriod = new Map<number, PoolDayRow>();
    for (const r of kept) byPeriod.set(w.interval === "month" ? monthOf(r.ts) : r.ts, r);
    const points = [...byPeriod.entries()].map(([start, r]) => {
      const total = POOL_NAMES.reduce((s, p) => s + r.pools[p], 0);
      return {
        periodStart: utcDayFromSeconds(start),
        closing: { day: utcDayFromSeconds(r.ts), height: r.height },
        pools: Object.fromEntries(POOL_NAMES.map((p) => [p, amount(r.pools[p])])),
        totalShielded: amount(total),
      };
    });
    cacheHeader(c);
    return c.json(
      applyShape(
        {
          query: { from: w.from, to: w.to, interval: w.interval },
          // A monthly row's ts is the month's START, not its newest day, so only daily rows can say
          // how far the series reaches.
          coverage: seriesCoverage(
            w,
            w.interval === "day" ? (rows.at(-1)?.ts ?? null) : null,
            nowSec(),
          ),
          source: { name: "ShieldedScan", url: `${SITE}/charts/pool-balances` },
          basis:
            "closing balance of each shielded pool at the period's highest block; a level, not a flow — never sum points. The transparent and lockbox pools are at /v1/supply.",
          data: { interval: w.interval, points },
          unknowns: {},
          asOf: nowSec(),
        },
        shape,
      ),
    );
  });

  // -------------------------------------------------------------- /analytics/pool-usage
  app.get("/v1/analytics/pool-usage", async (c) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "interval", "pool", ...SHAPE_PARAMS]);
    const shape = parseShape(q);
    const w = parseSeriesWindow(q);
    const pools = parseUsagePools(q.pool);
    const rows = await poolUsage.get(() => loadPoolUsage(pool));
    const built = buildPoolUsage(rows, w, pools, nowSec());
    cacheHeader(c);
    return c.json(
      applyShape(
        {
          query: { from: w.from, to: w.to, interval: w.interval, pool: pools },
          coverage: built.coverage,
          source: { name: "ShieldedScan", url: `${SITE}/shielded` },
          basis:
            "transactions that used each pool (carried a bundle in it), split by kind; a pool migration uses two pools and is counted in both, so pools do not sum. `notes.atClose` is the pool's note commitment tree size at the period's last block, as the node reports it: every note ever created in the pool, spent or not — the anonymity set a spend from it hides in. Sprout's is not reported.",
          data: built.data,
          unknowns: built.unknowns,
          asOf: nowSec(),
        },
        shape,
      ),
    );
  });

  // ----------------------------------------------------------------- /analytics/network
  app.get("/v1/analytics/network", async (c) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "interval", ...SHAPE_PARAMS]);
    const shape = parseShape(q);
    const w = parseSeriesWindow(q);
    const rows = await networkDays.get(() => loadNetworkDays(pool));
    const buckets = new Map<number, NetworkDayRow[]>();
    for (const r of rows.filter((r) => inWindow(w)(r.ts))) {
      const key = w.interval === "month" ? monthOf(r.ts) : r.ts;
      buckets.set(key, [...(buckets.get(key) ?? []), r]);
    }
    const unknowns: Record<string, string> = {};
    // Averages are weighted BY BLOCK, so a month's figure equals a scan of every block in it —
    // an unweighted mean of daily means differs at every difficulty adjustment. A day whose
    // average is unmeasured contributes neither to the numerator nor to the weight.
    const weighted = (days: NetworkDayRow[], field: "difficulty" | "bytes"): number | null => {
      let num = 0;
      let blocks = 0;
      for (const d of days) {
        const v = d[field];
        if (v === null) continue;
        num += v * d.blocks;
        blocks += d.blocks;
      }
      return blocks === 0 ? null : num / blocks;
    };
    const points = [...buckets.entries()].map(([start, days], i) => {
      const avgDifficulty = weighted(days, "difficulty");
      const avgBlockBytes = weighted(days, "bytes");
      if (avgDifficulty === null) unknowns[`data.points.${i}.avgDifficulty`] = "unmeasured";
      if (avgBlockBytes === null) unknowns[`data.points.${i}.avgBlockBytes`] = "unmeasured";
      return {
        periodStart: utcDayFromSeconds(start),
        blocks: days.reduce((s, d) => s + d.blocks, 0),
        avgDifficulty: avgDifficulty === null ? null : Math.round(avgDifficulty * 100) / 100,
        avgBlockBytes: avgBlockBytes === null ? null : Math.round(avgBlockBytes),
      };
    });
    cacheHeader(c);
    return c.json(
      applyShape(
        {
          query: { from: w.from, to: w.to, interval: w.interval },
          coverage: seriesCoverage(w, rows.at(-1)?.ts ?? null, nowSec()),
          source: { name: "ShieldedScan", url: `${SITE}/charts/difficulty` },
          basis:
            "averages weighted by block, so a month's figure equals the mean over every block in it",
          data: { interval: w.interval, points },
          unknowns,
          asOf: nowSec(),
        },
        shape,
      ),
    );
  });

  // -------------------------------------------------------------------- /analytics/fees
  app.get("/v1/analytics/fees", async (c) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "interval", ...SHAPE_PARAMS]);
    const shape = parseShape(q);
    const w = parseSeriesWindow(q);
    const TRAILING_DAYS = 90;
    const [rows, trailing] = await Promise.all([
      w.interval === "day"
        ? feeDays.get(() => loadFeeKinds(pool, "chain_day_fee_kind"))
        : feeMonths.get(() => loadFeeKinds(pool, "chain_month_fee_kind")),
      feeTrailing.get(() => loadFeeTrailing(pool, TRAILING_DAYS)),
    ]);
    const unknowns: Record<string, string> = {};
    const byPeriod = new Map<number, Partial<Record<FeeKind, FeeKindRow>>>();
    for (const r of rows.filter((r) => inWindow(w)(r.ts))) {
      byPeriod.set(r.ts, { ...(byPeriod.get(r.ts) ?? {}), [r.kind]: r });
    }
    const points = [...byPeriod.entries()].map(([start, kinds], i) => ({
      periodStart: utcDayFromSeconds(start),
      byKind: Object.fromEntries(
        FEE_KINDS.map((k) => {
          const r = kinds[k];
          // No transaction of this kind paid a fee that period: nothing to take a median of.
          if (r === undefined) {
            unknowns[`data.points.${i}.byKind.${k}`] = "nonexistent";
            return [k, null];
          }
          return [
            k,
            {
              median: amount(r.medianZat),
              p25: amount(r.p25Zat),
              p75: amount(r.p75Zat),
              txs: r.txs,
            },
          ];
        }),
      ),
    }));
    const trailingByKind = Object.fromEntries(
      FEE_KINDS.map((k) => {
        const r = trailing.find((t) => KIND_OF[t.kind ?? ""] === k);
        if (r === undefined) {
          unknowns[`data.trailing.byKind.${k}`] = "nonexistent";
          return [k, null];
        }
        return [
          k,
          {
            median: amount(Number(r.median_zat)),
            p25: amount(Number(r.p25_zat)),
            p75: amount(Number(r.p75_zat)),
            mean: amount(Number(r.mean_zat)),
            txs: Number(r.txs),
          },
        ];
      }),
    );
    cacheHeader(c);
    return c.json(
      applyShape(
        {
          query: { from: w.from, to: w.to, interval: w.interval },
          coverage: seriesCoverage(w, rows.at(-1)?.ts ?? null, nowSec()),
          source: { name: "ShieldedScan", url: `${SITE}/charts/median-fee` },
          basis:
            "fee paid per transaction, coinbase excluded; percentiles are computed over the period's own transactions and must never be averaged across periods",
          data: {
            interval: w.interval,
            trailing: { days: TRAILING_DAYS, byKind: trailingByKind },
            points,
          },
          unknowns,
          asOf: nowSec(),
        },
        shape,
      ),
    );
  });

  // ---------------------------------------------------------------- /analytics/ironwood
  app.get("/v1/analytics/ironwood", async (c) => {
    rejectUnknown(c.req.query(), []);
    const terms = await ironwood.get(() => loadIronwood(pool, deps.ironwoodActivationHeight));
    if (terms === null) {
      return c.json(
        errorBody(c, "upstream_unavailable", "the Ironwood terms could not be read just now"),
        503,
      );
    }
    const i = terms.inflow;
    cacheHeader(c);
    return c.json({
      query: {},
      coverage: { status: "complete", notes: [] },
      source: { name: "ShieldedScan", url: `${SITE}/shielded` },
      basis:
        "every term is the counterparty's own published value balance, netted across every transaction since activation; nothing is apportioned. balance = fromOrchard + fromSapling + fromSprout + fromTransparent + mined − feesPaid",
      data: {
        activationHeight: i.activationHeight,
        readAtHeight: terms.tipHeight,
        balance: amount(i.balanceZat),
        sources: {
          fromOrchard: amount(i.netFromOrchardZat),
          fromSapling: amount(i.netFromSaplingZat),
          fromSprout: amount(i.netFromSproutZat),
          fromTransparent: amount(i.netFromTransparentZat),
          mined: amount(i.minedZat),
          feesPaid: amount(i.feesPaidZat),
        },
        migrated: amount(migratedZat({ ...i, balance: [] })),
        // Zero by construction; published so a reader can check the identity holds.
        residual: amount(ironwoodResidualZat({ ...i, balance: [] })),
        transactions: {
          withIronwoodBundle: i.txCount,
          shieldedFromTransparent: i.fromTransparentTxCount,
        },
      },
      unknowns: {},
      asOf: nowSec(),
    });
  });

  // ----------------------------------------------------------------- /analytics/records
  /*
   * The all-time fee and transparent-value records. A record is named (txid or height) only
   * when it is unique: both fee minima are zero with tens of thousands of ties, so naming one
   * holder would be arbitrary. The value range covers transparent value only (a fully shielded
   * transaction has no public amount) and is withheld (null, `unmeasured`) until the walk behind
   * it reaches the tip, because an extremum over part of the chain may be the wrong row.
   */
  app.get("/v1/analytics/records", async (c) => {
    rejectUnknown(c.req.query(), []);
    const r = await records.get(async () => {
      const [fees, value, crossings] = await Promise.all([
        readFeeExtremes(pool),
        readValueExtremes(pool),
        readCrossingRecords(pool).catch(() => null),
      ]);
      return { fees, value, crossings };
    });
    const record = (e: FeeExtreme, named: "txid" | "height") => ({
      amount: amount(e.feeZat),
      ties: e.count,
      ...(named === "txid"
        ? { txid: e.count === 1 ? e.id : null }
        : { height: e.count === 1 ? e.height : null }),
      ...(named === "txid" ? { height: e.count === 1 ? e.height : null } : {}),
    });
    const scope = (s: FeeExtremeScope, named: "txid" | "height") => ({
      lowest: record(s.lowest, named),
      lowestNonZero: s.lowestNonZero ? record(s.lowestNonZero, named) : null,
      highest: record(s.highest, named),
      considered: s.considered,
    });
    const unknowns: Record<string, string> = {};
    if (r.fees === null) unknowns["data.fees"] = "unmeasured";
    if (r.fees !== null && !r.fees.transaction.lowestNonZero)
      unknowns["data.fees.transaction.lowestNonZero"] = "unmeasured";
    if (r.fees !== null && !r.fees.block.lowestNonZero)
      unknowns["data.fees.block.lowestNonZero"] = "unmeasured";
    if (r.value === null) unknowns["data.transparentValue"] = "unmeasured";
    // Withheld until the daily table covers the whole chain, the transparent range's rule: a
    // maximum over part of the chain is potentially the wrong row, not an estimate.
    const crossings = r.crossings !== null && r.crossings.complete ? r.crossings : null;
    if (crossings === null) unknowns["data.crossings"] = "unmeasured";
    const crossing = (kind: string, x: CrossingRecord) => {
      if (x.amountZat === null) unknowns[`data.crossings.${kind}.amount`] = "nonexistent";
      return {
        amount: x.amountZat === null ? null : amount(x.amountZat),
        ties: x.ties,
        txid: x.txid,
        height: x.height,
        considered: x.considered,
      };
    };
    cacheHeader(c);
    return c.json({
      query: {},
      coverage: { status: "complete", notes: [] },
      source: { name: "ShieldedScan", url: `${SITE}/charts/median-fee` },
      basis:
        "coinbase excluded throughout. A record is named only when it is unique (ties = 1). transparentValue covers transactions with a public amount only — never the largest transaction on Zcash, whose shielded amounts are encrypted. crossings are the largest single shielding (transparent value into the pools), unshielding (out of them) and pool migration, each measured by the balances the pools themselves publish.",
      data: {
        fees:
          r.fees === null
            ? null
            : {
                transaction: scope(r.fees.transaction, "txid"),
                block: scope(r.fees.block, "height"),
              },
        transparentValue:
          r.value === null
            ? null
            : {
                lowest: record(r.value.lowest, "txid"),
                highest: record(r.value.highest, "txid"),
                considered: r.value.considered,
                coveredThroughHeight: r.value.coveredThroughHeight,
              },
        crossings:
          crossings === null
            ? null
            : {
                shielding: crossing("shielding", crossings.shielding),
                unshielding: crossing("unshielding", crossings.unshielding),
                migration: crossing("migration", crossings.migration),
                coveredThroughDay:
                  crossings.coveredThrough === null
                    ? null
                    : utcDayFromSeconds(crossings.coveredThrough),
              },
      },
      unknowns,
      asOf: nowSec(),
    });
  });

  return app;
}

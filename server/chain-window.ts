import type { Pool } from "pg";
import { formatMoneyExact } from "@/lib/money";
import type {
  ChainWindowAggregate,
  ChainWindowBucket,
  ChainWindowFilters,
  ChainWindowGroupBy,
  PoolMigrationCell,
  PoolTxCounts,
  PoolTxCountsUnavailable,
} from "@/domain";
import { POOL_TX_COUNT_MAX_BLOCKS } from "@/domain";
import { BOUNDARY_COVERAGE_SQL } from "./boundary-daily";
import { POOL_USED_SQL } from "./pool-sql";
import { DAY_SECONDS } from "@/domain/time";

/**
 * A window of chain activity, totalled and optionally broken down by day or month.
 *
 * The series routes return whole series for charts; this answers totals for a window ("how many
 * shielded transactions in July"), so a consumer never has to sum a series itself.
 *
 * It reads the daily matviews, never `block` or `tx` directly. Each is keyed on a unique `ts`
 * index with one row per day of the chain, so a window is an indexed range scan over a few
 * thousand rows rather than a GROUP BY over millions. That is also why there is no cache: the
 * query is small and the route is token-gated and rate-limited.
 *
 * No 366-day horizon: the matviews are full-chain, so any year can be asked about.
 */

/** The four daily matviews this reads, named once so a rename fails in one place. */
const DAY_ROLLUP = "chain_day_rollup";
const DAY_SHIELDING = "chain_day_shielding_flow";
const DAY_FEES = "chain_day_fee_total";
const DAY_NETWORK = "chain_day_network";

/**
 * The bucket key for a grain, as a SQL expression over `ts`.
 *
 * `none` collapses everything to a constant, and the caller stamps the window's own start on the
 * result; using the first covered day instead would re-report the window's edge as wherever the
 * data happened to begin.
 */
const BUCKET_TS: Record<ChainWindowGroupBy, string> = {
  none: "0",
  day: "ts",
  month: "EXTRACT(EPOCH FROM date_trunc('month', to_timestamp(ts)))::bigint",
};

interface BucketRow {
  bucket_ts: string | number;
  days_covered: string | number;
  transparent: string | number;
  mixed: string | number;
  shielded: string | number;
  shielding_txs: string | number;
  unshielding_txs: string | number;
  indeterminate_txs: string | number;
  blocks: string | number;
  shielded_zat: string | number;
  unshielded_zat: string | number;
  fee_zat: string | number;
  blocks_covered: string | number;
  /** NULL when no block in the bucket carried the column — never coerce this with `Number()`. */
  avg_difficulty: string | number | null;
  avg_block_bytes: string | number | null;
  first_at: string | number | null;
  last_at: string | number | null;
}

interface ClosingRow {
  top_height: string | number;
  sprout: string | number;
  sapling: string | number;
  orchard: string | number;
  ironwood: string | number;
}

const num = (v: string | number): number => Number(v);

/** A NULL average stays null: `Number(null)` is `0`, which would read as a measured zero. */
const nullableNum = (v: string | number | null): number | null => (v === null ? null : Number(v));

/**
 * The aggregation, in one place, with only the bucket key varying.
 *
 *  - The joins are FULL OUTER on `ts`. The shielding-flow view has no row for a day nothing crossed
 *    the shielded boundary, while the rollup does; an inner join would drop such a day from a
 *    transaction count that has nothing to do with shielding.
 *  - `blocks` and `blocks_covered` both come from `chain_day_fee_total`, where they are defined
 *    over the same rows, so coverage is always relative to its own denominator and can never
 *    exceed 100% because two matviews were refreshed at different times.
 *  - The averages are weighted by block, so they equal a scan of every block in the range.
 *    `AVG(avg_difficulty)` is a different quantity whenever block production varies. `net_blocks`
 *    is the weight and comes from the same view as the mean it weights.
 *  - `dir` reads `boundary_daily` for every day it covers and `tx` only for the rest: the two
 *    newest days always, and everything from the first uncovered day while the table fills
 *    (`BOUNDARY_COVERAGE_SQL`). `tx_direction_keyset_idx` carries no `block_height`, so reading
 *    `tx` for all of history is a heap fetch per row. The window is exact either way. The bounds
 *    are pushed into both branches rather than applied after them, or every request would
 *    aggregate all of history.
 *
 * `$1`/`$2` are day-start unix seconds. `to` is exclusive, so a calendar month is counted once.
 */
export function aggregateSql(groupBy: ChainWindowGroupBy): string {
  return `
    WITH ${BOUNDARY_COVERAGE_SQL},
    dir AS (
      SELECT EXTRACT(EPOCH FROM day)::bigint AS ts,
             shielding_txs, unshielding_txs, indeterminate_txs
        FROM boundary_daily
       WHERE EXTRACT(EPOCH FROM day)::bigint < (SELECT t FROM cov)
         AND ($1::bigint IS NULL OR EXTRACT(EPOCH FROM day)::bigint >= $1::bigint)
         AND ($2::bigint IS NULL OR EXTRACT(EPOCH FROM day)::bigint <  $2::bigint)
      UNION ALL
      SELECT (timestamp / 86400) * 86400 AS ts,
             COUNT(*) FILTER (WHERE direction = 'shielding')::bigint     AS shielding_txs,
             COUNT(*) FILTER (WHERE direction = 'unshielding')::bigint   AS unshielding_txs,
             COUNT(*) FILTER (WHERE direction = 'indeterminate')::bigint AS indeterminate_txs
        FROM tx
       WHERE kind = 'mixed' AND direction IS NOT NULL AND block_height IS NOT NULL
         AND timestamp >= (SELECT t FROM cov)
         AND ($1::bigint IS NULL OR timestamp >= $1::bigint)
         AND ($2::bigint IS NULL OR timestamp <  $2::bigint)
       GROUP BY 1
    ),
    days AS (
      SELECT COALESCE(r.ts, s.ts, f.ts, n.ts, d.ts) AS ts,
             COALESCE(r.transparent, 0)       AS transparent,
             COALESCE(r.mixed, 0)             AS mixed,
             COALESCE(r.shielded, 0)          AS shielded,
             COALESCE(d.shielding_txs, 0)     AS shielding_txs,
             COALESCE(d.unshielding_txs, 0)   AS unshielding_txs,
             COALESCE(d.indeterminate_txs, 0) AS indeterminate_txs,
             COALESCE(s.shielded_zat, 0)      AS shielded_zat,
             COALESCE(s.unshielded_zat, 0)    AS unshielded_zat,
             COALESCE(f.fee_zat, 0)           AS fee_zat,
             COALESCE(f.blocks, 0)            AS blocks,
             COALESCE(f.blocks_covered, 0)    AS blocks_covered,
             n.avg_difficulty                 AS avg_difficulty,
             n.avg_block_bytes                AS avg_block_bytes,
             COALESCE(n.blocks, 0)            AS net_blocks
        FROM ${DAY_ROLLUP} r
        FULL OUTER JOIN ${DAY_SHIELDING} s ON s.ts = r.ts
        FULL OUTER JOIN ${DAY_FEES}      f ON f.ts = COALESCE(r.ts, s.ts)
        FULL OUTER JOIN ${DAY_NETWORK}   n ON n.ts = COALESCE(r.ts, s.ts, f.ts)
        FULL OUTER JOIN dir              d ON d.ts = COALESCE(r.ts, s.ts, f.ts, n.ts)
       WHERE ($1::bigint IS NULL OR COALESCE(r.ts, s.ts, f.ts, n.ts, d.ts) >= $1::bigint)
         AND ($2::bigint IS NULL OR COALESCE(r.ts, s.ts, f.ts, n.ts, d.ts) <  $2::bigint)
    )
    SELECT ${BUCKET_TS[groupBy]}       AS bucket_ts,
           COUNT(*)::int               AS days_covered,
           SUM(transparent)::bigint    AS transparent,
           SUM(mixed)::bigint          AS mixed,
           SUM(shielded)::bigint       AS shielded,
           SUM(shielding_txs)::bigint     AS shielding_txs,
           SUM(unshielding_txs)::bigint   AS unshielding_txs,
           SUM(indeterminate_txs)::bigint AS indeterminate_txs,
           SUM(blocks)::bigint         AS blocks,
           SUM(shielded_zat)::bigint   AS shielded_zat,
           SUM(unshielded_zat)::bigint AS unshielded_zat,
           SUM(fee_zat)::bigint        AS fee_zat,
           SUM(blocks_covered)::bigint AS blocks_covered,
           CASE WHEN SUM(net_blocks) FILTER (WHERE avg_difficulty IS NOT NULL) > 0
                THEN SUM(avg_difficulty * net_blocks) FILTER (WHERE avg_difficulty IS NOT NULL)
                     / SUM(net_blocks) FILTER (WHERE avg_difficulty IS NOT NULL)
           END                         AS avg_difficulty,
           CASE WHEN SUM(net_blocks) FILTER (WHERE avg_block_bytes IS NOT NULL) > 0
                THEN SUM(avg_block_bytes * net_blocks) FILTER (WHERE avg_block_bytes IS NOT NULL)
                     / SUM(net_blocks) FILTER (WHERE avg_block_bytes IS NOT NULL)
           END                         AS avg_block_bytes,
           MIN(ts)::bigint             AS first_at,
           MAX(ts)::bigint             AS last_at
      FROM days
     GROUP BY 1
     ORDER BY 1`;
}

/**
 * Crossing counts narrowed to a value floor, as a separate opt-in query.
 *
 * The base `dir` CTE reads only indexed columns; the value balances are not in
 * `tx_direction_keyset_idx`, so reading them costs a heap fetch per row. As a second query, only a
 * request that asks for a threshold pays that.
 *
 * One predicate serves both floor kinds, so a fix cannot reach one and miss the other:
 *
 *  - `$3` is a ZEC floor in zatoshi: exact, no price join, every day measurable.
 *  - `$4` is a floor in currency `$5`, evaluated against each row's own day's close. A row whose
 *    day has no stored close is not counted, since it has not been measured against the floor;
 *    `priced` beside `considered` makes a partly priced window visible.
 *
 * Both may be supplied, and then both bind. `to` is exclusive and both bounds are pushed into the
 * CTE. `indeterminate` crossings are excluded by `direction IN (...)`: their pools moved opposite
 * ways, so they have no single amount.
 */
export function thresholdedCrossingsSql(groupBy: ChainWindowGroupBy): string {
  const measurable = `CASE WHEN $4::double precision IS NULL THEN TRUE
                           ELSE usd IS NOT NULL AND ($5 = 'usd' OR rate IS NOT NULL) END`;
  const clears = `(($3::bigint IS NULL OR magnitude >= $3::bigint)
                   AND ($4::double precision IS NULL
                        OR (usd IS NOT NULL AND ($5 = 'usd' OR rate IS NOT NULL)
                            AND (magnitude / 1e8) * usd * COALESCE(rate, 1) >= $4::double precision)))`;
  return `
    WITH crossings AS (
      SELECT EXTRACT(EPOCH FROM date_trunc('day', to_timestamp(t.timestamp)))::bigint AS ts,
             t.direction AS direction,
             abs(COALESCE(t.ironwood_value_balance_zat, 0)
               + COALESCE(t.orchard_value_balance_zat, 0)
               + COALESCE(t.sapling_value_balance_zat, 0)
               + COALESCE(t.sprout_vpub_net_zat, 0)) AS magnitude
        FROM tx t
       WHERE t.kind = 'mixed'
         AND t.direction IN ('shielding', 'unshielding')
         AND t.block_height IS NOT NULL
         AND ($1::bigint IS NULL OR t.timestamp >= $1::bigint)
         AND ($2::bigint IS NULL OR t.timestamp <  $2::bigint)
    ),
    priced AS (
      SELECT c.ts, c.direction, c.magnitude, p.usd AS usd, f.rate AS rate
        FROM crossings c
        LEFT JOIN zec_price_daily p ON p.day = to_timestamp(c.ts)::date
        LEFT JOIN fx_rate_daily   f ON f.day = to_timestamp(c.ts)::date AND f.currency = $5
    )
    SELECT ${BUCKET_TS[groupBy]} AS bucket_ts,
           COUNT(*) FILTER (WHERE direction = 'shielding'   AND ${clears})::bigint AS shielding_over,
           COUNT(*) FILTER (WHERE direction = 'unshielding' AND ${clears})::bigint AS unshielding_over,
           COUNT(*) FILTER (WHERE ${measurable})::bigint AS priced,
           COUNT(*)::bigint AS considered
      FROM priced
     GROUP BY 1
     ORDER BY 1`;
}

const THRESHOLD_SQL_BY_GRAIN: Record<ChainWindowGroupBy, string> = {
  none: thresholdedCrossingsSql("none"),
  day: thresholdedCrossingsSql("day"),
  month: thresholdedCrossingsSql("month"),
};

interface ThresholdRow {
  bucket_ts: string | number;
  shielding_over: string | number;
  unshielding_over: string | number;
  priced: string | number;
  considered: string | number;
}

/** What a bucket gains when a floor was asked for. Keyed by the bucket's own timestamp. */
type ThresholdCounts = Pick<
  ChainWindowBucket,
  "shieldingTxsOverFloor" | "unshieldingTxsOverFloor" | "pricedCrossings" | "consideredCrossings"
>;

async function loadThresholdedCrossings(
  pool: Pool,
  from: number | null,
  to: number | null,
  groupBy: ChainWindowGroupBy,
  minZat: number | null,
  minValue: number | null,
  currency: string,
): Promise<Map<number, ThresholdCounts>> {
  const { rows } = await pool.query<ThresholdRow>(THRESHOLD_SQL_BY_GRAIN[groupBy], [
    from,
    to,
    minZat,
    minValue,
    currency,
  ]);
  return new Map(
    rows.map((r) => [
      num(r.bucket_ts),
      {
        shieldingTxsOverFloor: num(r.shielding_over),
        unshieldingTxsOverFloor: num(r.unshielding_over),
        pricedCrossings: num(r.priced),
        consideredCrossings: num(r.considered),
      },
    ]),
  );
}

/**
 * A bucket with no crossings: every count zero, which is a measurement. A covered day the
 * threshold query returned no row for had no crossing, so nothing cleared the floor; leaving the
 * fields absent would make it look like no floor was asked for.
 */
const NO_CROSSINGS: ThresholdCounts = {
  shieldingTxsOverFloor: 0,
  unshieldingTxsOverFloor: 0,
  pricedCrossings: 0,
  consideredCrossings: 0,
};

/** Built once per grain: the string is constant. */
const SQL_BY_GRAIN: Record<ChainWindowGroupBy, string> = {
  none: aggregateSql("none"),
  day: aggregateSql("day"),
  month: aggregateSql("month"),
};

function toBucket(row: BucketRow, fallbackTs: number): ChainWindowBucket {
  const bucketTs = num(row.bucket_ts);
  return {
    timestamp: bucketTs === 0 ? fallbackTs : bucketTs,
    daysCovered: num(row.days_covered),
    transparentTxs: num(row.transparent),
    mixedTxs: num(row.mixed),
    shieldedTxs: num(row.shielded),
    shieldingTxs: num(row.shielding_txs),
    unshieldingTxs: num(row.unshielding_txs),
    indeterminateTxs: num(row.indeterminate_txs),
    blocks: num(row.blocks),
    shieldedZat: num(row.shielded_zat),
    unshieldedZat: num(row.unshielded_zat),
    feeZat: num(row.fee_zat),
    blocksCovered: num(row.blocks_covered),
    avgDifficulty: nullableNum(row.avg_difficulty),
    avgBlockBytes: nullableNum(row.avg_block_bytes),
  };
}

/**
 * An untouched window: every total zero. That is a measurement ("nothing happened"), distinct
 * from a failed read, which arrives as a non-2xx. The averages stay NULL rather than 0: no block
 * means no difficulty, not a difficulty of zero.
 */
function emptyBucket(timestamp: number): ChainWindowBucket {
  return {
    timestamp,
    daysCovered: 0,
    transparentTxs: 0,
    mixedTxs: 0,
    shieldedTxs: 0,
    shieldingTxs: 0,
    unshieldingTxs: 0,
    indeterminateTxs: 0,
    blocks: 0,
    shieldedZat: 0,
    unshieldedZat: 0,
    feeZat: 0,
    blocksCovered: 0,
    avgDifficulty: null,
    avgBlockBytes: null,
  };
}

export async function loadChainWindow(
  pool: Pool,
  filters: ChainWindowFilters,
  groupBy: ChainWindowGroupBy,
  currency = "usd",
): Promise<ChainWindowAggregate> {
  const from = filters.fromTimestamp ?? null;
  const to = filters.toTimestamp ?? null;
  const params = [from, to];
  const minZat = filters.minCrossingZat ?? null;
  const minValue = filters.minCrossingValue ?? null;
  // `undefined` is the single test for "no floor was asked for" below.
  const thresholded = minZat !== null || minValue !== null;
  const migrationSource = filters.migrationSource ?? null;
  const migrationDestination = filters.migrationDestination ?? null;
  // A migration filter also unlocks the per-bucket split: the filter bounds the payload, so an
  // unfiltered grouped window attaches nothing.
  const migrationFiltered = migrationSource !== null || migrationDestination !== null;

  // The totals are always their own query, never a fold of the day buckets: folding would
  // re-implement the block-weighted mean, the plain day count and the fee sum in TypeScript, and
  // the SQL already gets all three right.
  const [totalsResult, groupsResult, pools, floorTotals, floorGroups] = await Promise.all([
    pool.query<BucketRow>(SQL_BY_GRAIN.none, params),
    groupBy === "none"
      ? Promise.resolve({ rows: [] as BucketRow[] })
      : pool.query<BucketRow>(SQL_BY_GRAIN[groupBy], params),
    // Concurrent with the matview reads: it touches different tables.
    loadPoolTxCounts(pool, from, to),
    // Skipped entirely when no floor was asked for, so an ordinary window costs what it always did.
    thresholded
      ? loadThresholdedCrossings(pool, from, to, "none", minZat, minValue, currency)
      : Promise.resolve(new Map<number, ThresholdCounts>()),
    thresholded && groupBy !== "none"
      ? loadThresholdedCrossings(pool, from, to, groupBy, minZat, minValue, currency)
      : Promise.resolve(new Map<number, ThresholdCounts>()),
  ]);

  // Null on failure, like the window matrix below: missing data of ours (an unbuilt matview) leaves
  // the buckets' `migrations` absent rather than claiming an empty day.
  const migrationBuckets =
    migrationFiltered && groupBy !== "none"
      ? await loadPoolMigrationBuckets(
          pool,
          from,
          to,
          groupBy,
          currency,
          migrationSource,
          migrationDestination,
        ).catch(() => null)
      : null;

  const totalsRow = totalsResult.rows[0];
  // An ungrouped or empty bucket is stamped with the window's own start; falling back to the first
  // covered day would re-report the window's edge as wherever data began.
  const windowStart = from ?? (totalsRow?.first_at != null ? num(totalsRow.first_at) : 0);

  // The ungrouped threshold query collapses to a single bucket keyed 0, matching `BUCKET_TS.none`.
  const withFloor = (bucket: ChainWindowBucket, counts: ThresholdCounts | undefined) =>
    thresholded ? { ...bucket, ...(counts ?? NO_CROSSINGS) } : bucket;

  const totals = withFloor(
    totalsRow === undefined ? emptyBucket(windowStart) : toBucket(totalsRow, windowStart),
    floorTotals.get(0),
  );
  const firstAt = totalsRow?.first_at != null ? num(totalsRow.first_at) : null;
  const lastAt = totalsRow?.last_at != null ? num(totalsRow.last_at) : null;

  return {
    totals,
    groups: groupsResult.rows.map((r) => {
      const raw = toBucket(r, windowStart);
      const bucket = withFloor(raw, floorGroups.get(raw.timestamp));
      // A covered bucket with no matching migration gets an empty list (a measurement, not an
      // absence), but only where the bucket read itself succeeded.
      return migrationBuckets === null
        ? bucket
        : { ...bucket, migrations: migrationBuckets.get(bucket.timestamp) ?? [] };
    }),
    groupBy,
    applied: {
      ...(from === null ? {} : { fromTimestamp: from }),
      ...(to === null ? {} : { toTimestamp: to }),
      // Echoed so a caller that asked for a floor can refuse a service that ignored it: an older
      // deployment would drop an unknown `?minZec=` and answer the unthresholded count.
      ...(minZat === null ? {} : { minCrossingZat: minZat }),
      ...(minValue === null ? {} : { minCrossingValue: minValue, crossingCurrency: currency }),
      // The migration filter's echo, for the same reason: an older deployment would answer the
      // whole matrix with no per-bucket split.
      ...(migrationSource === null ? {} : { migrationSource }),
      ...(migrationDestination === null ? {} : { migrationDestination }),
    },
    firstAt,
    lastAt,
    closingPools: lastAt === null ? null : await loadClosingPools(pool, lastAt),
    poolTxCounts: pools.counts,
    poolTxCountsUnavailable: pools.unavailable,
    poolMigrations: await loadPoolMigrations(
      pool,
      from,
      to,
      currency,
      migrationSource,
      migrationDestination,
    ).catch(() => null),
  };
}

interface MigrationRow {
  source: string;
  destination: string;
  txs: string;
  zat: string;
  priced_txs: string;
  value: string | null;
}

/**
 * One migration cell with its value as a number, for a consumer that formats for itself (the
 * windowed analytics publish decimal strings, and parsing `valueText` back out would break on other
 * currencies' symbols). Both shapes come from this one row type, so they cannot disagree.
 */
export interface PoolMigrationRaw {
  /** The bucket's day- or month-start unix seconds; null for the window total. */
  bucketTs: number | null;
  source: string;
  destination: string;
  txCount: number;
  amountZat: number;
  pricedTxCount: number;
  /** Null when no day in the cell carried a stored close (and, outside USD, a rate). */
  value: number | null;
}

function toMigrationRaw(r: MigrationRow & { bucket_ts?: string | number }): PoolMigrationRaw {
  return {
    bucketTs: r.bucket_ts === undefined ? null : num(r.bucket_ts),
    source: r.source,
    destination: r.destination,
    txCount: Number(r.txs),
    amountZat: Number(r.zat),
    pricedTxCount: Number(r.priced_txs),
    value: r.value === null ? null : Number(r.value),
  };
}

function toMigrationCell(r: PoolMigrationRaw, currency: string): PoolMigrationCell {
  return {
    source: r.source,
    destination: r.destination,
    txCount: r.txCount,
    amountZat: r.amountZat,
    pricedTxCount: r.pricedTxCount,
    valueText: r.value === null ? null : formatMoneyExact(r.value, currency),
  };
}

/**
 * The shared SELECT: bounds, pricing joins and the pair filter, with only the grouping key
 * varying. `$1`/`$2` are the window's unix-second edges (`to` exclusive: the `- 1` makes a window
 * ending at midnight exclude that midnight's day), `$3` the currency, `$4`/`$5` the optional
 * source/destination.
 */
function migrationSelectSql(bucketExpr: string | null): string {
  const bucket = bucketExpr === null ? "" : `${bucketExpr} AS bucket_ts,`;
  const groupExtra = bucketExpr === null ? "" : ", 3";
  return `SELECT ${bucket}
            m.source,
            m.destination,
            SUM(m.txs)::bigint  AS txs,
            SUM(m.zat)::bigint  AS zat,
            COALESCE(SUM(m.txs) FILTER (WHERE p.usd IS NOT NULL), 0)::bigint AS priced_txs,
            SUM((m.zat / 1e8) * p.usd * COALESCE(f.rate, 1))
              FILTER (WHERE p.usd IS NOT NULL AND ($3 = 'usd' OR f.rate IS NOT NULL)) AS value
       FROM chain_day_pool_migration m
       LEFT JOIN zec_price_daily p ON p.day = m.day
       LEFT JOIN fx_rate_daily  f ON f.day = m.day AND f.currency = $3
      WHERE ($1::bigint IS NULL OR m.day >= (to_timestamp($1) AT TIME ZONE 'UTC')::date)
        AND ($2::bigint IS NULL OR m.day <= (to_timestamp($2 - 1) AT TIME ZONE 'UTC')::date)
        AND ($4::text IS NULL OR m.source = $4::text)
        AND ($5::text IS NULL OR m.destination = $5::text)
      GROUP BY 1, 2${groupExtra}
      ORDER BY SUM(m.txs) DESC`;
}

/**
 * Directed pool-to-pool migrations over the window, priced day by day, from
 * `chain_day_pool_migration` (`poolMigration`'s definition at day grain).
 *
 * Each day is valued at its own day's close and its own day's reference rate, which is why both
 * joins are on `day`: one rate applied across a multi-year span would be fiction. `pricedTxCount`
 * travels beside `txCount` so a partly priced window is visible.
 *
 * The `to` edge is exclusive, matching the exact scan and `loadPoolTxCountsByDay`. An open window
 * means all of history (unlike the exact `tx` scan, this reads a small day matview, so the whole
 * range is cheap).
 *
 * Null on any failure, including an unbuilt matview: missing data of ours must not render as a
 * chain with no migrations. `[]` is returned only when the query genuinely found none.
 *
 * `source`/`destination` narrow the matrix to one pair or one side of it, echoed in `applied`. The
 * pair predicate and pricing joins live once, in `migrationSelectSql`.
 */
export async function loadPoolMigrations(
  pool: Pool,
  from: number | null,
  to: number | null,
  currency: string,
  source: string | null = null,
  destination: string | null = null,
): Promise<PoolMigrationCell[] | null> {
  const rows = await loadPoolMigrationRaw(pool, from, to, "none", currency, source, destination);
  return rows.map((r) => toMigrationCell(r, currency));
}

/**
 * The migration matrix as raw rows: the window total (`groupBy` "none", `bucketTs` null) or one set
 * of cells per day or month. The single place the matrix query runs; `loadPoolMigrations` and
 * `loadPoolMigrationBuckets` format these rows, and the windowed analytics publish them.
 */
export async function loadPoolMigrationRaw(
  pool: Pool,
  from: number | null,
  to: number | null,
  groupBy: ChainWindowGroupBy,
  currency: string,
  source: string | null,
  destination: string | null,
): Promise<PoolMigrationRaw[]> {
  const bucketExpr =
    groupBy === "none"
      ? null
      : groupBy === "day"
        ? "EXTRACT(EPOCH FROM m.day)::bigint"
        : "EXTRACT(EPOCH FROM date_trunc('month', m.day::timestamp))::bigint";
  const { rows } = await pool.query<MigrationRow & { bucket_ts?: string | number }>(
    migrationSelectSql(bucketExpr),
    [from, to, currency, source, destination],
  );
  return rows.map(toMigrationRaw);
}

/**
 * The same matrix split per bucket: one list of cells per day or month, keyed by the bucket's own
 * day-start (or month-start) unix seconds, matching the timestamps `aggregateSql` stamps on
 * `ChainWindowBucket`.
 *
 * Runs only when a migration filter was given and the window is grouped: the filter bounds the
 * payload (one side fixed is a handful of cells per bucket).
 *
 * `m.day` is a `date`; `EXTRACT(EPOCH FROM ...)` over a date (or a `date_trunc` of one) reads it
 * as UTC midnight, the day-start second the buckets are keyed on.
 */
export async function loadPoolMigrationBuckets(
  pool: Pool,
  from: number | null,
  to: number | null,
  groupBy: Exclude<ChainWindowGroupBy, "none">,
  currency: string,
  source: string | null,
  destination: string | null,
): Promise<Map<number, PoolMigrationCell[]>> {
  const rows = await loadPoolMigrationRaw(pool, from, to, groupBy, currency, source, destination);
  const buckets = new Map<number, PoolMigrationCell[]>();
  for (const r of rows) {
    const ts = r.bucketTs ?? 0;
    const cells = buckets.get(ts) ?? [];
    cells.push(toMigrationCell(r, currency));
    buckets.set(ts, cells);
  }
  return buckets;
}

/**
 * The first and last block whose timestamp falls in `[from, to)`, or nulls when none does.
 *
 * MIN/MAX over the matching set rather than "the first block at or after this instant", because
 * miner timestamps are only loosely ordered. Half-open, so no block belongs to two windows.
 *
 * The MATERIALIZED fence is required. As a plain `SELECT MIN(height), MAX(height) FROM block WHERE
 * timestamp ...` the planner rewrites each aggregate into a backward scan of `block_pkey` with the
 * timestamp as a filter, walking far more rows the further back the window sits; gathering the
 * matching heights first makes it an index scan on `block_timestamp_idx`.
 */
export async function blockHeightRange(
  pool: Pool,
  from: number,
  to: number,
): Promise<{ lo: number | null; hi: number | null }> {
  const { rows } = await pool.query<{ lo: number | null; hi: number | null }>(
    `WITH w AS MATERIALIZED (
       SELECT height FROM block WHERE timestamp >= $1::bigint AND timestamp < $2::bigint
     )
     SELECT MIN(height)::int AS lo, MAX(height)::int AS hi FROM w`,
    [from, to],
  );
  return { lo: rows[0]?.lo ?? null, hi: rows[0]?.hi ?? null };
}

/**
 * The window's exact first and last heights for `$1`..`$2` (whole UTC days), with `$3` the start
 * of the first day still read live. Settled days come from `mining_day`'s own per-day bounds, live
 * days from `block`. `settled_days` against `expected_days` says whether the table held every
 * settled day in the window with bounds (a row computed before the columns existed has none).
 */
export const WINDOW_HEIGHT_RANGE_SQL = `
  WITH edges AS (
    SELECT (SELECT (min(timestamp) / 86400) * 86400 FROM block) AS chain_first
  ),
  settled AS (
    SELECT count(*) FILTER (WHERE m.blocks = 0 OR m.first_height IS NOT NULL)::int AS days,
           min(m.first_height) AS lo, max(m.last_height) AS hi
      FROM mining_day m, edges e
     WHERE EXTRACT(EPOCH FROM m.day)::bigint >= GREATEST($1::bigint, e.chain_first)
       AND EXTRACT(EPOCH FROM m.day)::bigint < LEAST($2::bigint, $3::bigint)
  ),
  live AS MATERIALIZED (
    SELECT height FROM block
     WHERE timestamp >= GREATEST($1::bigint, $3::bigint) AND timestamp < $2::bigint
  )
  SELECT LEAST(s.lo, (SELECT min(height) FROM live))::int AS lo,
         GREATEST(s.hi, (SELECT max(height) FROM live))::int AS hi,
         s.days AS settled_days,
         GREATEST(0, (LEAST($2::bigint, $3::bigint) - GREATEST($1::bigint, e.chain_first)) / 86400)::int
           AS expected_days
    FROM settled s, edges e`;

/**
 * `blockHeightRange` for a window of whole UTC days, without reading every block in it (that read
 * becomes a sequential scan for long windows).
 *
 * Exact: a day's blocks are precisely those stamped inside it, so the window's bounds are the min
 * and max of its days' bounds, which `mining_day` stores for every settled day. Yesterday and
 * today are read from `block`, since a reorg or a late-stamped block can still move them. Anything
 * else falls back to the exact scan (a window that is not day-aligned, or a settled day the table
 * does not hold). The fallback is slower, never different.
 */
export async function windowHeightRange(
  pool: Pool,
  from: number,
  to: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<{ lo: number | null; hi: number | null }> {
  if (from % DAY_SECONDS !== 0 || to % DAY_SECONDS !== 0 || to <= from)
    return blockHeightRange(pool, from, to);
  const liveFrom = Math.floor(nowSec / DAY_SECONDS) * DAY_SECONDS - DAY_SECONDS;
  const { rows } = await pool.query<{
    lo: number | null;
    hi: number | null;
    settled_days: number;
    expected_days: number;
  }>(WINDOW_HEIGHT_RANGE_SQL, [from, to, liveFrom]);
  const r = rows[0];
  if (r === undefined || r.settled_days !== r.expected_days) {
    return blockHeightRange(pool, from, to);
  }
  return { lo: r.lo ?? null, hi: r.hi ?? null };
}

/**
 * Per-pool transaction counts over the window's own blocks: the one query here that reads `tx`.
 *
 * The height range comes from `windowHeightRange`. The count is then a bitmap index scan on `tx_block_idx` over the window's blocks. Its cost scales
 * with the window, which is why `POOL_TX_COUNT_MAX_BLOCKS` exists and is stated in blocks.
 *
 * Pool predicates come from `POOL_USED_SQL` (Sapling is spends OR outputs; Sprout is
 * `sprout_joinsplits`).
 */
async function loadPoolTxCounts(
  pool: Pool,
  from: number | null,
  to: number | null,
): Promise<{ counts: PoolTxCounts | null; unavailable: PoolTxCountsUnavailable | null }> {
  // An open edge is the chain's own first or last block, read off the timestamp index. A window
  // that wide always takes the day matview below.
  if (from === null || to === null) {
    const { rows } = await pool.query<{ first: string | null; last: string | null }>(
      "SELECT min(timestamp)::text AS first, max(timestamp)::text AS last FROM block",
    );
    const edges = rows[0];
    if (edges?.first == null || edges.last == null)
      return { counts: null, unavailable: "no-blocks" };
    from ??= Number(edges.first);
    to ??= Number(edges.last) + 1;
  }

  const { lo, hi } = await windowHeightRange(pool, from, to);
  // No block in the window is a measurement, not a failure: the chain did not reach it, or has not
  // yet. Distinguished from the cap so an answer can say which.
  if (lo === null || hi === null) return { counts: null, unavailable: "no-blocks" };
  if (hi - lo + 1 > POOL_TX_COUNT_MAX_BLOCKS) {
    // Too wide for the exact scan (a statement about our cost, not the data): read the day matview
    // instead. `POOL_TX_COUNT_MAX_BLOCKS` is a path selector, not a refusal.
    return loadPoolTxCountsByDay(pool, from, to, lo, hi);
  }

  const { rows } = await pool.query<{
    sprout: string | number;
    sapling: string | number;
    orchard: string | number;
    ironwood: string | number;
    transparent_only: string | number;
  }>(
    `SELECT
       count(*) FILTER (WHERE ${POOL_USED_SQL.sprout})   AS sprout,
       count(*) FILTER (WHERE ${POOL_USED_SQL.sapling})  AS sapling,
       count(*) FILTER (WHERE ${POOL_USED_SQL.orchard})  AS orchard,
       count(*) FILTER (WHERE ${POOL_USED_SQL.ironwood}) AS ironwood,
       count(*) FILTER (
         WHERE COALESCE(sprout_joinsplits, 0) = 0
           AND COALESCE(sapling_spends, 0) = 0
           AND COALESCE(sapling_outputs, 0) = 0
           AND COALESCE(orchard_actions, 0) = 0
           AND COALESCE(ironwood_actions, 0) = 0
       )                                                                    AS transparent_only
     FROM tx
     WHERE block_height BETWEEN $1::int AND $2::int`,
    [lo, hi],
  );
  const row = rows[0];
  if (row === undefined) return { counts: null, unavailable: "no-blocks" };
  return {
    counts: {
      fromHeight: lo,
      toHeight: hi,
      sprout: num(row.sprout),
      sapling: num(row.sapling),
      orchard: num(row.orchard),
      ironwood: num(row.ironwood),
      transparentOnly: num(row.transparent_only),
      basis: "exact-blocks",
    },
    unavailable: null,
  };
}

/**
 * The shielded pools' balances on a given day: a closing level, never a sum. `chain_day_rollup`
 * stores each day's closing values at the day's highest block; `max()` over the day would be wrong,
 * because a pool can fall within a day.
 */
async function loadClosingPools(
  pool: Pool,
  day: number,
): Promise<ChainWindowAggregate["closingPools"]> {
  const { rows } = await pool.query<ClosingRow>(
    `SELECT top_height, sprout, sapling, orchard, ironwood
       FROM ${DAY_ROLLUP}
      WHERE ts = $1::bigint`,
    [day],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    topHeight: num(row.top_height),
    sproutZat: num(row.sprout),
    saplingZat: num(row.sapling),
    orchardZat: num(row.orchard),
    ironwoodZat: num(row.ironwood),
  };
}

/**
 * Per-pool counts for a window too wide for the exact scan, summed from `chain_day_pool_tx`.
 *
 * The edges snap outward to whole UTC days, the matview's grain, and the days actually summed are
 * reported in `fromDay`/`toDay` so the figure's coverage is checkable.
 *
 * The `to` edge is exclusive, matching the exact path, and the `- 1` is what makes it so: a window
 * ending exactly at midnight must not include that midnight's day.
 *
 * `transparentOnly` is null here (unmeasured, not zero): the matview holds one row per (day,
 * pool), and a transaction carrying no bundle belongs to no pool. The exact path still answers it.
 */
async function loadPoolTxCountsByDay(
  pool: Pool,
  from: number,
  to: number,
  lo: number,
  hi: number,
): Promise<{ counts: PoolTxCounts | null; unavailable: PoolTxCountsUnavailable | null }> {
  const { rows } = await pool.query<{
    pool: string;
    txs: string;
    from_day: string;
    to_day: string;
  }>(
    `WITH d AS (
       SELECT pool, SUM(txs)::bigint AS txs
         FROM chain_day_pool_tx
        WHERE day >= (to_timestamp($1) AT TIME ZONE 'UTC')::date
          AND day <= (to_timestamp($2 - 1) AT TIME ZONE 'UTC')::date
        GROUP BY pool
     ),
     span AS (
       SELECT to_char((to_timestamp($1) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS from_day,
              to_char((to_timestamp($2 - 1) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS to_day
     )
     SELECT d.pool, d.txs, span.from_day, span.to_day FROM d CROSS JOIN span`,
    [from, to],
  );
  // An unpopulated or unrefreshed matview is missing data of ours, not a chain with no shielded
  // transactions, so it degrades to a refusal rather than a row of zeros.
  if (rows.length === 0) return { counts: null, unavailable: "window-too-wide" };

  const by = new Map(rows.map((r) => [r.pool, Number(r.txs)]));
  return {
    counts: {
      fromHeight: lo,
      toHeight: hi,
      sprout: by.get("sprout") ?? 0,
      sapling: by.get("sapling") ?? 0,
      orchard: by.get("orchard") ?? 0,
      ironwood: by.get("ironwood") ?? 0,
      transparentOnly: null,
      basis: "whole-days",
      fromDay: rows[0]!.from_day,
      toDay: rows[0]!.to_day,
    },
    unavailable: null,
  };
}

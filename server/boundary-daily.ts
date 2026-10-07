import type { Pool } from "pg";
import { DAY_SECONDS } from "@/domain/time";

/**
 * What crossed the shielded boundary, per UTC day (`boundary_daily`). One pass per day, run by
 * `PoolUsageTracker` beside the pool-usage counts, yields:
 *
 *  - the per-transaction direction counts that `loadChainWindow` needs (see
 *    {@link BOUNDARY_COVERAGE_SQL}), so an all-history window does not read millions of `tx` rows;
 *  - the day's largest shielding, unshielding and pool migration, from which the all-time
 *    records are a fold over a few thousand rows rather than a scan of the chain.
 *
 * Amounts use `chain_day_pool_migration`'s signs (value-balance columns in domain sign, Sprout's
 * `vpub_net` negated), and the migration predicate is copied from that view: a parity test holds
 * the two migration counts together day by day.
 */

export interface BoundaryMax {
  zat: number | null;
  ties: number;
  /** Only when the day's maximum is unique. */
  txid: string | null;
}

export interface BoundaryDayRow {
  day: number;
  shieldingTxs: number;
  unshieldingTxs: number;
  indeterminateTxs: number;
  migrationTxs: number;
  shielding: BoundaryMax;
  unshielding: BoundaryMax;
  migration: BoundaryMax;
}

/** One day's counts and maxima, `$1`/`$2` its half-open unix-second edges. */
export const BOUNDARY_DAY_SQL = `
  WITH d AS (
    SELECT txid, kind, direction,
           COALESCE(ironwood_value_balance_zat, 0) AS iw,
           COALESCE(orchard_value_balance_zat, 0)  AS oc,
           COALESCE(sapling_value_balance_zat, 0)  AS sa,
           -COALESCE(sprout_vpub_net_zat, 0)       AS sr
      FROM tx
     WHERE block_height IS NOT NULL AND kind IN ('mixed', 'shielded')
       AND timestamp >= $1::bigint AND timestamp < $2::bigint
  ),
  moves AS (
    SELECT 'shielding' AS what, txid, iw + oc + sa + sr AS amt
      FROM d WHERE kind = 'mixed' AND direction = 'shielding'
    UNION ALL
    SELECT 'unshielding', txid, -(iw + oc + sa + sr)
      FROM d WHERE kind = 'mixed' AND direction = 'unshielding'
    UNION ALL
    SELECT 'indeterminate', txid, NULL
      FROM d WHERE kind = 'mixed' AND direction = 'indeterminate'
    UNION ALL
    SELECT 'migration', txid,
           CASE WHEN iw > 0 THEN iw WHEN oc > 0 THEN oc WHEN sa > 0 THEN sa ELSE sr END
      FROM d
     WHERE kind = 'shielded'
       AND ((iw > 0)::int + (oc > 0)::int + (sa > 0)::int + (sr > 0)::int) = 1
       AND ((iw < 0)::int + (oc < 0)::int + (sa < 0)::int + (sr < 0)::int) >= 1
  ),
  ranked AS (
    SELECT what, txid, amt, max(amt) OVER (PARTITION BY what) AS mx FROM moves
  )
  SELECT what, count(*)::bigint AS n, max(mx)::bigint AS mx,
         count(*) FILTER (WHERE amt = mx)::int AS ties,
         min(txid) FILTER (WHERE amt = mx) AS txid
    FROM ranked GROUP BY what`;

/** Count one UTC day (its midnight in unix seconds). */
export async function computeBoundaryDay(pool: Pool, dayStart: number): Promise<BoundaryDayRow> {
  const { rows } = await pool.query<{
    what: string;
    n: string;
    mx: string | null;
    ties: number;
    txid: string | null;
  }>(BOUNDARY_DAY_SQL, [dayStart, dayStart + DAY_SECONDS]);
  const of = (what: string) => rows.find((r) => r.what === what);
  const count = (what: string) => Number(of(what)?.n ?? 0);
  const max = (what: string): BoundaryMax => {
    const r = of(what);
    if (r === undefined || r.mx === null) return { zat: null, ties: 0, txid: null };
    return { zat: Number(r.mx), ties: r.ties, txid: r.ties === 1 ? r.txid : null };
  };
  return {
    day: dayStart,
    shieldingTxs: count("shielding"),
    unshieldingTxs: count("unshielding"),
    indeterminateTxs: count("indeterminate"),
    migrationTxs: count("migration"),
    shielding: max("shielding"),
    unshielding: max("unshielding"),
    migration: max("migration"),
  };
}

export async function upsertBoundaryDay(
  pool: Pool,
  r: BoundaryDayRow,
  nowSec: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO boundary_daily (day, shielding_txs, unshielding_txs, indeterminate_txs,
                                 migration_txs, max_shielding_zat, max_shielding_ties,
                                 max_shielding_txid, max_unshielding_zat, max_unshielding_ties,
                                 max_unshielding_txid, max_migration_zat, max_migration_ties,
                                 max_migration_txid, computed_at)
     VALUES ((to_timestamp($1) AT TIME ZONE 'UTC')::date, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15)
     ON CONFLICT (day) DO UPDATE SET
       shielding_txs = EXCLUDED.shielding_txs, unshielding_txs = EXCLUDED.unshielding_txs,
       indeterminate_txs = EXCLUDED.indeterminate_txs, migration_txs = EXCLUDED.migration_txs,
       max_shielding_zat = EXCLUDED.max_shielding_zat,
       max_shielding_ties = EXCLUDED.max_shielding_ties,
       max_shielding_txid = EXCLUDED.max_shielding_txid,
       max_unshielding_zat = EXCLUDED.max_unshielding_zat,
       max_unshielding_ties = EXCLUDED.max_unshielding_ties,
       max_unshielding_txid = EXCLUDED.max_unshielding_txid,
       max_migration_zat = EXCLUDED.max_migration_zat,
       max_migration_ties = EXCLUDED.max_migration_ties,
       max_migration_txid = EXCLUDED.max_migration_txid,
       computed_at = EXCLUDED.computed_at`,
    [
      r.day,
      r.shieldingTxs,
      r.unshieldingTxs,
      r.indeterminateTxs,
      r.migrationTxs,
      r.shielding.zat,
      r.shielding.ties,
      r.shielding.txid,
      r.unshielding.zat,
      r.unshielding.ties,
      r.unshielding.txid,
      r.migration.zat,
      r.migration.ties,
      r.migration.txid,
      nowSec,
    ],
  );
}

/**
 * A CTE `cov(t)`: the unix second from which `boundary_daily` stops answering for the window
 * aggregate. It is the first day of the chain the table does not cover, and never later than the
 * start of yesterday, so the two newest days always come from `tx` itself. With an empty table
 * (or no blocks) it is the chain's first day, so the window is exact at every stage of the
 * backfill and fast once it is done.
 */
export const BOUNDARY_COVERAGE_SQL = `
    cov AS (
      SELECT COALESCE(
               (SELECT EXTRACT(EPOCH FROM g)::bigint
                  FROM generate_series(
                         (SELECT to_timestamp((min(timestamp) / 86400) * 86400) AT TIME ZONE 'UTC'
                            FROM block),
                         ((now() AT TIME ZONE 'UTC')::date - 2)::timestamp,
                         interval '1 day') AS g
                 WHERE NOT EXISTS (SELECT 1 FROM boundary_daily b WHERE b.day = g::date)
                 ORDER BY g LIMIT 1),
               CASE WHEN (SELECT min(timestamp) FROM block) IS NULL THEN 0
                    ELSE EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC')::date - 1)::timestamp)::bigint
               END) AS t
    )`;

export interface CrossingRecord {
  amountZat: number | null;
  /** How many transactions share the record amount; above 1, none is named. */
  ties: number;
  txid: string | null;
  /** The named transaction's block; null when none is named. */
  height: number | null;
  /** Transactions of this kind over the covered days. */
  considered: number;
}

export interface CrossingRecords {
  shielding: CrossingRecord;
  unshielding: CrossingRecord;
  migration: CrossingRecord;
  /** The last day folded in, and whether every day from the chain's first is present. */
  coveredThrough: number | null;
  complete: boolean;
}

/** The all-time largest crossings, folded from the daily maxima. */
export async function readCrossingRecords(pool: Pool): Promise<CrossingRecords> {
  const { rows } = await pool.query<Record<string, string | null>>(
    `WITH days AS (SELECT * FROM boundary_daily),
          span AS (SELECT (SELECT (min(timestamp) / 86400) * 86400 FROM block) AS first_ts,
                          EXTRACT(EPOCH FROM max(day))::bigint AS last_ts, count(*) AS n
                     FROM days)
     SELECT span.last_ts::text AS last_ts,
            (span.first_ts IS NOT NULL AND span.last_ts IS NOT NULL
               AND span.n = (span.last_ts - span.first_ts) / 86400 + 1
               AND EXTRACT(EPOCH FROM (SELECT min(day) FROM days))::bigint = span.first_ts)::text
              AS complete,
            ${["shielding", "unshielding", "migration"]
              .map(
                (k) => `
            (SELECT sum(${k}_txs) FROM days)::text AS ${k}_n,
            (SELECT max(max_${k}_zat) FROM days)::text AS ${k}_max,
            (SELECT sum(max_${k}_ties) FROM days
              WHERE max_${k}_zat = (SELECT max(max_${k}_zat) FROM days))::text AS ${k}_ties,
            (SELECT min(max_${k}_txid) FROM days
              WHERE max_${k}_zat = (SELECT max(max_${k}_zat) FROM days))::text AS ${k}_txid`,
              )
              .join(",")}
       FROM span`,
  );
  const r = rows[0] ?? {};
  const named = ["shielding", "unshielding", "migration"]
    .map((k) => (Number(r[`${k}_ties`] ?? 0) === 1 ? r[`${k}_txid`] : null))
    .filter((t): t is string => typeof t === "string");
  const heights = new Map<string, number>();
  if (named.length > 0) {
    const found = await pool.query<{ txid: string; block_height: number | null }>(
      "SELECT txid, block_height FROM tx WHERE txid = ANY($1::text[])",
      [named],
    );
    for (const f of found.rows) if (f.block_height !== null) heights.set(f.txid, f.block_height);
  }
  const record = (k: string): CrossingRecord => {
    const ties = Number(r[`${k}_ties`] ?? 0);
    const txid = ties === 1 ? (r[`${k}_txid`] ?? null) : null;
    return {
      amountZat: r[`${k}_max`] == null ? null : Number(r[`${k}_max`]),
      ties,
      txid,
      height: txid === null ? null : (heights.get(txid) ?? null),
      considered: Number(r[`${k}_n`] ?? 0),
    };
  };
  return {
    shielding: record("shielding"),
    unshielding: record("unshielding"),
    migration: record("migration"),
    coveredThrough: r.last_ts == null ? null : Number(r.last_ts),
    complete: r.complete === "true",
  };
}

/**
 * Writing the dirty-period log, `chain_rollup_dirty`.
 *
 * Every write to a `block` or `tx` row that a rollup reads must mark the timestamps of the rows it
 * changed, in the same transaction, or the period stays stale until a full rebuild. A mark is a
 * timestamp (or range), not a height: rollups group by time, timestamps can go backwards relative
 * to height, and a row being deleted or moved must mark the period it LEAVES as well as the one it
 * joins.
 */

/**
 * Before `ingestBlock`'s upserts: the new block's timestamp, plus the old timestamp of a block row
 * it replaces at that height and of any mined transaction its upsert moves. Both are normally the
 * same timestamp; reading them is a primary-key probe the upserts make anyway.
 *
 * `$1` block timestamp, `$2` height, `$3` txids.
 */
export const MARK_INGEST_SQL = `
  INSERT INTO chain_rollup_dirty (ts_lo, ts_hi)
  SELECT ts, ts FROM (
    SELECT $1::bigint AS ts
    UNION SELECT timestamp FROM block WHERE height = $2::int
    UNION SELECT timestamp FROM tx WHERE txid = ANY($3::text[]) AND block_height IS NOT NULL
  ) AS touched`;

/**
 * Before a rollback's cascade: every timestamp the doomed blocks and their transactions carry
 * (`block_pkey` and `tx_block_idx`). `$1` is the height kept.
 */
export const MARK_ROLLBACK_SQL = `
  INSERT INTO chain_rollup_dirty (ts_lo, ts_hi)
  SELECT ts, ts FROM (
    SELECT timestamp AS ts FROM block WHERE height > $1::int
    UNION SELECT timestamp FROM tx WHERE block_height > $1::int
  ) AS doomed`;

/**
 * Wrap a repair's `UPDATE ... RETURNING <table>.timestamp` so the same statement marks one range
 * per UTC day it changed and returns how many rows it changed (as `changed`), which the job
 * reports. A data-modifying CTE always runs to completion.
 */
export function markingUpdate(update: string): string {
  return `
    WITH changed AS (${update}),
    marked AS (
      INSERT INTO chain_rollup_dirty (ts_lo, ts_hi)
      SELECT min(timestamp), max(timestamp) FROM changed GROUP BY timestamp / 86400
    )
    SELECT count(*)::int AS changed FROM changed`;
}

import type { Pool } from "pg";
import type { RpcBlockHeader } from "@/data/chain/rpc-types";

/**
 * Fill `block.difficulty` for rows that have none, without re-ingesting the chain.
 *
 * The column was added after the backfiller had written the early chain, so blocks below height
 * 1,463,800 carry NULL. The API maps that NULL to null, never to zero; this fills in the value.
 *
 * Uses `getblockheader` rather than `getblock` at verbosity 2, which inlines every transaction: a
 * header is a few KB, so the whole hole takes minutes rather than hours. The header's
 * `difficulty` is the same value the ingest stores, so this is a second route to one number, not
 * a second derivation of it.
 *
 * Keyed by hash, not height: a height names whatever block sits there on the node's current
 * chain, so filling by height could write another block's difficulty into a row across a reorg.
 * The node answers an unknown hash with an error, so such rows are skipped.
 *
 * Idempotent and safe to interrupt: the remaining work is always `difficulty IS NULL`.
 */

export interface RepairDifficultyDeps {
  pool: Pool;
  rpc: { getBlockHeaderByHash(hash: string): Promise<RpcBlockHeader> };
  log: (message: string) => void;
  /** Rows per pass. Bounded so no single statement bloats the table. */
  batch?: number;
  /**
   * Headers in flight at once. Modest, because this node also serves every page on the site.
   */
  concurrency?: number;
  /**
   * Stop before this height; defaults to every row with a hole. Lets a first run against a real
   * database be bounded to a range small enough to check by hand.
   */
  end?: number;
  /** Refresh `chain_day_network` when finished. On by default — see `refreshDayNetwork`. */
  refresh?: boolean;
}

export interface RepairDifficultyResult {
  /** Rows examined, whether or not they could be filled. */
  scanned: number;
  written: number;
  /** The node did not know the hash — an orphan we stored and it no longer serves. */
  skippedUnknownHash: number;
  /** The node answered, but with something that is not a difficulty. */
  skippedBadValue: number;
}

export interface StoredBlockRow {
  height: number;
  hash: string;
}

/**
 * What to write for one row, or `null` to leave it alone.
 *
 * Pure and separate from the loop because it is the only part that makes a decision. Every
 * refusal leaves a NULL, which charts render as a gap: an absent difficulty must stay absent
 * rather than become a confident number.
 */
export function difficultyForRow(row: StoredBlockRow, header: RpcBlockHeader): number | null {
  // The node echoes the hash it answered for. A mismatch means we asked about one block and
  // are holding another's header, so nothing here may be trusted.
  if (header.hash !== row.hash) return null;
  if (typeof header.difficulty !== "number" || !Number.isFinite(header.difficulty)) return null;
  // Difficulty is a ratio against the genesis target and cannot be zero or negative. Genesis itself
  // is exactly 1, so only <= 0 is refused; a stored zero would be a fabricated measurement.
  if (header.difficulty <= 0) return null;
  return header.difficulty;
}

/** Resolve `items` through `fn` with at most `concurrency` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export async function repairDifficulty(
  deps: RepairDifficultyDeps,
): Promise<RepairDifficultyResult> {
  const { pool, rpc, log } = deps;
  const batch = deps.batch ?? 1000;
  const concurrency = deps.concurrency ?? 8;
  const result: RepairDifficultyResult = {
    scanned: 0,
    written: 0,
    skippedUnknownHash: 0,
    skippedBadValue: 0,
  };

  // A low-water mark: a row that cannot be filled keeps `difficulty IS NULL`, so selecting only on
  // that predicate would return the same row forever. Advancing past each batch guarantees
  // progress; a re-run simply re-scans.
  let from = 0;

  for (;;) {
    const { rows } = await pool.query<StoredBlockRow>(
      deps.end === undefined
        ? `SELECT height, hash
             FROM block
            WHERE difficulty IS NULL AND height >= $1
            ORDER BY height
            LIMIT $2`
        : `SELECT height, hash
             FROM block
            WHERE difficulty IS NULL AND height >= $1 AND height < $3
            ORDER BY height
            LIMIT $2`,
      deps.end === undefined ? [from, batch] : [from, batch, deps.end],
    );
    if (rows.length === 0) break;
    from = rows[rows.length - 1]!.height + 1;
    result.scanned += rows.length;

    const resolved = await mapWithConcurrency(rows, concurrency, async (row) => {
      let header: RpcBlockHeader;
      try {
        header = await rpc.getBlockHeaderByHash(row.hash);
      } catch {
        // An orphan we stored and the node no longer serves. Counted, never guessed at: re-asking
        // by height is the reorg hazard that hash keying avoids.
        return { row, difficulty: null, unknown: true };
      }
      return { row, difficulty: difficultyForRow(row, header), unknown: false };
    });

    const heights: number[] = [];
    const values: number[] = [];
    for (const r of resolved) {
      if (r.difficulty === null) {
        if (r.unknown) result.skippedUnknownHash++;
        else result.skippedBadValue++;
        continue;
      }
      heights.push(r.row.height);
      values.push(r.difficulty);
    }

    if (heights.length > 0) {
      // `AND b.difficulty IS NULL` so a concurrent follower write always wins: this job only fills
      // holes and never overwrites a value the ingest established.
      const { rowCount } = await pool.query(
        `UPDATE block AS b
            SET difficulty = v.d
           FROM (SELECT unnest($1::int[]) AS h, unnest($2::float8[]) AS d) AS v
          WHERE b.height = v.h AND b.difficulty IS NULL`,
        [heights, values],
      );
      result.written += rowCount ?? 0;
    }

    log(
      `difficulty repair: ${result.written} written, ${result.scanned} scanned, ` +
        `next height >= ${from}`,
    );
  }

  if (deps.refresh ?? true) await refreshDayNetwork(pool, log);
  return result;
}

/**
 * Refresh the daily matview the chart reads, so the repair is visible without waiting for the
 * follower's own refresh cycle. CONCURRENTLY (backed by the unique `chain_day_network_ts_idx`)
 * so the live site's readers never block.
 */
export async function refreshDayNetwork(pool: Pool, log: (m: string) => void): Promise<void> {
  log("refreshing chain_day_network");
  await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_day_network");
  log("chain_day_network refreshed");
}

/*
 * Not repaired here: `miner_kind`, `miner_address`, `miner_reward_zat` and `coinbase_tag` share
 * this hole but cannot be filled from a header. They come from the coinbase transaction, and
 * `repair-miner.ts` fills them.
 */

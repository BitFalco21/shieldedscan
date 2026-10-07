import type { Pool } from "pg";
import { rollbackQuietly } from "./pg-pool";
import { REORG_DEPTH } from "./follow";
import type { Pacer } from "./job-pacer";

/**
 * How many transactions every transparent address appears in: `address_tx_count`, covering every
 * address the chain has used, emptied ones included (the rich list holds only funded addresses).
 *
 * One count, no heights. When an address first and last appears is already answered by two index
 * probes (`ChainIndexStore.addressActivityExtent`), so storing heights here would be a second
 * answer to one question.
 *
 * Additive by construction. A transaction belongs to exactly one block, so an address's count of
 * distinct transactions over two disjoint height ranges is the sum of the two counts. The table
 * is built by one pass over the chain in height order and kept by adding each new range, under a
 * watermark (`applied_height`) moved in the same transaction as the counts it covers and only
 * forward from exactly where it stood, so a range is applied once whatever crashes or races.
 *
 * Never within reorg depth. Only heights at least `REORG_DEPTH` below the tip are applied, so a
 * stored count never needs taking back; the blocks above the watermark are counted live at read
 * time from `io_address_idx`, so a count is exact through the newest block.
 *
 * Two write paths, because an upsert into a large table costs random reads per address. Keeping
 * up (a few blocks a pass) upserts directly. A backfill appends each range's counts to an
 * unindexed log (`address_tx_count_log`) and folds the log into the table once, at the end, in one
 * sorted pass.
 */

/**
 * The most blocks a read will count live above the watermark. A count needing more (the backfill
 * still under way) is not stated, rather than costing one address a long walk.
 */
export const LIVE_TAIL_MAX_BLOCKS = 1_000;

/** One range's counts, added to the table; `$1`..`$2` the inclusive heights. */
export const ADDRESS_COUNT_RANGE_SQL = `
  WITH counted AS (
    SELECT i.address, count(DISTINCT i.txid)::int AS n
      FROM tx t JOIN tx_transparent_io i ON i.txid = t.txid
     WHERE t.block_height BETWEEN $1 AND $2 AND t.kind <> 'shielded' AND i.address IS NOT NULL
     GROUP BY i.address
  ), applied AS (
    INSERT INTO address_tx_count AS a (address, tx_count)
    SELECT address, n FROM counted
    ON CONFLICT (address) DO UPDATE SET tx_count = a.tx_count + EXCLUDED.tx_count
    RETURNING 1
  )
  SELECT count(*)::int AS addresses FROM applied`;

/** Where the table stands: every height at or below this is counted. -1 before the first range. */
export async function appliedHeight(pool: Pool): Promise<number | null> {
  const { rows } = await pool.query<{ applied_height: number }>(
    "SELECT applied_height FROM address_tx_count_state WHERE id",
  );
  return rows[0]?.applied_height ?? null;
}

/**
 * Add heights `lo`..`hi` and move the watermark to `hi`, in one transaction, and only if the
 * watermark stood at exactly `lo - 1`. Anything else means another writer moved it, and adding the
 * range again would count it twice, so nothing is written. Returns the addresses touched, or null
 * when the range was refused.
 */
export async function applyAddressRange(
  pool: Pool,
  lo: number,
  hi: number,
  nowSec: number,
): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One range groups up to a few hundred thousand addresses in memory.
    await client.query("SET LOCAL work_mem = '128MB'");
    // Its own bound above the pool's minute; ranges are sized to take seconds.
    await client.query("SET LOCAL statement_timeout = '180s'");
    await client.query(
      `INSERT INTO address_tx_count_state (id, applied_height, updated_at)
       VALUES (TRUE, -1, $1) ON CONFLICT (id) DO NOTHING`,
      [nowSec],
    );
    const moved = await client.query(
      `UPDATE address_tx_count_state SET applied_height = $2, updated_at = $3
        WHERE id AND applied_height = $1 - 1`,
      [lo, hi, nowSec],
    );
    if (moved.rowCount !== 1) {
      await client.query("ROLLBACK");
      return null;
    }
    const { rows } = await client.query<{ addresses: number }>(ADDRESS_COUNT_RANGE_SQL, [lo, hi]);
    await client.query("COMMIT");
    return rows[0]?.addresses ?? 0;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * One range's counts appended to the backfill log: one row per address and no index to maintain.
 * The log is summed into the table by `foldAddressLog`; until then an address may have a row per
 * range.
 */
export const ADDRESS_COUNT_LOG_SQL = `
  INSERT INTO address_tx_count_log (address, n)
  SELECT i.address, count(DISTINCT i.txid)::int
    FROM tx t JOIN tx_transparent_io i ON i.txid = t.txid
   WHERE t.block_height BETWEEN $1 AND $2 AND t.kind <> 'shielded' AND i.address IS NOT NULL
   GROUP BY i.address`;

/** Where the backfill log stands, or null when there is no log (none started, or folded). */
export async function logAppliedHeight(pool: Pool): Promise<number | null> {
  const { rows } = await pool.query<{ applied_height: number }>(
    "SELECT applied_height FROM address_tx_count_log_state WHERE id",
  );
  return rows[0]?.applied_height ?? null;
}

/**
 * Append heights `lo`..`hi` to the log and move the log's watermark to `hi`, in one transaction,
 * only from exactly `lo - 1`. A new log may start only at the table's watermark + 1, so the log
 * always continues the table and never overlaps it. False when refused.
 *
 * Both log tables are UNLOGGED: no WAL for data rebuilt from the chain anyway, and a crash empties
 * the log and its watermark together, after which the backfill resumes from the table's
 * watermark. Counts can be lost to a crash, never doubled.
 */
export async function appendAddressRange(pool: Pool, lo: number, hi: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL work_mem = '128MB'");
    await client.query("SET LOCAL statement_timeout = '180s'");
    await client.query(
      `INSERT INTO address_tx_count_log_state (id, applied_height)
       SELECT TRUE, $1::int - 1
        WHERE coalesce((SELECT applied_height FROM address_tx_count_state WHERE id), -1) = $1::int - 1
       ON CONFLICT (id) DO NOTHING`,
      [lo],
    );
    const moved = await client.query(
      `UPDATE address_tx_count_log_state SET applied_height = $2
        WHERE id AND applied_height = $1::int - 1`,
      [lo, hi],
    );
    if (moved.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(ADDRESS_COUNT_LOG_SQL, [lo, hi]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Fold the backfill log into the table: the table is rebuilt as the sum of itself and the log in
 * one sorted pass, its primary key built after the rows, swapped in, and its watermark moved to
 * the log's, all in one transaction. A reader sees the old table and watermark or the new ones,
 * never a mix, and a failure leaves everything as it was. The swap holds the table's lock only
 * for the renames. Returns the new watermark, or null when there was no log.
 */
export async function foldAddressLog(pool: Pool, nowSec: number): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL work_mem = '256MB'");
    await client.query("SET LOCAL maintenance_work_mem = '512MB'");
    await client.query("SET LOCAL statement_timeout = '30min'");
    const log = await client.query<{ applied_height: number }>(
      "SELECT applied_height FROM address_tx_count_log_state WHERE id FOR UPDATE",
    );
    const through = log.rows[0]?.applied_height;
    if (through === undefined) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("SELECT 1 FROM address_tx_count_state WHERE id FOR UPDATE");
    await client.query(
      `CREATE TABLE address_tx_count_next (address TEXT NOT NULL, tx_count INTEGER NOT NULL)
         WITH (fillfactor = 90)`,
    );
    await client.query(
      `INSERT INTO address_tx_count_next (address, tx_count)
       SELECT address, sum(n)::int FROM (
         SELECT address, tx_count AS n FROM address_tx_count
         UNION ALL
         SELECT address, n FROM address_tx_count_log
       ) u GROUP BY address`,
    );
    await client.query(
      "ALTER TABLE address_tx_count_next ADD CONSTRAINT address_tx_count_next_pkey PRIMARY KEY (address)",
    );
    await client.query("DROP TABLE address_tx_count");
    await client.query("ALTER TABLE address_tx_count_next RENAME TO address_tx_count");
    await client.query(
      "ALTER TABLE address_tx_count RENAME CONSTRAINT address_tx_count_next_pkey TO address_tx_count_pkey",
    );
    await client.query(
      `INSERT INTO address_tx_count_state (id, applied_height, updated_at) VALUES (TRUE, $1, $2)
       ON CONFLICT (id) DO UPDATE SET applied_height = EXCLUDED.applied_height,
                                      updated_at = EXCLUDED.updated_at`,
      [through, nowSec],
    );
    await client.query("TRUNCATE address_tx_count_log");
    await client.query("DELETE FROM address_tx_count_log_state");
    await client.query("COMMIT");
    return through;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * One address's count: the stored total through the watermark plus a live count of the blocks
 * above it, with the watermark read in the same query as the total so a range applied between two
 * reads cannot be counted twice or missed. Null while the table cannot answer yet (never started,
 * or so far behind that the live part would be a long walk). An unused address is a measured 0.
 */
export async function readAddressTxCount(pool: Pool, address: string): Promise<number | null> {
  const { rows } = await pool.query<{
    applied: number;
    tip: number | null;
    tx_count: number | null;
  }>(
    `SELECT s.applied_height AS applied, (SELECT max(height) FROM block) AS tip, a.tx_count
       FROM address_tx_count_state s
       LEFT JOIN address_tx_count a ON a.address = $1
      WHERE s.id`,
    [address],
  );
  const r = rows[0];
  if (!r || r.tip === null || r.tip - r.applied > LIVE_TAIL_MAX_BLOCKS) return null;
  const live = await pool.query<{ n: number }>(
    `SELECT count(DISTINCT txid)::int AS n
       FROM tx_transparent_io WHERE address = $1 AND block_height > $2`,
    [address, r.applied],
  );
  return (r.tx_count ?? 0) + (live.rows[0]?.n ?? 0);
}

/**
 * An address's lifetime transaction count: the single reader behind `/v1/addresses/{address}`'s
 * `txCount` and the `lifetimeTransactions` of its `/activity` and `/extremes`, so they cannot
 * disagree.
 *
 * Reads `address_tx_count` once it has caught up, which is exact for every address. Until then it
 * falls back to the rich list's count, exact but only for funded addresses, so an emptied address
 * reads null (our gap, never "none") while the table backfills.
 */
export async function lifetimeTxCount(pool: Pool, address: string): Promise<number | null> {
  const counted = await readAddressTxCount(pool, address);
  if (counted !== null) return counted;
  const { rows } = await pool.query<{ tx_count: string | number | null }>(
    "SELECT tx_count FROM chain_address_balance WHERE address = $1",
    [address],
  );
  const n = rows[0]?.tx_count;
  return n === undefined || n === null ? null : Number(n);
}

// ------------------------------------------------------------------------------ tracker

export interface AddressCountTrackerDeps {
  pool: Pool;
  /** A fresh pacer per pass, so a pass that aborted on a stall starts the next one clean. */
  pacer: () => Pacer;
  log: (m: string) => void;
  now?: () => number;
  /**
   * Whether a backfill may run now. Two passes over the io table at once double the random reads
   * beside ingestion, so the API runs one at a time: this waits for the transparent backfill.
   * Consulted only while far behind; keeping up never waits.
   */
  ready?: () => Promise<boolean>;
  /** The first range's size in transactions; measured from then on. Injectable for tests. */
  rangeTxs?: number;
}

/** Further behind the tip than this, a pass is a backfill and waits for `ready`. */
const BACKFILL_BLOCKS = 1_000;

/**
 * The seconds a range should take. A range is sized in transactions, not blocks: the work is one
 * io-table lookup per transaction with a transparent side, and chain density varies by two orders
 * of magnitude, so a block count measured on sparse blocks could overrun the statement bound on
 * dense ones. A range that fails is retried smaller, never at the same size.
 */
const TARGET_RANGE_MS = 8_000;
const MIN_RANGE_TXS = 200;
const MAX_RANGE_TXS = 150_000;
/** A range never spans more blocks than this, however sparse they are. */
const MAX_RANGE_BLOCKS = 20_000;

/**
 * The last height of a range starting at `from` holding at most `txs` transactions with a
 * transparent side, by the block table's own counts, and at least `from` itself, so one block
 * denser than the budget is still a range. Returns the range's end and its transaction count.
 */
export async function addressRangeEnd(
  pool: Pool,
  from: number,
  hi: number,
  txs: number,
): Promise<{ to: number; txs: number }> {
  const { rows } = await pool.query<{ to: number; txs: string | null }>(
    `WITH r AS (
       SELECT height, sum(greatest(tx_count - shielded_tx_count, 1)) OVER (ORDER BY height) AS cum
         FROM block WHERE height BETWEEN $1 AND $2
     ), fit AS (
       SELECT coalesce(max(height), $1)::int AS h FROM r WHERE cum <= $3
     )
     SELECT fit.h AS to, (SELECT cum FROM r WHERE r.height = fit.h) AS txs FROM fit`,
    [from, hi, txs],
  );
  return { to: rows[0]?.to ?? from, txs: Number(rows[0]?.txs ?? 0) };
}

/**
 * Keeps `address_tx_count` current: on start, then every ten minutes. Far behind (or with a log
 * already started), a pass is the backfill: ranges appended to the log up to the reorg depth below
 * the tip, then one fold. Near the tip, a pass upserts the few blocks that have reached that depth.
 * The pacer rests between ranges so ingestion keeps priority, and a stopped pass resumes from the
 * watermark it left.
 */
export class AddressCountTracker {
  #running = false;
  /** Transactions per range, re-measured after every range from its own throughput. */
  #rangeTxs: number;
  constructor(private readonly deps: AddressCountTrackerDeps) {
    this.#rangeTxs = deps.rangeTxs ?? 2_000;
  }

  async refresh(): Promise<{ applied: number; aborted: boolean }> {
    if (this.#running) return { applied: 0, aborted: false };
    this.#running = true;
    const now = this.deps.now ?? Date.now;
    const { pool } = this.deps;
    try {
      const { rows } = await pool.query<{ tip: number | null }>(
        "SELECT max(height) AS tip FROM block",
      );
      const tip = rows[0]?.tip ?? null;
      if (tip === null) return { applied: 0, aborted: false };
      const target = tip - REORG_DEPTH;
      const logged = await logAppliedHeight(pool);
      let from = Math.max((await appliedHeight(pool)) ?? -1, logged ?? -1) + 1;
      // A started log is finished through the log, however near the tip it now is.
      const backfill = logged !== null || target - from > BACKFILL_BLOCKS;
      if (from > target && logged === null) return { applied: 0, aborted: false };
      if (target - from > BACKFILL_BLOCKS && this.deps.ready && !(await this.deps.ready())) {
        return { applied: 0, aborted: false };
      }
      const pacer = this.deps.pacer();
      await pacer.preflight();
      let applied = 0;
      while (from <= target) {
        const range = await addressRangeEnd(
          pool,
          from,
          Math.min(target, from + MAX_RANGE_BLOCKS - 1),
          this.#rangeTxs,
        );
        const to = range.to;
        const started = now();
        let ok: boolean;
        try {
          ok = backfill
            ? await appendAddressRange(pool, from, to)
            : (await applyAddressRange(pool, from, to, Math.floor(now() / 1000))) !== null;
        } catch (error) {
          // A range that failed (above all one that overran its statement bound) must not be
          // retried at the same size, or every pass would fail the same way.
          this.#rangeTxs = Math.max(MIN_RANGE_TXS, Math.floor(this.#rangeTxs / 4));
          throw error;
        }
        if (!ok) {
          this.deps.log("address counts: the watermark moved under this pass; stopping it");
          return { applied, aborted: true };
        }
        const took = Math.max(1, now() - started);
        applied += to - from + 1;
        from = to + 1;
        // What this range showed the host can do in the target time, from the transactions it held.
        const measured = Math.round(Math.max(1, range.txs) * (TARGET_RANGE_MS / took));
        this.#rangeTxs = Math.min(MAX_RANGE_TXS, Math.max(MIN_RANGE_TXS, measured));
        if ((await pacer.afterUnit(took)) === "abort") {
          this.deps.log(`address counts: paused at height ${to}, ingestion is behind`);
          return { applied, aborted: true };
        }
      }
      if (backfill) {
        // The fold is the heaviest single statement this tracker runs, so not while ingestion is
        // behind.
        if ((await pacer.afterUnit(0)) === "abort") {
          this.deps.log("address counts: fold postponed, ingestion is behind");
          return { applied, aborted: true };
        }
        const started = now();
        const through = await foldAddressLog(pool, Math.floor(now() / 1000));
        this.deps.log(
          `address counts: folded the backfill log through height ${through} in ${Math.round((now() - started) / 1000)}s`,
        );
      }
      if (applied > 1_000) this.deps.log(`address counts: through height ${target}`);
      return { applied, aborted: false };
    } finally {
      this.#running = false;
    }
  }

  start(intervalMs = 10 * 60 * 1000): () => void {
    const run = (): void => {
      void this.refresh().catch((e: unknown) => {
        this.deps.log(`address counts: pass failed, will retry — ${String(e)}`);
      });
    };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}

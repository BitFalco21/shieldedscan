import type { Pool } from "pg";
import { POOL_NAMES, type PoolName } from "@/domain";
import { blockHeightRange } from "./chain-window";
import type { BlockTreeSizes } from "./node-rpc";
import type { Pacer } from "./job-pacer";
import { computeBoundaryDay, upsertBoundaryDay } from "./boundary-daily";
import { computeMiningDay, miningDaysToCompute } from "./mining-daily";
import { POOL_USED_SQL } from "./pool-sql";
import { DAY_SECONDS } from "@/domain/time";

/**
 * How each shielded pool is used, per UTC day, and the size of its anonymity set: kept in
 * `pool_usage_daily` by the API rather than the follower.
 *
 * The anonymity set is the one figure that measures a pool's privacy directly: a spend proves
 * membership among every note ever created in its pool, so the note commitment tree's size is the
 * set it hides in. The node reports that size on every block (`getblock`'s `trees`).
 *
 * The API keeps it because chain ingestion must never be paused for a follower redeploy. A day is
 * one indexed range read of `tx` (`tx_keyset_idx` on timestamp) and one light `getblock` for the
 * day's closing block, so the whole chain is a few thousand small units, paced to yield to
 * ingestion between days.
 */

/** One day's row for one pool, as stored. */
export interface PoolUsageRow {
  day: number;
  pool: PoolName;
  txs: number;
  fullyShielded: number;
  mixed: number;
  shielding: number;
  unshielding: number;
  indeterminate: number;
  coinbase: number;
  spends: number | null;
  outputs: number | null;
  actions: number | null;
  joinsplits: number | null;
  notesAtClose: number | null;
  closeHeight: number | null;
}

/**
 * One day's counts for all four pools, in one pass over the day's transactions.
 *
 * Built from `POOL_USED_SQL`, so "used the pool" means exactly what it means for the `?pool=` lists
 * and the per-pool counts. A transaction's day is its block's timestamp day, as in
 * `chain_day_pool_tx`; a parity test holds the two together.
 */
export const POOL_USAGE_DAY_SQL = (() => {
  const counts = POOL_NAMES.flatMap((p) => {
    const used = POOL_USED_SQL[p];
    return [
      `count(*) FILTER (WHERE ${used}) AS ${p}_txs`,
      `count(*) FILTER (WHERE ${used} AND kind = 'shielded') AS ${p}_fully_shielded`,
      `count(*) FILTER (WHERE ${used} AND kind = 'mixed') AS ${p}_mixed`,
      `count(*) FILTER (WHERE ${used} AND kind = 'mixed' AND direction = 'shielding') AS ${p}_shielding`,
      `count(*) FILTER (WHERE ${used} AND kind = 'mixed' AND direction = 'unshielding') AS ${p}_unshielding`,
      `count(*) FILTER (WHERE ${used} AND kind = 'mixed' AND direction = 'indeterminate') AS ${p}_indeterminate`,
      `count(*) FILTER (WHERE ${used} AND kind = 'coinbase') AS ${p}_coinbase`,
    ];
  });
  const sums = [
    "COALESCE(sum(sprout_joinsplits), 0) AS sprout_joinsplits",
    "COALESCE(sum(sapling_spends), 0) AS sapling_spends",
    "COALESCE(sum(sapling_outputs), 0) AS sapling_outputs",
    "COALESCE(sum(orchard_actions), 0) AS orchard_actions",
    "COALESCE(sum(ironwood_actions), 0) AS ironwood_actions",
  ];
  return `SELECT ${[...counts, ...sums].join(",\n       ")}
  FROM tx
 WHERE block_height IS NOT NULL AND timestamp >= $1::bigint AND timestamp < $2::bigint`;
})();

/** Count one UTC day (its midnight in unix seconds) for every pool, trees included. */
export async function computePoolUsageDay(
  pool: Pool,
  dayStart: number,
  trees: (height: number) => Promise<BlockTreeSizes>,
): Promise<PoolUsageRow[]> {
  const dayEnd = dayStart + DAY_SECONDS;
  const [{ rows }, range] = await Promise.all([
    pool.query<Record<string, string>>(POOL_USAGE_DAY_SQL, [dayStart, dayEnd]),
    blockHeightRange(pool, dayStart, dayEnd),
  ]);
  const r = rows[0] ?? {};
  const n = (key: string): number => Number(r[key] ?? 0);
  const closeHeight = range.hi;
  const sizes = closeHeight === null ? null : await trees(closeHeight);
  return POOL_NAMES.map((p) => ({
    day: dayStart,
    pool: p,
    txs: n(`${p}_txs`),
    fullyShielded: n(`${p}_fully_shielded`),
    mixed: n(`${p}_mixed`),
    shielding: n(`${p}_shielding`),
    unshielding: n(`${p}_unshielding`),
    indeterminate: n(`${p}_indeterminate`),
    coinbase: n(`${p}_coinbase`),
    spends: p === "sapling" ? n("sapling_spends") : null,
    outputs: p === "sapling" ? n("sapling_outputs") : null,
    actions: p === "orchard" || p === "ironwood" ? n(`${p}_actions`) : null,
    joinsplits: p === "sprout" ? n("sprout_joinsplits") : null,
    notesAtClose: p === "sprout" || sizes === null ? null : sizes[p],
    closeHeight,
  }));
}

export async function upsertPoolUsage(
  pool: Pool,
  rows: readonly PoolUsageRow[],
  nowSec: number,
): Promise<void> {
  for (const r of rows) {
    await pool.query(
      `INSERT INTO pool_usage_daily (day, pool, txs, fully_shielded, mixed, shielding, unshielding,
                                    indeterminate, coinbase, spends, outputs, actions, joinsplits,
                                    notes_at_close, close_height, computed_at)
       VALUES ((to_timestamp($1) AT TIME ZONE 'UTC')::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16)
       ON CONFLICT (day, pool) DO UPDATE SET
         txs = EXCLUDED.txs, fully_shielded = EXCLUDED.fully_shielded, mixed = EXCLUDED.mixed,
         shielding = EXCLUDED.shielding, unshielding = EXCLUDED.unshielding,
         indeterminate = EXCLUDED.indeterminate, coinbase = EXCLUDED.coinbase,
         spends = EXCLUDED.spends, outputs = EXCLUDED.outputs, actions = EXCLUDED.actions,
         joinsplits = EXCLUDED.joinsplits, notes_at_close = EXCLUDED.notes_at_close,
         close_height = EXCLUDED.close_height, computed_at = EXCLUDED.computed_at`,
      [
        r.day,
        r.pool,
        r.txs,
        r.fullyShielded,
        r.mixed,
        r.shielding,
        r.unshielding,
        r.indeterminate,
        r.coinbase,
        r.spends,
        r.outputs,
        r.actions,
        r.joinsplits,
        r.notesAtClose,
        r.closeHeight,
        nowSec,
      ],
    );
  }
}

/** Every stored row, oldest first: the table is small enough to read into a memo. */
export async function loadPoolUsage(pool: Pool): Promise<PoolUsageRow[]> {
  const { rows } = await pool.query<Record<string, string | number | null>>(
    `SELECT EXTRACT(EPOCH FROM day)::bigint AS day, pool, txs, fully_shielded, mixed, shielding,
            unshielding, indeterminate, coinbase, spends, outputs, actions, joinsplits,
            notes_at_close, close_height
       FROM pool_usage_daily ORDER BY day, pool`,
  );
  const num = (v: string | number | null | undefined): number | null =>
    v === null || v === undefined ? null : Number(v);
  return rows.map((r) => ({
    day: Number(r.day),
    pool: r.pool as PoolName,
    txs: Number(r.txs),
    fullyShielded: Number(r.fully_shielded),
    mixed: Number(r.mixed),
    shielding: Number(r.shielding),
    unshielding: Number(r.unshielding),
    indeterminate: Number(r.indeterminate),
    coinbase: Number(r.coinbase),
    spends: num(r.spends),
    outputs: num(r.outputs),
    actions: num(r.actions),
    joinsplits: num(r.joinsplits),
    notesAtClose: num(r.notes_at_close),
    closeHeight: num(r.close_height),
  }));
}

/** The chain's first and newest UTC day (midnights), the newest never past today; null when empty. */
export async function chainDayExtent(
  pool: Pool,
  nowSec: number,
): Promise<{ first: number; last: number } | null> {
  const { rows } = await pool.query<{ lo: string | null; hi: string | null }>(
    "SELECT min(timestamp)::text AS lo, max(timestamp)::text AS hi FROM block",
  );
  const lo = rows[0]?.lo;
  const hi = rows[0]?.hi;
  if (lo == null || hi == null) return null;
  return {
    first: Math.floor(Number(lo) / DAY_SECONDS) * DAY_SECONDS,
    last: Math.floor(Math.min(Number(hi), nowSec) / DAY_SECONDS) * DAY_SECONDS,
  };
}

/** The UTC days to (re)compute: every day missing a full set of rows, plus the newest three. */
export async function daysToCompute(pool: Pool, nowSec: number): Promise<number[]> {
  const [extent, done] = await Promise.all([
    chainDayExtent(pool, nowSec),
    // Done means both tables hold the day: the boundary counts ride in the same per-day unit.
    pool.query<{ day: string }>(
      `SELECT EXTRACT(EPOCH FROM p.day)::bigint::text AS day
         FROM pool_usage_daily p JOIN boundary_daily b ON b.day = p.day
        GROUP BY p.day HAVING count(*) = ${POOL_NAMES.length}`,
    ),
  ]);
  if (extent === null) return [];
  const { first, last } = extent;
  const complete = new Set(done.rows.map((r) => Number(r.day)));
  // A day stays open until settled: late blocks stamped into it and reorgs are absorbed by
  // recomputing the newest three on every pass.
  const recent = last - 2 * DAY_SECONDS;
  const days: number[] = [];
  for (let d = first; d <= last; d += DAY_SECONDS) {
    if (d >= recent || !complete.has(d)) days.push(d);
  }
  return days;
}

export interface PoolUsageTrackerDeps {
  pool: Pool;
  trees: (height: number) => Promise<BlockTreeSizes>;
  /** A fresh pacer per pass, so a pass that aborted on a stall starts the next one clean. */
  pacer: () => Pacer;
  log: (m: string) => void;
  now?: () => number;
}

/**
 * Keeps `pool_usage_daily`, `boundary_daily` and the mining days current: on start, then every ten
 * minutes. The first pass on an empty table is the backfill (one unit per day, paced); later passes
 * recompute three days. A pass the pacer stops (ingestion fell behind) is abandoned, and the next
 * resumes from the days still missing, so nothing is lost or double-counted (upserts, and a mining
 * day is replaced whole).
 */
export class PoolUsageTracker {
  #running = false;
  constructor(private readonly deps: PoolUsageTrackerDeps) {}

  async refresh(): Promise<{ computed: number; aborted: boolean }> {
    if (this.#running) return { computed: 0, aborted: false };
    this.#running = true;
    const now = this.deps.now ?? Date.now;
    try {
      const nowSec = Math.floor(now() / 1000);
      const extent = await chainDayExtent(this.deps.pool, nowSec);
      if (extent === null) return { computed: 0, aborted: false };
      // Two independent sets: a day can be settled for pool usage while its miners are still
      // being filled by the miner repair, and recomputing pool usage for it would be wasted work.
      const [usageDays, miningDays] = await Promise.all([
        daysToCompute(this.deps.pool, nowSec),
        miningDaysToCompute(this.deps.pool, extent.first, extent.last, nowSec),
      ]);
      const usage = new Set(usageDays);
      const mining = new Set(miningDays);
      const days = [...new Set([...usageDays, ...miningDays])].sort((a, b) => a - b);
      if (days.length === 0) return { computed: 0, aborted: false };
      const pacer = this.deps.pacer();
      await pacer.preflight();
      let computed = 0;
      for (const d of days) {
        const started = now();
        if (usage.has(d)) {
          const [rows, boundary] = await Promise.all([
            computePoolUsageDay(this.deps.pool, d, this.deps.trees),
            computeBoundaryDay(this.deps.pool, d),
          ]);
          await upsertPoolUsage(this.deps.pool, rows, Math.floor(now() / 1000));
          await upsertBoundaryDay(this.deps.pool, boundary, Math.floor(now() / 1000));
        }
        if (mining.has(d)) await computeMiningDay(this.deps.pool, d, Math.floor(now() / 1000));
        computed += 1;
        if ((await pacer.afterUnit(now() - started)) === "abort") {
          this.deps.log(`pool usage: paused after ${computed} days, ingestion is behind`);
          return { computed, aborted: true };
        }
      }
      if (days.length > 3) this.deps.log(`pool usage: computed ${computed} days`);
      return { computed, aborted: false };
    } finally {
      this.#running = false;
    }
  }

  start(intervalMs = 10 * 60 * 1000): () => void {
    const run = (): void => {
      void this.refresh().catch((e: unknown) => {
        this.deps.log(`pool usage: pass failed, will retry — ${String(e)}`);
      });
    };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}

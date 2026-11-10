import type { Pool, PoolClient } from "pg";
import { addressRangeEnd } from "./address-counts";
import { REORG_DEPTH } from "./follow";
import type { Pacer } from "./job-pacer";
import { rollbackQuietly } from "./pg-pool";
import { dayBefore } from "@/domain/coin-age";

/**
 * Transparent coin age: `coin_age_matrix`, every transparent output summed by the day its block
 * created it and the day a block spent it (see `server/schema.sql` and `src/domain/coin-age.ts`).
 *
 * Kept by applying height ranges in order under a watermark moved in the same transaction as the
 * rows it covers, and only forward from exactly where it stood, so a range is applied once
 * whatever crashes or races. Never within the reorg depth: only heights at least `REORG_DEPTH`
 * below the tip are applied, so nothing stored is ever taken back.
 *
 * A range's work is: its blocks' days; its outputs, added to (their day, unspent); and its inputs,
 * each a primary-key probe for the output it spends, moved from (that output's day, unspent) to
 * (that output's day, this block's day). Before committing, the unspent rows must add up to the
 * node's transparent pool at the range's last block to the zatoshi, and every input must have
 * found its output; anything else rolls the range back and stops the pass.
 *
 * The first fill is seeded from a matrix computed offline and checked against the pool at every
 * day; walking from genesis here would cost a probe per input for the whole chain.
 */

/** The range's blocks and their days; `$1`..`$2` the heights, `$3` the day before them. */
const RANGE_DAYS_SQL = `
  INSERT INTO coin_age_range_day (height, day)
  SELECT height, greatest(max(raw) OVER (ORDER BY height), $3::date) AS day
    FROM (SELECT height, (to_timestamp(timestamp) AT TIME ZONE 'UTC')::date AS raw
            FROM block WHERE height BETWEEN $1 AND $2) b`;

const DAYS_SQL = `
  INSERT INTO coin_age_day AS d (day, last_height)
  SELECT day, max(height) FROM coin_age_range_day GROUP BY day
  ON CONFLICT (day) DO UPDATE SET last_height = greatest(d.last_height, EXCLUDED.last_height)`;

const ADD_SQL = `
  ON CONFLICT (creation_day, spend_day) DO UPDATE
    SET value_zat = m.value_zat + EXCLUDED.value_zat, outputs = m.outputs + EXCLUDED.outputs`;

const OUTPUTS_SQL = `
  INSERT INTO coin_age_matrix AS m (creation_day, spend_day, value_zat, outputs)
  SELECT d.day, NULL, sum(o.value_zat), count(*)
    FROM tx t
    JOIN tx_transparent_io o ON o.txid = t.txid AND o.io = 'out'
    JOIN coin_age_range_day d ON d.height = t.block_height
   WHERE t.block_height BETWEEN $1 AND $2 AND t.kind <> 'shielded'
   GROUP BY d.day
  ${ADD_SQL}`;

/**
 * Every input in the range with the day its output was created and the output's own value. The
 * creation day is the first day whose closing height reaches the output's height: days close in
 * height order, so that is the day the output's block belongs to.
 */
const SPENDS_SQL = `
  INSERT INTO coin_age_range_spend (creation_day, spend_day, value_zat, outputs)
  SELECT c.day AS creation_day, d.day AS spend_day, sum(p.value_zat) AS value_zat, count(*) AS outputs
    FROM tx t
    JOIN tx_transparent_io i ON i.txid = t.txid AND i.io = 'in'
    JOIN coin_age_range_day d ON d.height = t.block_height
    JOIN tx_transparent_io p ON p.txid = i.prev_txid AND p.io = 'out' AND p.ordinal = i.prev_vout
    CROSS JOIN LATERAL (
      SELECT day FROM coin_age_day WHERE last_height >= p.block_height ORDER BY last_height LIMIT 1
    ) c
   WHERE t.block_height BETWEEN $1 AND $2 AND t.kind <> 'shielded'
   GROUP BY 1, 2`;

const INPUT_COUNT_SQL = `
  SELECT count(*)::bigint AS n
    FROM tx t JOIN tx_transparent_io i ON i.txid = t.txid AND i.io = 'in'
   WHERE t.block_height BETWEEN $1 AND $2 AND t.kind <> 'shielded'`;

const UNSPEND_SQL = `
  UPDATE coin_age_matrix m SET value_zat = m.value_zat - s.v, outputs = m.outputs - s.n
    FROM (SELECT creation_day, sum(value_zat) AS v, sum(outputs) AS n
            FROM coin_age_range_spend GROUP BY creation_day) s
   WHERE m.creation_day = s.creation_day AND m.spend_day IS NULL`;

const SPEND_SQL = `
  INSERT INTO coin_age_matrix AS m (creation_day, spend_day, value_zat, outputs)
  SELECT creation_day, spend_day, value_zat, outputs FROM coin_age_range_spend
  ${ADD_SQL}`;

/** The reconciliation: unspent value against the node's pool at the range's last block. */
const RECONCILE_SQL = `
  SELECT (SELECT coalesce(sum(value_zat), 0) FROM coin_age_matrix WHERE spend_day IS NULL)::bigint AS unspent,
         (SELECT count(*) FROM coin_age_matrix WHERE spend_day IS NULL AND (value_zat < 0 OR outputs < 0))::int AS negative,
         (SELECT transparent_pool_zat FROM block WHERE height = $1) AS pool,
         (SELECT day FROM coin_age_range_day WHERE height = $1)::text AS day`;

export interface CoinAgeState {
  appliedHeight: number;
  appliedDay: string | null;
}

export async function coinAgeState(pool: Pick<Pool, "query">): Promise<CoinAgeState | null> {
  const { rows } = await pool.query<{ applied_height: number; applied_day: string | null }>(
    "SELECT applied_height, applied_day::text FROM coin_age_state WHERE id",
  );
  const r = rows[0];
  return r ? { appliedHeight: r.applied_height, appliedDay: r.applied_day } : null;
}

export class CoinAgeRangeRefused extends Error {}

async function count(client: PoolClient, sql: string, params: unknown[]): Promise<bigint> {
  const { rows } = await client.query<{ n: string }>(sql, params);
  return BigInt(rows[0]?.n ?? 0);
}

/**
 * Apply heights `lo`..`hi` and move the watermark to `hi`, in one transaction, only if it stood
 * at exactly `lo - 1`. False when another writer moved it (nothing is written). Throws
 * `CoinAgeRangeRefused`, with everything rolled back, when the range does not reconcile.
 */
export async function applyCoinAgeRange(
  pool: Pool,
  lo: number,
  hi: number,
  nowSec: number,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL work_mem = '128MB'");
    await client.query("SET LOCAL statement_timeout = '180s'");
    const state = await client.query<{ applied_day: string | null }>(
      "SELECT applied_day::text FROM coin_age_state WHERE id AND applied_height = $1 - 1 FOR UPDATE",
      [lo],
    );
    if (state.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    // Bind parameters are refused in CREATE TABLE AS, so the scratch tables are made empty first.
    await client.query(
      "CREATE TEMP TABLE coin_age_range_day (height INTEGER PRIMARY KEY, day DATE NOT NULL) ON COMMIT DROP",
    );
    await client.query(
      `CREATE TEMP TABLE coin_age_range_spend (creation_day DATE NOT NULL, spend_day DATE NOT NULL,
         value_zat BIGINT NOT NULL, outputs BIGINT NOT NULL) ON COMMIT DROP`,
    );
    await client.query(RANGE_DAYS_SQL, [lo, hi, state.rows[0]!.applied_day]);
    const blocks = await count(client, "SELECT count(*) AS n FROM coin_age_range_day", []);
    if (blocks !== BigInt(hi - lo + 1)) {
      throw new CoinAgeRangeRefused(`heights ${lo}..${hi}: ${blocks} blocks stored`);
    }
    await client.query(DAYS_SQL);
    await client.query(OUTPUTS_SQL, [lo, hi]);
    await client.query(SPENDS_SQL, [lo, hi]);
    const inputs = await count(client, INPUT_COUNT_SQL, [lo, hi]);
    const matched = await count(
      client,
      "SELECT coalesce(sum(outputs), 0) AS n FROM coin_age_range_spend",
      [],
    );
    if (inputs !== matched) {
      throw new CoinAgeRangeRefused(
        `heights ${lo}..${hi}: ${inputs - matched} of ${inputs} inputs found no output`,
      );
    }
    await client.query(UNSPEND_SQL);
    await client.query(SPEND_SQL);
    const { rows } = await client.query<{
      unspent: string;
      negative: number;
      pool: string | null;
      day: string;
    }>(RECONCILE_SQL, [hi]);
    const r = rows[0]!;
    if (r.negative > 0) {
      throw new CoinAgeRangeRefused(`heights ${lo}..${hi}: ${r.negative} days spent below zero`);
    }
    // Only genesis has no pool reading; it creates nothing transparent anyone can spend.
    if (r.pool !== null && BigInt(r.pool) !== BigInt(r.unspent)) {
      throw new CoinAgeRangeRefused(
        `heights ${lo}..${hi}: unspent ${r.unspent} zat against the node's transparent pool ${r.pool}`,
      );
    }
    await client.query(
      "UPDATE coin_age_state SET applied_height = $1, applied_day = $2, updated_at = $3 WHERE id",
      [hi, r.day, nowSec],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------------------ reading

/** Unspent value created on one day, as measured at the end of another. */
export interface CoinAgeCellRow {
  asOf: string;
  creationDay: string;
  valueZat: number;
  outputs: number;
}

const cellRow = (r: {
  as_of: string;
  creation_day: string;
  value_zat: string;
  outputs: string;
}) => ({
  asOf: r.as_of,
  creationDay: r.creation_day,
  valueZat: Number(r.value_zat),
  outputs: Number(r.outputs),
});

/**
 * One month-end's cells, read from the matrix into `coin_age_month_end`: the value created on each
 * day up to `$1` and not spent by its end. One scan of the matrix, once per month.
 */
export const MONTH_END_SQL = `
  INSERT INTO coin_age_month_end (as_of, creation_day, value_zat, outputs)
  SELECT $1::date, creation_day, sum(value_zat), sum(outputs)
    FROM coin_age_matrix
   WHERE creation_day <= $1::date AND (spend_day IS NULL OR spend_day > $1::date)
   GROUP BY creation_day
  HAVING sum(outputs) <> 0
  ON CONFLICT (as_of, creation_day) DO NOTHING`;

/**
 * Write every closed month-end not stored yet, oldest first. A month-end is closed once the
 * applied block's day is later than it: every block of that day is applied, and a later spend has a
 * later spend day, so what it reads never changes. Returns the month-ends written.
 */
export async function fillCoinAgeMonthEnds(
  pool: Pick<Pool, "query">,
  afterEach: (tookMs: number) => Promise<"continue" | "abort"> = async () => "continue",
): Promise<string[]> {
  const state = await coinAgeState(pool);
  if (state === null || state.appliedDay === null) return [];
  const { rows } = await pool.query<{ first: string | null }>(
    "SELECT min(day)::text AS first FROM coin_age_day",
  );
  const first = rows[0]?.first ?? null;
  if (first === null) return [];
  const stored = await pool.query<{ as_of: string }>(
    "SELECT DISTINCT as_of::text FROM coin_age_month_end",
  );
  const have = new Set(stored.rows.map((r) => r.as_of));
  const written: string[] = [];
  for (const end of monthEndsThrough(first, dayBefore(state.appliedDay, { days: 1 }))) {
    if (have.has(end)) continue;
    const started = Date.now();
    await pool.query(MONTH_END_SQL, [end]);
    written.push(end);
    if ((await afterEach(Date.now() - started)) === "abort") break;
  }
  return written;
}

/** The stored month-ends' cells, oldest first. */
export async function loadMonthEndCells(pool: Pick<Pool, "query">): Promise<CoinAgeCellRow[]> {
  const { rows } = await pool.query<{
    as_of: string;
    creation_day: string;
    value_zat: string;
    outputs: string;
  }>(
    `SELECT as_of::text, creation_day::text, value_zat, outputs
       FROM coin_age_month_end ORDER BY as_of, creation_day`,
  );
  return rows.map(cellRow);
}

/** The newest applied block's cells: everything the matrix holds as unspent. */
export async function loadLatestCells(
  pool: Pick<Pool, "query">,
  asOf: string,
): Promise<CoinAgeCellRow[]> {
  const { rows } = await pool.query<{
    as_of: string;
    creation_day: string;
    value_zat: string;
    outputs: string;
  }>(
    `SELECT $1::text AS as_of, creation_day::text, value_zat, outputs
       FROM coin_age_matrix WHERE spend_day IS NULL AND outputs <> 0 ORDER BY creation_day`,
    [asOf],
  );
  return rows.map(cellRow);
}

/** The month-ends a table covering days `firstDay`..`lastClosedDay` can state, oldest first. */
export function monthEndsThrough(firstDay: string, lastClosedDay: string): string[] {
  const out: string[] = [];
  let y = Number(firstDay.slice(0, 4));
  let m = Number(firstDay.slice(5, 7));
  for (;;) {
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (end > lastClosedDay) return out;
    out.push(end);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

/** Each stored day's closing height, oldest first. */
export async function loadCoinAgeDays(
  pool: Pick<Pool, "query">,
): Promise<{ day: string; lastHeight: number }[]> {
  const { rows } = await pool.query<{ day: string; last_height: number }>(
    "SELECT day::text, last_height FROM coin_age_day ORDER BY day",
  );
  return rows.map((r) => ({ day: r.day, lastHeight: r.last_height }));
}

// ------------------------------------------------------------------------------ tracker

export interface CoinAgeTrackerDeps {
  pool: Pool;
  /** A fresh pacer per pass, so a pass that aborted on a stall starts the next one clean. */
  pacer: () => Pacer;
  log: (m: string) => void;
  now?: () => number;
}

/** Transactions per range: a few seconds of probes on the production box. */
const RANGE_TXS = 5_000;
const MAX_RANGE_BLOCKS = 2_000;

/**
 * Keeps the matrix current once it has been seeded: on start, then every ten minutes, applying the
 * blocks that have reached the reorg depth, then storing any month-end they closed. Does nothing before the seed (no state row): a walk
 * from genesis is not what this is for.
 */
export class CoinAgeTracker {
  #running = false;
  #stopped = false;
  constructor(private readonly deps: CoinAgeTrackerDeps) {}

  async refresh(): Promise<{ applied: number; aborted: boolean }> {
    if (this.#running || this.#stopped) return { applied: 0, aborted: false };
    this.#running = true;
    const now = this.deps.now ?? Date.now;
    const { pool } = this.deps;
    try {
      const state = await coinAgeState(pool);
      if (state === null) return { applied: 0, aborted: false };
      const { rows } = await pool.query<{ tip: number | null }>(
        "SELECT max(height) AS tip FROM block",
      );
      const target = (rows[0]?.tip ?? -1) - REORG_DEPTH;
      let from = state.appliedHeight + 1;
      const pacer = this.deps.pacer();
      await pacer.preflight();
      let applied = 0;
      while (from <= target) {
        const { to } = await addressRangeEnd(
          pool,
          from,
          Math.min(target, from + MAX_RANGE_BLOCKS - 1),
          RANGE_TXS,
        );
        const started = now();
        let ok: boolean;
        try {
          ok = await applyCoinAgeRange(pool, from, to, Math.floor(now() / 1000));
        } catch (error) {
          // A range that does not reconcile will not reconcile on the next pass either; stop
          // rather than retry it every ten minutes, and say so.
          if (error instanceof CoinAgeRangeRefused) this.#stopped = true;
          throw error;
        }
        if (!ok) {
          this.deps.log("coin age: the watermark moved under this pass; stopping it");
          return { applied, aborted: true };
        }
        applied += to - from + 1;
        from = to + 1;
        if ((await pacer.afterUnit(Math.max(1, now() - started))) === "abort") {
          this.deps.log(`coin age: paused at height ${to}, ingestion is behind`);
          return { applied, aborted: true };
        }
      }
      // Month-ends the applied ranges have closed (on a fresh seed, every one since 2016).
      const ends = await fillCoinAgeMonthEnds(pool, (took) => pacer.afterUnit(took));
      if (ends.length > 1) this.deps.log(`coin age: stored ${ends.length} month-ends`);
      return { applied, aborted: false };
    } finally {
      this.#running = false;
    }
  }

  start(intervalMs = 10 * 60 * 1000): () => void {
    const run = (): void => {
      void this.refresh().catch((e: unknown) => {
        this.deps.log(
          `coin age: pass failed${this.#stopped ? ", tracker stopped" : ", will retry"} — ${String(e)}`,
        );
      });
    };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}

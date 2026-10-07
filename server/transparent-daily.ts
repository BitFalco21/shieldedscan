import type { Pool } from "pg";
import { rollbackQuietly } from "./pg-pool";
import type { Pacer } from "./job-pacer";
import { chainDayExtent } from "./pool-usage";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";

/**
 * Transparent volume and active addresses: per UTC day, per calendar month, and over the trailing
 * 7, 30 and 90 complete days. Read by `/v1/analytics/transparent`.
 *
 * Every figure is a rollup of rows the follower already writes (`tx` and `tx_transparent_io`), so
 * the API keeps these tables and the follower is untouched.
 *
 * A day is an indexed range read of `tx` plus one primary-key probe of `tx_transparent_io` per
 * transaction with a transparent side. Busy days take tens of seconds cold, so the chain is a few
 * hours of paced work, a day at a time, newest first, each day one statement under its own
 * timeout.
 *
 * A distinct count never adds across days: an address active on two days is one address in their
 * month. Counting a month straight from `tx_transparent_io` would repeat the whole read, so each
 * day stores its distinct addresses in `transparent_day_address`; a month or trailing window is a
 * GROUP BY over those rows, and a month's rows are deleted once its count is final and its days are
 * older than the retention window. A recomputed day replaces its own rows, so a reorged-away
 * address leaves the counts with its block.
 */

/**
 * Days of address rows kept after their month is final: the trailing windows read them, and 92
 * covers the longest one (90 complete days) whatever day of the month it is.
 */
export const ADDRESS_RETENTION_DAYS = 92;

/** The trailing windows counted, in complete UTC days ending yesterday. */
export const TRAILING_WINDOWS = [7, 30, 90] as const;

/** The UTC month start (unix seconds) a day belongs to. */
export function monthOf(ts: number): number {
  const d = new Date(ts * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

/** The first day of the month after the one `ts` belongs to. */
export function nextMonth(ts: number): number {
  const d = new Date(ts * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
}

/**
 * One day: its address set into `transparent_day_address` and its figures back, in one pass over
 * the day's inputs and outputs. `$1`/`$2` are the day's half-open unix-second edges, `$3` the day.
 *
 * A fully shielded transaction has no transparent side and is not probed. Volume excludes coinbase
 * outputs (issuance and collected fees, which mining reports) while the address set keeps them: a
 * miner's payout address did receive. An output naming no single address (a bare public key,
 * multisig, OP_RETURN) counts as volume and no address.
 */
export const TRANSPARENT_DAY_SQL = `
  WITH t AS MATERIALIZED (
    SELECT txid, kind FROM tx
     WHERE block_height IS NOT NULL AND kind <> 'shielded'
       AND timestamp >= $1::bigint AND timestamp < $2::bigint
  ), io AS MATERIALIZED (
    SELECT t.kind, i.io, i.address, i.value_zat
      FROM t JOIN tx_transparent_io i ON i.txid = t.txid
  ), kept AS (
    INSERT INTO transparent_day_address (day, address, sent, received)
    SELECT $3::date, address, bool_or(io = 'in'), bool_or(io = 'out')
      FROM io WHERE address IS NOT NULL
     GROUP BY address
    RETURNING sent, received
  )
  SELECT (SELECT count(*) FROM kept)::int AS active,
         (SELECT count(*) FILTER (WHERE sent) FROM kept)::int AS sending,
         (SELECT count(*) FILTER (WHERE received) FROM kept)::int AS receiving,
         count(*) FILTER (WHERE io = 'out' AND kind <> 'coinbase')::int AS outputs,
         count(*) FILTER (WHERE io = 'out' AND kind <> 'coinbase' AND address IS NULL)::int
           AS unaddressed,
         COALESCE(sum(value_zat) FILTER (WHERE io = 'out' AND kind = 'transparent'), 0)::text
           AS out_transparent,
         COALESCE(sum(value_zat) FILTER (WHERE io = 'out' AND kind = 'mixed'), 0)::text
           AS out_mixed,
         count(*) FILTER (WHERE io = 'in')::int AS inputs,
         count(*) FILTER (WHERE io = 'in' AND value_zat IS NULL)::int AS unresolved,
         COALESCE(sum(value_zat) FILTER (WHERE io = 'in' AND kind = 'transparent'), 0)::text
           AS in_transparent,
         COALESCE(sum(value_zat) FILTER (WHERE io = 'in' AND kind = 'mixed'), 0)::text
           AS in_mixed
    FROM io`;

/** One stored day. Amounts in zatoshi; addresses are exact distinct counts for that day. */
export interface TransparentDayRow {
  day: number;
  /** Transparent outputs of the day's non-coinbase transactions. */
  outputs: number;
  /** Of those, outputs naming no single address. */
  unaddressedOutputs: number;
  /** Their value in transactions with no shielded side. */
  outTransparentZat: number;
  /** Their value in transactions crossing the shielded boundary. */
  outMixedZat: number;
  inputs: number;
  /** Inputs whose value the index never resolved; above zero, the input sums are floors. */
  unresolvedInputs: number;
  inTransparentZat: number;
  inMixedZat: number;
  active: number;
  sending: number;
  receiving: number;
}

/**
 * (Re)compute one UTC day (its midnight in unix seconds) in one transaction. The day's address rows
 * are replaced, because a recompute can remove an address (one whose only activity was in a
 * reorged-away block), and its figures are upserted beside them, so the two always agree.
 */
export async function computeTransparentDay(
  pool: Pool,
  dayStart: number,
  nowSec: number,
): Promise<TransparentDayRow> {
  const day = utcDayFromSeconds(dayStart);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The day's address set is grouped in memory; heavy days hold on the order of 100k addresses.
    await client.query("SET LOCAL work_mem = '64MB'");
    // Its own bound above the pool's: the heaviest days take tens of seconds cold, and a day that
    // always timed out would stall the backfill on it.
    await client.query("SET LOCAL statement_timeout = '180s'");
    await client.query("DELETE FROM transparent_day_address WHERE day = $1::date", [day]);
    const { rows } = await client.query<Record<string, string | number>>(TRANSPARENT_DAY_SQL, [
      dayStart,
      dayStart + DAY_SECONDS,
      day,
    ]);
    const r = rows[0]!;
    const row: TransparentDayRow = {
      day: dayStart,
      outputs: Number(r.outputs),
      unaddressedOutputs: Number(r.unaddressed),
      outTransparentZat: Number(r.out_transparent),
      outMixedZat: Number(r.out_mixed),
      inputs: Number(r.inputs),
      unresolvedInputs: Number(r.unresolved),
      inTransparentZat: Number(r.in_transparent),
      inMixedZat: Number(r.in_mixed),
      active: Number(r.active),
      sending: Number(r.sending),
      receiving: Number(r.receiving),
    };
    await client.query(
      `INSERT INTO transparent_daily (day, outputs, unaddressed_outputs, out_transparent_zat,
                                     out_mixed_zat, inputs, unresolved_inputs, in_transparent_zat,
                                     in_mixed_zat, active_addresses, sending_addresses,
                                     receiving_addresses, computed_at)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (day) DO UPDATE SET
         outputs = EXCLUDED.outputs, unaddressed_outputs = EXCLUDED.unaddressed_outputs,
         out_transparent_zat = EXCLUDED.out_transparent_zat, out_mixed_zat = EXCLUDED.out_mixed_zat,
         inputs = EXCLUDED.inputs, unresolved_inputs = EXCLUDED.unresolved_inputs,
         in_transparent_zat = EXCLUDED.in_transparent_zat, in_mixed_zat = EXCLUDED.in_mixed_zat,
         active_addresses = EXCLUDED.active_addresses,
         sending_addresses = EXCLUDED.sending_addresses,
         receiving_addresses = EXCLUDED.receiving_addresses, computed_at = EXCLUDED.computed_at`,
      [
        day,
        row.outputs,
        row.unaddressedOutputs,
        row.outTransparentZat,
        row.outMixedZat,
        row.inputs,
        row.unresolvedInputs,
        row.inTransparentZat,
        row.inMixedZat,
        row.active,
        row.sending,
        row.receiving,
        nowSec,
      ],
    );
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The days to (re)compute, `first`..`last` being the chain's day extent: the newest three first
 * (late blocks and reorgs can still change them), then every day never computed, newest first,
 * since recent periods are asked about far more often. Walking backwards still completes one month
 * at a time, so months behind the walk are counted and pruned as it passes them.
 */
export async function transparentDaysToCompute(
  pool: Pool,
  first: number,
  last: number,
): Promise<number[]> {
  const { rows } = await pool.query<{ day: string }>(
    "SELECT EXTRACT(EPOCH FROM day)::bigint::text AS day FROM transparent_daily",
  );
  const done = new Set(rows.map((r) => Number(r.day)));
  const recent = Math.max(first, last - 2 * DAY_SECONDS);
  const newest: number[] = [];
  const backlog: number[] = [];
  for (let d = first; d <= last; d += DAY_SECONDS) {
    if (d >= recent) newest.push(d);
    else if (!done.has(d)) backlog.push(d);
  }
  return [...newest, ...backlog.reverse()];
}

/** Exact distinct counts over the stored address rows of `[from, to)`. */
const COUNT_SQL = `
  SELECT count(*)::int AS active, count(*) FILTER (WHERE s)::int AS sending,
         count(*) FILTER (WHERE r)::int AS receiving
    FROM (SELECT address, bool_or(sent) AS s, bool_or(received) AS r
            FROM transparent_day_address
           WHERE day >= $1::date AND day < $2::date
           GROUP BY address) a`;

async function countAddresses(
  pool: Pool,
  fromTs: number,
  toTs: number,
): Promise<{ active: number; sending: number; receiving: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // A busy month is a few million rows; with this much memory the grouping does not spill.
    await client.query("SET LOCAL work_mem = '256MB'");
    const { rows } = await client.query<{ active: number; sending: number; receiving: number }>(
      COUNT_SQL,
      [utcDayFromSeconds(fromTs), utcDayFromSeconds(toTs)],
    );
    await client.query("COMMIT");
    return rows[0]!;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Count every month that is not final yet, from its days' address rows, and mark it final once it
 * has ended outside the newest three days with every day counted. A month whose days are not all
 * computed yet (a backfill mid-month) is left alone rather than counted short. Returns the months
 * counted.
 */
export async function finalizeTransparentMonths(
  pool: Pool,
  extent: { first: number; last: number },
  nowSec: number,
): Promise<number> {
  // Each month the daily table holds, with the days it holds and how many named any address: a day
  // can carry no address, and its absence from the address rows must not read as a missing day.
  const { rows } = await pool.query<{
    month: string;
    computed: number;
    with_addresses: number;
    stored_days: number;
    complete: boolean | null;
  }>(
    `SELECT EXTRACT(EPOCH FROM d.month)::bigint::text AS month, d.computed, d.with_addresses,
            COALESCE(a.stored_days, 0)::int AS stored_days, m.complete
       FROM (SELECT date_trunc('month', day)::date AS month, count(*)::int AS computed,
                    count(*) FILTER (WHERE active_addresses > 0)::int AS with_addresses
               FROM transparent_daily GROUP BY 1) d
       LEFT JOIN transparent_monthly m ON m.month = d.month
       LEFT JOIN (SELECT date_trunc('month', day)::date AS month, count(DISTINCT day) AS stored_days
                    FROM transparent_day_address GROUP BY 1) a ON a.month = d.month
      WHERE m.complete IS NOT TRUE`,
  );
  let counted = 0;
  for (const r of rows) {
    const month = Number(r.month);
    const end = nextMonth(month);
    const lo = Math.max(month, extent.first);
    const hi = Math.min(end, extent.last + DAY_SECONDS);
    const expected = Math.max(0, Math.round((hi - lo) / DAY_SECONDS));
    // Not every day computed, or a day's address rows missing: counting now would count short.
    if (r.computed < expected || r.stored_days < r.with_addresses) continue;
    const counts = await countAddresses(pool, month, end);
    // Final once the month has ended and its last day is outside the newest three, which a
    // recompute can still change.
    const complete = end <= extent.last - 2 * DAY_SECONDS;
    await pool.query(
      `INSERT INTO transparent_monthly (month, active_addresses, sending_addresses,
                                       receiving_addresses, days, complete, computed_at)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (month) DO UPDATE SET
         active_addresses = EXCLUDED.active_addresses,
         sending_addresses = EXCLUDED.sending_addresses,
         receiving_addresses = EXCLUDED.receiving_addresses, days = EXCLUDED.days,
         complete = EXCLUDED.complete, computed_at = EXCLUDED.computed_at`,
      [
        utcDayFromSeconds(month),
        counts.active,
        counts.sending,
        counts.receiving,
        r.computed,
        complete,
        nowSec,
      ],
    );
    counted += 1;
  }
  return counted;
}

/**
 * Delete the address rows of final months older than the retention window. Only a final month
 * loses rows (its count is stored), and never a day the trailing windows read.
 */
export async function pruneTransparentAddresses(pool: Pool, last: number): Promise<number> {
  const keepFrom = last - (ADDRESS_RETENTION_DAYS - 1) * DAY_SECONDS;
  const { rowCount } = await pool.query(
    `DELETE FROM transparent_day_address a
      USING transparent_monthly m
      WHERE m.complete AND a.day < $1::date
        AND a.day >= m.month AND a.day < (m.month + interval '1 month')::date`,
    [utcDayFromSeconds(keepFrom)],
  );
  return rowCount ?? 0;
}

/**
 * The trailing windows, counted exactly over complete UTC days ending yesterday: today is still
 * filling. A window reaching before the stored rows, or over a day not computed, is not counted.
 */
export async function countTrailingWindows(
  pool: Pool,
  extent: { first: number; last: number },
  nowSec: number,
): Promise<number> {
  const through = extent.last - DAY_SECONDS;
  // Address rows are contiguous from their oldest day: pruning only ever removes the oldest.
  const { rows } = await pool.query<{ lo: string | null }>(
    "SELECT EXTRACT(EPOCH FROM min(day))::bigint::text AS lo FROM transparent_day_address",
  );
  const storedFrom = rows[0]?.lo == null ? null : Number(rows[0].lo);
  let counted = 0;
  for (const days of TRAILING_WINDOWS) {
    const from = through - (days - 1) * DAY_SECONDS;
    if (from < extent.first || storedFrom === null || from < storedFrom) continue;
    const { rows: c } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM transparent_daily WHERE day >= $1::date AND day <= $2::date",
      [utcDayFromSeconds(from), utcDayFromSeconds(through)],
    );
    if (Number(c[0]!.n) < days) continue;
    const counts = await countAddresses(pool, from, through + DAY_SECONDS);
    await pool.query(
      `INSERT INTO transparent_trailing (days, last_day, active_addresses, sending_addresses,
                                        receiving_addresses, computed_at)
       VALUES ($1, $2::date, $3, $4, $5, $6)
       ON CONFLICT (days) DO UPDATE SET
         last_day = EXCLUDED.last_day, active_addresses = EXCLUDED.active_addresses,
         sending_addresses = EXCLUDED.sending_addresses,
         receiving_addresses = EXCLUDED.receiving_addresses, computed_at = EXCLUDED.computed_at`,
      [days, utcDayFromSeconds(through), counts.active, counts.sending, counts.receiving, nowSec],
    );
    counted += 1;
  }
  return counted;
}

// ------------------------------------------------------------------------------ reading

/** A month's distinct counts, as stored. `days` is how many of its days the count covers. */
export interface TransparentMonthRow {
  month: number;
  active: number;
  sending: number;
  receiving: number;
  days: number;
  complete: boolean;
}

/** A trailing window's distinct counts, through `lastDay`. */
export interface TransparentTrailingRow {
  days: number;
  lastDay: number;
  active: number;
  sending: number;
  receiving: number;
}

export interface TransparentSeries {
  days: TransparentDayRow[];
  months: TransparentMonthRow[];
  trailing: TransparentTrailingRow[];
}

/** Every stored row, oldest first (at most one per day), read into a memo. */
export async function loadTransparentSeries(pool: Pool): Promise<TransparentSeries> {
  const [days, months, trailing] = await Promise.all([
    pool.query<Record<string, string | number>>(
      `SELECT EXTRACT(EPOCH FROM day)::bigint AS day, outputs, unaddressed_outputs,
              out_transparent_zat::text AS out_t, out_mixed_zat::text AS out_m, inputs,
              unresolved_inputs, in_transparent_zat::text AS in_t, in_mixed_zat::text AS in_m,
              active_addresses, sending_addresses, receiving_addresses
         FROM transparent_daily ORDER BY day`,
    ),
    pool.query<Record<string, string | number | boolean>>(
      `SELECT EXTRACT(EPOCH FROM month)::bigint AS month, active_addresses, sending_addresses,
              receiving_addresses, days, complete
         FROM transparent_monthly ORDER BY month`,
    ),
    pool.query<Record<string, string | number>>(
      `SELECT days, EXTRACT(EPOCH FROM last_day)::bigint AS last_day, active_addresses,
              sending_addresses, receiving_addresses
         FROM transparent_trailing ORDER BY days`,
    ),
  ]);
  return {
    days: days.rows.map((r) => ({
      day: Number(r.day),
      outputs: Number(r.outputs),
      unaddressedOutputs: Number(r.unaddressed_outputs),
      outTransparentZat: Number(r.out_t),
      outMixedZat: Number(r.out_m),
      inputs: Number(r.inputs),
      unresolvedInputs: Number(r.unresolved_inputs),
      inTransparentZat: Number(r.in_t),
      inMixedZat: Number(r.in_m),
      active: Number(r.active_addresses),
      sending: Number(r.sending_addresses),
      receiving: Number(r.receiving_addresses),
    })),
    months: months.rows.map((r) => ({
      month: Number(r.month),
      active: Number(r.active_addresses),
      sending: Number(r.sending_addresses),
      receiving: Number(r.receiving_addresses),
      days: Number(r.days),
      complete: r.complete === true,
    })),
    trailing: trailing.rows.map((r) => ({
      days: Number(r.days),
      lastDay: Number(r.last_day),
      active: Number(r.active_addresses),
      sending: Number(r.sending_addresses),
      receiving: Number(r.receiving_addresses),
    })),
  };
}

// ------------------------------------------------------------------------------ tracker

export interface TransparentTrackerDeps {
  pool: Pool;
  /** A fresh pacer per pass, so a pass that aborted on a stall starts the next one clean. */
  pacer: () => Pacer;
  log: (m: string) => void;
  now?: () => number;
}

/**
 * Keeps the transparent tables current: on start, then every ten minutes. The first pass is the
 * backfill (every day of the chain, newest first, paced over hours); later passes recompute three
 * days. Its own tracker, separate from `PoolUsageTracker`, so a long pass never holds back the pool
 * and mining days. A stopped pass resumes from the days still missing; months and trailing windows
 * are counted as the pass crosses each month boundary, so recent months are answered first and
 * only a few months of address rows are held at once.
 */
export class TransparentTracker {
  #running = false;
  constructor(private readonly deps: TransparentTrackerDeps) {}

  async refresh(): Promise<{ computed: number; aborted: boolean }> {
    if (this.#running) return { computed: 0, aborted: false };
    this.#running = true;
    const now = this.deps.now ?? Date.now;
    const { pool } = this.deps;
    try {
      const nowSec = Math.floor(now() / 1000);
      const extent = await chainDayExtent(pool, nowSec);
      if (extent === null) return { computed: 0, aborted: false };
      const days = await transparentDaysToCompute(pool, extent.first, extent.last);
      const pacer = this.deps.pacer();
      if (days.length > 0) await pacer.preflight();
      // Count what the days computed so far complete, and drop what is no longer needed.
      const settle = async (): Promise<void> => {
        const at = Math.floor(now() / 1000);
        await finalizeTransparentMonths(pool, extent, at);
        await pruneTransparentAddresses(pool, extent.last);
        await countTrailingWindows(pool, extent, at);
      };
      let computed = 0;
      let month: number | null = null;
      for (const d of days) {
        // Past a month boundary: the month just walked is whole, so count it before going on.
        if (month !== null && monthOf(d) !== month) await settle();
        month = monthOf(d);
        const started = now();
        await computeTransparentDay(pool, d, Math.floor(now() / 1000));
        computed += 1;
        if ((await pacer.afterUnit(now() - started)) === "abort") {
          this.deps.log(`transparent: paused after ${computed} days, ingestion is behind`);
          return { computed, aborted: true };
        }
      }
      await settle();
      if (days.length > 3) this.deps.log(`transparent: computed ${computed} days`);
      return { computed, aborted: false };
    } finally {
      this.#running = false;
    }
  }

  start(intervalMs = 10 * 60 * 1000): () => void {
    const run = (): void => {
      void this.refresh().catch((e: unknown) => {
        this.deps.log(`transparent: pass failed, will retry — ${String(e)}`);
      });
    };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}

import type { PoolClient } from "pg";
import { ROLLUP_TABLES, type RollupTable } from "./definitions";
import { bindSelect, type RollupTargets } from "./targets";

/**
 * Recomputing rollup periods: the incremental pass over the dirty-period log, and the month-sized
 * chunks the full rebuild is made of.
 *
 * Every function here runs inside the caller's transaction, which `beginRollupTransaction` opens:
 * REPEATABLE READ, so the marks consumed and every period recomputed come from one snapshot, and
 * UTC, because the definitions truncate in the session's zone.
 */

type Query = Pick<PoolClient, "query">;

const DAY = 86_400;

export async function beginRollupTransaction(client: Query): Promise<void> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await client.query("SET LOCAL TimeZone = 'UTC'");

  // A month of fee percentiles sorts in memory instead of spilling. LOCAL: the connection returns
  // to a shared pool, and a raised ceiling must not outlive the transaction.
  await client.query("SET LOCAL work_mem = '256MB'");
}

/** The first second of the UTC month containing `ts`. */
export function monthStart(ts: number): number {
  const d = new Date(ts * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

/** The first second of the UTC month after the one starting at `start`. */
export function monthEnd(start: number): number {
  const d = new Date(start * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
}

/** Sorted UTC day starts → maximal runs of consecutive days, as `[lo, hi)` windows. */
export function dayIslands(days: readonly number[]): [number, number][] {
  const islands: [number, number][] = [];
  for (const day of [...days].sort((a, b) => a - b)) {
    const last = islands.at(-1);
    if (last !== undefined && day <= last[1]) last[1] = Math.max(last[1], day + DAY);
    else islands.push([day, day + DAY]);
  }
  return islands;
}

/** What one table cost in a pass. */
export interface TableWork {
  name: string;
  windows: number;
  deleted: number;
  inserted: number;
  ms: number;
}

export type WorkLog = Map<string, TableWork>;

function record(work: WorkLog, name: string, deleted: number, inserted: number, ms: number) {
  const entry = work.get(name) ?? { name, windows: 0, deleted: 0, inserted: 0, ms: 0 };
  entry.windows += 1;
  entry.deleted += deleted;
  entry.inserted += inserted;
  entry.ms += ms;
  work.set(name, entry);
}

function targetOf(table: RollupTable, targets: RollupTargets): string {
  const target = targets.get(table.name);
  if (target === undefined) throw new Error(`rollup ${table.name} has no target`);
  return target;
}

/** A period-keyed table's rows for every period in `[$1, $2)`. */
export const DELETE_WINDOW: Record<"ts" | "day", string> = {
  ts: "ts >= $1::bigint AND ts < $2::bigint",
  day: `day >= (to_timestamp($1::bigint) AT TIME ZONE 'UTC')::date
        AND day < (to_timestamp($2::bigint) AT TIME ZONE 'UTC')::date`,
};

/** Replace one table's rows for every period in `[lo, hi)` with their recomputation. */
async function recomputeWindow(
  client: Query,
  targets: RollupTargets,
  table: RollupTable,
  lo: number,
  hi: number,
  work: WorkLog,
): Promise<void> {
  if (table.key === null) throw new Error(`${table.name} has no period key`);
  const target = targetOf(table, targets);
  const started = Date.now();
  const deleted = await client.query(`DELETE FROM ${target} WHERE ${DELETE_WINDOW[table.key]}`, [
    lo,
    hi,
  ]);
  const inserted = await client.query(
    `INSERT INTO ${target} (${table.columns.join(", ")}) ${bindSelect(table.select, targets)}`,
    [lo, hi],
  );
  record(work, table.name, deleted.rowCount ?? 0, inserted.rowCount ?? 0, Date.now() - started);
}

/**
 * Recompute the given day windows of one month, then the month itself.
 *
 * Month tables are recomputed whenever any of their days was: two of them are derived from the day
 * tables, which this has just brought up to date.
 */
export async function recomputeMonth(
  client: Query,
  targets: RollupTargets,
  month: number,
  dayWindows: readonly [number, number][],
  work: WorkLog,
): Promise<void> {
  for (const table of ROLLUP_TABLES) {
    if (table.grain !== "day") continue;
    for (const [lo, hi] of dayWindows) await recomputeWindow(client, targets, table, lo, hi, work);
  }
  for (const table of ROLLUP_TABLES) {
    if (table.grain !== "month") continue;
    await recomputeWindow(client, targets, table, month, monthEnd(month), work);
  }
}

/** Rewrite the all-time tables from their day helpers: a few thousand rows. */
export async function recomputeTotals(
  client: Query,
  targets: RollupTargets,
  work: WorkLog,
): Promise<void> {
  for (const table of ROLLUP_TABLES) {
    if (table.grain !== "all") continue;
    const target = targetOf(table, targets);
    const started = Date.now();
    const deleted = await client.query(`DELETE FROM ${target}`);
    const inserted = await client.query(
      `INSERT INTO ${target} (${table.columns.join(", ")}) ${bindSelect(table.select, targets)}`,
    );
    record(work, table.name, deleted.rowCount ?? 0, inserted.rowCount ?? 0, Date.now() - started);
  }
}

export interface MarksPass {
  /** Touched days recomputed, and the months they fell in. */
  days: number;
  months: number;
  /** Months left for a later pass because the budget ran out; their marks were put back. */
  deferredMonths: number;
  work: WorkLog;
}

/**
 * Consume the dirty-period log and recompute what it names.
 *
 * `DELETE ... RETURNING` under REPEATABLE READ removes exactly the marks this snapshot can see; a
 * mark committed after it is invisible to the DELETE and stays for the next pass. Marks are mapped
 * to UTC days with the same `date_trunc` the definitions use.
 *
 * Months are processed newest first, so a backlog (a repair that marked all history) never holds
 * up the open day, until `budgetMs` is spent; at least one month is always processed. The days of
 * the months not reached are marked again in this same transaction, so nothing is lost.
 */
export async function applyMarks(
  client: Query,
  targets: RollupTargets,
  budgetMs: number,
): Promise<MarksPass> {
  const started = Date.now();
  const { rows } = await client.query<{ day: string }>(
    `WITH marks AS (DELETE FROM chain_rollup_dirty RETURNING ts_lo, ts_hi)
     SELECT DISTINCT EXTRACT(EPOCH FROM d)::bigint AS day
       FROM marks,
            generate_series(date_trunc('day', to_timestamp(ts_lo)),
                            date_trunc('day', to_timestamp(ts_hi)),
                            interval '1 day') AS d`,
  );
  const byMonth = new Map<number, number[]>();
  for (const { day } of rows) {
    const d = Number(day);
    const m = monthStart(d);
    const list = byMonth.get(m);
    if (list === undefined) byMonth.set(m, [d]);
    else list.push(d);
  }
  const months = [...byMonth.keys()].sort((a, b) => b - a);
  const work: WorkLog = new Map();
  let done = 0;
  let days = 0;
  for (const month of months) {
    if (done > 0 && Date.now() - started > budgetMs) break;
    const monthDays = byMonth.get(month) ?? [];
    await recomputeMonth(client, targets, month, dayIslands(monthDays), work);
    days += monthDays.length;
    done += 1;
  }
  const deferred = months.slice(done);
  if (deferred.length > 0) {
    const islands = deferred.flatMap((m) => dayIslands(byMonth.get(m) ?? []));
    await client.query(
      `INSERT INTO chain_rollup_dirty (ts_lo, ts_hi)
       SELECT lo, hi - 1 FROM unnest($1::bigint[], $2::bigint[]) AS i(lo, hi)`,
      [islands.map((i) => i[0]), islands.map((i) => i[1])],
    );
  }
  if (done > 0) await recomputeTotals(client, targets, work);
  return { days, months: done, deferredMonths: deferred.length, work };
}

/** One line per pass: what it covered and what each table cost, the slowest first. */
export function describeWork(work: WorkLog): string {
  return [...work.values()]
    .sort((a, b) => b.ms - a.ms)
    .map((w) => `${w.name} ${w.ms}ms -${w.deleted}+${w.inserted}`)
    .join(", ");
}

/** Total rows written by a pass. */
export function rowsWritten(work: WorkLog): number {
  let rows = 0;
  for (const w of work.values()) rows += w.inserted;
  return rows;
}

/** The earliest and latest timestamp any rollup source row carries, or null on an empty chain. */
export async function sourceExtent(client: Query): Promise<{ lo: number; hi: number } | null> {
  const { rows } = await client.query<{ lo: string | null; hi: string | null }>(
    `SELECT LEAST((SELECT min(timestamp) FROM block), (SELECT min(timestamp) FROM tx)) AS lo,
            GREATEST((SELECT max(timestamp) FROM block), (SELECT max(timestamp) FROM tx)) AS hi`,
  );
  const row = rows[0];
  if (row?.lo == null || row.hi == null) return null;
  return { lo: Number(row.lo), hi: Number(row.hi) };
}

/** Recompute one whole month of every table, then the totals: a chunk of the full rebuild. */
export async function recomputeWholeMonth(
  client: Query,
  targets: RollupTargets,
  month: number,
  work: WorkLog,
): Promise<void> {
  await recomputeMonth(client, targets, month, [[month, monthEnd(month)]], work);
  await recomputeTotals(client, targets, work);
}

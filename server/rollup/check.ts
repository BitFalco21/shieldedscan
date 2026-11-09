import type { Pool, PoolClient } from "pg";
import { ROLLUP_TABLES, type RollupTable } from "./definitions";
import { diffRows, identical, periodStartSql, type RowDiff } from "./compare";
import { applyMarks, beginRollupTransaction, DELETE_WINDOW, monthEnd } from "./pass";
import { ROLLUP_PASS_LOCK, withSessionLock } from "./lock";
import { markedDays, MAX_CATCH_UP_DAYS } from "./marks";
import { bindSelect, nextName, resolveTargets } from "./targets";

/**
 * Proof that each rollup table equals the materialized view it replaces; it never writes.
 *
 * Before the swap it compares `<name>_next` with the view `<name>`; after it, the table `<name>`
 * with the retired view `<name>_old`. Each table is read in its own REPEATABLE READ, READ ONLY
 * transaction, under UTC like the pass.
 *
 * A view is only as fresh as its last refresh, so its newest periods may differ because it is
 * behind. Such a period passes only if it ends within `BEHIND_SECONDS` of the newest period the
 * view holds (the open period and, for a month table, the one before it) AND the table's rows
 * for it equal its definition recomputed in the same snapshot. Any
 * older difference fails: a recompute agreeing with the table proves only that the table matches
 * its own definition, not the view's. The all-time tables have no periods: without `live`, a
 * difference there is unverified, never a pass. With `live`, each table is first caught up to
 * its snapshot by applying the pending marks in a read-write transaction under the rollup lock,
 * then compared with its view's own definition (`pg_get_viewdef`) in that snapshot, then rolled
 * back: equality proven outright on a moving chain, at the cost of a full scan per view, while
 * the follower's pass skips (and retries) for as long as one table holds the lock. It refuses a
 * backlog over `MAX_CATCH_UP_DAYS`, as the swap does.
 */

export type Verdict = "PASS" | "FAIL" | "UNVERIFIED";

export interface CheckResult {
  table: string;
  view: string;
  verdict: Verdict;
  detail: string;
  ms: number;
}

/** How far behind its own newest period a view's rows may be explained by its refresh lag. */
const BEHIND_SECONDS = 2 * 86_400;

interface Pair {
  table: string;
  view: string;
}

/** Which table to hold to which view, and which relation holds each rollup's rows. */
export async function checkPairs(
  pool: Pool,
): Promise<{ pairs: Map<string, Pair>; targets: Map<string, string> }> {
  const { rows } = await pool.query<{
    name: string;
    kind: string | null;
    next: string | null;
    old: string | null;
  }>(
    `SELECT n.name,
            (SELECT relkind FROM pg_class WHERE oid = to_regclass(n.name))::text AS kind,
            (SELECT relkind FROM pg_class WHERE oid = to_regclass(n.name || '_next'))::text AS next,
            (SELECT relkind FROM pg_class WHERE oid = to_regclass(n.name || '_old'))::text AS old
       FROM unnest($1::text[]) AS n(name)`,
    [ROLLUP_TABLES.map((t) => t.name)],
  );
  const pairs = new Map<string, Pair>();
  const targets = new Map<string, string>();
  for (const r of rows) {
    if (r.kind === "m" && r.next === "r") {
      pairs.set(r.name, { table: nextName(r.name), view: r.name });
      targets.set(r.name, nextName(r.name));
    } else if (r.kind === "r") {
      targets.set(r.name, r.name);
      if (r.old === "m") pairs.set(r.name, { table: r.name, view: `${r.name}_old` });
    }
  }
  return { pairs, targets };
}

const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

const describe = (d: RowDiff) =>
  `${d.onlyLeft} row(s) only in the table, ${d.onlyRight} only in the view` +
  (d.inexact > 0 ? `, ${d.inexact} equal within 1e-12 but not bit-equal` : "");

async function readOnly<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TimeZone = 'UTC'");
    await client.query("SET LOCAL work_mem = '256MB'");
    return await work(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/**
 * The live comparison, on a chain that keeps moving: the table is first brought up to the
 * snapshot by applying every pending mark inside this transaction, as the swap does, then compared
 * with the view's own definition evaluated in the same snapshot, then ROLLED BACK — nothing is
 * written. Without the catch-up, every block since the follower's last pass reads as a difference.
 * Holds the rollup lock, so the follower's pass waits (and retries) while one table is compared.
 */
async function checkLive(
  pool: Pool,
  table: RollupTable,
  pair: Pair,
): Promise<{ verdict: Verdict; detail: string }> {
  const days = await markedDays(pool);
  if (days > MAX_CATCH_UP_DAYS) {
    return {
      verdict: "UNVERIFIED",
      detail: `${days} marked days wait; let the follower's passes drain them before a live check`,
    };
  }
  const outcome = await withSessionLock(pool, ROLLUP_PASS_LOCK, { wait: true }, async (client) => {
    await beginRollupTransaction(client);
    try {
      const resolution = await resolveTargets(client);
      if (!resolution.ok) {
        return { verdict: "FAIL" as const, detail: "the rollup tables could not be resolved" };
      }
      await applyMarks(client, resolution.targets, Number.POSITIVE_INFINITY);
      const { rows } = await client.query<{ def: string }>(
        "SELECT pg_get_viewdef(to_regclass($1)) AS def",
        [pair.view],
      );
      const def = (rows[0]?.def ?? "").trim().replace(/;$/, "");
      const d = await diffRows(client, table, pair.table, `(${def})`);
      return identical(d)
        ? {
            verdict: "PASS" as const,
            detail: `equal to the view's definition evaluated now, pending marks applied and rolled back (${describe(d)})`,
          }
        : {
            verdict: "FAIL" as const,
            detail: `differs from the definition evaluated now, pending marks applied: ${describe(d)}`,
          };
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
    }
  });
  return outcome ?? { verdict: "FAIL", detail: "could not take the rollup lock" };
}

export async function checkTable(
  pool: Pool,
  table: RollupTable,
  pair: Pair,
  targets: ReadonlyMap<string, string>,
  live: boolean,
): Promise<{ verdict: Verdict; detail: string }> {
  if (live) return checkLive(pool, table, pair);
  return readOnly(pool, async (client) => {
    const d = await diffRows(client, table, pair.table, pair.view);
    if (identical(d)) return { verdict: "PASS", detail: `equal to the view (${describe(d)})` };
    if (table.key === null) {
      return {
        verdict: "UNVERIFIED",
        detail: `differs from the view (${describe(d)}); no period to recompute — run with --live`,
      };
    }
    const { rows: newest } = await client.query<{ start: string | null }>(
      `SELECT max(${periodStartSql(table)}) AS start FROM ${pair.view}`,
    );
    const horizon = newest[0]?.start == null ? null : Number(newest[0].start) - BEHIND_SECONDS;
    const periodEnd = (start: number) =>
      table.grain === "month" ? monthEnd(start) : start + 86_400;
    const older = d.periods.filter((p) => horizon === null || periodEnd(p) <= horizon);
    if (older.length > 0) {
      return {
        verdict: "FAIL",
        detail:
          `${older.length} period(s) older than the view's last refresh differ, e.g. ` +
          `${older.slice(0, 5).map(day).join(" ")} (${describe(d)})`,
      };
    }
    const select = bindSelect(table.select, targets);
    const held = `(SELECT * FROM ${pair.table} WHERE ${DELETE_WINDOW[table.key]})`;
    const wrong: string[] = [];
    for (const start of d.periods) {
      const now = await diffRows(client, table, held, `(${select})`, [start, periodEnd(start)]);
      if (!identical(now)) wrong.push(day(start));
    }
    const label = d.periods.map(day).join(" ");
    return wrong.length === 0
      ? {
          verdict: "PASS",
          detail: `${label} differ from the view and equal their recompute now (the view is behind)`,
        }
      : { verdict: "FAIL", detail: `${wrong.join(" ")} differ from the view and from a recompute` };
  });
}

/** Every rollup that replaced a view, checked in definition order. `between` may pace or stop. */
export async function checkRollups(
  pool: Pool,
  options: { live?: boolean; between?: (ms: number) => Promise<boolean> } = {},
): Promise<CheckResult[]> {
  const { pairs, targets } = await checkPairs(pool);
  const results: CheckResult[] = [];
  for (const table of ROLLUP_TABLES) {
    const pair = pairs.get(table.name);
    if (!table.replacesView || pair === undefined) continue;
    const started = Date.now();
    const outcome = await checkTable(pool, table, pair, targets, options.live ?? false);
    const ms = Date.now() - started;
    results.push({ ...pair, ...outcome, ms });
    if (options.between !== undefined && !(await options.between(ms))) break;
  }
  return results;
}

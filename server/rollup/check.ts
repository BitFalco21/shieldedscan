import type { Pool, PoolClient } from "pg";
import { ROLLUP_TABLES, type RollupTable } from "./definitions";
import { diffRows, identical, type RowDiff } from "./compare";
import { DELETE_WINDOW, monthEnd } from "./pass";
import { bindSelect, nextName } from "./targets";

/**
 * Read-only proof that each rollup table equals the materialized view it replaces.
 *
 * Before the swap it compares `<name>_next` with the view `<name>`; after it, the table `<name>`
 * with the retired view `<name>_old`. Each table is read in its own REPEATABLE READ, READ ONLY
 * transaction, under UTC like the pass.
 *
 * A view is only as fresh as its last refresh, so a period may differ because the view is behind.
 * Such a period passes only if the table's rows for it equal its definition recomputed in the same
 * snapshot. The all-time tables have no periods: without `live`, a difference there is reported
 * as unverified, never as a pass. With `live`, each view's own definition (`pg_get_viewdef`) is
 * evaluated in the table's snapshot, which proves equality outright at the cost of a full scan.
 */

export type Verdict = "PASS" | "FAIL" | "UNVERIFIED";

export interface CheckResult {
  table: string;
  view: string;
  verdict: Verdict;
  detail: string;
  ms: number;
}

/** Differing periods beyond this are not a view being behind; they fail without a recompute. */
const MAX_BEHIND_PERIODS = 60;

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

export async function checkTable(
  pool: Pool,
  table: RollupTable,
  pair: Pair,
  targets: ReadonlyMap<string, string>,
  live: boolean,
): Promise<{ verdict: Verdict; detail: string }> {
  return readOnly(pool, async (client) => {
    if (live) {
      const { rows } = await client.query<{ def: string }>(
        "SELECT pg_get_viewdef(to_regclass($1)) AS def",
        [pair.view],
      );
      const def = (rows[0]?.def ?? "").trim().replace(/;$/, "");
      const d = await diffRows(client, table, pair.table, `(${def})`);
      return identical(d)
        ? {
            verdict: "PASS",
            detail: `equal to the view's definition evaluated now (${describe(d)})`,
          }
        : { verdict: "FAIL", detail: `differs from the definition evaluated now: ${describe(d)}` };
    }

    const d = await diffRows(client, table, pair.table, pair.view);
    if (identical(d)) return { verdict: "PASS", detail: `equal to the view (${describe(d)})` };
    if (table.key === null) {
      return {
        verdict: "UNVERIFIED",
        detail: `differs from the view (${describe(d)}); no period to recompute — run with --live`,
      };
    }
    if (d.periods.length > MAX_BEHIND_PERIODS) {
      return { verdict: "FAIL", detail: `${d.periods.length} periods differ (${describe(d)})` };
    }
    const select = bindSelect(table.select, targets);
    const held = `(SELECT * FROM ${pair.table} WHERE ${DELETE_WINDOW[table.key]})`;
    const wrong: string[] = [];
    for (const start of d.periods) {
      const end = table.grain === "month" ? monthEnd(start) : start + 86_400;
      const now = await diffRows(client, table, held, `(${select})`, [start, end]);
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

import type { Pool, PoolClient } from "pg";
import { rollbackQuietly } from "../pg-pool";
import { ROLLUP_VIEW_NAMES } from "./definitions";
import { MATVIEW_REFRESH_LOCK, ROLLUP_PASS_LOCK, withSessionLock } from "./lock";
import { applyMarks, beginRollupTransaction } from "./pass";
import { nextName, resolveTargets } from "./targets";

/**
 * Put the rollup tables in the materialized views' place (each view `<name>` becomes
 * `<name>_old`, each table `<name>_next` becomes `<name>`), or, with `revert`, put the views back.
 *
 * Readers keep their SQL: after the swap the same names are tables. One transaction for all of
 * them, so readers see either every view or every table.
 *
 *  - It takes the view-refresh lock exclusively, so it waits for an in-flight `REFRESH` instead of
 *    queueing behind it with every reader of that view queued behind the rename, and no new refresh
 *    starts; then the rollup lock, so no pass or fill chunk runs during it.
 *  - `lock_timeout` bounds each rename's wait for in-flight reads; on a timeout the transaction
 *    rolls back and is retried.
 *  - A view reading these relations (the open-data views) is bound to a relation, not a name, so
 *    each is recreated from its own printed definition after the renames and reads the new one.
 *  - Nothing here touches `tx` or `block`.
 *
 * It does not judge equality: `check-rollups` does, before it.
 */

export const oldName = (name: string) => `${name}_old`;

type Query = Pick<PoolClient, "query">;
type Log = (line: string) => void;

interface Dependent {
  view: string;
  kind: string;
  options: string[] | null;
  owned: boolean;
  def: string;
}

/** Every view reading one of `relations`, with the definition that rebinds it by name. */
async function dependents(client: Query, relations: readonly string[]): Promise<Dependent[]> {
  const { rows } = await client.query<Dependent>(
    `SELECT DISTINCT v.oid::regclass::text AS view, v.relkind::text AS kind,
            v.reloptions AS options, pg_has_role(v.relowner, 'MEMBER') AS owned,
            pg_get_viewdef(v.oid) AS def
       FROM pg_depend d
       JOIN pg_rewrite w ON w.oid = d.objid
       JOIN pg_class v ON v.oid = w.ev_class
      WHERE d.classid = 'pg_rewrite'::regclass
        AND d.refclassid = 'pg_class'::regclass
        AND d.refobjid = ANY(SELECT to_regclass(n) FROM unnest($1::text[]) AS n)
        AND v.oid <> d.refobjid`,
    [[...relations]],
  );
  return rows;
}

/** For each name: the relation holding it now, the one set aside, and the name that must be free. */
function plan(revert: boolean) {
  return ROLLUP_VIEW_NAMES.map((name) =>
    revert
      ? { name, holder: "r", aside: oldName(name), asideKind: "m", free: nextName(name) }
      : { name, holder: "m", aside: nextName(name), asideKind: "r", free: oldName(name) },
  );
}

/** Refuse before taking any lock: wrong state, a relation this role does not own, an odd reader. */
async function preflight(pool: Pool, revert: boolean): Promise<void> {
  const steps = plan(revert);
  const names = steps.flatMap((s) => [s.name, s.aside, s.free]);
  const { rows } = await pool.query<{ name: string; kind: string | null; owned: boolean | null }>(
    `SELECT n AS name, c.relkind::text AS kind, pg_has_role(c.relowner, 'MEMBER') AS owned
       FROM unnest($1::text[]) AS n
       LEFT JOIN pg_class c ON c.oid = to_regclass(n)`,
    [names],
  );
  const at = new Map(rows.map((r) => [r.name, r]));
  const problems: string[] = [];
  for (const s of steps) {
    for (const [rel, kind] of [
      [s.name, s.holder],
      [s.aside, s.asideKind],
    ] as const) {
      const found = at.get(rel);
      if (found?.kind !== kind) {
        problems.push(`${rel} is ${found?.kind ?? "absent"}, expected relkind ${kind}`);
      } else if (found.owned !== true) problems.push(`${rel} is not owned by this role`);
    }
    if (at.get(s.free)?.kind != null) problems.push(`${s.free} already exists`);
  }
  for (const d of await dependents(pool, ROLLUP_VIEW_NAMES)) {
    if (d.kind !== "v") problems.push(`${d.view} (relkind ${d.kind}) reads a rollup`);
    else if (d.options !== null) problems.push(`${d.view} has options a rebind would drop`);
    else if (!d.owned) problems.push(`${d.view} is not owned by this role`);
  }
  if (problems.length > 0) throw new Error(`refusing to swap:\n  ${problems.join("\n  ")}`);
}

async function swapOnce(client: PoolClient, revert: boolean, log: Log): Promise<void> {
  await beginRollupTransaction(client);
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    if (!revert) {
      // Bring the tables up to the moment of the swap, so readers lose no freshness.
      const resolution = await resolveTargets(client);
      if (!resolution.ok || !resolution.staged) throw new Error("the tables are not staged");
      const pass = await applyMarks(client, resolution.targets, Number.POSITIVE_INFINITY);
      log(`caught up ${pass.days} marked day(s) before the swap`);
    }
    const views = await dependents(client, ROLLUP_VIEW_NAMES);
    for (const { name, aside } of plan(revert)) {
      if (revert) {
        await client.query(`ALTER TABLE ${name} RENAME TO ${nextName(name)}`);
        await client.query(`ALTER INDEX ${name}_pkey RENAME TO ${nextName(name)}_pkey`);
        await client.query(`ALTER MATERIALIZED VIEW ${aside} RENAME TO ${name}`);
      } else {
        await client.query(`ALTER MATERIALIZED VIEW ${name} RENAME TO ${oldName(name)}`);
        await client.query(`ALTER TABLE ${aside} RENAME TO ${name}`);
        await client.query(`ALTER INDEX ${aside}_pkey RENAME TO ${name}_pkey`);
      }
    }
    // Each definition was printed with the names it read, so replaying it binds the new relation.
    for (const v of views) await client.query(`CREATE OR REPLACE VIEW ${v.view} AS ${v.def}`);
    const left = await dependents(client, ROLLUP_VIEW_NAMES.map(revert ? nextName : oldName));
    if (left.length > 0) {
      throw new Error(`still reading the retired relations: ${left.map((d) => d.view).join(", ")}`);
    }
    await client.query("COMMIT");
    log(
      `${revert ? "reverted" : "swapped"} ${ROLLUP_VIEW_NAMES.length} rollups; ` +
        `rebound ${views.length} view(s)`,
    );
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

export async function swapRollups(
  pool: Pool,
  options: { revert?: boolean; log?: Log; attempts?: number; retryMs?: number } = {},
): Promise<void> {
  const revert = options.revert ?? false;
  const log = options.log ?? (() => {});
  const attempts = options.attempts ?? 6;
  await preflight(pool, revert);
  log("waiting for any view refresh to finish, then for the rollup lock");
  await withSessionLock(pool, MATVIEW_REFRESH_LOCK, { wait: true }, () =>
    withSessionLock(pool, ROLLUP_PASS_LOCK, { wait: true }, async (client) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await swapOnce(client, revert, log);
          return;
        } catch (error) {
          // 55P03: a rename waited longer than lock_timeout behind in-flight reads.
          const code = (error as { code?: unknown }).code;
          if (code !== "55P03" || attempt >= attempts) throw error;
          log(`attempt ${attempt}: a lock was busy; retrying`);
          await new Promise((resolve) => setTimeout(resolve, options.retryMs ?? 5_000));
        }
      }
    }),
  );
}

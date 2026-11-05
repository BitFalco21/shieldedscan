import type { PoolClient } from "pg";
import { ROLLUP_TABLES } from "./definitions";

/**
 * Which relation holds each rollup right now.
 *
 * A fresh database creates every rollup as a table under its own name. A database that had the
 * materialized views keeps them under those names until the swap (`swap-rollups-main.ts`), with
 * the table beside each as `<name>_next`, which the pass maintains and the readers do not see.
 */
export type RollupTargets = ReadonlyMap<string, string>;

/** The staging name of a rollup table while a view still holds its name. */
export const nextName = (name: string) => `${name}_next`;

export type TargetResolution =
  { ok: true; targets: RollupTargets; staged: boolean } | { ok: false; missing: string[] };

export async function resolveTargets(client: Pick<PoolClient, "query">): Promise<TargetResolution> {
  const names = ROLLUP_TABLES.map((t) => t.name);
  const { rows } = await client.query<{
    name: string;
    kind: string | null;
    next_kind: string | null;
  }>(
    `SELECT n.name,
            (SELECT relkind FROM pg_class WHERE oid = to_regclass(n.name))::text AS kind,
            (SELECT relkind FROM pg_class WHERE oid = to_regclass(n.name || '_next'))::text
              AS next_kind
       FROM unnest($1::text[]) AS n(name)`,
    [names],
  );
  const targets = new Map<string, string>();
  const missing: string[] = [];
  let staged = false;
  for (const row of rows) {
    if (row.kind === "r") targets.set(row.name, row.name);
    else if (row.kind === "m" && row.next_kind === "r") {
      targets.set(row.name, nextName(row.name));
      staged = true;
    } else missing.push(row.name);
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, targets, staged };
}

/** A rollup's SELECT with each `{dependency}` replaced by the relation that holds it. */
export function bindSelect(select: string, targets: RollupTargets): string {
  return select.replace(/\{([a-z_]+)\}/g, (_, name: string) => {
    const target = targets.get(name);
    if (target === undefined) throw new Error(`rollup dependency ${name} has no target`);
    return target;
  });
}

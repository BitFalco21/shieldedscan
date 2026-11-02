import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import type { Pool } from "pg";
import { copyInto } from "./copy";
import { fetchVerified } from "./download";
import type { ImportPlan, ImportUnit } from "./plan";
import type { ReleaseSource } from "./source";
import { importedUnits } from "./state";
import { unitRows } from "./units";

/**
 * The load: every unit not yet imported, downloaded and verified, then copied into its table in
 * one transaction with its marker. `jobs` units run at once, so one unit's download overlaps
 * another's COPY. A unit that fails rolls back whole and is retried by the next run.
 */

export interface LoadOptions {
  pool: Pool;
  plan: ImportPlan;
  source: ReleaseSource;
  commit: string;
  dataDir: string;
  jobs: number;
  /** Keep each downloaded file after its unit is in; by default it is deleted to save disk. */
  keepFiles: boolean;
  nowSec: number;
  log: (line: string) => void;
}

/** The marker's hash: every file of the unit, so a unit is never mistaken for another release's. */
export const unitSha = (u: ImportUnit) =>
  createHash("sha256")
    .update(u.files.map((f) => f.sha256).join(","))
    .digest("hex");

async function loadUnit(o: LoadOptions, unit: ImportUnit): Promise<number> {
  const paths: string[] = [];
  for (const f of unit.files) {
    paths.push(await fetchVerified(o.source, o.commit, f, o.dataDir, o.log));
  }
  const rows = unitRows(unit, paths, o.nowSec);
  const client = await o.pool.connect();
  try {
    await client.query("BEGIN");
    // A crash loses at most the units in flight, which their markers would not record anyway.
    await client.query("SET LOCAL synchronous_commit = off");
    const copied = await copyInto(client, rows.table, rows.columns, rows.lines);
    const expected = unit.files[0]!.rows;
    if (copied !== expected) {
      throw new Error(`${unit.key}: copied ${copied} rows, the manifest says ${expected}`);
    }
    await client.query(
      `INSERT INTO selfhost_import_file (path, sha256, rows, imported_at)
       VALUES ($1, $2, $3, EXTRACT(EPOCH FROM now())::bigint)`,
      [unit.key, unitSha(unit), copied],
    );
    await client.query("COMMIT");
    return copied;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
    if (!o.keepFiles) for (const p of paths) rmSync(p, { force: true });
  }
}

export async function loadUnits(o: LoadOptions): Promise<void> {
  const done = await importedUnits(o.pool);
  for (const u of o.plan.units) {
    const sha = done.get(u.key);
    if (sha !== undefined && sha !== unitSha(u)) {
      throw new Error(`${u.key} was imported from different files; start from an empty database`);
    }
  }
  const todo = o.plan.units.filter((u) => !done.has(u.key));
  o.log(`load: ${todo.length} of ${o.plan.units.length} units to import, ${o.jobs} at a time`);
  const started = Date.now();
  let next = 0;
  let finished = 0;
  let rows = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (failure === null && next < todo.length) {
      const unit = todo[next++]!;
      try {
        // Awaited before the sum: `rows += await` would read `rows` before another unit adds to it.
        const copied = await loadUnit(o, unit);
        rows += copied;
        finished++;
        const min = (Date.now() - started) / 60_000;
        o.log(`  ${unit.key} (${finished}/${todo.length}, ${rows} rows, ${min.toFixed(1)} min)`);
      } catch (e) {
        failure ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.jobs) }, worker));
  if (failure !== null) throw failure instanceof Error ? failure : new Error(String(failure));
}

import type { Pool } from "pg";

/**
 * The three large tables are loaded bare and indexed afterwards: a b-tree built once from sorted
 * input is several times faster than one grown row by row, and a primary key on a hash (`txid`)
 * grown row by row turns every insert into a random page write once the index outgrows memory.
 *
 * Each constraint and index is read from the catalogue as Postgres itself prints it and kept in
 * `selfhost_import_ddl` before it is dropped, so the rebuild restores exactly the schema files'
 * definitions, and a crash between the two loses nothing.
 */

export const LOAD_TABLES = ["block", "tx", "tx_transparent_io"] as const;

export async function deferIndexes(pool: Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Captured once: on a retry the saved definitions stand, and whatever of them exists again
    // (the schema re-applied by a run that stopped before its first unit) is dropped again.
    const saved = await client.query("SELECT 1 FROM selfhost_import_ddl LIMIT 1");
    if (saved.rows.length === 0) {
      // Primary and unique keys, then the foreign keys that depend on them, then plain indexes:
      // the order they are rebuilt in. Dropped in reverse.
      const { rows } = await client.query<{ tbl: string; name: string; kind: string; def: string }>(
        `SELECT conrelid::regclass::text AS tbl, conname AS name,
                CASE contype WHEN 'f' THEN 'foreign' ELSE 'constraint' END AS kind,
                pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conrelid = ANY($1::regclass[]) AND contype IN ('p', 'u', 'f')
         UNION ALL
         SELECT i.indrelid::regclass::text, c.relname, 'index', pg_get_indexdef(i.indexrelid)
           FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = ANY($1::regclass[])
            AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)
          ORDER BY 3, 1, 2`,
        [LOAD_TABLES],
      );
      const order = { constraint: 0, foreign: 1, index: 2 } as const;
      rows.sort(
        (a, b) => order[a.kind as keyof typeof order] - order[b.kind as keyof typeof order],
      );
      for (const [seq, r] of rows.entries()) {
        await client.query(
          "INSERT INTO selfhost_import_ddl (seq, tbl, name, kind, def) VALUES ($1, $2, $3, $4, $5)",
          [seq, r.tbl, r.name, r.kind, r.def],
        );
      }
    }
    const { rows } = await client.query<{ tbl: string; name: string; kind: string }>(
      "SELECT tbl, name, kind FROM selfhost_import_ddl ORDER BY seq DESC",
    );
    for (const r of rows) {
      await client.query(
        r.kind === "index"
          ? `DROP INDEX IF EXISTS ${quote(r.name)}`
          : `ALTER TABLE ${quote(r.tbl)} DROP CONSTRAINT IF EXISTS ${quote(r.name)}`,
      );
    }
    await client.query("COMMIT");
    return rows.length;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Rebuilds what `deferIndexes` dropped, in its order, each one skipped if it already exists, so a
 * rebuild interrupted midway resumes. Foreign keys are validated in full: that proves every
 * transaction's block and every ledger row's transaction were imported.
 */
export async function restoreIndexes(
  pool: Pool,
  maintenanceWorkMem: string,
  log: (line: string) => void,
): Promise<void> {
  const { rows } = await pool.query<{
    seq: number;
    tbl: string;
    name: string;
    kind: string;
    def: string;
  }>("SELECT seq, tbl, name, kind, def FROM selfhost_import_ddl ORDER BY seq");
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('maintenance_work_mem', $1, false)", [
      maintenanceWorkMem,
    ]);
    for (const r of rows) {
      const exists =
        r.kind === "index"
          ? await client.query("SELECT 1 FROM pg_class WHERE relname = $1 AND relkind = 'i'", [
              r.name,
            ])
          : await client.query(
              "SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass",
              [r.name, r.tbl],
            );
      if (exists.rows.length > 0) continue;
      const started = Date.now();
      await client.query(
        r.kind === "index"
          ? r.def
          : `ALTER TABLE ${quote(r.tbl)} ADD CONSTRAINT ${quote(r.name)} ${r.def}`,
      );
      log(`  ${r.name} on ${r.tbl} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
  } finally {
    await client.query("RESET maintenance_work_mem").catch(() => undefined);
    client.release();
  }
  await pool.query("DELETE FROM selfhost_import_ddl");
}

const quote = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

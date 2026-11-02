import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import type { Manifest } from "../opendata/manifest";
import { deferIndexes, restoreIndexes } from "./ddl";
import { deriveTables } from "./derive";
import { loadUnits } from "./load";
import { planImport } from "./plan";
import { readManifest } from "./release";
import type { ReleaseSource } from "./source";
import { STATE_DDL, once, readImport } from "./state";
import { ADDRESS_SNAPSHOT_TABLE } from "./units";
import { verifyImport } from "./verify";

/**
 * One release into one database, in steps that each resume where a stopped run left them:
 *
 *  1. on an empty database, the repo's schema, then the three large tables' keys and indexes
 *     dropped (`ddl.ts`);
 *  2. every file downloaded, checked against the manifest and copied in (`load.ts`);
 *  3. keys and indexes rebuilt, the schema re-applied, ANALYZE;
 *  4. the derived tables rebuilt by their production functions (`derive.ts`);
 *  5. the follower's resume point set to the release block, so a follower given a node continues
 *     at N + 1;
 *  6. the database held to the release (`verify.ts`).
 */

/** Applied in this order on a new database, as the test suites and the services apply them. */
export const SCHEMA_FILES = ["schema-chain.sql", "schema.sql", "schema-net.sql"] as const;

export interface ImportOptions {
  pool: Pool;
  source: ReleaseSource;
  repo: string;
  /** A branch, tag or commit; resolved once, then every file is read at that commit. */
  revision: string;
  dataDir: string;
  /** Where the schema files are: next to the bundle in the image, `server/` in the repo. */
  schemaDir: string;
  jobs: number;
  keepFiles: boolean;
  maintenanceWorkMem: string;
  log: (line: string) => void;
  now?: () => number;
}

export interface ImportResult {
  manifest: Manifest;
  commit: string;
  failures: string[];
}

async function applySchema(pool: Pool, dir: string): Promise<void> {
  for (const f of SCHEMA_FILES) await pool.query(readFileSync(join(dir, f), "utf8"));
}

/** Refuses a database that holds blocks the importer did not put there. */
async function requireEmpty(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ t: string | null }>("SELECT to_regclass('block')::text AS t");
  if (rows[0]?.t === null) return;
  const n = await pool.query("SELECT 1 FROM block LIMIT 1");
  if (n.rows.length > 0) {
    throw new Error("this database already holds blocks; import into an empty database");
  }
}

export async function runImport(o: ImportOptions): Promise<ImportResult> {
  const { pool, log } = o;
  const nowSec = () => Math.floor((o.now ?? Date.now)() / 1000);
  const existing = await readImport(pool);
  let commit: string;
  if (existing) {
    // A branch name has moved on since; only a different pinned commit is a different release.
    if (/^[0-9a-f]{40}$/.test(o.revision) && o.revision !== existing.commit) {
      throw new Error(`this database holds release ${existing.commit}, not ${o.revision}`);
    }
    commit = existing.commit;
    log(`resuming the import of ${existing.repo} at ${commit} (block ${existing.height})`);
  } else {
    commit = await o.source.resolve(o.revision);
    log(`importing ${o.repo} at ${commit}`);
  }
  const manifest = await readManifest(o.source, commit);
  if (existing?.finishedAt != null) {
    log(`already imported: block ${existing.height}, nothing to do`);
    return { manifest, commit, failures: [] };
  }
  const plan = planImport(manifest);
  if (plan.problems.length > 0) throw new Error(`cannot import: ${plan.problems.join("; ")}`);
  log(
    `release at block ${manifest.height} (${manifest.hash}), ${manifest.files.length} files, ` +
      `${(manifest.files.reduce((s, f) => s + f.bytes, 0) / 1e9).toFixed(1)} GB`,
  );
  if (!plan.coinbase) {
    log("this release has no blocks_coinbase/: miner addresses and coinbase tags stay NULL");
  }

  if (!existing) {
    await requireEmpty(pool);
    await applySchema(pool, o.schemaDir);
    await pool.query(STATE_DDL);
    const dropped = await deferIndexes(pool);
    log(`schema applied; ${dropped} keys and indexes deferred until after the load`);
    await pool.query(
      `INSERT INTO selfhost_import (repo, commit_sha, height, hash, started_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [o.repo, commit, manifest.height, manifest.hash, nowSec()],
    );
  }

  await once(pool, "load", log, () =>
    loadUnits({
      pool,
      plan,
      source: o.source,
      commit,
      dataDir: o.dataDir,
      jobs: o.jobs,
      keepFiles: o.keepFiles,
      nowSec: nowSec(),
      log,
    }),
  );

  await once(pool, "indexes", log, async () => {
    await restoreIndexes(pool, o.maintenanceWorkMem, log);
    // Re-applied now that the tables are full: every statement is a no-op but the planner hint
    // `schema-chain.sql` derives from the row counts (`n_distinct` on the ledger's txid).
    await applySchema(pool, o.schemaDir);
    await pool.query("ANALYZE");
  });

  await deriveTables({
    pool,
    height: manifest.height,
    coinbase: plan.coinbase,
    nowSec: nowSec(),
    log,
  });

  await once(pool, "sync-state", log, async () => {
    await pool.query(
      `INSERT INTO chain_sync_state (id, tip_height, tip_hash, updated_at) VALUES (TRUE, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET tip_height = EXCLUDED.tip_height,
         tip_hash = EXCLUDED.tip_hash, updated_at = EXCLUDED.updated_at`,
      [manifest.height, manifest.hash, nowSec()],
    );
  });

  log("verify: holding the database to the release");
  const failures = await verifyImport(pool, manifest, plan);
  if (failures.length === 0) {
    await pool.query(`TRUNCATE ${ADDRESS_SNAPSHOT_TABLE}`);
    await pool.query("UPDATE selfhost_import SET finished_at = $1", [nowSec()]);
  }
  return { manifest, commit, failures };
}

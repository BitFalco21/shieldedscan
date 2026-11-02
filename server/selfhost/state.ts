import type { Pool, PoolClient } from "pg";

/**
 * The importer's own bookkeeping, in the database it fills, so a restart resumes where the last
 * run stopped: which release (one, pinned by commit), which files are in, which steps are done.
 * Prefixed `selfhost_`, outside every schema file, and never read by the API or the follower.
 */

export const STATE_DDL = `
CREATE TABLE IF NOT EXISTS selfhost_import (
  id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  repo        TEXT    NOT NULL,
  commit_sha  TEXT    NOT NULL,
  height      INTEGER NOT NULL,
  hash        TEXT    NOT NULL,
  started_at  BIGINT  NOT NULL,
  finished_at BIGINT
);
-- One row per imported unit, written in the same transaction as its rows.
CREATE TABLE IF NOT EXISTS selfhost_import_file (
  path        TEXT    PRIMARY KEY,
  sha256      TEXT    NOT NULL,
  rows        BIGINT  NOT NULL,
  imported_at BIGINT  NOT NULL
);
CREATE TABLE IF NOT EXISTS selfhost_import_step (
  step    TEXT   PRIMARY KEY,
  done_at BIGINT NOT NULL
);
-- The constraints and indexes dropped for the load, to be rebuilt after it.
CREATE TABLE IF NOT EXISTS selfhost_import_ddl (
  seq  INTEGER PRIMARY KEY,
  tbl  TEXT    NOT NULL,
  name TEXT    NOT NULL,
  kind TEXT    NOT NULL CHECK (kind IN ('constraint', 'foreign', 'index')),
  def  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS selfhost_address_snapshot (
  address     TEXT   NOT NULL,
  balance_zat BIGINT NOT NULL,
  tx_count    BIGINT
);`;

export interface ImportRecord {
  repo: string;
  commit: string;
  height: number;
  hash: string;
  finishedAt: number | null;
}

export async function readImport(pool: Pool): Promise<ImportRecord | null> {
  const exists = await pool.query("SELECT to_regclass('selfhost_import') IS NOT NULL AS e");
  if (!exists.rows[0]?.e) return null;
  const { rows } = await pool.query<{
    repo: string;
    commit_sha: string;
    height: number;
    hash: string;
    finished_at: string | null;
  }>("SELECT repo, commit_sha, height, hash, finished_at::text FROM selfhost_import");
  const r = rows[0];
  return r
    ? {
        repo: r.repo,
        commit: r.commit_sha,
        height: r.height,
        hash: r.hash,
        finishedAt: r.finished_at === null ? null : Number(r.finished_at),
      }
    : null;
}

export async function stepDone(pool: Pool, step: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM selfhost_import_step WHERE step = $1", [step]);
  return rows.length > 0;
}

export async function markStep(db: Pool | PoolClient, step: string): Promise<void> {
  await db.query(
    `INSERT INTO selfhost_import_step (step, done_at) VALUES ($1, EXTRACT(EPOCH FROM now())::bigint)
     ON CONFLICT (step) DO NOTHING`,
    [step],
  );
}

export async function importedUnits(pool: Pool): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ path: string; sha256: string }>(
    "SELECT path, sha256 FROM selfhost_import_file",
  );
  return new Map(rows.map((r) => [r.path, r.sha256]));
}

/**
 * Runs `step` once: skipped when its marker exists, marked when it returns. A step interrupted
 * midway runs again from its start, so every step is written to be safe to repeat.
 */
export async function once(
  pool: Pool,
  step: string,
  log: (line: string) => void,
  run: () => Promise<void>,
): Promise<void> {
  if (await stepDone(pool, step)) return;
  const started = Date.now();
  log(`${step}: starting`);
  await run();
  await markStep(pool, step);
  log(`${step}: done in ${((Date.now() - started) / 60_000).toFixed(1)} min`);
}

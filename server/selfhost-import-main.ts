import { parseArgs } from "node:util";
import { log, requirePostgres } from "./entrypoint";
import { createPool } from "./pg-pool";
import { runImport } from "./selfhost/import";
import { DEFAULT_ENDPOINT, DEFAULT_REPO, huggingFaceSource } from "./selfhost/source";

/**
 * Self-hosting: one release of the open dataset into an empty Postgres, ready for the API and,
 * given a node, for the follower to continue from the release block. No reindex from 2016.
 *
 *   node selfhost-import.mjs [--revision <commit|branch>] [--data-dir ./data] [--jobs 2]
 *
 * Safe to stop and run again: it resumes at the first file or step not yet done, and once the
 * import has passed its checks a re-run does nothing. Exits 0 when the database matches the
 * release, 1 otherwise (each failed check is printed).
 *
 * Env: DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE (required); HF_ENDPOINT (a mirror,
 * default the Hub); SELFHOST_REPO, SELFHOST_REVISION, SELFHOST_DATA_DIR, SELFHOST_JOBS,
 * SELFHOST_KEEP_FILES=1, SELFHOST_MAINTENANCE_WORK_MEM, SCHEMA_DIR. No token: the dataset is
 * public. `--allow-missing-coinbase` accepts a release from before miner addresses were published.
 */

const { values: args } = parseArgs({
  options: {
    repo: { type: "string" },
    revision: { type: "string" },
    "data-dir": { type: "string" },
    "schema-dir": { type: "string" },
    jobs: { type: "string" },
    "keep-files": { type: "boolean", default: false },
    "allow-missing-coinbase": { type: "boolean", default: false },
  },
});

requirePostgres("the importer fills a database");
const env = process.env;
const jobs = Number(args.jobs ?? env.SELFHOST_JOBS ?? 2);
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) {
  console.error("--jobs must be an integer from 1 to 16");
  process.exit(1);
}
const repo = args.repo ?? env.SELFHOST_REPO ?? DEFAULT_REPO;
const pool = createPool(env.DATABASE_URL, { max: jobs + 2 });
const started = Date.now();

try {
  const result = await runImport({
    pool,
    source: huggingFaceSource({ repo, endpoint: env.HF_ENDPOINT ?? DEFAULT_ENDPOINT }),
    repo,
    revision: args.revision ?? env.SELFHOST_REVISION ?? "main",
    dataDir: args["data-dir"] ?? env.SELFHOST_DATA_DIR ?? "./data",
    schemaDir: args["schema-dir"] ?? env.SCHEMA_DIR ?? ".",
    jobs,
    keepFiles: args["keep-files"] || env.SELFHOST_KEEP_FILES === "1",
    allowMissingCoinbase: args["allow-missing-coinbase"],
    maintenanceWorkMem: env.SELFHOST_MAINTENANCE_WORK_MEM ?? "1GB",
    log,
  });
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  if (result.failures.length > 0) {
    log(`FAILED after ${minutes} min: the database does not match release ${result.commit}`);
    for (const f of result.failures) log(`  ${f}`);
    process.exitCode = 1;
  } else {
    log(
      `done in ${minutes} min: block ${result.height} (${result.hash}), ` +
        `release ${result.commit}`,
    );
  }
} catch (e) {
  log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

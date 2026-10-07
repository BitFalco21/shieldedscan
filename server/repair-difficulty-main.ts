import { HttpNodeRpc } from "./node-rpc";
import { repairDifficulty } from "./repair-difficulty";
import { createPool } from "./pg-pool";
import { log, requirePostgres } from "./entrypoint";

/**
 * One-shot difficulty repair, shipped as an entrypoint in the follower's image:
 *
 *   docker run --rm --network <network> --env-file <db.env> \
 *     -e NODE_RPC_URL=http://<node>:8232 <follower-image> node repair-difficulty.mjs
 *
 * Run with `--rm` and no restart policy: this job finishes, and `--restart unless-stopped`
 * would restart a container that exits 0.
 *
 * It applies no schema; the follower's boot is the single migration path. Safe to interrupt and
 * re-run: the remaining work is always `difficulty IS NULL`.
 *
 * Env: PGHOST/DATABASE_URL (required), NODE_RPC_URL, REPAIR_BATCH, REPAIR_CONCURRENCY,
 * REPAIR_REFRESH=0 to skip the matview refresh.
 */

const NODE_RPC_URL = process.env.NODE_RPC_URL ?? "http://zakura:8232";
const BATCH = process.env.REPAIR_BATCH ? Number(process.env.REPAIR_BATCH) : undefined;
const CONCURRENCY = process.env.REPAIR_CONCURRENCY
  ? Number(process.env.REPAIR_CONCURRENCY)
  : undefined;
const END = process.env.REPAIR_END ? Number(process.env.REPAIR_END) : undefined;

requirePostgres();

const pool = createPool(process.env.DATABASE_URL);

const startedAt = Date.now();
try {
  const { rows } = await pool.query<{ missing: string }>(
    "SELECT count(*)::text AS missing FROM block WHERE difficulty IS NULL",
  );
  log(
    `difficulty repair starting against ${NODE_RPC_URL}: ${rows[0]?.missing ?? "?"} rows to fill`,
  );

  const result = await repairDifficulty({
    pool,
    rpc: new HttpNodeRpc(NODE_RPC_URL),
    log,
    ...(BATCH !== undefined ? { batch: BATCH } : {}),
    ...(CONCURRENCY !== undefined ? { concurrency: CONCURRENCY } : {}),
    ...(END !== undefined ? { end: END } : {}),
    ...(process.env.REPAIR_REFRESH === "0" ? { refresh: false } : {}),
  });

  const minutes = Math.round((Date.now() - startedAt) / 60000);
  log(
    `done in ${minutes}m: ${result.written} written, ${result.scanned} scanned, ` +
      `${result.skippedUnknownHash} unknown hashes, ${result.skippedBadValue} refused values`,
  );
  // Report what is still missing, not only what was done: "skipped everything" and "nothing to
  // do" both print "0 written" and are opposite outcomes.
  const after = await pool.query<{ missing: string }>(
    "SELECT count(*)::text AS missing FROM block WHERE difficulty IS NULL",
  );
  log(`remaining rows with no difficulty: ${after.rows[0]?.missing ?? "?"}`);
} catch (error) {
  log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

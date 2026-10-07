import { repairDirection } from "./repair-direction";
import { createPool } from "./pg-pool";
import { log, requirePostgres } from "./entrypoint";

/**
 * One-shot direction repair, shipped as an entrypoint in the follower's image:
 *
 *   docker run --rm --network <network> --env-file <db.env> \
 *     <follower-image> node repair-direction.mjs
 *
 * Run with `--rm` and no restart policy: this job finishes, and `--restart unless-stopped`
 * would restart a container that exits 0.
 *
 * It makes no node calls (everything `txDirection` reads is in Postgres), so it is safe to run at
 * full speed while the site is serving.
 *
 * It applies no schema: a follower carrying the current `schema-chain.sql` must have started at
 * least once, or `tx.direction` will not exist yet.
 *
 * Safe to interrupt and re-run: the remaining work is always
 * `kind = 'mixed' AND direction IS NULL`.
 *
 * Env: PGHOST/DATABASE_URL (required), REPAIR_BATCH, REPAIR_LIMIT to bound a first run,
 * REPAIR_REFRESH=0 to skip the matview refresh.
 */

const BATCH = process.env.REPAIR_BATCH ? Number(process.env.REPAIR_BATCH) : undefined;
const LIMIT = process.env.REPAIR_LIMIT ? Number(process.env.REPAIR_LIMIT) : undefined;

requirePostgres();

const pool = createPool(process.env.DATABASE_URL);

const remaining = async (): Promise<string> => {
  const { rows } = await pool.query<{ missing: string }>(
    `SELECT count(*)::text AS missing
       FROM tx
      WHERE kind = 'mixed' AND direction IS NULL AND block_height IS NOT NULL`,
  );
  return rows[0]?.missing ?? "?";
};

const startedAt = Date.now();
try {
  log(`direction repair starting: ${await remaining()} mixed rows to fill`);

  const result = await repairDirection({
    pool,
    log,
    ...(BATCH !== undefined ? { batch: BATCH } : {}),
    ...(LIMIT !== undefined ? { limit: LIMIT } : {}),
    ...(process.env.REPAIR_REFRESH === "0" ? { refresh: false } : {}),
  });

  const minutes = Math.round((Date.now() - startedAt) / 60000);
  log(
    `done in ${minutes}m: ${result.written} written, ${result.scanned} scanned — ` +
      `${result.shielding} shielding, ${result.unshielding} unshielding, ` +
      `${result.indeterminate} indeterminate`,
  );
  // Report what is still missing, not only what was done: a bounded run and a finished run both
  // print "0 written" and are opposite outcomes.
  log(`remaining mixed rows with no direction: ${await remaining()}`);
} catch (error) {
  log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

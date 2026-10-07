import { PostgresChainStore } from "./postgres-chain-store";
import { createPool } from "./pg-pool";
import { log, requirePostgres } from "./entrypoint";

/**
 * One-shot repair of rich-list rows that a reorg rollback left standing. Shipped as an
 * entrypoint in the follower's image:
 *
 *   docker run --rm --network <network> --env-file <db.env> [-e REPAIR_COMMIT=1] \
 *     <follower-image> node repair-reorg-addresses.mjs
 *
 * A dry run unless `REPAIR_COMMIT=1`, and even then it commits only when the rich list
 * reconciles with the node's transparent pool to the zatoshi afterwards
 * (`repairReorgCreatedAddresses`). Safe to run with the follower running: one short transaction
 * on the watermark row. Idempotent, so it can be re-run to sweep later reorgs.
 *
 * Env: PGHOST/DATABASE_URL (required), REPAIR_COMMIT=1 to commit.
 */

requirePostgres();

const pool = createPool(process.env.DATABASE_URL, { max: 1 });
const store = new PostgresChainStore(pool);
/** Exact to the zatoshi: a repair's evidence is the one figure that must not be rounded. */
const zec = (zat: bigint | null): string => {
  if (zat === null) return "unknown";
  const abs = zat < 0n ? -zat : zat;
  const fraction = (abs % 100_000_000n).toString().padStart(8, "0");
  return `${zat < 0n ? "-" : ""}${abs / 100_000_000n}.${fraction} ZEC`;
};

try {
  const commit = process.env.REPAIR_COMMIT === "1";
  const r = await store.repairReorgCreatedAddresses({ commit });
  log(
    `at height ${r.height}: ${r.candidates} addresses first seen inside a reorg — ` +
      `${r.removed} removed, ${r.corrected} corrected, ${zec(r.excessZat)} of excess`,
  );
  log(
    `residual against the node's transparent pool: ${zec(r.residualBeforeZat)} → ${zec(r.residualAfterZat)}`,
  );
  if (r.committed) log("COMMITTED");
  else if (commit) {
    log("NOT committed: the list would not reconcile with the pool exactly; nothing changed");
    process.exitCode = 1;
  } else log("dry run: rolled back, nothing changed (REPAIR_COMMIT=1 to commit)");
} catch (error) {
  log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await store.close();
  await pool.end();
}

/**
 * Put the rollup tables in the materialized views' place, or the views back (`server/rollup/swap.ts`).
 *
 *   node swap-rollups.mjs            each view <name> becomes <name>_old, <name>_next becomes <name>
 *   node swap-rollups.mjs --revert   the table goes back to <name>_next, <name>_old back to <name>
 *
 * Run `check-rollups` first: this does not judge equality. The views stay, renamed, until dropped
 * by hand. A view put back by `--revert` is as old as the swap until the follower refreshes it.
 *
 * Env: PGHOST/DATABASE_URL (required).
 */
import { createPool } from "./pg-pool";
import { log, requirePostgres } from "./entrypoint";
import { swapRollups } from "./rollup/swap";

async function main(): Promise<void> {
  requirePostgres();
  const revert = process.argv.includes("--revert");
  const pool = createPool(process.env.DATABASE_URL, { max: 3 });
  try {
    await swapRollups(pool, { revert, log });
    if (revert) log("the views are back; each is as old as the swap until its next refresh");
  } catch (error) {
    log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();

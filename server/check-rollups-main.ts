/**
 * Read-only proof that the rollup tables equal the materialized views they replace
 * (`server/rollup/check.ts`).
 *
 *   node check-rollups.mjs           every table against its view, row for row (cheap)
 *   node check-rollups.mjs --live    against each view's definition evaluated now, in the same
 *                                    snapshot (a full scan per view; paced, preflighted)
 *
 * Exit status 0 only when every table passes.
 *
 * Env: PGHOST/DATABASE_URL (required); NODE_RPC_URL for the pacer with `--live`.
 */
import { hostPacer } from "./job-pacer";
import { createPool } from "./pg-pool";
import { log, requirePostgres } from "./entrypoint";
import { checkRollups } from "./rollup/check";
import { ROLLUP_VIEW_NAMES } from "./rollup/definitions";

const NODE_RPC_URL = process.env.NODE_RPC_URL ?? "http://zakura:8232";

async function main(): Promise<void> {
  requirePostgres();
  const live = process.argv.includes("--live");
  const pool = createPool(process.env.DATABASE_URL, { max: 2 });
  let passed = false;
  try {
    const pacer = live ? hostPacer(pool, NODE_RPC_URL, log) : null;
    if (pacer !== null) await pacer.preflight();
    const results = await checkRollups(pool, {
      live,
      between: async (ms) => pacer === null || (await pacer.afterUnit(ms)) === "continue",
    });
    for (const r of results) log(`${r.verdict} ${r.table} vs ${r.view} (${r.ms}ms): ${r.detail}`);
    passed =
      results.length === ROLLUP_VIEW_NAMES.length && results.every((r) => r.verdict === "PASS");
    if (results.length < ROLLUP_VIEW_NAMES.length) {
      log(`only ${results.length} of ${ROLLUP_VIEW_NAMES.length} rollups have a view to compare`);
    }
    log(passed ? "every table passed" : "NOT every table passed");
  } catch (error) {
    log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    process.exitCode = passed ? 0 : 1;
    await pool.end();
  }
}

void main();

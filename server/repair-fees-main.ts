import { HttpNodeRpc } from "./node-rpc";
import { repairFees } from "./repair-fees";
import { createPool } from "./pg-pool";
import { log, requirePostgres } from "./entrypoint";

/**
 * One-shot fee repair, shipped as an entrypoint in the follower's image:
 *
 *   docker run --rm --network <network> --env-file <db.env> \
 *     -e NODE_RPC_URL=http://<node>:8232 <follower-image> node repair-fees.mjs
 *
 * Run with `--rm` and no restart policy: this job finishes, and `--restart unless-stopped`
 * would restart a container that exits 0.
 *
 * It applies no schema. The `sprout_vpub_net_zat` column it depends on arrives through the
 * follower's boot, the single place `schema-chain.sql` is applied; the job fails loudly if the
 * column is absent.
 *
 * Safe to interrupt and re-run: every phase derives its remaining work from the rows themselves,
 * so there is no checkpoint to corrupt.
 *
 * Env: PGHOST/DATABASE_URL (required), NODE_RPC_URL, REPAIR_BATCH, REPAIR_END.
 */

const NODE_RPC_URL = process.env.NODE_RPC_URL ?? "http://zakura:8232";
const BATCH = process.env.REPAIR_BATCH ? Number(process.env.REPAIR_BATCH) : undefined;
const END = process.env.REPAIR_END ? Number(process.env.REPAIR_END) : undefined;

requirePostgres();

const pool = createPool(process.env.DATABASE_URL);

const startedAt = Date.now();
try {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tx' AND column_name = 'sprout_vpub_net_zat'
     ) AS exists`,
  );
  if (rows[0]?.exists !== true) {
    // The writer that owns the schema must ship first. Proceeding without the column would leave
    // every Sprout fee wrong.
    throw new Error(
      "tx.sprout_vpub_net_zat is missing — deploy the follower (which applies schema-chain.sql) before running this repair",
    );
  }

  log(`fee repair starting against ${NODE_RPC_URL}`);
  const result = await repairFees({
    pool,
    rpc: new HttpNodeRpc(NODE_RPC_URL),
    log,
    ...(BATCH !== undefined ? { batch: BATCH } : {}),
    ...(END !== undefined ? { end: END } : {}),
  });
  const minutes = Math.round((Date.now() - startedAt) / 60000);
  log(
    `done in ${minutes}m: ${result.inputsResolved} inputs resolved, ` +
      `${result.sproutTermsFilledTrivially} trivial sprout terms, ` +
      `${result.sproutBlocksRefetched} blocks re-read (${result.sproutTxsUpdated} txs), ` +
      `${result.feesWritten} fees, ${result.blockTotalsWritten} block totals`,
  );
} catch (error) {
  log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

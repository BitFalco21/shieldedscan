import { runBackfill } from "./backfill-chain";
import { HttpNodeRpc } from "./node-rpc";
import { PostgresChainStore } from "./postgres-chain-store";
import { log, requirePostgres } from "./entrypoint";

/**
 * The one-shot backfiller, as its own container from the follower's image:
 *
 *   docker run -d --network <network> -e DATABASE_URL=... <follower-image> node backfill.mjs
 *
 * Always `full` mode (filling the transaction and transparent-I/O tables is its purpose; the
 * rollup already covers every block), and always `trackSyncState: false`, so the live follower's
 * resume point and reorg detection are untouched.
 *
 * Production sequence:
 *
 * 1. Run this to completion (it logs rate and ETA periodically). It stops at nodeTip - 100,
 *    below anything that could still reorg.
 * 2. Switch the live follower to CHAIN_INGEST_MODE=full (recreate, not restart). New blocks then
 *    get transaction rows as they arrive.
 * 3. Re-run this. Blocks between step 1's end and step 2's switchover were written in rollup mode
 *    and will never be revisited by the follower; the re-run walks that seam and exits.
 *
 * Env: DATABASE_URL (required), NODE_RPC_URL, CHAIN_SCHEMA_PATH, FOLLOW_BATCH, BACKFILL_START
 * (first run only; a checkpoint always wins), BACKFILL_END (fixed end height for bounded runs;
 * omit in production so the target tracks the tip).
 */

const NODE_RPC_URL = process.env.NODE_RPC_URL ?? "http://zakura:8232";
const SCHEMA_PATH = process.env.CHAIN_SCHEMA_PATH ?? "./schema-chain.sql";
const BATCH = Number(process.env.FOLLOW_BATCH ?? 200);
const START = process.env.BACKFILL_START ? Number(process.env.BACKFILL_START) : undefined;
const END = process.env.BACKFILL_END ? Number(process.env.BACKFILL_END) : undefined;

requirePostgres("the backfiller has no in-memory mode");

const store = new PostgresChainStore(process.env.DATABASE_URL, {
  rollupOnly: false,
  trackSyncState: false,
});
await store.applySchema(SCHEMA_PATH);
log(
  `backfill starting against ${NODE_RPC_URL}, batches of ${BATCH}` +
    (START !== undefined ? `, start ${START}` : "") +
    (END !== undefined ? `, fixed end ${END}` : ", end tracks nodeTip - 100"),
);

/**
 * SIGTERM/SIGINT exit between batches. `ingestBlock` is one transaction per block, so a kill
 * mid-batch loses nothing: the checkpoint resumes from the batch boundary and the idempotent
 * upserts absorb the overlap.
 */
let interrupted = false;
const shutdown = (signal: string) => {
  log(`${signal} received — exiting; the checkpoint resumes this run`);
  interrupted = true;
  void store.close().then(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

try {
  const result = await runBackfill({
    rpc: new HttpNodeRpc(NODE_RPC_URL),
    store,
    log,
    batch: BATCH,
    ...(START !== undefined ? { start: START } : {}),
    ...(END !== undefined ? { end: END } : {}),
  });
  log(`done: ${result.ingested} blocks, checkpoint at ${result.nextHeight}`);
} catch (error) {
  // ReconciliationError is deliberately fatal: a block we cannot reconcile means our reading of the
  // bundles is wrong, and skipping it would leave a silent gap in derived data.
  const message = error instanceof Error ? error.message : String(error);
  log(`FATAL ${message}`);
  process.exitCode = 1;
} finally {
  if (!interrupted) await store.close();
}

import { createPool } from "./pg-pool";
import { PostgresChainStore } from "./postgres-chain-store";
import { hostPacer } from "./job-pacer";
import {
  applyTxCounts,
  BackfillRefused,
  dropStaging,
  ensureStaging,
  preflight,
  readState,
  reconcileStaging,
  stageTxCounts,
} from "./tx-count-backfill";
import { log, envNumber, requirePostgres } from "./entrypoint";

/**
 * The transaction-count backfill, an entrypoint in the follower's image:
 *
 *   docker run --rm --network <network> --env-file <db.env> -e REPAIR_PHASE=stage \
 *     <follower-image> node repair-tx-count.mjs
 *
 * `--rm` and no restart policy: this job finishes, and `--restart unless-stopped` would restart
 * a container that exits 0.
 *
 * Run it with the follower running: it paces itself against ingestion (`job-pacer.ts`).
 *
 * Phases, run separately:
 *
 *   `REPAIR_PHASE=stage`    accumulate counts into unlogged staging. Touches no published row.
 *   `REPAIR_PHASE=status`   read-only: where is the run, and what does it still owe?
 *   `REPAIR_PHASE=apply`    copy staging onto `chain_address_balance`, in millisecond batches.
 *   `REPAIR_PHASE=cleanup`  drop the staging tables. Never automatic.
 *
 * Staging and applying are separate because the accumulator is the evidence for the
 * reconciliation between them; cleanup is separate for the same reason.
 *
 * It applies no product schema: a follower carrying the current `schema-chain.sql` must have
 * started at least once, or `tx_count` will not exist. The staging tables are created here and
 * kept out of `schema-chain.sql`, which is re-applied on every boot.
 *
 * It reads `NODE_RPC_URL` only for `getblockcount`, so the pacer can measure how far behind the
 * node the follower is. Every figure it computes comes from Postgres.
 *
 * Env: PGHOST/DATABASE_URL (required), REPAIR_PHASE, REPAIR_HEIGHT_CHUNK, REPAIR_CHUNKS,
 * REPAIR_BATCH, REPAIR_LIMIT, REPAIR_DUTY, REPAIR_STALL_BLOCKS, REPAIR_WORK_MEM,
 * REPAIR_REORG_MARGIN.
 */

const PHASE = process.env.REPAIR_PHASE ?? "status";
requirePostgres();

const pool = createPool(process.env.DATABASE_URL);

/** The census, before and after. */
const remaining = async (): Promise<string> => {
  const { rows } = await pool.query<{ missing: string }>(
    "SELECT count(*)::text AS missing FROM chain_address_balance WHERE tx_count IS NULL",
  );
  return rows[0]?.missing ?? "?";
};

// The one read outside Postgres: the stall signal must be how far the follower is behind the
// node, because "time since the last block" cannot tell a stalled follower from a quiet chain.
const NODE_RPC_URL = process.env.NODE_RPC_URL ?? "http://zakura:8232";

const makePacer = () =>
  hostPacer(pool, NODE_RPC_URL, log, {
    duty: envNumber("REPAIR_DUTY") ?? 0.5,
    stallBlocks: envNumber("REPAIR_STALL_BLOCKS") ?? 5,
  });

const startedAt = Date.now();
const minutes = () => ((Date.now() - startedAt) / 60000).toFixed(1);

try {
  if (PHASE === "status") {
    await ensureStaging(pool);
    const state = await readState(pool);
    log(`addresses with no count: ${await remaining()}`);
    if (state === null) {
      log("nothing staged yet — run REPAIR_PHASE=stage");
    } else {
      log(
        `staged through height ${state.throughHeight} of H ${state.hTarget}` +
          (state.throughHeight >= state.hTarget ? " (complete)" : ""),
      );
      log(`apply cursor at ${state.applyCursor === "" ? "(start)" : state.applyCursor}`);
      if (state.throughHeight >= state.hTarget) {
        const { disagreements, notYetApplied, zeroCounts } = await reconcileStaging(pool);
        log(
          `reconciliation: ${disagreements} disagreements, ${notYetApplied} staged but not yet ` +
            `applied, ${zeroCounts} rows at zero`,
        );
      }
    }
    // Also print the go/no-go, so `status` answers "could I start now?". A refusal here is
    // information, so it is caught rather than thrown.
    try {
      await preflight(pool, log, {
        skipHoleCheck: true,
        ...(envNumber("REPAIR_REORG_MARGIN") !== undefined
          ? { reorgMargin: envNumber("REPAIR_REORG_MARGIN")! }
          : {}),
      });
    } catch (error) {
      log(`preflight would REFUSE: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (PHASE === "stage") {
    log(`staging starting: ${await remaining()} addresses with no count`);
    const pacer = makePacer();
    const result = await stageTxCounts({
      pool,
      log,
      pacer,
      ...(envNumber("REPAIR_HEIGHT_CHUNK") !== undefined
        ? { chunk: envNumber("REPAIR_HEIGHT_CHUNK")! }
        : {}),
      ...(envNumber("REPAIR_CHUNKS") !== undefined ? { chunks: envNumber("REPAIR_CHUNKS")! } : {}),
      ...(process.env.REPAIR_WORK_MEM ? { workMem: process.env.REPAIR_WORK_MEM } : {}),
      ...(envNumber("REPAIR_REORG_MARGIN") !== undefined
        ? { reorgMargin: envNumber("REPAIR_REORG_MARGIN")! }
        : {}),
    });
    log(
      `staged ${result.chunksRun} chunks in ${minutes()}m, through height ${result.throughHeight} ` +
        `of H ${result.hTarget}`,
    );
    // A bounded run, a run that yielded to ingestion, and a finished run all print a chunk count;
    // the log says which outcome it was.
    if (result.abortedForIngestion) {
      log("STOPPED because ingestion fell behind. Nothing is lost; re-run to resume.");
    } else if (!result.complete) {
      log("stopped at the chunk limit — re-run to continue.");
    } else {
      log("staging COMPLETE. Reconcile against the node, then run REPAIR_PHASE=apply.");
    }
    log(
      `pacer: rested ${(pacer.stats.sleptMs / 60000).toFixed(1)}m, worst lag ` +
        `${pacer.stats.maxBlocksBehind} block(s), ${pacer.stats.stallSamples} stall sample(s), ` +
        `${result.timeouts} span timeout(s)`,
    );
  } else if (PHASE === "apply") {
    const before = await remaining();
    log(`apply starting: ${before} addresses with no count`);
    // Shares this process's pool rather than opening a second one; `close()` is a no-op when the
    // pool is borrowed, so the `finally` below still owns it.
    //
    // No rich-list maintenance and no sync-state writes: this process must never act as the
    // follower, whose watermark makes the delta exactly-once. It calls only `recomputeAddresses`.
    const store = new PostgresChainStore(pool, {
      maintainRichList: false,
      trackSyncState: false,
    });
    const pacer = makePacer();
    try {
      const result = await applyTxCounts({
        pool,
        store,
        log,
        pacer,
        ...(envNumber("REPAIR_BATCH") !== undefined ? { batch: envNumber("REPAIR_BATCH")! } : {}),
        ...(envNumber("REPAIR_LIMIT") !== undefined ? { limit: envNumber("REPAIR_LIMIT")! } : {}),
      });
      log(
        `applied ${result.filled} rows and recomputed ${result.recomputed} in ${minutes()}m ` +
          `across ${result.batches} batches (${result.retries} lock retries)`,
      );
      if (result.abortedForIngestion)
        log("STOPPED because ingestion fell behind; re-run to resume.");
      log(`remaining addresses with no count: ${result.remaining}`);
      const { disagreements, notYetApplied, zeroCounts } = await reconcileStaging(pool);
      log(
        `reconciliation: ${disagreements} disagreements, ${notYetApplied} staged but not yet ` +
          `applied, ${zeroCounts} rows at zero`,
      );
      if (zeroCounts > 0) {
        // Impossible by construction (an address in this table has at least one transaction), so a
        // zero is a fabricated value and the run is suspect.
        log("FAILED CHECK: rows at tx_count = 0. That value cannot be true; investigate.");
        process.exitCode = 1;
      }
    } finally {
      await store.close();
    }
  } else if (PHASE === "cleanup") {
    const { disagreements, zeroCounts } = await reconcileStaging(pool).catch(() => ({
      disagreements: -1,
      zeroCounts: -1,
    }));
    log(
      `final reconciliation before dropping: ${disagreements} disagreements, ${zeroCounts} zeros`,
    );
    log(`remaining addresses with no count: ${await remaining()}`);
    await dropStaging(pool);
    log("staging tables dropped");
  } else {
    console.error(`unknown REPAIR_PHASE ${PHASE} (stage | status | apply | cleanup)`);
    process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof BackfillRefused) {
    // A refusal is a failed precondition, not a crash: still a non-zero exit, but the message, not
    // a stack trace, is what matters.
    log(`REFUSED: ${error.message}`);
  } else {
    log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}

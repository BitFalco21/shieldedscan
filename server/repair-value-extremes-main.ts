import { hostPacer } from "./job-pacer";
import {
  dropValueStaging,
  ensureValueStaging,
  foldValueExtremes,
  readValueState,
  stageValueExtremes,
  valueTargetHeight,
  ValueBackfillRefused,
} from "./value-extremes";
import { createPool } from "./pg-pool";
import { log, envNumber, requirePostgres } from "./entrypoint";

/**
 * The transparent value-range backfill, an entrypoint in the follower's image:
 *
 *   docker run --rm --network <network> --env-file <db.env> -e REPAIR_PHASE=stage \
 *     <follower-image> node repair-value-extremes.mjs
 *
 * `--rm` and no restart policy: this job finishes, and `--restart unless-stopped` would restart
 * a container that exits 0.
 *
 * Run it with the follower running. It paces itself against ingestion (`job-pacer.ts`). Killing
 * it at any moment is safe: every chunk commits its own range, and the accumulator deletes any
 * overlapping range before writing, so a resumed run cannot double-count.
 *
 * Phases:
 *
 *   `REPAIR_PHASE=status`   read-only: how far has the walk reached, and could it start now?
 *   `REPAIR_PHASE=stage`    walk the chain, recording each chunk's extrema into scratch.
 *   `REPAIR_PHASE=apply`    fold the chunks into the one published row.
 *   `REPAIR_PHASE=cleanup`  drop the scratch tables. Never automatic.
 *
 * Staging and applying are separate so the result can be checked before it is published; cleanup
 * is manual because dropping the scratch discards the ability to re-fold without re-walking.
 *
 * It applies no product schema: a follower carrying the current `schema-chain.sql` must have
 * started at least once, or `chain_value_extremes` will not exist. The scratch tables are created
 * here and kept out of `schema-chain.sql`, which is re-applied on every boot.
 *
 * Env: PGHOST/DATABASE_URL (required), REPAIR_PHASE, REPAIR_HEIGHT_CHUNK, REPAIR_CHUNKS,
 * REPAIR_DUTY, REPAIR_STALL_BLOCKS, REPAIR_WORK_MEM, REPAIR_TARGET_MS, NODE_RPC_URL.
 */

const PHASE = process.env.REPAIR_PHASE ?? "status";

requirePostgres();

const pool = createPool(process.env.DATABASE_URL);

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
    await ensureValueStaging(pool);
    const state = await readValueState(pool);
    const target = await valueTargetHeight(pool);
    if (state === null) {
      log(`nothing staged yet — run REPAIR_PHASE=stage (target height ${target})`);
    } else {
      const done = state.throughHeight >= state.hTarget;
      log(
        `staged through height ${state.throughHeight} of H ${state.hTarget}` +
          (done ? " (complete)" : ` (${state.hTarget - state.throughHeight} to go)`),
      );
    }
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM value_extremes_chunk",
    );
    log(`accumulator holds ${rows[0]?.n ?? "?"} chunk rows`);
    const published = await pool.query(
      "SELECT * FROM chain_value_extremes WHERE scope = 'transaction'",
    );
    log(
      published.rows[0]
        ? `published: ${JSON.stringify(published.rows[0])}`
        : "published: nothing yet — run REPAIR_PHASE=apply",
    );
  } else if (PHASE === "stage") {
    const result = await stageValueExtremes({
      pool,
      log,
      pacer: makePacer(),
      ...(envNumber("REPAIR_HEIGHT_CHUNK") !== undefined
        ? { chunk: envNumber("REPAIR_HEIGHT_CHUNK")! }
        : {}),
      ...(envNumber("REPAIR_CHUNKS") !== undefined ? { chunks: envNumber("REPAIR_CHUNKS")! } : {}),
      ...(envNumber("REPAIR_TARGET_MS") !== undefined
        ? { targetChunkMs: envNumber("REPAIR_TARGET_MS")! }
        : {}),
      ...(process.env.REPAIR_WORK_MEM ? { workMem: process.env.REPAIR_WORK_MEM } : {}),
    });
    log(
      `staged ${result.chunksRun} chunks through height ${result.throughHeight} of ` +
        `${result.hTarget} in ${minutes()} min (${result.timeouts} timeouts)`,
    );
    if (result.abortedForIngestion) {
      // Not a failure: the pacer yielded so the follower could catch up. Exit 0 so a wrapper does
      // not treat a deliberate pause as an error.
      log("PAUSED for ingestion — re-run REPAIR_PHASE=stage to continue where it stopped");
    } else if (!result.complete) {
      log("stopped short of the target — re-run REPAIR_PHASE=stage to continue");
    } else {
      log("walk COMPLETE — now run REPAIR_PHASE=apply, then check the figures before trusting");
    }
  } else if (PHASE === "apply") {
    const state = await readValueState(pool);
    if (state === null) throw new ValueBackfillRefused("nothing staged — run REPAIR_PHASE=stage");
    // Folding a partial walk is allowed (`covered_through_height` records how far it reached, and
    // the route refuses to publish below the target), but it is logged so a partial figure is not
    // taken for a final one.
    if (state.throughHeight < state.hTarget) {
      log(
        `WARNING: folding a PARTIAL walk (through ${state.throughHeight} of ${state.hTarget}). ` +
          `The published row will record that, and consumers will refuse to quote it.`,
      );
    }
    await foldValueExtremes(pool);
    const { rows } = await pool.query(
      "SELECT * FROM chain_value_extremes WHERE scope = 'transaction'",
    );
    log(`applied: ${JSON.stringify(rows[0])}`);
  } else if (PHASE === "cleanup") {
    await dropValueStaging(pool);
    log("scratch dropped — a future run walks the chain again from the start");
  } else {
    throw new Error(`unknown REPAIR_PHASE: ${PHASE}`);
  }
} catch (error) {
  log(`FAILED after ${minutes()} min: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

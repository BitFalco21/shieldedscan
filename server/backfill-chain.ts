import { REORG_DEPTH, ingestRange, type NodeRpcPort } from "./follow";
import type { ParsedBlock } from "@/data/chain/parse";

/**
 * The one-shot chain backfiller: walk `[start, end]` once, in order, and exit.
 *
 * Switching the live follower to `CHAIN_INGEST_MODE=full` backfills nothing: the follower resumes
 * from `chain_sync_state` at the tip, so only new blocks gain transaction rows. Rewinding the
 * follower's sync state instead would cost reorg detection and the short tip-poll cadence for the
 * whole walk.
 *
 * So there are two processes with two resume points: the live follower keeps the tip and the reorg
 * log; this walks history with `trackSyncState: false` and its own checkpoint. The ingest itself
 * is `ingestRange`, the follower's own loop including the reconciliation gate.
 *
 * Reorg safety comes from distance, not detection: the target is recomputed each pass as
 * `nodeTip - REORG_DEPTH`, so this never writes a height the chain could still rewrite. The seam
 * between its end and the follower's full-mode start is closed by re-running it (see
 * `backfill-main.ts`).
 */

export interface BackfillStorePort {
  ingestBlock(parsed: ParsedBlock): Promise<void>;
  getBackfillCheckpoint(): Promise<number | null>;
  setBackfillCheckpoint(nextHeight: number): Promise<void>;
}

export interface BackfillDeps {
  rpc: NodeRpcPort;
  store: BackfillStorePort;
  log: (message: string) => void;
  /** First height to ingest when no checkpoint exists. Default 0. */
  start?: number;
  /**
   * Last height to ingest, inclusive. Default: the node's tip minus REORG_DEPTH,
   * recomputed each pass — a moving target that the walk eventually catches. A fixed
   * value is for measurement runs over a bounded slice.
   */
  end?: number;
  /** Blocks per batch between checkpoint writes. */
  batch?: number;
}

export interface BackfillResult {
  /** Blocks ingested across the whole run. */
  ingested: number;
  /** The next height a re-run would start from. */
  nextHeight: number;
  /** The last target the run caught up to. */
  end: number;
}

/**
 * Run to completion. Throws on `ReconciliationError` (a block we misread — stop, never
 * skip) and on RPC/database failures; the caller decides whether to re-run, and the
 * checkpoint makes any re-run resume where this one stopped.
 */
export async function runBackfill(deps: BackfillDeps): Promise<BackfillResult> {
  const batch = deps.batch ?? 200;
  const checkpoint = await deps.store.getBackfillCheckpoint();
  // A checkpoint always wins over `start`: it records real ingested work, and restarting
  // below it would re-parse blocks for no reason. `start` seeds the very first run only.
  let next = checkpoint ?? deps.start ?? 0;
  if (checkpoint !== null && deps.start !== undefined && deps.start !== checkpoint) {
    deps.log(
      `checkpoint ${checkpoint} overrides start ${deps.start} — delete the ` +
        `chain_backfill_state row to force a restart from scratch`,
    );
  }

  let ingested = 0;
  let target = deps.end ?? (await deps.rpc.getTipHeight()) - REORG_DEPTH;
  const startedAt = Date.now();
  let windowStart = startedAt;
  let windowBlocks = 0;

  while (next <= target) {
    const to = Math.min(next + batch - 1, target);
    ingested += await ingestRange(deps, next, to);
    windowBlocks += to - next + 1;
    next = to + 1;
    await deps.store.setBackfillCheckpoint(next);

    // One log line roughly every 30s of work, carrying the figures that let an operator
    // extrapolate the whole run: instantaneous rate, overall rate, and the remainder.
    const now = Date.now();
    if (now - windowStart >= 30_000) {
      const instant = windowBlocks / ((now - windowStart) / 1000);
      const overall = ingested / ((now - startedAt) / 1000);
      const remaining = target - next + 1;
      const etaHours = remaining / overall / 3600;
      deps.log(
        `backfill at ${next}/${target} — ${instant.toFixed(1)} blk/s (window), ` +
          `${overall.toFixed(1)} blk/s (run), ~${etaHours.toFixed(1)}h remaining`,
      );
      windowStart = now;
      windowBlocks = 0;
    }

    // Only a moving target is refreshed; a fixed `end` is a measurement contract.
    if (deps.end === undefined && next > target) {
      target = (await deps.rpc.getTipHeight()) - REORG_DEPTH;
    }
  }

  deps.log(`backfill complete: ${ingested} blocks ingested, next height ${next}`);
  return { ingested, nextHeight: next, end: target };
}

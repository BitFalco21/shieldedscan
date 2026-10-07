import { parseBlock, reconcilePoolFlows } from "@/data/chain/parse";
import type { RpcBlock } from "@/data/chain/rpc-types";
import type { ChainStorePort, ChainSyncState } from "./chain-store";

/**
 * The chain follower: the same code path for the initial backfill and for steady-state following,
 * so the hardest logic in the system exists once.
 *
 * Three invariants, in priority order:
 *
 *  1. Reorg-safe. A history that no longer matches the node is rolled back, never merged.
 *     Divergence deeper than `REORG_DEPTH` stops the follower instead of rewriting a large slice
 *     of the database on its own initiative.
 *  2. Reconciled. Every block's shielded flows must account for exactly the pool movement the
 *     node reports, or the follower refuses to advance (see `reconcilePoolFlows`), so a sign
 *     inversion or a missed bundle field is loud instead of silent.
 *  3. Idempotent and atomic per block, which the store guarantees.
 */

/** Deeper than any plausible Zcash reorg; also the depth past which pages may be cached forever. */
export const REORG_DEPTH = 100;

/** Blocks per pass. Bounded so the loop yields, and so a failure costs one batch. */
export const DEFAULT_BATCH = 200;

export interface NodeRpcPort {
  getTipHeight(): Promise<number>;
  getBlockHash(height: number): Promise<string>;
  getBlock(height: number): Promise<RpcBlock>;
}

export interface FollowDeps {
  rpc: NodeRpcPort;
  store: ChainStorePort;
  log: (message: string) => void;
  batch?: number;
  /** Clock for reorg-event timestamps; injectable so tests can pin `detectedAt`. */
  now?: () => number;
}

export interface FollowResult {
  /** Blocks written this pass. */
  ingested: number;
  /** Height rolled back to, when a reorg was detected. */
  rolledBackTo?: number;
  localTip: number | null;
  nodeTip: number;
  /** True when local tip has caught up to the node's. */
  caughtUp: boolean;
}

export class ReconciliationError extends Error {
  constructor(
    readonly height: number,
    detail: string,
  ) {
    super(`block ${height} failed pool reconciliation: ${detail}`);
    this.name = "ReconciliationError";
  }
}

export class DeepReorgError extends Error {
  constructor(readonly localTip: number) {
    super(
      `chain diverged more than ${REORG_DEPTH} blocks below local tip ${localTip} — ` +
        `refusing to roll back automatically`,
    );
    this.name = "DeepReorgError";
  }
}

/**
 * Walk back from our tip until our stored hash matches the node's, and return that height.
 *
 * Throws past `REORG_DEPTH`: a divergence that deep is either a serious chain event or a bug in
 * this follower, and silently rewriting a large part of the database is wrong for either.
 */
async function findCommonAncestor(deps: FollowDeps, local: ChainSyncState): Promise<number> {
  const floor = Math.max(0, local.tipHeight - REORG_DEPTH);
  for (let height = local.tipHeight; height >= floor; height -= 1) {
    const ours = await deps.store.hashAt(height);
    if (ours === null) continue;
    const theirs = await deps.rpc.getBlockHash(height);
    if (ours === theirs) return height;
  }
  throw new DeepReorgError(local.tipHeight);
}

/**
 * Fetch, parse, reconcile and ingest every block in `[from, to]`, in order.
 *
 * Shared verbatim by the one-shot backfiller, so the reconciliation gate has one implementation.
 * Returns the number of blocks ingested (zero when `from > to`).
 */
export async function ingestRange(
  // Structurally narrowed to exactly what the loop touches, which is what lets the
  // backfiller's store satisfy it without carrying the follower's sync/rollback methods.
  deps: {
    rpc: Pick<NodeRpcPort, "getBlock">;
    store: Pick<ChainStorePort, "ingestBlock">;
  },
  from: number,
  to: number,
): Promise<number> {
  let ingested = 0;
  for (let height = from; height <= to; height += 1) {
    const raw = await deps.rpc.getBlock(height);
    const parsed = parseBlock(raw);

    const reconciliation = reconcilePoolFlows(raw, parsed);
    if (!reconciliation.ok) {
      // Stop rather than skip. A block whose flows do not account for the node's own pool
      // movement means our reading of the bundles is wrong, and every aggregate built on
      // top of it would be wrong in a way no page would reveal.
      throw new ReconciliationError(
        height,
        `sapling txs=${reconciliation.saplingFromTxs} pool=${reconciliation.saplingFromPool}, ` +
          `orchard txs=${reconciliation.orchardFromTxs} pool=${reconciliation.orchardFromPool}, ` +
          `ironwood txs=${reconciliation.ironwoodFromTxs} pool=${reconciliation.ironwoodFromPool}`,
      );
    }

    await deps.store.ingestBlock(parsed);
    ingested += 1;
  }
  return ingested;
}

/**
 * One pass: reconcile history, then ingest forward up to `batch` blocks.
 *
 * Returns rather than looping so the caller controls pacing, and so tests can assert one
 * pass at a time. `caughtUp` tells a scheduler whether to sleep or immediately continue.
 */
export async function followOnce(deps: FollowDeps): Promise<FollowResult> {
  const batch = deps.batch ?? DEFAULT_BATCH;
  const nodeTip = await deps.rpc.getTipHeight();
  const local = await deps.store.getSyncState();

  let resumeFrom = 0;
  let rolledBackTo: number | undefined;

  if (local !== null) {
    const ancestor = await findCommonAncestor(deps, local);
    if (ancestor < local.tipHeight) {
      // Capture both hashes at the lowest rolled-back height now: the rollback is about to delete
      // the only row that knows ours. Two distinct hashes at one height is the fact the reorg log
      // keeps.
      const lowestRolledBack = ancestor + 1;
      const orphanedHash = await deps.store.hashAt(lowestRolledBack);
      const replacedBy = await deps.rpc.getBlockHash(lowestRolledBack);
      const event =
        orphanedHash === null
          ? // No stored row at that height means there is no orphan to describe — roll
            // back without fabricating one. Contiguous ingest makes this unreachable in
            // practice; the branch exists so a gap can never invent a hash.
            undefined
          : {
              detectedAt: (deps.now ?? (() => Math.floor(Date.now() / 1000)))(),
              height: lowestRolledBack,
              depth: local.tipHeight - ancestor,
              orphanedHash,
              replacedBy,
            };
      await deps.store.rollbackAbove(ancestor, event);
      rolledBackTo = ancestor;
      deps.log(`reorg: rolled back from ${local.tipHeight} to ${ancestor}`);
    }
    resumeFrom = ancestor + 1;
  }

  const target = Math.min(nodeTip, resumeFrom + batch - 1);
  const ingested = await ingestRange(deps, resumeFrom, target);

  const localTip = ingested > 0 ? target : (local?.tipHeight ?? null);
  return {
    ingested,
    ...(rolledBackTo === undefined ? {} : { rolledBackTo }),
    localTip,
    nodeTip,
    caughtUp: localTip !== null && localTip >= nodeTip,
  };
}

/**
 * How long the follower waits between passes once caught up. A reorg is only detectable by rolling
 * back a block we had already stored, so a losing block that appears and is replaced between two
 * polls is never seen. A depth-1 orphan typically lives a few seconds against the 75-second target,
 * so the poll is short; one `getblockcount` per poll is cheap. The public reorg summary states this
 * cadence.
 */
export const FOLLOW_IDLE_MS = 5_000;

export interface FollowLoopOptions extends FollowDeps {
  /** Wait between passes once caught up; `FOLLOW_IDLE_MS` by default. */
  idleMs?: number;
  /** Wait after a failure, so a persistent fault does not become a hot loop. */
  errorMs?: number;
}

/**
 * Runs `followOnce` until stopped. Returns a stop handle.
 *
 * A `ReconciliationError` or `DeepReorgError` stops the loop rather than retrying: both mean
 * the follower's understanding of the chain is wrong, and retrying would either spin or
 * compound the damage. Transient faults (a node restart, an RPC timeout) are retried after
 * `errorMs`.
 */
export function startFollowing(options: FollowLoopOptions): () => void {
  const idleMs = options.idleMs ?? FOLLOW_IDLE_MS;
  const errorMs = options.errorMs ?? 10_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    });

  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        const result = await followOnce(options);
        if (result.ingested > 0) {
          options.log(
            `ingested ${result.ingested} blocks, tip ${result.localTip}/${result.nodeTip}`,
          );
        }
        if (stopped) break;
        // Only sleep once caught up: mid-backfill there is no reason to idle.
        if (result.caughtUp) await wait(idleMs);
      } catch (error) {
        if (error instanceof ReconciliationError || error instanceof DeepReorgError) {
          options.log(`FATAL ${error.message} — follower stopped`);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        options.log(`follow pass failed, retrying: ${message}`);
        if (stopped) break;
        await wait(errorMs);
      }
    }
  };
  void loop();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

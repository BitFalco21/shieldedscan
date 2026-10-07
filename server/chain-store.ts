import type { ParsedBlock } from "@/data/chain/parse";

/**
 * What the block follower needs from storage.
 *
 * Deliberately narrow, like `CrossChainStorePort`: each method is either a read the follower makes
 * to decide what to do next, or the single write that advances it.
 *
 * `ingestBlock` must be atomic across several tables and one derived value. A block writes its row,
 * its transactions and their transparent I/O, then resolves inputs against stored outputs, derives
 * fees from those, and updates the rollup and sync state. A crash halfway must leave nothing, which
 * is why resolution and fee derivation live behind this method: only the store can wrap them in one
 * transaction.
 */
export interface ChainSyncState {
  tipHeight: number;
  tipHash: string;
}

/**
 * A reorg the follower observed, captured at detection time — before the rollback deletes
 * the only row that knows the orphaned hash.
 */
export interface ReorgEventRecord {
  /** Unix seconds, the follower's clock. */
  detectedAt: number;
  /** Lowest height rolled back. */
  height: number;
  /** Blocks discarded. */
  depth: number;
  /** The hash WE held at `height` — gone from the node, surviving only in this record. */
  orphanedHash: string;
  /** The hash the node reports at `height` now. */
  replacedBy: string;
}

export interface ChainStorePort {
  /** Resume point, or null on an empty database. */
  getSyncState(): Promise<ChainSyncState | null>;
  /** The hash we hold at a height, or null if we hold no block there. */
  hashAt(height: number): Promise<string | null>;
  /**
   * Discard every block above `height`. Cascades to transactions and transparent I/O, and resets
   * the sync state to `height`. Used only on a detected reorg.
   *
   * `event` is the audit record of the reorg, written in the same transaction as the rollback so a
   * crash cannot leave one without the other. Optional only when no orphaned row existed to
   * describe.
   */
  rollbackAbove(height: number, event?: ReorgEventRecord): Promise<void>;
  /**
   * Persist one block and everything derived from it, atomically, and advance the sync
   * state. Idempotent: re-ingesting a block already stored must be a no-op, which is what
   * makes crash recovery and manual backfill safe.
   */
  ingestBlock(parsed: ParsedBlock): Promise<void>;
}

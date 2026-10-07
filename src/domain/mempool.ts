import type { Transaction } from "./transaction";

/**
 * A pending transaction as the node's mempool holds it, plus the facts that exist only while
 * it waits. A wrapper rather than fields on `Transaction`, because none of this survives
 * confirmation.
 */
export interface MempoolEntry {
  transaction: Transaction;
  /** Unix seconds the node first saw it — measured, not inferred from a block time. */
  seenAt: number;
  /** What actually orders inclusion: the fee against the bytes it occupies. */
  feeRateZatPerByte: number;
  /** Pending transactions this one spends from; it cannot be mined before they are. */
  dependsOn: string[];
}

/**
 * How a sample of pending transactions splits by privacy kind.
 *
 * Classification needs each transaction's structure, which the mempool listing does not carry,
 * so a busy mempool is sampled. The counts describe the sample and are never extrapolated to
 * the full mempool.
 *
 * `coinbase` exists because `txKind` can name it; a coinbase cannot be in a mempool, so a
 * non-zero value means a bug upstream.
 */
export interface MempoolComposition {
  /** How many pending transactions were actually classified. */
  sampled: number;
  transparent: number;
  mixed: number;
  shielded: number;
  coinbase: number;
}

export interface MempoolStats {
  pendingCount: number;
  totalSizeBytes: number;
  /** Median absolute fee; null for an empty mempool — unknown is not zero. */
  medianFeeZat: number | null;
  /** Median fee rate in zat/byte, the number that actually orders inclusion. */
  medianFeeRateZatPerByte: number | null;
  /** Privacy composition of a sample; null when no sample could be classified. */
  composition: MempoolComposition | null;
}

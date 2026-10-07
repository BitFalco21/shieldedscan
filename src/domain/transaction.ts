export interface TransparentInput {
  address: string;
  valueZat: number;
}

export interface TransparentOutput {
  address: string;
  valueZat: number;
}

/** Zatoshi per ZEC. Every amount in `domain/` is an integer in zatoshi; convert only here. */
export const ZATS_PER_ZEC = 100_000_000;

export interface SproutBundle {
  joinSplits: number;
}

export interface SaplingBundle {
  spends: number;
  outputs: number;
  /** Public net flow: > 0 means ZEC entering the pool, < 0 leaving it. */
  valueBalanceZat: number;
}

export interface OrchardBundle {
  actions: number;
  /** Public net flow: > 0 means ZEC entering the pool, < 0 leaving it. */
  valueBalanceZat: number;
}

/**
 * Ironwood (NU6.3), the fourth shielded pool, activated on mainnet at height 3,428,143.
 *
 * Structurally an Orchard bundle but a distinct type: it is a separate pool with its own value
 * balance, and Orchard value migrates into it. A shared type would make it easy to read
 * migrated value as a fee.
 */
export interface IronwoodBundle {
  actions: number;
  /** Public net flow: > 0 means ZEC entering the pool, < 0 leaving it. */
  valueBalanceZat: number;
}

export interface Transaction {
  txid: string;
  /** Height of the block containing this tx; null while it is still in the mempool. */
  blockHeight: number | null;
  /** Hash of the containing block; null while it is still in the mempool. */
  blockHash: string | null;
  timestamp: number;
  isCoinbase: boolean;
  version: number;
  sizeBytes: number;
  /**
   * `nLockTime` as the chain states it; 0 means no lock.
   *
   * Null on index-served list paths, which do not store it: null means "not carried in this
   * view", never "does not exist". The detail page always has it.
   */
  lockTime: number | null;
  expiryHeight: number | null;
  /**
   * The full serialised transaction, hex. Carried only on the single-transaction path (it is
   * often 9 KB+); null elsewhere means "not carried in this view", never "does not exist".
   */
  rawHex: string | null;
  /** null when unknown (never render as 0). */
  feeZat: number | null;
  bindingSigValid: boolean | null;
  transparentInputs: TransparentInput[];
  transparentOutputs: TransparentOutput[];
  sprout: SproutBundle | null;
  sapling: SaplingBundle | null;
  orchard: OrchardBundle | null;
  /**
   * Null for a transaction that does not touch Ironwood and for any transaction mined before
   * NU6.3, where the field does not exist. Both mean nothing moved through Ironwood.
   */
  ironwood: IronwoodBundle | null;
}

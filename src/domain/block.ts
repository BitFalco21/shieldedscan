import { txKind } from "./classify";
import { POOL_NAMES, txPools, type PoolName } from "./pool";
import type { BlockMiner } from "./miner";
import type { Transaction, TransparentOutput } from "./transaction";

/**
 * How many of a block's transactions fall in each privacy bucket.
 *
 * Counted from the block alone (bundle presence and transparent input/output counts), so a
 * list row needs no input resolution.
 *
 * The coinbase counts as transparent here, because this describes what a block contains.
 * `BlockRollup` excludes it because it measures user activity.
 */
export interface BlockComposition {
  transparentTxs: number;
  mixedTxs: number;
  shieldedTxs: number;
  /**
   * Transactions that carried a bundle in each shielded pool. A migration counts in both pools,
   * so these do not sum to the total. Optional only for hand-written compositions;
   * `blockComposition` always fills it.
   */
  byPool?: Record<PoolName, number>;
}

export function blockComposition(txs: readonly Transaction[]): BlockComposition {
  const byPool = Object.fromEntries(POOL_NAMES.map((p) => [p, 0])) as Record<PoolName, number>;
  const composition: BlockComposition = { transparentTxs: 0, mixedTxs: 0, shieldedTxs: 0, byPool };
  for (const tx of txs) {
    const kind = txKind(tx);
    if (kind === "shielded") composition.shieldedTxs += 1;
    else if (kind === "mixed") composition.mixedTxs += 1;
    else composition.transparentTxs += 1;
    for (const pool of txPools(tx)) byPool[pool] += 1;
  }
  return composition;
}

/**
 * What the miner itself took from the coinbase, or null when that is not public.
 *
 * The coinbase minus the era's funding streams. This is exact, not inferential: a funding
 * stream is a consensus-fixed output, not a guess about which output was change.
 *
 * Null for a shielded coinbase (ZIP 213), whose amount is encrypted, and when there is no
 * coinbase. Never zero in place of unknown.
 */
export function minerRewardZat(
  block: Pick<Block, "miner" | "blockRewardZat" | "fundingStreams">,
): number | null {
  if (block.miner.kind !== "transparent" || block.blockRewardZat === null) return null;
  const streams = block.fundingStreams.reduce((sum, output) => sum + output.valueZat, 0);
  return block.blockRewardZat - streams;
}

export interface Block {
  height: number;
  hash: string;
  prevHash: string;
  timestamp: number;
  sizeBytes: number;
  txids: string[];

  // ---------------------------------------------------------------- the header
  version: number;
  /** The network's difficulty at this block, as the node computes it from `bits`. */
  difficulty: number;
  /** Compact target, hex (`"1c00e9e0"`) — kept as the header states it, not decoded. */
  bits: string;
  /** 32 bytes of hex. Zcash's nonce is a 256-bit field, not Bitcoin's 32-bit counter. */
  nonce: string;
  merkleRoot: string;
  /**
   * Commitment tree roots as of this block. Null before the pool existed — a pre-Sapling
   * block has no final Sapling root, and an empty string would be a claim that it does.
   */
  finalSaplingRoot: string | null;
  finalOrchardRoot: string | null;

  /** Privacy make-up of the block's transactions, so a list row needs none of them. */
  composition: BlockComposition;

  // ------------------------------------------------- derived from the coinbase
  /** Who took the reward. `shielded` is a real answer here, not a missing one. */
  miner: BlockMiner;
  /**
   * The message the miner wrote into the coinbase, printable characters only, or null if
   * nothing printable survived. Attacker-controlled: sanitised at the parse boundary and
   * never rendered as HTML.
   */
  coinbaseTag: string | null;
  /**
   * Coinbase outputs that went somewhere other than the miner: the era's funding streams
   * (Founders' Reward, Canopy's three, NU6's FPF). A list because the count is era-dependent.
   */
  fundingStreams: TransparentOutput[];
  /**
   * Everything the coinbase paid out: subsidy plus fees, transparent outputs plus
   * anything it shielded. Null only when the block carries no coinbase.
   */
  blockRewardZat: number | null;
  /**
   * Fees from this block's non-coinbase transactions, or null when unknown. Null when any
   * single fee is unknown (a partial sum is never shown as a total) or when the source did
   * not compute it; readers treat both the same way.
   */
  totalFeeZat: number | null;
}

/**
 * A block list row: every field of `Block` except the header fields only a detail page shows
 * and the txid list, whose length is `txCount`. The chain index builds a page of these in a few
 * queries (`ChainIndexStore.blockSummaries`); a full `Block` needs the node, block by block.
 */
export type BlockSummary = Omit<
  Block,
  "txids" | "version" | "bits" | "nonce" | "merkleRoot" | "finalSaplingRoot" | "finalOrchardRoot"
> & { txCount: number };

/** A full block, as its list row. Spelled out so a field added to `Block` must be decided here. */
export function blockSummaryOf(b: Block): BlockSummary {
  return {
    height: b.height,
    hash: b.hash,
    prevHash: b.prevHash,
    timestamp: b.timestamp,
    sizeBytes: b.sizeBytes,
    txCount: b.txids.length,
    difficulty: b.difficulty,
    composition: b.composition,
    miner: b.miner,
    coinbaseTag: b.coinbaseTag,
    fundingStreams: b.fundingStreams,
    blockRewardZat: b.blockRewardZat,
    totalFeeZat: b.totalFeeZat,
  };
}

/**
 * A block's total transaction fees, deriving the case the chain already answers.
 *
 * `totalFeeZat` comes from the chain index and is null for a block not yet ingested. A block
 * holding only its coinbase collects no fees by construction, so its total is exactly zero
 * with or without the index.
 */
export function blockFeesZat(block: Pick<BlockSummary, "txCount" | "totalFeeZat">): number | null {
  // Exactly one, never `<= 1`: a count of zero means the contents are unknown, not empty.
  if (block.txCount === 1) return 0;
  return block.totalFeeZat;
}

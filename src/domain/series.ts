/**
 * Both series carry both grains in one object — monthly for the ALL range, daily for every
 * shorter range — so a page cannot hold one grain without the other.
 */

/**
 * What the whole network paid in fees over a period — miner revenue beyond the block
 * subsidy.
 *
 * Not the median fee: that is a property of ZIP-317 and barely moves, while this total is
 * fee count × fee size and moves with demand.
 */
export interface FeeTotalPoint {
  /** Unix seconds at the start of the period. */
  timestamp: number;
  /** Fees paid across every block in the period whose total could be derived. */
  feeZat: number;
  /** Blocks in the period. */
  blocks: number;
  /**
   * Blocks whose fee total was derivable. A block's total is NULL when one of its inputs is
   * unresolvable, so coverage travels with the figure; it is not guaranteed to stay complete.
   */
  blocksCovered: number;
}

/** True when every block in the period contributed, so the total is not a floor. */
export function feeTotalIsComplete(point: FeeTotalPoint): boolean {
  return point.blocks > 0 && point.blocksCovered === point.blocks;
}

export interface FeeTotalSeries {
  monthly: FeeTotalPoint[];
  /** Trailing 366 days only — the longest sub-ALL range is 1Y. */
  daily: FeeTotalPoint[];
}

/**
 * ZEC crossing to and from other chains in a period, at the public swap venues this
 * explorer watches.
 *
 * USD is the sum of the venues' own swap-time figures, never today's price against a
 * historical amount. It is a floor, like every cross-chain aggregate here: rows whose venue
 * published no per-leg USD carry none.
 */
export interface CrossChainVolumePoint {
  /** Unix seconds at the start of the period. */
  timestamp: number;
  /** ZEC that arrived on Zcash. */
  inZat: number;
  /** ZEC that left Zcash. */
  outZat: number;
  /**
   * Transfers in both directions — the sum of the two below, kept because "how many crossings
   * were there" is the commonest question asked of this series and its consumer may not add.
   */
  transfers: number;
  /**
   * Transfers per direction, so each direction's dollar figure has its own coverage
   * denominator rather than the combined count.
   */
  inTransfers: number;
  outTransfers: number;
  /**
   * Swap-time USD, split by direction exactly as `inZat`/`outZat` are, so a consumer never has
   * to reconcile a combined dollar total against per-direction ZEC. A floor, never a spot price.
   */
  inUsdAtSwap: number;
  outUsdAtSwap: number;
  /**
   * Transfers in each direction whose venue published a swap-time USD price.
   *
   * Below the direction's own transfer count means some venue published none, so the dollar
   * figure covers only part of the crossings and must be rendered with the `≥` the cards use.
   */
  inUsdCoveredTransfers: number;
  outUsdCoveredTransfers: number;
}

export interface CrossChainVolumeSeries {
  monthly: CrossChainVolumePoint[];
  /** Trailing 366 days only, matching `FeeTotalSeries`. */
  daily: CrossChainVolumePoint[];
}

/**
 * Blank out a band's leading zeros, so a pool that did not exist yet reads as absent (`null`,
 * omitted from the readout) rather than as a measured zero balance.
 *
 * Only the leading run is blanked: a zero after a pool's first value is a real measurement
 * (Sprout draining to nothing), so it stays.
 *
 * Derived from the data rather than an activation height, because activation heights differ
 * per network (NU6.3 is 3,428,143 on mainnet, 4,134,000 on testnet).
 */
export function sinceFirstValue(values: readonly number[]): (number | null)[] {
  const first = values.findIndex((v) => v !== 0);
  // Never held anything: every point is absence, not a row of zeros.
  if (first === -1) return values.map(() => null);
  return values.map((v, i) => (i < first ? null : v));
}

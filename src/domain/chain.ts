import { ZATS_PER_ZEC } from "./transaction";
export interface ChainInfo {
  height: number;
  bestBlockHash: string;
  /** Unix seconds of the chain tip — also the deterministic "now" for relative times. */
  lastBlockTimestamp: number;
  /**
   * ZEC in circulation, in zatoshis: all mined supply except the NU6 lockbox, which holds
   * deferred subsidy no transaction can spend. Same definition as `/v1/supply/circulating`.
   */
  circulatingSupplyZat: number;
  /**
   * The four fields below are `null` when not measured. They come from API pollers (a ~1,150
   * block aggregate and an external price feed) that are cold at start-up and can go stale, so
   * null is the normal state of a freshly restarted API.
   *
   * Keep the explicit null: an omitted key would let a fixture value survive a spread. Render
   * null as "unavailable", never as the veil (which means encrypted on-chain) and never as a
   * substituted value.
   */
  txCount24h: number | null;
  fullyShieldedPct24h: number | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
}

/**
 * Fees paid to miners over the trailing day, with the coverage that produced the figure.
 *
 * Coverage is part of the value: a block whose inputs cannot all be resolved has no fee total,
 * so the sum over the blocks that do is a floor unless every block is covered.
 *
 * The whole object is `null` when nothing could be measured, rendered as "unavailable", never
 * as `0`.
 */
export interface Fees24h {
  /** Total of the block fees that are known, in zatoshis. A floor when coverage is partial. */
  zat: number;
  /** Blocks in the window whose total fee is known. */
  blocksCovered: number;
  /** Blocks in the window. `blocksCovered < blocksTotal` means the figure is a floor. */
  blocksTotal: number;
}

/** Is every block in the window accounted for, so the total is exact rather than a floor? */
export function fees24hIsComplete(fees: Fees24h): boolean {
  return fees.blocksCovered >= fees.blocksTotal;
}

/**
 * Market capitalisation: circulating supply x price.
 *
 * `null` when the price feed has not reported: a market cap without a price is unknown, not
 * smaller.
 */
export function marketCapUsd(chain: ChainInfo): number | null {
  return marketCapFromTermsUsd(chain.circulatingSupplyZat, chain.priceUsd);
}

/**
 * The same quantity from plain scalars, for a caller holding the two terms and no `ChainInfo`.
 *
 * The agent's `chain_status` reads `/v1/chain` (supply and price, no market cap) and must not
 * do arithmetic itself, so it calls this. One definition keeps the homepage and the agent in
 * agreement.
 */
export function marketCapFromTermsUsd(
  circulatingSupplyZat: number,
  priceUsd: number | null,
): number | null {
  if (priceUsd === null) return null;
  return (circulatingSupplyZat / ZATS_PER_ZEC) * priceUsd;
}

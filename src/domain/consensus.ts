import { BLOSSOM_HEIGHT } from "./halving";
import { NU7, type UpgradeNetwork } from "./network-upgrade";
import type { ValuePoolName } from "./pool";

/**
 * Consensus facts that change with height: the block target spacing and whether NU7's rules
 * apply. Kept in one place so a spacing figure is never hardcoded elsewhere (NU7 took testnet
 * to 25-second blocks on 2026-10-04).
 *
 * Every function takes the network and the height in question, never "now": a block mined
 * under the 75-second rules keeps them after NU7. Mainnet's NU7 height is `null` until ZIP 259
 * assigns it (`network-upgrade.ts`), so mainnet answers are unchanged until then.
 */

/**
 * Blossom (150 s → 75 s), per network. Mainnet's is the halving schedule's own constant;
 * testnet's was read from our testnet node's `getblockchaininfo.upgrades` on 2026-10-04.
 */
const BLOSSOM_ACTIVATION: Record<UpgradeNetwork, number> = {
  mainnet: BLOSSOM_HEIGHT,
  testnet: 584_000,
};

/** Whether NU7's consensus rules apply at `height` on `network`. False while the height is unset. */
export function nu7ActiveAt(network: UpgradeNetwork, height: number): boolean {
  const activation = NU7.activationHeight[network];
  return activation !== null && height >= activation;
}

/** The block target spacing in seconds at `height`: 150 before Blossom, 75 after, 25 from NU7 (ZIP 218). */
export function targetSpacingSeconds(network: UpgradeNetwork, height: number): 150 | 75 | 25 {
  if (nu7ActiveAt(network, height)) return 25;
  return height >= BLOSSOM_ACTIVATION[network] ? 75 : 150;
}

/** Plain-language description of where a fee at `height` goes; one sentence for every page. */
export function feeDestinationSentence(network: UpgradeNetwork, height: number): string {
  return nu7ActiveAt(network, height)
    ? "Since NU7, 40% of it goes to the miner and 60% is removed from circulation, to be reissued in later block rewards (ZIP 235)."
    : "All of it goes to the miner, and nothing is burned.";
}

/**
 * The miner's share of a block's fees, in zatoshi. From NU7, ZIP 235 removes `floor(6 × fees / 10)`
 * of the block's total into the NSM balance and leaves the rest to the miner (rounded in the
 * miner's favour, on the block total, never per transaction); before NU7 the miner takes all of it.
 */
export function minerFeeShareZat(
  network: UpgradeNetwork,
  height: number,
  blockFeesZat: number,
): number {
  if (!nu7ActiveAt(network, height)) return blockFeesZat;
  return blockFeesZat - Math.floor((blockFeesZat * 6) / 10);
}

/**
 * Value pools no transaction can spend from at `height`: the NU6 lockbox always, and Sprout from
 * NU7, whose ZIP 2003 disallows the only transaction versions that can carry a JoinSplit. Mined
 * but not circulating, so every circulating-supply figure leaves them out.
 */
export function unspendablePools(network: UpgradeNetwork, height: number): ValuePoolName[] {
  return nu7ActiveAt(network, height) ? ["lockbox", "sprout"] : ["lockbox"];
}

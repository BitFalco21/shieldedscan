/**
 * Reading the wall clock, isolated in one place.
 *
 * Separate from `format.ts` because it is the one genuinely impure helper in `lib/`:
 * every other function there maps input to output. Keeping it here means React's purity
 * lint has a single boundary to reason about, and tests have a single thing to control.
 *
 * Use this only for events that are not on-chain. Anything measured against Zcash — block
 * ages, confirmations — must use the chain tip from `getChainInfo()`, never this.
 *
 * Exception: relative ages use `useDisplayNow`, which takes the later of this clock and the
 * chain tip, so the newest block's age keeps ticking (and keeps ticking if the chain stalls).
 * `timeAgo` clamps at zero, so a miner timestamp ahead of real time reads "0s". Confirmations,
 * block ordering and other statements about the chain's state still come from the tip.
 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

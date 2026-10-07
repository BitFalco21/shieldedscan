/**
 * Editorial facts about the target that are NOT derivable from the key itself, each with the
 * day it was read. The chain half of the target (public key → hash160 → address) lives in
 * `domain/bitcoin-keys.ts` and is pinned to consensus data by a test; these are what an
 * explorer reported on a given day, and go stale honestly rather than silently.
 *
 * A dated static figure rather than a live Bitcoin feed: this site indexes Zcash. Update by
 * hand; the read date travels with the figure wherever it prints.
 */
export const GENESIS_TRIBUTES = {
  /** Whole figure as printed on the cabinet. */
  btc: "57.43",
  /** Exact balance in BTC at the read, for the `title` beside the rounded figure. */
  exactBtc: "57.43251519",
  /** Unspent outputs paying the address at the read — every one sent by a stranger. */
  outputs: 78_573,
  readOn: "2026-09-02",
  explorerHref: "https://mempool.space/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
} as const;

/**
 * The reason the jackpot is the tributes and not "the 50 BTC": the genesis coinbase output was
 * never added to Bitcoin's UTXO set, so it cannot be spent by anyone, with any key. Only the
 * later payments to the same address are spendable — and those are what a key would unlock.
 */
export const GENESIS_COINBASE_BTC = "50";

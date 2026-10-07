import { hasShielded } from "./classify";
import type { Transaction } from "./transaction";

/**
 * Who a block paid its reward to.
 *
 * A Zcash block carries no miner field, so this is derived from the block's coinbase
 * transaction — and on this chain the answer is not always public, which is why it is a
 * union rather than a string. `shielded` is a real, correct answer, not a failure.
 */
export type BlockMiner =
  | { kind: "transparent"; address: string }
  /** ZIP 213 shielded coinbase: the reward was paid into a shielded pool. */
  | { kind: "shielded" }
  /** No coinbase available, or its largest output names no address (a bare key, non-standard). */
  | { kind: "unknown" };

/**
 * The miner of a block, from its transactions.
 *
 * The miner took the coinbase's largest transparent output. That follows from consensus: in
 * every era the miner's share strictly exceeds any single funding stream —
 *
 *  - Founders' Reward (pre-Canopy): miner 80%, founders 20% in one output.
 *  - Canopy (ZIP 214): miner 80%; ZF 5%, BP 7%, Major Grants 8%.
 *  - NU6: miner 80%, FPF 8%; the deferred 12% goes to the lockbox pool, not an output.
 *
 * Fees go to the miner on top, so the gap only widens. Do not use output order (e.g.
 * `vout[0]`): miners build their own coinbase and may order it freely.
 *
 * A coinbase carrying any shielded bundle (ZIP 213) reports `shielded`: once part of the
 * reward is shielded, the largest transparent output may be a funding stream, which must not
 * be named as the miner. The pool test goes through {@link hasShielded} so new pools are
 * covered automatically.
 */
export function blockMiner(txs: readonly Transaction[]): BlockMiner {
  const coinbase = txs.find((tx) => tx.isCoinbase);
  if (coinbase === undefined) return { kind: "unknown" };

  if (hasShielded(coinbase)) return { kind: "shielded" };

  // The largest output over all of them, addressed or not. An output naming no address (a
  // bare public key, as early miners were paid) still took the miner's share, so when it is
  // the largest the miner is `unknown`. Taking the largest addressed output instead would name
  // the founders' 20% output as the miner in the founders'-reward era.
  let best: { address: string; valueZat: number } | null = null;
  for (const output of coinbase.transparentOutputs) {
    if (best === null || output.valueZat > best.valueZat) best = output;
  }

  return best === null || best.address === ""
    ? { kind: "unknown" }
    : { kind: "transparent", address: best.address };
}

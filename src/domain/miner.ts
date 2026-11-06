import { hasShielded } from "./classify";
import { REISSUANCE_START_HEIGHT, scheduledSubsidyZat } from "./halving";
import { isLockboxDisbursementOutput } from "./lockbox-disbursement";
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
 * The miner of the block at `height`, from its transactions.
 *
 * The miner took the coinbase's largest transparent output, once the outputs consensus requires
 * for another purpose at this height are set aside. Funding streams need no setting aside: in
 * every era the miner's share strictly exceeds any single stream —
 *
 *  - Founders' Reward (pre-Canopy): miner 80%, founders 20% in one output.
 *  - Canopy (ZIP 214): miner 80%; ZF 5%, BP 7%, Major Grants 8%.
 *  - NU6: miner 80%, FPF 8%; the deferred 12% goes to the lockbox pool, not an output.
 *
 * The one-time lockbox disbursements are the exception (`lockbox-disbursement.ts`): at NU6.1 each
 * of its ten outputs is thousands of times the miner's share. They are matched on height, address
 * and amount, so the rule stays "largest output" everywhere else.
 *
 * Fees go to the miner on top, so the gap only widens. Do not use output order (e.g.
 * `vout[0]`): miners build their own coinbase and may order it freely.
 *
 * A coinbase carrying any shielded bundle (ZIP 213) reports `shielded`: once part of the
 * reward is shielded, the largest transparent output may be a funding stream, which must not
 * be named as the miner. The pool test goes through {@link hasShielded} so new pools are
 * covered automatically.
 */
export function blockMiner(txs: readonly Transaction[], height: number): BlockMiner {
  const coinbase = txs.find((tx) => tx.isCoinbase);
  if (coinbase === undefined) return { kind: "unknown" };

  if (hasShielded(coinbase)) return { kind: "shielded" };

  // The largest output over all of them, addressed or not. An output naming no address (a
  // bare public key, as early miners were paid) still took the miner's share, so when it is
  // the largest the miner is `unknown`. Taking the largest addressed output instead would name
  // the founders' 20% output as the miner in the founders'-reward era.
  let best: { address: string; valueZat: number } | null = null;
  for (const output of coinbase.transparentOutputs) {
    if (isLockboxDisbursementOutput(height, output)) continue;
    if (best === null || output.valueZat > best.valueZat) best = output;
  }

  return best === null || best.address === ""
    ? { kind: "unknown" }
    : { kind: "transparent", address: best.address };
}

/**
 * Whether a recorded miner reward is more than the block could pay anyone: its scheduled subsidy
 * plus every fee in it. Above that, an output that was not the miner's was counted as the
 * miner's, which is how the NU6.1 disbursement was first recorded. Mainnet's schedule, and only
 * before ZIP 237 reissuance (8,939,664) adds a bonus to it. Null where it cannot be decided: in
 * the slow start, which the schedule does not model, and when the fee total is unknown.
 */
export function minerRewardAboveIssuance(
  height: number,
  minerRewardZat: number,
  totalFeeZat: number | null,
): boolean | null {
  if (height < SLOW_START_END || height >= REISSUANCE_START_HEIGHT || totalFeeZat === null) {
    return null;
  }
  return minerRewardZat > scheduledSubsidyZat(height) + totalFeeZat;
}

/** The slow start's last height plus one; `scheduledSubsidyZat` refuses below it. */
const SLOW_START_END = 20_000;

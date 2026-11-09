import type { TransparentOutput } from "./transaction";

/**
 * One-time coinbase payments that consensus requires at a fixed height, which are not the miner's.
 *
 * ZIP 271 paid 78,750 ZEC out of the deferred dev fund lockbox in the NU6.1 activation block's
 * coinbase, as ten equal outputs to the key-holders' multisig, on each network. Each output is
 * 7,875 ZEC, far above the miner's 1.25, so "the miner is the largest output" names the multisig
 * unless these outputs are set aside first. A list rather than one constant: a later lockbox
 * disbursement would be paid the same way.
 *
 * Matched on height, address and amount together, never on the address alone: the multisig is an
 * ordinary address that can receive anything at any other height. No network is needed, because
 * each entry's address only exists on its own network.
 *
 * Sources: https://zips.z.cash/zip-0271 (amount, chunks, both addresses) and
 * https://zips.z.cash/zip-0255 (NU6.1 heights), read 2026-11-06. The mainnet block's coinbase was
 * checked: ten outputs of 787,500,000,000 zat to `t3ev37Q2…`, plus the miner and the FPF stream.
 */
export interface LockboxDisbursement {
  network: "mainnet" | "testnet";
  height: number;
  address: string;
  totalZat: number;
  /** The total is split into this many equal outputs. */
  chunks: number;
  zip: number;
}

export const LOCKBOX_DISBURSEMENTS: readonly LockboxDisbursement[] = [
  {
    network: "mainnet",
    height: 3_146_400,
    address: "t3ev37Q2uL1sfTsiJQJiWJoFzQpDhmnUwYo",
    totalZat: 7_875_000_000_000,
    chunks: 10,
    zip: 271,
  },
  {
    network: "testnet",
    height: 3_536_500,
    address: "t2RnBRiqrN1nW4ecZs1Fj3WWjNdnSs4kiX8",
    totalZat: 7_875_000_000_000,
    chunks: 10,
    zip: 271,
  },
];

/** Whether this coinbase output at `height` is a consensus-mandated disbursement chunk. */
export function isLockboxDisbursementOutput(
  height: number,
  output: Pick<TransparentOutput, "address" | "valueZat">,
): boolean {
  return LOCKBOX_DISBURSEMENTS.some(
    (d) =>
      d.height === height &&
      d.address === output.address &&
      d.totalZat / d.chunks === output.valueZat,
  );
}

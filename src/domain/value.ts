import { txKind } from "./classify";
import type { Transaction } from "./transaction";

/**
 * Fees across a set of transactions, or null if any of them is unknown.
 *
 * All-or-nothing: skipping an underived fee would yield a total that looks authoritative and
 * is short by an unknown amount. Coinbase transactions are excluded; they collect fees.
 */
export function totalFeeZat(txs: readonly Transaction[]): number | null {
  let total = 0;
  for (const tx of txs) {
    if (tx.isCoinbase) continue;
    if (tx.feeZat === null) return null;
    total += tx.feeZat;
  }
  return total;
}

/** Public transparent value of a tx, or null when nothing is public (fully shielded). */
/** The ZEC on one transparent side of a transaction: its inputs' or its outputs' total. */
export function sideZat(side: readonly { valueZat: number }[]): number {
  return side.reduce((sum, entry) => sum + entry.valueZat, 0);
}

export function publicValueZat(tx: Transaction): number | null {
  if (txKind(tx) === "shielded") return null;
  const out = sideZat(tx.transparentOutputs);
  if (out > 0) return out;
  const inn = sideZat(tx.transparentInputs);
  if (inn > 0) return inn;
  return null;
}

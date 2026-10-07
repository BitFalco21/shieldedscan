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
export function publicValueZat(tx: Transaction): number | null {
  if (txKind(tx) === "shielded") return null;
  const out = tx.transparentOutputs.reduce((s, o) => s + o.valueZat, 0);
  if (out > 0) return out;
  const inn = tx.transparentInputs.reduce((s, i) => s + i.valueZat, 0);
  if (inn > 0) return inn;
  return null;
}

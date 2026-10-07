import type { Transaction } from "@/domain";
import { hasShielded } from "@/domain";

/**
 * Decides which sides of the transaction-flow diagram must render a VeilPanel.
 *
 * Structural, not value-based: any non-coinbase tx with no transparent inputs
 * and at least one shielded bundle is spending from a shielded pool, and that
 * must always be shown — even when the public value balance happens to be
 * zero (all-Sprout txs, or a Sapling/Orchard net of exactly 0).
 */
export function txFlowSides(tx: Transaction): { spendingVeil: boolean; receivingVeil: boolean } {
  // Imported, not re-derived, so every shielded pool is covered: a missing pool here would leave a
  // fully shielded transaction with no veil.
  const shielded = hasShielded(tx);

  const spendingVeil = !tx.isCoinbase && tx.transparentInputs.length === 0 && shielded;

  const receivingVeil =
    shielded &&
    (tx.transparentOutputs.length === 0 || tx.transparentInputs.length > 0 || tx.isCoinbase);

  return { spendingVeil, receivingVeil };
}

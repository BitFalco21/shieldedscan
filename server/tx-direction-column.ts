import type { TxDirection, TxKind } from "@/domain";

/**
 * How `tx.direction` is stored: the only place the domain's answer is translated for SQL.
 *
 * The column serves `?kind=shielding` / `?kind=unshielding` on /txs. Two translations:
 *
 *  1. Only a mixed transaction stores anything. For every other kind `txDirection` merely
 *     restates `kind`, and storing it would be a second copy of a fact. Nothing queries
 *     direction for a non-mixed row.
 *
 *  2. A mixed transaction with no direction stores `'indeterminate'`, not NULL. Its pools moved
 *     in opposite directions and `txDirection` returns null rather than apportioning. NULL means
 *     "not backfilled yet": `repair-direction` finds its remaining work with `direction IS NULL`,
 *     so writing NULL here would make the repair revisit the same rows forever.
 *
 * Kept out of `domain/` because this is a storage encoding, not a fact about Zcash.
 */
export type StoredTxDirection = "shielding" | "unshielding" | "indeterminate";

export function txDirectionColumn(kind: TxKind, direction: TxDirection): StoredTxDirection | null {
  if (kind !== "mixed") return null;
  return direction === "shielding" || direction === "unshielding" ? direction : "indeterminate";
}

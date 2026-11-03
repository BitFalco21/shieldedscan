import type { AddressTxRow } from "./address-walk";
import { col } from "./spec";
import type { ExportColumn, SourceRow } from "./table";

/**
 * The address export's columns. `net_zat` is the address's own net change in the transaction, the
 * address page's NET column (`addressDeltaZat`): arithmetic, never a guess at which output was the
 * payment and which the change.
 */
export const ADDRESS_EXPORT_COLUMNS: readonly ExportColumn[] = [
  col("block_height", "int", "blockHeight", "The block that mined the transaction."),
  col("block_time_utc", "utc", "timestamp", "That block header's time."),
  col("txid", "text", "txid", "Transaction id, hex."),
  col(
    "tx_kind",
    "text",
    "kind",
    "transparent | mixed | coinbase (a fully shielded one names no address).",
  ),
  col("received_zat", "zat", "receivedZat", "What the transaction's outputs paid this address."),
  col(
    "sent_zat",
    "zat",
    "sentZat",
    "What this address's inputs spent. Empty when one of them has no resolved value; the address page and /activity count such an input as 0.",
    ["indeterminate"],
  ),
  col("net_zat", "zat", "netZat", "received_zat minus sent_zat. Empty as sent_zat.", [
    "indeterminate",
  ]),
  col(
    "tx_fee_zat",
    "zat",
    "feeZat",
    "The whole transaction's fee, not this address's. Empty: nonexistent for a coinbase, indeterminate where an input could not be resolved.",
    ["nonexistent", "indeterminate"],
  ),
];

/** A walked row as a table row, each empty cell with its reason. */
export function addressRowSource(r: AddressTxRow): SourceRow {
  const unknowns: Record<string, string> = {};
  if (r.feeZat === null) unknowns.feeZat = r.kind === "coinbase" ? "nonexistent" : "indeterminate";
  return {
    value: { ...r, netZat: r.sentZat === null ? null : r.receivedZat - r.sentZat },
    unknowns,
  };
}

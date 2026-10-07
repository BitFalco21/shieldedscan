import type { PulseLedgerRow } from "@/domain";
import { AddressLink } from "@/components/AddressLink";
import { HashLink } from "@/components/HashLink";
import { formatZecAmount } from "@/lib/format";

/**
 * The transparent ledger's newest rows, as evidence.
 *
 * The stage draws these same outputs inside the transparent box — the shape. This is the
 * evidence: the same array with the controls a picture cannot carry (an SVG cell cannot hold a
 * copy button, and checking an address needs the whole string, not an elision).
 *
 * Outputs only, never an input→output pairing, and confirmed only. Deciding which output was the
 * payment is the inference this site refuses; a mempool output has not happened.
 */

export interface PulseLedgerRowsProps {
  rows: readonly PulseLedgerRow[];
  /** How many to list. The stage draws more; this is the readable tail of them. */
  limit?: number;
}

export function PulseLedgerRows({ rows, limit = 6 }: PulseLedgerRowsProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-faint">No transparent outputs in this frame.</p>;
  }
  return (
    <ul className="grid gap-1.5 text-xs">
      {rows.slice(0, limit).map((row, i) => (
        <li
          key={`${row.txid}-${i}`}
          className="flex items-baseline justify-between gap-3 tabular-nums"
        >
          <span className="min-w-0 truncate">
            <AddressLink address={row.address} copyable />
          </span>
          <span className="shrink-0 text-ink">{formatZecAmount(row.valueZat)}</span>
          <span className="shrink-0">
            <HashLink value={row.txid} href={`/tx/${row.txid}`} copyLabel="transaction id" />
          </span>
        </li>
      ))}
    </ul>
  );
}

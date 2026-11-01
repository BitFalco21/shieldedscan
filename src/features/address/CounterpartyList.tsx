import type { Counterparty } from "@/domain";
import { formatCount } from "@/lib/format";
import Link from "@/components/Link";
import { CounterpartyEntry } from "./CounterpartyEntry";

/**
 * Entries drawn per side. A sweep can spend thousands of inputs (13,538 in one), and every row's
 * list is in the page's HTML: past this, the list says how many it left out and points to the
 * transaction, which shows them all.
 */
export const COUNTERPARTY_LIST_LIMIT = 50;

export interface CounterpartyListProps {
  /** "INPUTS" or "OTHER OUTPUTS": never "recipients", which the chain cannot tell apart from change. */
  heading: string;
  parties: readonly Counterparty[];
  txid: string;
}

/** An entry's identity on its side: an address and a pool appear at most once each. */
const partyKey = (p: Counterparty) =>
  p.kind === "address" ? p.address : p.kind === "pool" ? `pool:${p.pool}` : p.kind;

/** One side of a transaction, every entry in on-chain order with its public amount. */
export function CounterpartyList({ heading, parties, txid }: CounterpartyListProps) {
  const shown = parties.slice(0, COUNTERPARTY_LIST_LIMIT);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="microlabel text-ink-dim">{heading}</span>
      <ul className="flex flex-col gap-1.5">
        {shown.map((party) => (
          <li key={partyKey(party)} className="flex">
            <CounterpartyEntry party={party} withAmount />
          </li>
        ))}
      </ul>
      {parties.length > shown.length && (
        <Link href={`/tx/${txid}`} className="text-xs text-ink-dim hover:text-green">
          First {formatCount(shown.length)} of {formatCount(parties.length)}: see the transaction
        </Link>
      )}
    </div>
  );
}

import type { OtherParty } from "@/domain";
import { AddressLink } from "@/components/AddressLink";
import { AmountZec } from "@/components/AmountZec";
import { PoolBadge } from "@/components/PoolBadge";

export interface CounterpartyEntryProps {
  party: OtherParty;
  /** Draw the entry's public amount after it (the full list does; the inline cell does not). */
  withAmount?: boolean;
}

/**
 * One entry on the other side of a transaction: an address (by name where one is known), a
 * shielded pool, new coins, or scripts naming no address.
 *
 * An amount is drawn only where the chain publishes one. Sprout publishes no value balance, and
 * pools that moved opposite ways claim no amount, so those draw none: never a 0, and never the
 * Veil, which means encrypted, not "we cannot say". No copy button: a list can hold fifty, on
 * every row, and `title` already carries the full address.
 */
export function CounterpartyEntry({ party, withAmount = false }: CounterpartyEntryProps) {
  const zat = party.kind === "mined" ? null : party.zat;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
      <span className="min-w-0">
        {party.kind === "address" ? (
          <AddressLink address={party.address} edge={4} />
        ) : party.kind === "pool" ? (
          <span className="inline-flex items-center gap-2">
            <PoolBadge pool={party.pool} variant="text" />
            {(party.undirected === "opposite" || party.zat === null) && (
              <span className="text-xs text-ink-faint">
                {party.undirected === "opposite" ? "moved both ways" : "no published balance"}
              </span>
            )}
          </span>
        ) : party.kind === "mined" ? (
          <PoolBadge pool="mined" variant="text" />
        ) : (
          <span className="text-xs text-ink-dim">
            {party.count === 1 ? "non-standard script" : `${party.count} non-standard scripts`}
          </span>
        )}
      </span>
      {withAmount && zat !== null && (
        <span className="ml-auto text-xs whitespace-nowrap">
          <AmountZec zat={zat} />
        </span>
      )}
    </span>
  );
}

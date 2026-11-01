import type { ReactNode } from "react";
import type { Transaction } from "@/domain";
import { addressCounterparties, counterpartySummary } from "@/domain";
import { Badge } from "@/components/Badge";
import { Popover } from "@/components/Popover";
import { CounterpartyEntry } from "./CounterpartyEntry";
import { CounterpartyList } from "./CounterpartyList";

export interface CounterpartyProps {
  tx: Transaction;
  /** The address whose page this is: the side shown is read from it. */
  address: string;
}

/**
 * The other side of a transaction on an address's history: what the FROM / TO column shows, and
 * on a phone the line under the hash (`CounterpartyCell`).
 *
 * One entry is named inline. Several are summarised by a count that names nobody ("4 inputs"),
 * and the list opens from it: naming only the first would single out one output, often read as
 * the payment, when the chain cannot tell a payment from change (`addressCounterparties`).
 *
 * Pools whose direction is not on chain are listed apart, under no side's heading, and a side's
 * word (FROM, TO) is drawn only over entries that are on that side. Otherwise the word is WITH.
 *
 * The list is a `Popover` (`<details>`): no script, Escape and outside clicks close it through
 * `DismissPopovers`. Below `lg` the table scrolls sideways inside a box that would clip a floating
 * panel, so there it opens in place, under the trigger, as wide as the cell allows; from `lg` it
 * floats over the rows. Every row renders this twice (the column and the phone line, one of them
 * `display: none`); its HTML is bounded by `COUNTERPARTY_LIST_LIMIT`.
 */
export function Counterparty({ tx, address }: CounterpartyProps) {
  const c = addressCounterparties(tx, address);

  // Each list the panel holds: the shown side for FROM / TO, both sides when the address netted
  // to zero, and the undirected pools apart. Empty lists are left out, as are their words.
  const sides = (
    c.direction === "both"
      ? [
          { heading: "OTHER INPUTS", noun: "input" as const, parties: c.inputs },
          { heading: "OTHER OUTPUTS", noun: "output" as const, parties: c.outputs },
        ]
      : c.direction === "from"
        ? [{ heading: "OTHER INPUTS", noun: "input" as const, parties: c.shown }]
        : [{ heading: "OTHER OUTPUTS", noun: "output" as const, parties: c.shown }]
  ).filter((side) => side.parties.length > 0);
  const pools = c.undirected.length;
  const entries = sides.reduce((n, side) => n + side.parties.length, 0) + pools;

  const word =
    c.direction === "self"
      ? null
      : c.direction !== "both" && c.shown.length > 0
        ? c.direction
        : "with";

  let content: ReactNode;
  if (c.direction === "self") {
    content = <span className="text-xs text-ink-dim">itself</span>;
  } else if (entries === 1) {
    content = <CounterpartyEntry party={sides[0]?.parties[0] ?? c.undirected[0]!} />;
  } else {
    const summary = [
      ...sides.map((side) => counterpartySummary(side.parties, side.noun)),
      ...(pools > 0 ? [`${pools} pool${pools === 1 ? "" : "s"}`] : []),
    ].join(" · ");
    content = (
      <Popover
        className="group block lg:relative lg:inline-block lg:align-middle"
        triggerClassName="inline-flex cursor-pointer list-none marker:content-none"
        trigger={<Badge tone="filled">{summary}</Badge>}
        panelLabel={`The other side of transaction ${tx.txid}`}
        panelClassName="panel mt-2 hidden max-h-80 flex-col group-open:flex gap-3 overflow-y-auto p-3 text-left lg:absolute lg:left-0 lg:z-30 lg:min-w-72"
      >
        {sides.map((side) => (
          <CounterpartyList
            key={side.heading}
            heading={side.heading}
            parties={side.parties}
            txid={tx.txid}
          />
        ))}
        {pools > 0 && (
          <CounterpartyList heading="SHIELDED POOLS" parties={c.undirected} txid={tx.txid} />
        )}
      </Popover>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {word !== null && <span className="microlabel text-ink-dim">{word}</span>}
      {content}
    </span>
  );
}

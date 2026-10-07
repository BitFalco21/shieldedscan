import type { Transaction } from "@/domain";
import { poolMigration, txPools } from "@/domain";
import { AmountZec } from "@/components/AmountZec";
import { Panel } from "@/components/Panel";
import { AddressLink } from "@/components/AddressLink";
import { VeilPanel } from "@/components/VeilPanel";
import { capitalise, formatCount, formatZec } from "@/lib/format";
import { txFlowSides } from "./txFlowSides";
import { shieldedFacts } from "./shieldedFacts";

/**
 * Which pool a side of the flow diagram is showing.
 *
 * Derived from `txPools`, never a hand-written list, so a new pool cannot be missed here. On a
 * migration the two sides differ: the spending side names the pools losing value, the receiving
 * side the one gaining it — from the same `poolMigration` the summary sentence uses, so panel and
 * prose cannot disagree.
 */
function shieldedPoolTitle(tx: Transaction, side: "spending" | "receiving"): string {
  const migration = poolMigration(tx);
  const pools = migration
    ? side === "spending"
      ? migration.fromPools
      : [migration.toPool]
    : txPools(tx);
  return `${pools.map(capitalise).join(" + ")} pool`;
}

/**
 * How many transparent entries a side renders before it stops. A sweep transaction can carry
 * thousands of inputs (mainnet `c860a7e8…` has 13,538); rendering every one is a DOM nobody
 * scrolls.
 */
const MAX_RENDERED_ENTRIES = 250;

function TransparentSide({
  title,
  entries,
  total,
}: {
  title: string;
  entries: { address: string; valueZat: number }[];
  total: number;
}) {
  // The TOTAL is computed by the caller over every entry, never over the shown subset.
  const shown = entries.slice(0, MAX_RENDERED_ENTRIES);
  const hidden = entries.length - shown.length;
  return (
    <Panel title={title} className="flex-1">
      <ul>
        {shown.map((e, i) => (
          <li
            key={`${e.address}-${i}`}
            className="hairline-b flex items-center justify-between gap-3 py-2 text-sm last:border-0"
          >
            {/* Named where somebody has named it, the address itself otherwise. The copy
                button carries the address either way — see `AddressLink`. */}
            <AddressLink address={e.address} edge={6} copyable />
            <AmountZec zat={e.valueZat} />
          </li>
        ))}
        {hidden > 0 ? (
          <li className="hairline-b py-2 text-xs leading-relaxed text-ink-faint">
            Showing the first <span className="text-ink">{formatCount(shown.length)}</span> of{" "}
            <span className="text-ink">{formatCount(entries.length)}</span> — the remaining{" "}
            {formatCount(hidden)} are in the API response and in the raw transaction. The total
            below covers all of them.
          </li>
        ) : null}
        <li className="flex items-center justify-between pt-2">
          <span className="microlabel">TOTAL</span>
          <AmountZec zat={total} />
        </li>
      </ul>
    </Panel>
  );
}

export interface TxFlowProps {
  tx: Transaction;
}

export function TxFlow({ tx }: TxFlowProps) {
  const { spendingVeil, receivingVeil } = txFlowSides(tx);
  const totalIn = tx.transparentInputs.reduce((s, e) => s + e.valueZat, 0);
  const totalOut = tx.transparentOutputs.reduce((s, e) => s + e.valueZat, 0);

  const inputSide = tx.isCoinbase ? (
    <Panel title="INPUTS" className="flex-1">
      <p className="py-2 text-sm text-ink-dim">Newly issued coins — block subsidy, no inputs.</p>
    </Panel>
  ) : tx.transparentInputs.length > 0 ? (
    <TransparentSide title="INPUTS — TRANSPARENT" entries={tx.transparentInputs} total={totalIn} />
  ) : spendingVeil ? (
    <div className="flex-1">
      <VeilPanel
        title={`${shieldedPoolTitle(tx, "spending")} · spending`}
        facts={shieldedFacts(tx)}
      />
    </div>
  ) : null;

  const outputPanel =
    tx.transparentOutputs.length > 0 ? (
      <TransparentSide
        title="OUTPUTS — TRANSPARENT"
        entries={tx.transparentOutputs}
        total={totalOut}
      />
    ) : null;
  const veilPanel = receivingVeil ? (
    <VeilPanel
      title={`${shieldedPoolTitle(tx, "receiving")} · receiving`}
      facts={shieldedFacts(tx)}
    />
  ) : null;

  const outputSide =
    outputPanel && veilPanel ? (
      <div className="flex flex-1 flex-col gap-3">
        {outputPanel}
        {veilPanel}
      </div>
    ) : outputPanel ? (
      outputPanel
    ) : veilPanel ? (
      <div className="flex-1">{veilPanel}</div>
    ) : null;

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      {inputSide}
      <div className="flex flex-col items-center justify-center px-2">
        {/* The panels stack vertically until `lg`, so on a phone the arrow must point down.
            Rotated rather than swapped for a ⇓ glyph, which JetBrains Mono may not carry;
            rotation cannot miss. */}
        <span aria-hidden className="rotate-90 text-xl text-green lg:rotate-0">
          ⇒
        </span>
        <span className="text-[10px] text-ink-faint">
          {tx.isCoinbase
            ? "no fee — a coinbase collects them"
            : tx.feeZat !== null
              ? `fee ${formatZec(tx.feeZat)}`
              : "fee unknown"}
        </span>
      </div>
      {outputSide}
    </div>
  );
}

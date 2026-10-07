import { AmountZec } from "@/components/AmountZec";
import { PrivacyShield } from "@/components/PrivacyShield";
import type { PrivacyVariant } from "@/components/PrivacyShield";
import { formatZec } from "@/lib/format";
import { AskZeno } from "./AskZeno";
import { LearnAddress } from "./LearnAddress";
import { LearnRow } from "./LearnRow";
import { CHIP, DIMMED, PANEL_FADE, RING } from "./learn-ui";
import { TourArrow } from "./TourArrow";
import { explainQuestion } from "./sim-model";
import type { SimLedgerRow, SimLeg, SimShape } from "./sim-model";

export interface SimLedgerProps {
  rows: readonly SimLedgerRow[];
  highlight: string | null;
  /** The tour is pointing at another panel. */
  dimmed: boolean;
}

const VARIANT: Readonly<Record<SimShape, PrivacyVariant>> = {
  transparent: "transparent",
  shielding: "mixed",
  shielded: "shielded",
  unshielding: "mixed",
};

function Leg({ leg }: { leg: SimLeg }) {
  if (leg.kind === "address") {
    return (
      <LearnRow
        label={<LearnAddress address={leg.address} owner={leg.owner} variant="short" />}
        value={formatZec(leg.valueZat)}
      />
    );
  }
  if (leg.kind === "pool") {
    return (
      <LearnRow
        label={<span className={`${CHIP} border-edge text-green`}>shielded pool</span>}
        value={formatZec(leg.valueZat)}
      />
    );
  }
  return <LearnRow label={leg.what} value={<AmountZec zat={null} />} />;
}

/**
 * The test chain: each transaction as an explorer would show it. Where the chain is silent,
 * the site's own veil stands in, so the simulator teaches the same grammar the explorer uses.
 */
export function SimLedger({ rows, highlight, dimmed }: SimLedgerProps) {
  return (
    <section
      id="learn-ledger"
      aria-label="The test blockchain"
      className={["panel min-w-0 p-4", PANEL_FADE, dimmed ? DIMMED : ""].join(" ")}
    >
      <h3 className="microlabel text-green">the blockchain · what anyone can look up</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-faint">Nothing on the blockchain yet.</p>
      ) : (
        <ol className="mt-1">
          {rows.map((row, i) => (
            <li
              key={`${row.time}-${i}`}
              id={i === 0 ? "learn-ledger-new" : undefined}
              className={`border-b border-edge-faint py-2.5 last:border-b-0 ${i === 0 && highlight === "ledger-new" ? `rounded ${RING}` : ""}`}
            >
              {row.kind === "offchain" ? (
                <p className="flex flex-wrap gap-x-3 text-sm text-ink-faint">
                  <span className="tabular-nums">{row.time}</span>
                  <span>{row.text}</span>
                </p>
              ) : (
                <div className="grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="text-xs text-ink-faint tabular-nums">{row.time}</span>
                    <PrivacyShield variant={VARIANT[row.shape]} />
                    <span className={`${CHIP} border-edge text-ink-bright`}>{row.shape}</span>
                    <TourArrow on={i === 0 && highlight === "ledger-new"} inline />
                    <span className="ml-auto text-xs text-ink-faint">
                      fee {formatZec(row.feeZat)}
                    </span>
                  </div>
                  <div className="grid items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                    <div className="min-w-0">
                      {row.from.map((leg, j) => (
                        <Leg key={j} leg={leg} />
                      ))}
                    </div>
                    <span
                      aria-hidden
                      className="justify-self-center text-green-dim max-sm:rotate-90"
                    >
                      →
                    </span>
                    <div className="min-w-0">
                      {row.to.map((leg, j) => (
                        <Leg key={j} leg={leg} />
                      ))}
                    </div>
                  </div>
                  {row.note ? <p className="text-sm text-ink-dim">{row.note}</p> : null}
                  <div>
                    <AskZeno
                      question={explainQuestion(row) ?? ""}
                      label="explain this transaction"
                    />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

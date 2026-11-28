import type { ReactNode } from "react";
import { EXCHANGE_NAMES, type CombinedFlowSide, type ExchangeId, type FlowKind } from "@/domain";
import { EcosystemLogo } from "@/components/EcosystemLogo";
import { InfoTip } from "@/components/InfoTip";
import { Panel } from "@/components/Panel";
import { ShareBar } from "@/components/ShareBar";
import { formatCount, formatSharePct, formatZecBalance, formatZecWhole } from "@/lib/format";
import {
  FLOW_KIND_LABELS,
  FLOW_KIND_ORDER,
  FLOW_KIND_SHORT,
  FLOW_KIND_TIPS,
  phoneZec,
} from "./flow-copy";

export interface FlowBreakdownPanelProps {
  title: string;
  /** The side's figures: its total and its parts. */
  side: CombinedFlowSide;
  /**
   * Whether to state the transaction count: true for one exchange. Summed over several, a
   * transaction touching two of them would count twice.
   */
  showTxs: boolean;
}

/** A row's amount: whole coins from `sm`, compact on a phone; the exact figure in the title. */
function Amount({ zat }: { zat: number }) {
  return (
    <span
      className="font-mono whitespace-nowrap text-ink-bright"
      title={`${formatCount(zat)} zatoshi`}
    >
      <span className="sm:hidden">{`${phoneZec(zat)} ZEC`}</span>
      <span className="hidden sm:inline">{formatZecBalance(zat)}</span>
    </span>
  );
}

function Row({
  label,
  short,
  zat,
  total,
  mark,
  tip,
}: {
  label: string;
  /** The label on a phone, where the long form would be cut. */
  short?: string;
  zat: number;
  total: number;
  mark?: ReactNode;
  /** Explains the row; `label` is its spoken name, unique on the page. */
  tip?: { text: string; label: string };
}) {
  const pct = total > 0 ? (100 * zat) / total : null;
  return (
    <div className="relative py-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-dim">
          {mark}
          <span className="truncate">
            <span className="sm:hidden">{short ?? label}</span>
            <span className="hidden sm:inline">{label}</span>
          </span>
          {tip === undefined ? null : <InfoTip text={tip.text} label={tip.label} />}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          <Amount zat={zat} />
          <span className="w-12 text-right font-mono text-xs text-ink-faint">
            {pct === null ? "" : formatSharePct(pct)}
          </span>
        </span>
      </div>
      <ShareBar pct={pct} className="mt-1 h-1 w-full" fillClassName="text-green-dim" />
    </div>
  );
}

/**
 * Where the ZEC came from or went, by kind: what the Sankey of the first design carried, as rows
 * a phone can read. Each row's share is of the side's total; a move between two of the exchanges
 * shown is not in it (the page states that figure apart), so the rows add up to the total.
 */
export function FlowBreakdownPanel({ title, side, showTxs }: FlowBreakdownPanelProps) {
  const byKind = new Map<FlowKind, number>();
  // An exchange this build cannot name yet is "other".
  const exchanges = new Map<ExchangeId | "other", number>();
  for (const p of side.parts) {
    byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + p.zat);
    if (p.kind === "exchange") {
      const key = p.exchange ?? "other";
      exchanges.set(key, (exchanges.get(key) ?? 0) + p.zat);
    }
  }
  const kinds = FLOW_KIND_ORDER.filter((k) => (byKind.get(k) ?? 0) > 0);
  return (
    <Panel title={title}>
      <p className="font-mono text-lg text-ink-bright">
        {side.zat >= 100_000_000 ? formatZecWhole(side.zat) : formatZecBalance(side.zat)}
        {showTxs ? (
          <span className="ms-2 text-xs text-ink-faint">{`${formatCount(side.txs)} transactions`}</span>
        ) : null}
      </p>
      {kinds.length === 0 ? (
        <p className="mt-3 text-sm text-ink-faint">None in this window.</p>
      ) : (
        <div className="mt-2 divide-y divide-edge-faint">
          {kinds.map((k) =>
            k === "exchange" ? (
              <details key={k} className="group">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <Row
                    label={`${FLOW_KIND_LABELS[k]} (${exchanges.size})`}
                    zat={byKind.get(k)!}
                    total={side.zat}
                    mark={
                      <span aria-hidden className="text-ink-faint group-open:rotate-90">
                        ›
                      </span>
                    }
                  />
                </summary>
                <div className="ms-4 border-s border-edge-faint ps-3">
                  {[...exchanges.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([e, zat]) => (
                      <Row
                        key={e}
                        label={e === "other" ? "Another exchange" : EXCHANGE_NAMES[e]}
                        zat={zat}
                        total={side.zat}
                        mark={e === "other" ? undefined : <EcosystemLogo logo={e} />}
                      />
                    ))}
                </div>
              </details>
            ) : (
              <Row
                key={k}
                label={FLOW_KIND_LABELS[k]}
                short={FLOW_KIND_SHORT[k]}
                zat={byKind.get(k)!}
                total={side.zat}
                tip={
                  FLOW_KIND_TIPS[k] === undefined
                    ? undefined
                    : {
                        text: FLOW_KIND_TIPS[k],
                        label: `${FLOW_KIND_LABELS[k].toLowerCase()}, ${title.toLowerCase()}`,
                      }
                }
              />
            ),
          )}
        </div>
      )}
    </Panel>
  );
}

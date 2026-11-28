import {
  EXCHANGES,
  combineFlows,
  type ExchangeFlowWindow,
  type ExchangeId,
  type ExchangeMovement,
  type ExchangeReserveSummary,
} from "@/domain";
import { utcDayFromSeconds } from "@/domain/time";
import { Panel } from "@/components/Panel";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatZecBalance, formatZecWhole } from "@/lib/format";
import { ExchangeFlowChart } from "./ExchangeFlowChart";
import { ExchangeFlowTable } from "./ExchangeFlowTable";
import { ExchangeMovementsTable } from "./ExchangeMovementsTable";
import { EXCHANGE_FLOW_TIPS } from "./flow-copy";
import { FlowBreakdownPanel } from "./FlowBreakdownPanel";

export interface ExchangeFlowsBodyProps {
  flows: ExchangeFlowWindow;
  movements: ExchangeMovement[] | null;
  reserves: ExchangeReserveSummary | null;
  exchange: ExchangeId | null;
  href: (q: { exchange?: ExchangeId | null }) => string;
}

/** Whole coins from 1 ZEC; below it the real precision, never a rounded zero. */
function zec(zat: number): string {
  return Math.abs(zat) >= 100_000_000 ? formatZecWhole(zat) : formatZecBalance(zat);
}

function signedZec(zat: number): string {
  if (zat === 0) return zec(0);
  return `${zat > 0 ? "+" : "−"}${zec(Math.abs(zat))}`;
}

/** The page under its controls, once the flows have been read. */
export function ExchangeFlowsBody({
  flows,
  movements,
  reserves,
  exchange,
  href,
}: ExchangeFlowsBodyProps) {
  const shown = exchange === null ? EXCHANGES : [exchange];
  const combined = combineFlows(flows.totals, shown);
  const tip = exchange === null ? undefined : EXCHANGE_FLOW_TIPS[exchange];
  // A transaction touching two exchanges is one per exchange: summed, the counts would count it
  // twice, so they are given for one exchange only.
  const one = exchange !== null;
  // The counted line below says "counted through"; the API's notes are prose with code marks.
  const notes = flows.notes
    .filter((n) => !n.startsWith("Counted through"))
    .map((n) => n.replace(/`/g, ""));
  const txs = (n: number) => `${formatCount(n)} transactions`;
  return (
    <>
      <p className="mt-4 text-xs text-ink-faint">
        {flows.counted === null
          ? "No whole day is counted yet."
          : `Whole days counted: ${utcDayFromSeconds(flows.counted.from)} to ${utcDayFromSeconds(flows.counted.to)}. A day counts once every block in it is 100 blocks deep.`}
      </p>

      <StatGrid columns={4} className="mt-3">
        <StatCard
          label="IN"
          value={combined === null ? <Unmeasured /> : zec(combined.in.zat)}
          sub={combined === null || !one ? undefined : txs(combined.in.txs)}
        />
        <StatCard
          label="OUT"
          value={combined === null ? <Unmeasured /> : zec(combined.out.zat)}
          sub={combined === null || !one ? undefined : txs(combined.out.txs)}
        />
        <StatCard
          label="NET"
          value={
            combined === null ? (
              <Unmeasured />
            ) : (
              <span className={combined.netZat < 0 ? "text-red" : undefined}>
                {signedZec(combined.netZat)}
              </span>
            )
          }
          sub="the change in what they hold"
        />
        {one ? (
          <StatCard
            label="OWN-WALLET MOVES"
            value={combined === null ? <Unmeasured /> : formatCount(combined.internalTxs)}
            sub={combined === null ? undefined : `${zec(combined.internalFeeZat)} in fees`}
          />
        ) : (
          <StatCard
            label="EXCHANGE TO EXCHANGE"
            value={combined === null ? <Unmeasured /> : zec(combined.betweenZat)}
            sub="sent directly; not in in or out"
          />
        )}
      </StatGrid>

      {tip === undefined ? null : <p className="mt-3 text-sm text-ink-dim">{tip}</p>}
      {notes.length === 0 ? null : (
        <ul className="mt-3 space-y-1 text-xs text-ink-faint">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {combined === null ? null : (
        <div className="mt-6 grid gap-3 *:min-w-0 lg:grid-cols-2">
          <FlowBreakdownPanel title="WHERE IT CAME FROM" side={combined.in} showTxs={one} />
          <FlowBreakdownPanel title="WHERE IT WENT" side={combined.out} showTxs={one} />
        </div>
      )}

      <Panel
        title={flows.interval === "month" ? "IN AND OUT, BY MONTH" : "IN AND OUT, BY DAY"}
        className="mt-6"
      >
        <ExchangeFlowChart points={flows.points} interval={flows.interval} exchange={exchange} />
      </Panel>

      <div className="mt-6 grid gap-6 *:min-w-0">
        <ExchangeFlowTable
          totals={flows.totals}
          reserves={reserves}
          selected={exchange}
          hrefFor={(e) => href({ exchange: e })}
        />
        <ExchangeMovementsTable
          movements={movements}
          fullDates={flows.windowDays === null || flows.windowDays > 90}
        />
      </div>

      <div className="mt-6 mb-10 max-w-[90ch] text-xs leading-relaxed text-ink-faint">
        <p className="microlabel mb-2 text-ink-faint">HOW THIS IS COUNTED</p>
        <ul className="list-disc space-y-1 ps-4">
          <li>
            A transaction&apos;s flow is what it paid an exchange&apos;s labelled addresses minus
            what it spent from them, so change returned to the exchange cancels out.
          </li>
          <li>
            Where it came from or went is named only where the chain says so exactly. Several
            parties on both sides are counted as mixed, never split.
          </li>
          <li>
            Customer deposit addresses are mostly unlabelled, so a deposit usually shows when the
            exchange sweeps it into a labelled wallet. Shielded wallets are not seen at all.
          </li>
        </ul>
      </div>
    </>
  );
}

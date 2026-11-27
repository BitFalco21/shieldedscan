import {
  EXCHANGES,
  EXCHANGE_FLOW_WINDOWS,
  EXCHANGE_NAMES,
  combineFlows,
  type ExchangeFlowWindow,
  type ExchangeFlowWindowId,
  type ExchangeId,
  type ExchangeMovement,
  type ExchangeReserveSummary,
} from "@/domain";
import { utcDayFromSeconds } from "@/domain/time";
import { EcosystemLogo } from "@/components/EcosystemLogo";
import { FilterChips } from "@/components/FilterChips";
import { PageHeader } from "@/components/PageHeader";
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

export interface ExchangeFlowsPageProps {
  flows: ExchangeFlowWindow;
  movements: ExchangeMovement[] | null;
  /** What each exchange holds now; null when the balances could not be read. */
  reserves: ExchangeReserveSummary | null;
  range: ExchangeFlowWindowId;
  /** One exchange, or null for all of them. */
  exchange: ExchangeId | null;
  href: (q: { window?: ExchangeFlowWindowId; exchange?: ExchangeId | null }) => string;
}

function signedZec(zat: number): string {
  if (zat === 0) return formatZecWhole(0);
  return `${zat > 0 ? "+" : "−"}${formatZecWhole(Math.abs(zat))}`;
}

/**
 * `/exchanges`: ZEC into and out of the exchanges' labelled addresses over a window, where it came
 * from and went, and the largest movements. Every figure is the labelled transparent addresses'
 * only, and the page says so once, up top.
 */
export function ExchangeFlowsPage({
  flows,
  movements,
  reserves,
  range,
  exchange,
  href,
}: ExchangeFlowsPageProps) {
  const shown = exchange === null ? EXCHANGES : [exchange];
  const combined = combineFlows(flows.totals, shown);
  const tip = exchange === null ? undefined : EXCHANGE_FLOW_TIPS[exchange];
  // The API's "counted through" note is said by the counted line below instead.
  const notes = flows.notes.filter((n) => !n.startsWith("Counted through"));
  return (
    <>
      <PageHeader
        eyebrow="ANALYTICS"
        title="Exchange flows"
        lede="ZEC moving into and out of the exchange addresses this explorer labels, and where it came from or went. Labelled transparent addresses only, so every figure is a floor."
      />

      <div className="flex flex-col gap-3">
        <FilterChips
          label="WINDOW"
          ariaLabel="Window"
          activeValue={range}
          options={EXCHANGE_FLOW_WINDOWS.map((w) => ({
            value: w.value,
            label: w.label,
            href: href({ window: w.value }),
          }))}
        />
        <FilterChips
          label="EXCHANGE"
          ariaLabel="Exchange"
          activeValue={exchange ?? "all"}
          options={[
            { value: "all", label: "ALL", href: href({ exchange: null }) },
            ...EXCHANGES.map((e) => ({
              value: e,
              label: EXCHANGE_NAMES[e].toUpperCase(),
              href: href({ exchange: e }),
              icon: <EcosystemLogo logo={e} />,
            })),
          ]}
        />
      </div>

      <p className="mt-4 text-xs text-ink-faint">
        {flows.counted === null
          ? "No whole day is counted yet."
          : `Whole days counted: ${utcDayFromSeconds(flows.counted.from)} to ${utcDayFromSeconds(flows.counted.to)}. A day counts once every block in it is 100 blocks deep.`}
      </p>

      <StatGrid columns={4} className="mt-3">
        <StatCard
          label="IN"
          value={combined === null ? <Unmeasured /> : formatZecWhole(combined.in.zat)}
          sub={combined === null ? undefined : `${formatCount(combined.in.txs)} transactions`}
        />
        <StatCard
          label="OUT"
          value={combined === null ? <Unmeasured /> : formatZecWhole(combined.out.zat)}
          sub={combined === null ? undefined : `${formatCount(combined.out.txs)} transactions`}
        />
        <StatCard
          label="NET"
          value={
            combined === null ? (
              <Unmeasured />
            ) : (
              <span
                className={
                  combined.in.zat - combined.out.zat - combined.internalFeeZat < 0
                    ? "text-red"
                    : undefined
                }
              >
                {signedZec(combined.in.zat - combined.out.zat - combined.internalFeeZat)}
              </span>
            )
          }
          sub="the change in what they hold"
        />
        {exchange === null ? (
          <StatCard
            label="BETWEEN EXCHANGES"
            value={combined === null ? <Unmeasured /> : formatZecWhole(combined.betweenZat)}
            sub="left out of in and out"
          />
        ) : (
          <StatCard
            label="OWN-WALLET MOVES"
            value={combined === null ? <Unmeasured /> : formatCount(combined.internalTxs)}
            sub={
              combined === null ? undefined : `${formatZecBalance(combined.internalFeeZat)} in fees`
            }
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
          <FlowBreakdownPanel title="WHERE IT CAME FROM" side={combined.in} />
          <FlowBreakdownPanel title="WHERE IT WENT" side={combined.out} />
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
        <ExchangeMovementsTable movements={movements} />
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

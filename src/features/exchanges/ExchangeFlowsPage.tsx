import {
  EXCHANGES,
  EXCHANGE_FLOW_WINDOWS,
  EXCHANGE_NAMES,
  type ExchangeFlowWindow,
  type ExchangeFlowWindowId,
  type ExchangeId,
  type ExchangeMovement,
  type ExchangeReserveSummary,
} from "@/domain";
import { DataUnavailable } from "@/components/DataUnavailable";
import { EcosystemLogo } from "@/components/EcosystemLogo";
import { FilterChips } from "@/components/FilterChips";
import { PageHeader } from "@/components/PageHeader";
import { ExchangeFlowsBody } from "./ExchangeFlowsBody";

export interface ExchangeFlowsPageProps {
  /** Null when the flows could not be read: the page keeps its controls and says so. */
  flows: ExchangeFlowWindow | null;
  movements: ExchangeMovement[] | null;
  /** What each exchange holds now; null when the balances could not be read. */
  reserves: ExchangeReserveSummary | null;
  range: ExchangeFlowWindowId;
  /** One exchange, or null for all of them. */
  exchange: ExchangeId | null;
  href: (q: { window?: ExchangeFlowWindowId; exchange?: ExchangeId | null }) => string;
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

      {flows === null ? (
        <DataUnavailable what="The exchange flows" className="mt-4" />
      ) : (
        <ExchangeFlowsBody
          flows={flows}
          movements={movements}
          reserves={reserves}
          exchange={exchange}
          href={href}
        />
      )}
    </>
  );
}

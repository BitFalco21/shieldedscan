import Link from "@/components/Link";
import {
  EXCHANGES,
  EXCHANGE_NAMES,
  type ExchangeFlowTotal,
  type ExchangeId,
  type ExchangeReserveSummary,
} from "@/domain";
import { EcosystemLogo } from "@/components/EcosystemLogo";
import { FlushEnd } from "@/components/FlushEnd";
import { InfoTip } from "@/components/InfoTip";
import { Panel } from "@/components/Panel";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatZecWhole } from "@/lib/format";
import { EXCHANGE_FLOW_TIPS, phoneZec } from "./flow-copy";

export interface ExchangeFlowTableProps {
  totals: Record<ExchangeId, ExchangeFlowTotal | null>;
  /** What each exchange holds now; null when the balances could not be read. */
  reserves: ExchangeReserveSummary | null;
  /** The exchange the page is narrowed to; the others are drawn faint. */
  selected: ExchangeId | null;
  /** The page narrowed to one exchange, keeping the window. */
  hrefFor: (exchange: ExchangeId) => string;
}

/** Whole coins from `sm`, compact on a phone; the exact amount in the title. */
function Figure({ zat, signed = false }: { zat: number; signed?: boolean }) {
  const sign = signed && zat !== 0 ? (zat > 0 ? "+" : "−") : "";
  const abs = Math.abs(zat);
  return (
    <span title={`${formatCount(zat)} zatoshi`}>
      <span className="sm:hidden">{`${sign}${phoneZec(abs)}`}</span>
      <span className="hidden sm:inline">{`${sign}${formatZecWhole(abs)}`}</span>
    </span>
  );
}

const TH = "border-b border-edge-faint pb-2 font-normal whitespace-nowrap";

/**
 * Each exchange's flows over the window. Net is in − out − the fees of its own-wallet moves, which
 * is exactly the change in its labelled addresses' balance over the same days.
 */
export function ExchangeFlowTable({ totals, reserves, selected, hrefFor }: ExchangeFlowTableProps) {
  const held = new Map(reserves?.rows.map((r) => [r.exchange, r.zat]) ?? []);
  const rows = EXCHANGES.map((e) => ({ e, t: totals[e] })).sort(
    (a, b) => (b.t ? b.t.in.zat + b.t.out.zat : -1) - (a.t ? a.t.in.zat + a.t.out.zat : -1),
  );
  return (
    <Panel title="BY EXCHANGE, ZEC">
      <div className="overflow-x-auto">
        <table className="data-table w-full min-w-[17rem] text-sm max-sm:text-xs">
          <caption className="sr-only">ZEC into and out of each exchange in the window</caption>
          <thead>
            <tr className="microlabel text-left">
              <th className={`${TH} max-sm:pe-0`}>EXCHANGE</th>
              <th className={`${TH} text-right`}>
                <FlushEnd>IN</FlushEnd>
              </th>
              <th className={`${TH} text-right`}>
                <FlushEnd>OUT</FlushEnd>
              </th>
              <th className={`${TH} text-right max-sm:pe-1`}>
                <FlushEnd>NET</FlushEnd>
              </th>
              <th className={`${TH} hidden text-right sm:table-cell`}>
                <FlushEnd>HELD NOW</FlushEnd>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, t }) => {
              const net = t === null ? null : t.in.zat - t.out.zat - t.internalFeeZat;
              const tip = EXCHANGE_FLOW_TIPS[e];
              const h = held.get(e) ?? null;
              return (
                <tr
                  key={e}
                  className={[
                    "hairline-b last:border-0",
                    selected !== null && selected !== e ? "opacity-50" : "",
                  ].join(" ")}
                >
                  <td className="text-ink-dim max-sm:pe-0">
                    <span className="relative inline-flex items-center gap-1.5 align-top">
                      <EcosystemLogo logo={e} />
                      <Link href={hrefFor(e)} className="hover:text-green hover:underline">
                        {EXCHANGE_NAMES[e]}
                      </Link>
                      {tip === undefined ? null : (
                        <InfoTip text={tip} label={`${EXCHANGE_NAMES[e]}'s figures`} />
                      )}
                    </span>
                  </td>
                  {t === null || net === null ? (
                    <td colSpan={3} className="text-right text-ink-faint max-sm:pe-1">
                      <Unmeasured />
                    </td>
                  ) : (
                    <>
                      <td className="text-right font-mono whitespace-nowrap text-ink-bright">
                        <Figure zat={t.in.zat} />
                      </td>
                      <td className="text-right font-mono whitespace-nowrap text-ink-bright">
                        <Figure zat={t.out.zat} />
                      </td>
                      <td
                        className={[
                          "text-right font-mono whitespace-nowrap max-sm:pe-1",
                          net < 0 ? "text-red" : "text-ink-dim",
                        ].join(" ")}
                      >
                        <Figure zat={net} signed />
                      </td>
                    </>
                  )}
                  <td className="hidden text-right font-mono whitespace-nowrap text-ink-dim sm:table-cell">
                    {h === null ? <Unmeasured /> : <Figure zat={h} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

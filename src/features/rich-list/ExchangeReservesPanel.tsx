import Link from "@/components/Link";
import { EXCHANGE_NAMES, type ExchangeReserveSummary } from "@/domain";
import { DataUnavailable } from "@/components/DataUnavailable";
import { FlushEnd } from "@/components/FlushEnd";
import { Panel } from "@/components/Panel";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatZecBalance, formatZecCompact, formatZecWhole } from "@/lib/format";
import { utcDayFromSeconds } from "@/domain/time";

export interface ExchangeReservesPanelProps {
  /** Null when the series could not be read: the panel says so and nothing else. */
  summary: ExchangeReserveSummary | null;
}

/** A change with its sign, never a bare figure that could read as a balance. */
function signed(zat: number, format: (zat: number) => string): string {
  if (zat === 0) return format(0);
  return `${zat > 0 ? "+" : "−"}${format(Math.abs(zat))}`;
}

/** Whole coins from `sm`, compact on a phone, where four columns of full figures do not fit. */
function Figure({ zat, change = false }: { zat: number; change?: boolean }) {
  return (
    <>
      <span className="sm:hidden">
        {change ? signed(zat, formatZecCompact) : formatZecCompact(zat)}
      </span>
      <span className="hidden sm:inline">
        {change ? signed(zat, formatZecBalance) : formatZecWhole(zat)}
      </span>
    </>
  );
}

/**
 * The labelled exchange addresses' balances on the newest complete day, beside each exchange's
 * change over the days before. The grouping is ours, and says so once.
 */
export function ExchangeReservesPanel({ summary }: ExchangeReservesPanelProps) {
  if (summary === null) {
    return <DataUnavailable what="The exchange balances" className="mt-3" />;
  }
  return (
    <Panel title="ON EXCHANGE ADDRESSES" className="mt-3">
      <div className="overflow-x-auto">
        <table className="data-table w-full min-w-[17rem] text-sm">
          <caption className="sr-only">
            Transparent ZEC on each exchange&apos;s labelled addresses
          </caption>
          <thead>
            <tr className="microlabel text-left">
              <th className="border-b border-edge-faint pb-2 font-normal max-sm:pe-0">EXCHANGE</th>
              <th className="hidden border-b border-edge-faint pb-2 text-right font-normal whitespace-nowrap sm:table-cell">
                <FlushEnd>ADDRESSES</FlushEnd>
              </th>
              <th className="border-b border-edge-faint pb-2 text-right font-normal max-sm:pe-1">
                <FlushEnd>HELD</FlushEnd>
              </th>
              <th className="border-b border-edge-faint pb-2 text-right font-normal whitespace-nowrap">
                <FlushEnd>{`${summary.changeDays}D`}</FlushEnd>
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.exchange} className="hairline-b last:border-0">
                <td className="text-ink-dim max-sm:pe-0">
                  {EXCHANGE_NAMES[r.exchange]}
                  {/* The address count, which the hidden column carries from `sm`. */}
                  <span className="block text-xs text-ink-faint sm:hidden">
                    {` ${formatCount(r.addresses)} addresses`}
                  </span>
                </td>
                <td className="hidden text-right font-mono whitespace-nowrap text-ink-dim sm:table-cell">
                  {formatCount(r.addresses)}
                </td>
                <td
                  className="text-right font-mono whitespace-nowrap text-ink-bright max-sm:pe-1"
                  title={r.zat === null ? undefined : `${formatCount(r.zat)} zatoshi`}
                >
                  {r.zat === null ? <Unmeasured /> : <Figure zat={r.zat} />}
                </td>
                <td
                  className={[
                    "text-right font-mono whitespace-nowrap",
                    r.changeZat !== null && r.changeZat < 0 ? "text-red" : "text-ink-dim",
                  ].join(" ")}
                >
                  {r.changeZat === null ? <Unmeasured /> : <Figure zat={r.changeZat} change />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-faint">
        Labelled addresses only, grouped by exchange by us; unlabelled exchange wallets are not
        counted. At block {formatCount(summary.closeHeight)}, the close of{" "}
        {utcDayFromSeconds(summary.timestamp)}.{" "}
        <Link href="/charts/exchange-reserves" className="text-green hover:underline">
          Daily chart
        </Link>
      </p>
    </Panel>
  );
}

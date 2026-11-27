import Link from "@/components/Link";
import { EXCHANGE_NAMES, type ExchangeMovement } from "@/domain";
import { utcDayFromSeconds } from "@/domain/time";
import { DataUnavailable } from "@/components/DataUnavailable";
import { EcosystemLogo } from "@/components/EcosystemLogo";
import { FlushEnd } from "@/components/FlushEnd";
import { HashLink } from "@/components/HashLink";
import { Panel } from "@/components/Panel";
import { formatCount, formatZecAmount } from "@/lib/format";
import { FLOW_KIND_LABELS, phoneZec } from "./flow-copy";

export interface ExchangeMovementsTableProps {
  /** Largest first; null when they could not be read. */
  movements: ExchangeMovement[] | null;
}

/** Where a movement came from or went: its one counterparty, or how many it split across. */
function where(m: ExchangeMovement): string {
  const real = m.parts.filter((p) => p.kind !== "fee");
  if (real.length === 1) {
    const p = real[0]!;
    return p.kind === "exchange" && p.exchange !== null
      ? EXCHANGE_NAMES[p.exchange]
      : FLOW_KIND_LABELS[p.kind];
  }
  return `${real.length} kinds`;
}

const TH = "border-b border-edge-faint pb-2 font-normal whitespace-nowrap";

/** The window's largest single flows into or out of a labelled exchange address. */
export function ExchangeMovementsTable({ movements }: ExchangeMovementsTableProps) {
  if (movements === null) return <DataUnavailable what="The largest movements" />;
  return (
    <Panel title="LARGEST MOVEMENTS">
      {movements.length === 0 ? (
        <p className="text-sm text-ink-faint">None in this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table w-full min-w-[17rem] text-sm max-sm:text-xs">
            <caption className="sr-only">
              The largest single transactions into or out of a labelled exchange address
            </caption>
            <thead>
              <tr className="microlabel text-left">
                <th className={TH}>DAY</th>
                <th className={TH}>EXCHANGE</th>
                <th className={`${TH} text-right`}>
                  <FlushEnd>ZEC</FlushEnd>
                </th>
                <th className={`${TH} hidden sm:table-cell`}>FROM / TO</th>
                <th className={`${TH} hidden md:table-cell`}>TRANSACTION</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={`${m.txid}:${m.exchange}`} className="hairline-b last:border-0">
                  <td className="font-mono whitespace-nowrap text-ink-dim">
                    {utcDayFromSeconds(m.timestamp).slice(5)}
                  </td>
                  <td className="text-ink-dim">
                    <span className="inline-flex items-center gap-1.5">
                      <EcosystemLogo logo={m.exchange} />
                      <span className="max-sm:sr-only">{EXCHANGE_NAMES[m.exchange]}</span>
                    </span>
                  </td>
                  <td
                    className="text-right font-mono whitespace-nowrap text-ink-bright"
                    title={`${formatCount(m.zat)} zatoshi`}
                  >
                    <Link href={`/tx/${m.txid}`} className="hover:text-green hover:underline">
                      <span className="sm:hidden">{`${m.direction === "in" ? "+" : "−"}${phoneZec(m.zat)}`}</span>
                      <span className="hidden sm:inline">{`${m.direction === "in" ? "+" : "−"}${formatZecAmount(m.zat)}`}</span>
                    </Link>
                  </td>
                  <td className="hidden text-ink-dim sm:table-cell">{where(m)}</td>
                  <td className="hidden md:table-cell">
                    <HashLink value={m.txid} href={`/tx/${m.txid}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-faint">
        + into an exchange, − out of it. A move between two exchanges is listed for each.
      </p>
    </Panel>
  );
}

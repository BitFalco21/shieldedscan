import Link from "@/components/Link";
import { COIN_AGE_BANDS, coinAgeTotalZat, type CoinAgePoint } from "@/domain/coin-age";
import { FlushEnd } from "@/components/FlushEnd";
import { Panel } from "@/components/Panel";
import { CellShareBar } from "@/components/CellShareBar";
import { formatCount, formatSharePct, formatZecBalance } from "@/lib/format";

export interface CoinAgePanelProps {
  /** The newest block the coin-age table covers. */
  point: CoinAgePoint;
}

/**
 * How long the transparent ZEC has sat unspent, at the newest block the table covers: its own
 * height and its own total, which is the whole transparent pool there rather than the rich list's
 * addressed share above.
 */
export function CoinAgePanel({ point }: CoinAgePanelProps) {
  const total = coinAgeTotalZat(point);
  const label = new Map<string, string>(COIN_AGE_BANDS.map((b) => [b.key, b.label]));
  return (
    <Panel
      title="UNSPENT FOR"
      className="mt-3"
      action={
        <Link href="/charts/transparent-coin-age" className="text-xs text-ink-faint hover:text-ink">
          every month →
        </Link>
      }
    >
      <table className="data-table w-full min-w-[17rem] text-sm">
        <caption className="sr-only">
          Transparent value by how long it has sat unspent, at block {formatCount(point.height)}
        </caption>
        <thead>
          <tr className="microlabel text-left">
            <th className="border-b border-edge-faint pb-2 font-normal whitespace-nowrap max-sm:pe-0">
              AGE
            </th>
            <th className="border-b border-edge-faint pb-2 text-right font-normal max-sm:pe-1">
              <FlushEnd>VALUE</FlushEnd>
            </th>
            <th className="border-b border-edge-faint pb-2 font-normal">SHARE</th>
          </tr>
        </thead>
        <tbody>
          {point.bands.map((band) => {
            const pct = total === 0 ? 0 : (band.valueZat / total) * 100;
            return (
              <tr key={band.key} className="hairline-b last:border-0">
                <td className="text-ink-dim max-sm:pe-0 sm:whitespace-nowrap">
                  {label.get(band.key)}
                </td>
                <td className="text-right font-mono whitespace-nowrap text-ink-bright max-sm:pe-1">
                  {formatZecBalance(band.valueZat)}
                </td>
                <td className="sm:w-2/5">
                  <div className="font-mono text-xs whitespace-nowrap text-ink-faint">
                    {formatSharePct(pct, 2)}
                  </div>
                  <CellShareBar pct={pct} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-faint">
        Of {formatZecBalance(total)} transparent at block {formatCount(point.height)}.
      </p>
    </Panel>
  );
}

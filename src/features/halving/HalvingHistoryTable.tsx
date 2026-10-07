import type { HalvingEvent } from "@/domain";
import { utcDayFromSeconds } from "@/domain";
import { FlushEnd } from "@/components/FlushEnd";
import { formatUsdExact, formatZecAmount } from "@/lib/format";
import { Height } from "./Height";

export interface HalvingHistoryTableProps {
  /** The halvings already past, oldest first. */
  events: HalvingEvent[];
  /** The next halving, drawn as the table's last row. */
  next: HalvingEvent;
  /** Daily ZEC closes by UTC day; a day with no close prints a dash. */
  dailyUsd: Record<string, number>;
}

/**
 * Every halving, with the ZEC close on the day it landed.
 *
 * The price is stated and nothing is said about it. It is a fact we hold and a reader will
 * look for; the page draws no line from a halving to a price, in either direction, and the
 * figures themselves decline to tell a tidy story — ZEC closed lower at the second halving
 * than at the first.
 */
export function HalvingHistoryTable({ events, next, dailyUsd }: HalvingHistoryTableProps) {
  const rows = [...events, next];
  return (
    <div className="overflow-x-auto">
      <table className="data-table w-full min-w-[32rem] text-sm">
        <caption className="sr-only">
          Every Zcash subsidy change so far, with the ZEC price on the day
        </caption>
        <thead>
          <tr className="microlabel text-left">
            <th className="border-b border-edge-faint pb-2 font-normal">HEIGHT</th>
            <th className="border-b border-edge-faint pb-2 font-normal">DATE</th>
            <th className="border-b border-edge-faint pb-2 text-right font-normal">
              <FlushEnd>SUBSIDY (ZEC)</FlushEnd>
            </th>
            <th className="border-b border-edge-faint pb-2 text-right font-normal">
              <FlushEnd>TO MINER (ZEC)</FlushEnd>
            </th>
            {/* "PRICE", not "ZEC": the table already has a ZEC column of coins. */}
            <th className="border-b border-edge-faint pb-2 text-right font-normal">
              <FlushEnd>PRICE</FlushEnd>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => {
            const price = e.at === null ? undefined : dailyUsd[utcDayFromSeconds(e.at)];
            return (
              <tr key={e.height} className="hairline-b last:border-0">
                <td>
                  <Height value={e.height} />
                  {/*
                   * Blossom is in this table, marked as not a halving: omitting it would leave
                   * the table starting at 6.25 ZEC with nothing to say where 12.5 went. Amber
                   * because it is a caveat. Both badges carry a real space as well as the margin,
                   * so the cell copies and announces as two words.
                   */}
                  {e.kind === "block-time-change" ? (
                    <>
                      {" "}
                      <span className="ml-1 text-[11px] whitespace-nowrap text-warn">
                        not a halving
                      </span>
                    </>
                  ) : i === rows.length - 1 ? (
                    <>
                      {" "}
                      <span className="ml-1 text-[11px] whitespace-nowrap text-ink-faint">
                        next
                      </span>
                    </>
                  ) : null}
                </td>
                <td className="whitespace-nowrap text-ink-dim">
                  {e.at === null ? (
                    <span className="text-ink-faint">estimated</span>
                  ) : (
                    utcDayFromSeconds(e.at)
                  )}
                </td>
                <td className="text-right font-mono whitespace-nowrap text-ink-dim">
                  {formatZecAmount(e.before.totalZat)} → {formatZecAmount(e.after.totalZat)}
                </td>
                {/*
                 * No badge in this right-aligned column: one would push its row's figure out of
                 * line, and the WHY panel and WHAT CHANGES table already state it.
                 */}
                <td className="text-right font-mono whitespace-nowrap text-ink-dim">
                  {formatZecAmount(e.before.minerZat)} → {formatZecAmount(e.after.minerZat)}
                </td>
                <td className="text-right font-mono whitespace-nowrap text-ink-dim">
                  {price === undefined ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    formatUsdExact(price)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

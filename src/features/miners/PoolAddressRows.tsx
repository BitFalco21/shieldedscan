import type { MinerAddressRow } from "@/domain";
import { AddressLink } from "@/components/AddressLink";
import { formatCount } from "@/lib/format";
import { usdText, zecShort } from "./miners-view";

export interface PoolAddressRowsProps {
  /** The id the opening row's button controls. */
  id: string;
  rows: readonly MinerAddressRow[];
  livePriceUsd: number | null;
}

/**
 * A pool's payout addresses, or the largest unattributed ones, under its row: each linked to its
 * page, with its blocks, what they paid, and that valued at each day's close.
 */
export function PoolAddressRows({ id, rows, livePriceUsd }: PoolAddressRowsProps) {
  return (
    <tr id={id} className="hairline-b bg-green-wash">
      <td colSpan={6} className="py-2">
        <ul className="space-y-1.5 pl-5 text-xs">
          {rows.map((r) => {
            const usd = usdText(r.rewardZat, r.usd, livePriceUsd);
            return (
              <li key={r.address} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <AddressLink address={r.address} edge={6} />
                <span className="text-ink-dim tabular-nums">
                  {formatCount(r.blocks)} {r.blocks === 1 ? "block" : "blocks"} ·{" "}
                  {r.rewardZat === null ? "ZEC unavailable" : zecShort(r.rewardZat)} ·{" "}
                  {usd ?? "USD unavailable"}
                </span>
              </li>
            );
          })}
        </ul>
      </td>
    </tr>
  );
}

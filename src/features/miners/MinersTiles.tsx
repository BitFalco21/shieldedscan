import { blockSharePct, type GroupedMiners, type MinersOverview } from "@/domain";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatSharePct, formatZecCompact } from "@/lib/format";
import { usdText } from "./miners-view";

export interface MinersTilesProps {
  overview: MinersOverview;
  grouped: GroupedMiners;
  livePriceUsd: number | null;
}

/**
 * The window in five figures. "Paid to miners" is what transparent payout addresses received
 * (subsidy share plus the miner's fees); the shielded coinbases' amounts are encrypted, so the
 * sub-line names the blocks it covers. USD values each day at its own close, today at the live
 * price.
 */
export function MinersTiles({ overview, grouped, livePriceUsd }: MinersTilesProps) {
  const { transparent } = overview;
  const usd = usdText(transparent.rewardZat, transparent.usd, livePriceUsd, true);
  const largest = grouped.pools[0];
  const pct = (n: number) => {
    const p = blockSharePct(n, overview.blocks);
    return p === null ? "—" : formatSharePct(p);
  };
  return (
    <StatGrid columns={5} className="mt-3">
      <StatCard
        label="PAID TO MINERS"
        value={
          transparent.rewardZat === null ? (
            <Unmeasured />
          ) : (
            <>
              {formatZecCompact(transparent.rewardZat)}
              <span className="text-base text-ink-dim"> · {usd ?? "USD unavailable"}</span>
            </>
          )
        }
        sub={`${formatCount(transparent.blocks)} transparent-payout blocks`}
      />
      <StatCard
        label="BLOCKS"
        value={formatCount(overview.blocks)}
        sub={`${pct(overview.shieldedBlocks)} shielded coinbase`}
      />
      <StatCard
        label="POOLS ACTIVE"
        value={formatCount(grouped.pools.length)}
        sub={`+ ${formatCount(overview.unattributed.addresses)} unattributed ${
          overview.unattributed.addresses === 1 ? "address" : "addresses"
        }`}
      />
      <StatCard
        label="LARGEST POOL"
        value={
          largest === undefined ? (
            "—"
          ) : (
            <>
              {largest.pool.name}
              <span className="text-base text-ink-dim"> {pct(largest.blocks)}</span>
            </>
          )
        }
        sub={
          largest === undefined
            ? "no reviewed pool mined here"
            : `${largest.addresses.length} payout ${largest.addresses.length === 1 ? "address" : "addresses"}`
        }
      />
      <StatCard
        label="SHIELDED COINBASE"
        value={formatCount(overview.shieldedBlocks)}
        sub="blocks; never attributed"
      />
    </StatGrid>
  );
}

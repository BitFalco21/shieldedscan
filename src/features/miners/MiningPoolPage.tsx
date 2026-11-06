import {
  MINERS_OPEN_WINDOWS,
  blockSharePct,
  type MinerSeries,
  type MinersOverview,
  type MinersWindowKey,
  type MiningPool,
  type MiningPoolBlock,
} from "@/domain";
import { DataUnavailable } from "@/components/DataUnavailable";
import { FilterChips } from "@/components/FilterChips";
import Link from "@/components/Link";
import { MiningPoolMark } from "@/components/MiningPoolMark";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import { formatCount, formatSharePct, formatZecCompact, formatZecTwo, timeAgo } from "@/lib/format";
import { PoolAddressRows } from "./PoolAddressRows";
import { PoolMonthlyShareChart } from "./PoolMonthlyShareChart";
import { PoolRecentBlocks } from "./PoolRecentBlocks";
import { grouped, usdText, WINDOW_LABELS } from "./miners-view";

export interface MiningPoolPageProps {
  pool: MiningPool;
  overview: MinersOverview;
  livePriceUsd: number | null;
  months: MinerSeries | null;
  /** Newest first, or null when they did not load. */
  blocks: MiningPoolBlock[] | null;
  nowSec: number;
  windowHref: (key: MinersWindowKey) => string;
}

/**
 * One reviewed pool: its blocks and pay over the window, its share by month, the payout addresses
 * it is the sum of, and its newest blocks.
 */
export function MiningPoolPage({
  pool,
  overview,
  livePriceUsd,
  months,
  blocks,
  nowSec,
  windowHref,
}: MiningPoolPageProps) {
  const group = grouped(overview).pools.find((g) => g.pool.id === pool.id);
  const share = group === undefined ? null : blockSharePct(group.blocks, overview.blocks);
  const usd = group === undefined ? null : usdText(group.rewardZat, group.usd, livePriceUsd, true);
  const newest = blocks?.[0];
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "MINERS", href: "/miners" }, { label: pool.name.toUpperCase() }]}
        title={
          <span className="flex items-center gap-3">
            <MiningPoolMark miningPool={pool} className="h-6 w-6" />
            {pool.name}
          </span>
        }
        lede="Mining pool. Its figures add up the payout addresses we reviewed for it."
      />

      <FilterChips
        label="WINDOW"
        ariaLabel="Window"
        activeValue={overview.window}
        options={MINERS_OPEN_WINDOWS.map((key) => ({
          value: key,
          label: WINDOW_LABELS[key],
          href: windowHref(key),
        }))}
      />

      <StatGrid columns={4} className="mt-3">
        <StatCard
          label="BLOCKS"
          value={formatCount(group?.blocks ?? 0)}
          sub={
            share === null ? "no blocks in the window" : `${formatSharePct(share)} of all blocks`
          }
        />
        <StatCard
          label="PAID TO THIS POOL"
          value={
            group === undefined ? (
              "—"
            ) : group.rewardZat === null ? (
              <Unmeasured />
            ) : (
              <>
                {formatZecCompact(group.rewardZat)}
                <span className="text-base text-ink-dim"> · {usd ?? "USD unavailable"}</span>
              </>
            )
          }
          sub="subsidy share + fees"
        />
        <StatCard
          label="FEES"
          value={
            group === undefined ? (
              "—"
            ) : group.feeZat === null ? (
              <Unmeasured />
            ) : (
              formatZecTwo(group.feeZat)
            )
          }
          sub="included in what it was paid"
        />
        <StatCard
          label="LAST BLOCK"
          value={
            newest === undefined ? (
              blocks === null ? (
                <Unmeasured />
              ) : (
                "—"
              )
            ) : (
              <Link href={`/block/${newest.height}`} className="hover:text-green">
                #{formatCount(newest.height)}
              </Link>
            )
          }
          sub={newest === undefined ? "none recently" : timeAgo(newest.timestamp, nowSec)}
        />
      </StatGrid>

      <Panel title="SHARE OF BLOCKS BY MONTH" className="mt-3">
        {months === null ? (
          <DataUnavailable what="The monthly series" inset />
        ) : (
          <PoolMonthlyShareChart series={months} pool={pool} />
        )}
      </Panel>

      <Panel title="PAYOUT ADDRESSES" className="mt-3">
        {group === undefined ? (
          <p className="text-sm text-ink-faint">No blocks in this window.</p>
        ) : (
          <table className="w-full">
            <caption className="sr-only">{`${pool.name}'s payout addresses in the window`}</caption>
            <tbody>
              <PoolAddressRows id="addresses" rows={group.addresses} livePriceUsd={livePriceUsd} />
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="RECENT BLOCKS" className="mt-3">
        {blocks === null ? (
          <DataUnavailable what="This pool's recent blocks" inset />
        ) : (
          <PoolRecentBlocks blocks={blocks} nowSec={nowSec} />
        )}
      </Panel>
    </>
  );
}

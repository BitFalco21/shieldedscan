import type {
  ChainInfo,
  IronwoodInflow,
  ShieldedPool,
  ShieldedSupplyPoint,
  SupplyBreakdown,
} from "@/domain";
import { IronwoodPanel } from "./IronwoodPanel";
import { SupplyBreakdownPanel } from "./SupplyBreakdownPanel";
import { shieldedShareOfCirculatingPct, totalShieldedZat, nu7ActiveAt } from "@/domain";
import { coinTicker, network } from "@/lib/network";
import { Panel } from "@/components/Panel";
import { ChartFigure } from "@/features/charts/ChartFigure";
import { chartData } from "@/features/charts/chart-data";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import { VeilPanel } from "@/components/VeilPanel";
import { formatCount, formatZecCompact } from "@/lib/format";
import { PoolCard } from "./PoolCard";
import { PageHeader } from "@/components/PageHeader";

export interface ShieldedPageProps {
  chain: ChainInfo;
  pools: ShieldedPool[];
  /**
   * `null` when the rollup could not be read — distinct from `[]`, which would draw an
   * empty chart and state that no shielded value has ever existed. The pool balances
   * beside it come from the node and are unaffected, so only the chart degrades.
   */
  series: ShieldedSupplyPoint[] | null;
  supply: SupplyBreakdown;
  /**
   * What is filling Ironwood. `null` before NU6.3 activation or where nothing has arrived —
   * the panel then renders nothing at all, rather than an empty breakdown asserting the pool
   * exists and is unused.
   */
  ironwood: IronwoodInflow | null;
}

export function ShieldedPage({ chain, pools, series, supply, ironwood }: ShieldedPageProps) {
  const totalZat = totalShieldedZat(pools);
  const sharePct = shieldedShareOfCirculatingPct(totalZat, chain.circulatingSupplyZat) ?? 0;
  return (
    <>
      <PageHeader
        eyebrow="SHIELDED"
        title="The shielded pools"
        lede="ZEC held behind zero-knowledge encryption. Pool totals are public — everything inside them is not."
      />

      <StatGrid columns={3}>
        <StatCard
          label="TOTAL SHIELDED"
          value={formatZecCompact(totalZat)}
          sub="across all shielded pools"
        />
        <StatCard
          label="SHARE OF SUPPLY"
          value={`${sharePct.toFixed(1)}%`}
          sub={`of circulating ${coinTicker}`}
        />
        <StatCard
          label="FULLY SHIELDED 24H"
          value={
            chain.fullyShieldedPct24h === null ? <Unmeasured /> : `${chain.fullyShieldedPct24h}%`
          }
          sub="of all transactions"
        />
      </StatGrid>

      {/* Two to a row on a tablet, one row from `lg` (as many equal columns as there are pools).
          A single flex row from `sm` would overflow sideways at 640px. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
        {pools.map((p) => (
          <PoolCard
            key={p.pool}
            pool={p}
            sharePct={(p.balanceZat / totalZat) * 100}
            sproutFrozen={nu7ActiveAt(network, chain.height)}
          />
        ))}
      </div>

      <SupplyBreakdownPanel supply={supply} />

      {/* Directly under the pool balances it explains: Ironwood is one of the cards above,
          and this says where its contents came from. */}
      <IronwoodPanel inflow={ironwood} nu7Active={nu7ActiveAt(network, chain.height)} />

      <Panel title="TOTAL SHIELDED SUPPLY OVER TIME" className="mt-3">
        <div className="py-3">
          {/* The single renderer /charts uses — same configuration, same range toggle. */}
          <ChartFigure slug="shielded-supply" data={chartData({ supply: series })} />
        </div>
        {/*
          The series comes from the analytics rollup, which backfills from genesis forward, so
          until it completes the chart covers a stated slice, not chain history. The caption
          retires itself once the last point is within 5,000 blocks (≈ 4 days) of the tip, well
          beyond the one-day gap a complete daily series can have.
        */}
        {series !== null &&
        series.length > 0 &&
        chain.height - series[series.length - 1]!.height > 5_000 ? (
          <p className="mt-1 text-xs text-ink-faint">
            backfill in progress — series so far covers genesis to block{" "}
            {formatCount(series[series.length - 1]!.height)} of {formatCount(chain.height)}
          </p>
        ) : null}
      </Panel>

      {/* Side by side: the veil states what is hidden, the panel how the totals are known
          anyway. The grid stretches both to the row's height. */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <VeilPanel
          title="Why this page can't show more"
          facts={[
            { label: "POOL TOTALS", value: "public — from value balances" },
            { label: "INDIVIDUAL BALANCES", value: "never visible" },
          ]}
        />
        <Panel className="text-sm leading-relaxed text-ink-dim">
          <p>
            Every transaction that crosses a pool boundary declares a public net value — that&apos;s
            how these totals are known without decrypting anything. Inside a pool, amounts, senders,
            and recipients are encrypted with zero-knowledge proofs; no explorer can enumerate them.
          </p>
        </Panel>
      </div>
    </>
  );
}

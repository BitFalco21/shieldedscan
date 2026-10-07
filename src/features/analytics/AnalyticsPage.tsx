import type {
  ActivityPoint,
  ChainInfo,
  ChainMonthPoint,
  FeeKindMonthPoint,
  Fees24h,
  ShieldingFlowPoint,
  FeeDistribution,
} from "@/domain";
import {
  DAY_SECONDS,
  fees24hIsComplete,
  fullyShieldedPct,
  monthTotalTxs,
  targetSpacingSeconds,
} from "@/domain";
import { Panel } from "@/components/Panel";
import { StatCard } from "@/components/StatCard";
import { StatGrid } from "@/components/StatGrid";
import { Unmeasured } from "@/components/Unmeasured";
import { VeilPanel } from "@/components/VeilPanel";
import {
  capitalise,
  compactCount,
  formatZatUsd,
  formatZec,
  monthLong,
  monthShort,
} from "@/lib/format";
import { POOL_CLASSES } from "@/lib/pool-palette";
import { coinTicker, network } from "@/lib/network";
import { ChartFigure } from "@/features/charts/ChartFigure";
import { chartData } from "@/features/charts/chart-data";
import { POOL_STACK } from "@/features/charts/pool-series";
import { FeeCostPanel } from "./FeeCostPanel";
import { PageHeader } from "@/components/PageHeader";

const KIND_LEGEND: { label: string; band: string }[] = [
  { label: "Transparent", band: "band-transparent" },
  { label: "Mixed — one side shielded", band: "band-mixed" },
  { label: "Fully shielded", band: "band-shielded" },
];

const POOL_LEGEND = POOL_STACK.map((pool) => ({
  label: capitalise(pool),
  band: POOL_CLASSES[pool],
}));

function Legend({ items }: { items: { label: string; band: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-dim">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${item.band}`}>
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
              <rect width="10" height="10" fill="currentColor" opacity="0.82" />
            </svg>
          </span>
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Transactions per second and per block, averaged over the last seven whole days.
 *
 * Seven, because one day swings with a single busy hour, and the daily buckets are what
 * the rollup actually carries. The final bucket is dropped: today is partial, and dividing
 * a part-day's transactions by a whole day's seconds understates throughput by however
 * much of the day is left.
 *
 * `null` rather than 0 when there is nothing to average — an unmeasured rate is not a rate
 * of zero, which on this page would read as a chain that had stopped.
 */
function sevenDayThroughput(
  activity: ActivityPoint[] | null,
  spacingSeconds: number,
): { tps: number; perBlock: number } | null {
  if (activity === null || activity.length < 2) return null;
  const whole = activity.slice(0, -1).slice(-7);
  if (whole.length === 0) return null;
  const txs = whole.reduce((sum, p) => sum + p.transparentTxs + p.mixedTxs + p.shieldedTxs, 0);
  const seconds = whole.length * DAY_SECONDS;
  // Blocks are derived from the target spacing at the tip (75 s, 25 s from NU7), not counted,
  // and the figure is labelled an average. It misstates only the week after an activation, when
  // the window straddles both rates.
  const blocks = seconds / spacingSeconds;
  return { tps: txs / seconds, perBlock: blocks === 0 ? 0 : txs / blocks };
}

export interface AnalyticsPageProps {
  series: ChainMonthPoint[];
  /** Trailing-day fees with their coverage. `null` when nothing could be measured. */
  fees24h: Fees24h | null;
  /**
   * Monthly gross shielding flow.
   *
   * `null` means unreadable and renders "unavailable"; `[]` means the chain genuinely has no
   * months. Same distinction `/shielded` draws for its supply series, and for the same
   * reason — an empty chart is a claim, not an absence of one.
   */
  flow: ShieldingFlowPoint[] | null;
  /** Fee statistics by kind. `null` when unreadable; the panel says so itself. */
  feeDistribution: FeeDistribution | null;
  /** For the 24h figures — they come from a poller, not from this month's rollup. */
  chain: ChainInfo;
  /** Daily buckets; the last seven are the throughput average. `null` when unreadable. */
  activity: ActivityPoint[] | null;
  /**
   * The daily siblings behind the chart range toggles, trailing 366 days. Each is `null`
   * when unreadable — the chart then answers a sub-ALL range with its unavailable panel
   * while ALL keeps rendering from the monthly series.
   */
  days: ChainMonthPoint[] | null;
  flowDays: ShieldingFlowPoint[] | null;
  feesDaily: FeeKindMonthPoint[] | null;
}

export function AnalyticsPage({
  series,
  chain,
  activity,
  fees24h,
  flow,
  feeDistribution,
  days,
  flowDays,
  feesDaily,
}: AnalyticsPageProps) {
  const allTxs = series.reduce((sum, p) => sum + monthTotalTxs(p), 0);
  const throughput = sevenDayThroughput(activity, targetSpacingSeconds(network, chain.height));
  const allShielded = series.reduce((sum, p) => sum + p.shieldedTxs, 0);
  const allMixed = series.reduce((sum, p) => sum + p.mixedTxs, 0);

  // The peak month, named rather than left for the reader to find — it is the most
  // striking thing on the chart and it is not what it looks like.
  const peak =
    series.length === 0
      ? null
      : series.reduce((best, p) => (fullyShieldedPct(p) > fullyShieldedPct(best) ? p : best));

  return (
    <>
      <PageHeader
        eyebrow="ANALYTICS"
        title="Network activity"
        lede={
          <>
            Every month since Zcash launched, from the chain itself. Transaction counts and pool
            balances are public by construction; what moves <em className="not-italic">inside</em> a
            pool is not, and nothing here estimates it.
          </>
        }
      />

      <StatGrid columns={4}>
        {/* The all-time total, with the coverage of our dataset as its sub-label. */}
        <StatCard
          label="TRANSACTIONS"
          value={compactCount(allTxs)}
          sub={
            series[0]
              ? `excluding coinbase, since ${monthLong(series[0].timestamp)}`
              : "excluding coinbase, all-time"
          }
        />
        {/* 24h rather than all-time: the all-time shielded share is /shielded's headline. What
            this page adds is the current rate, which the month buckets cannot show. */}
        <StatCard
          label="TRANSACTIONS 24H"
          value={chain.txCount24h === null ? <Unmeasured /> : compactCount(chain.txCount24h)}
          sub={
            chain.fullyShieldedPct24h === null ? (
              "24h window not yet measured"
            ) : (
              <>
                <span className="text-green">{chain.fullyShieldedPct24h}%</span> fully shielded
              </>
            )
          }
        />
        {/* Throughput. Blocks are tens of seconds apart, so transactions per second is small
            and per block legible; the card states both. Seven days, since a single day swings
            on one busy hour. */}
        <StatCard
          label="THROUGHPUT"
          value={throughput === null ? <Unmeasured /> : `${throughput.tps.toFixed(3)} TPS`}
          sub={
            throughput === null
              ? "needs the daily series"
              : `${throughput.perBlock.toFixed(1)} tx per block · 7d average`
          }
        />
        {/* Fees paid in the last 24h, with coverage shown rather than assumed. A block's fee
            total is legitimately NULL when one of its inputs cannot be resolved, so when every
            block is accounted for the sub-line says so; otherwise the figure is labelled a
            floor and carries its denominator.

            `null` stays "unavailable", never 0: zero fees in a day and unmeasured fees are
            different claims. */}
        <StatCard
          label="FEES 24H"
          value={
            fees24h === null ? (
              <Unmeasured />
            ) : (
              // Three display decimals with the exact amount in the title: a stat card is read
              // at a glance. `coinTicker`, not a literal, so a testnet amount is never labelled
              // ZEC.
              <span title={formatZec(fees24h.zat)}>
                {(fees24h.zat / 100_000_000).toFixed(3)} {coinTicker}
              </span>
            )
          }
          sub={
            fees24h === null ? (
              "no block in the window could be measured"
            ) : fees24hIsComplete(fees24h) ? (
              <>
                across {compactCount(fees24h.blocksTotal)} blocks
                {chain.priceUsd !== null ? (
                  <> · {formatZatUsd(fees24h.zat, chain.priceUsd)}</>
                ) : null}
              </>
            ) : (
              <>
                at least — from{" "}
                <span className="text-ink">
                  {compactCount(fees24h.blocksCovered)} of {compactCount(fees24h.blocksTotal)}
                </span>{" "}
                blocks
              </>
            )
          }
        />
      </StatGrid>

      <Panel title="TRANSACTIONS BY PRIVACY KIND" className="mt-3">
        {/* The single renderer /charts uses, so the two surfaces cannot show the same series
            differently. */}
        <ChartFigure slug="transactions-by-kind" data={chartData({ months: series, days })} />
        <Legend items={KIND_LEGEND} />
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-dim">
          Band height is a <span className="text-ink">count</span>, not a share. That is deliberate:{" "}
          {peak !== null ? (
            <>
              the fully-shielded share peaked at{" "}
              <span className="text-ink">{fullyShieldedPct(peak).toFixed(0)}%</span> in{" "}
              <span className="text-ink">{monthShort(peak.timestamp)}</span>, but total volume
              roughly tripled in the same months
            </>
          ) : (
            "shares can move because the numerator changed or because the denominator did"
          )}
          . On a chart normalised to 100% that reads as a wave of privacy adoption; drawn as counts,
          you can see the transaction flood it actually was. A percentage is only honest beside the
          number it is a percentage of.
        </p>
      </Panel>

      <Panel title="WHERE SHIELDED VALUE SITS" className="mt-3">
        <ChartFigure slug="pool-balances" data={chartData({ months: series, days })} />
        <Legend items={POOL_LEGEND} />
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-dim">
          Each pool&apos;s balance at the month&apos;s{" "}
          <span className="text-ink">closing block</span> — not an average, and not a maximum: a
          pool can fall within a month, so neither would be a balance. Together they are the
          migration history, each new pool drawing value from the last as its upgrade activates. The
          totals are public because every transaction crossing a pool boundary declares a net value;
          the amounts held by anyone inside a pool are not, and never appear here.
        </p>
      </Panel>

      {/*
        Gross, not net: a day with 9,817 ZEC shielded and 9,814 unshielded nets to 3.7, which a
        net chart would draw as flat while ~20,000 ZEC crossed the privacy boundary. Both bars
        share one scale, so the net is the visible gap between them.
      */}
      <Panel title="SHIELDED IN AND OUT" className="mt-3">
        <ChartFigure slug="shielding-flow" data={chartData({ flow, flowDays })} />
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-dim">
          Above the line, ZEC entering the shielded pools; below it, ZEC leaving. The two are drawn
          to the same scale, so the <em className="text-ink not-italic">net</em> is the gap between
          them — a period where both bars are long and nearly equal moved a great deal of value
          while netting almost nothing, which a net-only chart shows as flat. Summed from each
          transaction&rsquo;s own declared value balances, Sprout included.
        </p>
      </Panel>

      <FeeCostPanel
        distribution={feeDistribution}
        feesDaily={feesDaily}
        priceUsd={chain.priceUsd}
      />

      {/* Side by side, each at its own height (`items-start`): stretching the veil to match the
          three-paragraph panel would leave a block of empty hatching. */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2 lg:items-start">
        <VeilPanel
          title="What this page will never show"
          facts={[
            { label: "AMOUNTS INSIDE A POOL", value: "encrypted — not estimated" },
            { label: "WHO TRANSACTED", value: "never derivable" },
          ]}
        />
        <Panel className="text-sm leading-relaxed text-ink-dim">
          <p>
            Counts, pool balances and net flows are all genuinely public: they come from transaction
            structure and from the value balances each shielded bundle declares. Nothing here is
            sampled or extrapolated — every month covers every block in it, and the series runs from
            block 0.
          </p>
          <p className="mt-3">
            Fees are absent on purpose. Deriving a fee needs every transaction input resolved, which
            the per-block rollup does not carry, so a fee series would cover a fraction of the chain
            while looking complete — the same reason this page was withdrawn for a day while its
            backfill finished.
          </p>
          <p className="mt-3">
            {allTxs > 0 ? (
              <>
                All-time,{" "}
                <span className="text-ink">{((allShielded / allTxs) * 100).toFixed(1)}%</span> of
                transactions were fully shielded and{" "}
                <span className="text-ink">{((allMixed / allTxs) * 100).toFixed(1)}%</span> had one
                shielded side. The rest were entirely transparent.
              </>
            ) : null}
          </p>
        </Panel>
      </div>
    </>
  );
}

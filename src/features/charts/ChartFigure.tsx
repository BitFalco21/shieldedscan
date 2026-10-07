"use client";

import { useState } from "react";
import type { ChartRange } from "@/domain";
import {
  feeTotalIsComplete,
  sliceRange,
  sliceTail,
  upgradeMarkers,
  utcDayFromSeconds,
} from "@/domain";
import { DataUnavailable } from "@/components/DataUnavailable";
import { FlowBalanceChart } from "@/components/FlowBalanceChart";
import { MultiLineChart } from "@/components/MultiLineChart";
import { PoolAreaChart } from "@/components/PoolAreaChart";
import { RangeToggle } from "@/components/RangeToggle";
import { StackedAreaChart } from "@/components/StackedAreaChart";
import {
  compactCount,
  formatCount,
  formatUsd,
  formatZec,
  formatZecCompact,
  formatZecWhole,
  monthLong,
  monthShort,
} from "@/lib/format";
import type { ChartSlug } from "./catalog";
import type { ChartData } from "./chart-data";
import { poolBands, poolLines } from "./pool-series";

/** An x-axis label: a day for the daily siblings, a short month for the monthly series. */
const axisLabel = (ts: number, daily: boolean) => (daily ? utcDayFromSeconds(ts) : monthShort(ts));

/** A hover-readout label: a day, or a month with its full year, which reads unambiguously alone. */
const readoutLabel = (ts: number, daily: boolean) =>
  daily ? utcDayFromSeconds(ts) : monthLong(ts);

const unavailable = (what: string) => <DataUnavailable what={what} refreshesWithin="15 minutes" />;

export interface ChartFigureProps {
  slug: ChartSlug;
  data: ChartData;
  /**
   * Gallery-size axes. The /charts grid renders each REAL chart at roughly half the content
   * column, scaling the whole viewBox — tick text included — down with it, so compact charts
   * draw their axis text larger in SVG units to land back at a readable size. Forwarded to
   * every chart this component can render; see `COMPACT_TICK_FONT` in `chart-axes.tsx`.
   */
  compact?: boolean;
}

/**
 * The renderer half of the catalog: one component per slug, each reusing the exact chart
 * configuration its home page already ships, so /charts and the source page can never show
 * the same series differently.
 *
 * Every chart carries the ALL / 1Y / 180D / 90D / 60D / 30D toggle except `ironwood-balance`,
 * whose whole series is days old — a range control on a window narrower than its shortest
 * option is a dead control. Ranges are windowed client-side from data already on the page;
 * the monthly charts switch to their daily sibling series below ALL, because thirty days
 * of a monthly series is one point. The grain switch is visible in the axis labels, which
 * is deliberate — resampling months into a fake daily line would be fabrication.
 */
export function ChartFigure({ slug, data, compact = false }: ChartFigureProps) {
  const [range, setRange] = useState<ChartRange>("all");
  if (slug === "ironwood-balance")
    return <Figure slug={slug} data={data} range="all" compact={compact} />;
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <RangeToggle value={range} onChange={setRange} />
      </div>
      <Figure slug={slug} data={data} range={range} compact={compact} />
    </div>
  );
}

function Figure({
  slug,
  data,
  range,
  compact,
}: {
  slug: ChartSlug;
  data: ChartData;
  range: ChartRange;
  compact: boolean;
}) {
  // The monthly charts read their daily sibling for every range short of ALL.
  const daily = range !== "all";
  switch (slug) {
    case "transactions-by-kind": {
      const source = daily ? data.days : data.months;
      if (!source) return unavailable("The monthly activity series");
      const points = sliceRange(source, (p) => p.timestamp, range);
      return (
        <StackedAreaChart
          compact={compact}
          series={[
            {
              key: "transparent",
              label: "Transparent",
              colorClass: "band-transparent",
              values: points.map((p) => p.transparentTxs),
            },
            {
              key: "mixed",
              label: "Mixed",
              colorClass: "band-mixed",
              values: points.map((p) => p.mixedTxs),
            },
            {
              key: "shielded",
              label: "Fully shielded",
              colorClass: "band-shielded",
              values: points.map((p) => p.shieldedTxs),
            },
          ]}
          labels={points.map((p) => axisLabel(p.timestamp, daily))}
          readoutLabels={points.map((p) => readoutLabel(p.timestamp, daily))}
          markers={upgradeMarkers(points)}
          formatValue={compactCount}
          ariaLabel={`Transactions per ${daily ? "day" : "month"} by privacy kind`}
        />
      );
    }
    case "pool-balances": {
      const source = daily ? data.days : data.months;
      if (!source) return unavailable("The monthly pool series");
      const points = sliceRange(source, (p) => p.timestamp, range);
      return (
        <StackedAreaChart
          compact={compact}
          series={poolBands({
            sprout: points.map((p) => p.sproutZat),
            sapling: points.map((p) => p.saplingZat),
            orchard: points.map((p) => p.orchardZat),
            ironwood: points.map((p) => p.ironwoodZat),
          })}
          labels={points.map((p) => axisLabel(p.timestamp, daily))}
          readoutLabels={points.map((p) => readoutLabel(p.timestamp, daily))}
          markers={upgradeMarkers(points)}
          formatValue={formatZecCompact}
          ariaLabel={`Shielded pool balances per ${daily ? "day" : "month"}`}
        />
      );
    }
    case "pool-usage": {
      if (!data.poolUsage) return unavailable("The pool usage series");
      const points = sliceRange(data.poolUsage, (p) => p.timestamp, range);
      if (points.length === 0) return unavailable("The pool usage series");
      // LINES, never a stack: one transaction can carry two pools' bundles, so these four
      // counts do not partition the day's transactions — stacking them would draw a total
      // nobody measured. Same pool ink grammar as pool-balances, so a pool holds its colour
      // across the two charts; `sinceFirstValue` keeps a pool out of the readout before its
      // first use, the pool-balances rule.
      return (
        <MultiLineChart
          compact={compact}
          labels={points.map((p) => utcDayFromSeconds(p.timestamp))}
          series={poolLines({
            sprout: points.map((p) => p.sproutTxs),
            sapling: points.map((p) => p.saplingTxs),
            orchard: points.map((p) => p.orchardTxs),
            ironwood: points.map((p) => p.ironwoodTxs),
          })}
          formatValue={compactCount}
          ariaLabel="Transactions touching each shielded pool per day"
        />
      );
    }
    case "pool-migrations": {
      if (!data.poolMigrations) return unavailable("The pool migration series");
      const points = sliceRange(data.poolMigrations, (p) => p.timestamp, range);
      // StackedAreaChart needs two points to draw a band.
      if (points.length < 2) return unavailable("The pool migration series");
      // A STACK, honestly: each migration has exactly one destination pool, so the
      // destination bands partition the day's migrated value — the inverse of pool-usage.
      return (
        <StackedAreaChart
          compact={compact}
          series={poolBands({
            sprout: points.map((p) => p.toSproutZat),
            sapling: points.map((p) => p.toSaplingZat),
            orchard: points.map((p) => p.toOrchardZat),
            ironwood: points.map((p) => p.toIronwoodZat),
          })}
          labels={points.map((p) => utcDayFromSeconds(p.timestamp))}
          readoutLabels={points.map((p) => utcDayFromSeconds(p.timestamp))}
          // No upgrade markers: `upgradeMarkers` places a rule by each point's `topHeight`,
          // and this day-grained series carries no height. Each activation is visible as its
          // pool's band starting, which is the fact a marker would restate.
          formatValue={formatZecCompact}
          ariaLabel="ZEC migrating between shielded pools per day, by destination pool"
        />
      );
    }
    case "shielding-flow": {
      const source = daily ? data.flowDays : data.flow;
      if (!source) return unavailable("The shielding flow series");
      const points = sliceRange(source, (p) => p.timestamp, range);
      return (
        <FlowBalanceChart
          compact={compact}
          points={points.map((p) => ({
            label: axisLabel(p.timestamp, daily),
            inValue: p.shieldedZat,
            outValue: p.unshieldedZat,
          }))}
          readoutLabels={points.map((p) => readoutLabel(p.timestamp, daily))}
          inLabel="Shielded"
          outLabel="Unshielded"
          formatValue={formatZecCompact}
          ariaLabel={`ZEC shielded and unshielded per ${daily ? "day" : "month"}, on one scale`}
        />
      );
    }
    case "median-fee": {
      const source = daily ? data.feesDaily : (data.fees?.monthly ?? null);
      if (!source) return unavailable("The fee series");
      const m = sliceRange(source, (p) => p.timestamp, range);
      return (
        <MultiLineChart
          compact={compact}
          labels={m.map((p) => readoutLabel(p.timestamp, daily))}
          series={[
            {
              name: "Fully shielded",
              values: m.map((p) => p.shieldedZat),
              className: "text-green",
            },
            {
              name: "Mixed",
              values: m.map((p) => p.mixedZat),
              className: "text-green",
              opacity: 0.55,
            },
            {
              name: "Transparent",
              values: m.map((p) => p.transparentZat),
              className: "text-ink-dim",
            },
          ]}
          formatValue={formatZec}
          ariaLabel={`Median transaction fee per ${daily ? "day" : "month"}, by privacy kind`}
        />
      );
    }
    case "shielded-supply": {
      if (!data.supply) return unavailable("The shielded supply series");
      // One published point per day and no timestamps on it, so the tail IS the window.
      return (
        <PoolAreaChart
          points={sliceTail(data.supply, range)}
          formatValue={formatZecWhole}
          compact={compact}
        />
      );
    }
    case "ironwood-balance": {
      if (!data.ironwood) return unavailable("The Ironwood balance series");
      return (
        <MultiLineChart
          compact={compact}
          labels={data.ironwood.balance.map((p) =>
            new Date(p.timestamp * 1000).toISOString().slice(5, 16).replace("T", " "),
          )}
          series={[
            {
              name: "Pool balance",
              values: data.ironwood.balance.map((p) => p.ironwoodZat),
              className: "text-green",
            },
          ]}
          formatValue={formatZecWhole}
          ariaLabel="Ironwood pool balance since activation, hourly"
        />
      );
    }
    case "price": {
      if (!data.prices) return unavailable("The price series");
      const days = sliceTail(Object.keys(data.prices).sort(), range);
      return (
        <MultiLineChart
          compact={compact}
          labels={days}
          series={[
            {
              name: "ZEC/USD close",
              values: days.map((d) => data.prices![d] ?? null),
              className: "text-green",
            },
          ]}
          formatValue={formatUsd}
          ariaLabel="Daily ZEC price in USD"
        />
      );
    }
    case "difficulty": {
      if (!data.network) return unavailable("The difficulty series");
      const points = sliceRange(data.network, (p) => p.timestamp, range);
      // Not just `!data.network`: a day with no difficulty is a legitimate `null` and the line
      // gaps, but a window where every point is null would draw axes around an empty plot.
      if (!points.some((p) => p.avgDifficulty !== null)) {
        return unavailable("The difficulty series");
      }
      return (
        <MultiLineChart
          compact={compact}
          labels={points.map((p) => utcDayFromSeconds(p.timestamp))}
          series={[
            {
              name: "Difficulty (daily avg)",
              values: points.map((p) => p.avgDifficulty),
              className: "text-green",
            },
          ]}
          formatValue={(v) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          ariaLabel="Daily average mining difficulty"
        />
      );
    }
    case "fee-totals": {
      const series = data.feeTotals;
      if (!series) return unavailable("The fee totals series");
      const source = daily ? series.daily : series.monthly;
      const points = sliceRange(source, (p) => p.timestamp, range);
      return (
        <MultiLineChart
          compact={compact}
          labels={points.map((p) => readoutLabel(p.timestamp, daily))}
          series={[
            {
              name: "Fees paid",
              values: points.map((p) => p.feeZat),
              className: "text-green",
            },
          ]}
          /*
           * The denominator, per point. A block's fee total is legitimately NULL when a
           * transaction in it has an unresolvable input, so an uncovered block drops out of the
           * sum and the line dips without any fall in fee demand. Fees are repaired, not
           * guaranteed, so coverage travels with each point. A context row rather than a series:
           * a block count does not belong on a zatoshi axis.
           */
          contextRows={[
            {
              name: "Blocks",
              values: points.map((p) => {
                const covered = `${formatCount(p.blocksCovered)} of ${formatCount(p.blocks)}`;
                // "partial" says the total rests on fewer blocks than the period holds.
                return feeTotalIsComplete(p) ? `${covered} blocks` : `${covered} blocks · partial`;
              }),
            },
          ]}
          formatValue={formatZecCompact}
          ariaLabel={`Total fees paid per ${daily ? "day" : "month"}`}
        />
      );
    }
    case "crosschain-volume": {
      const series = data.crosschainVolume;
      if (!series) return unavailable("The cross-chain volume series");
      const source = daily ? series.daily : series.monthly;
      const points = sliceRange(source, (p) => p.timestamp, range);
      // The same both-directions-one-ruler component the shielding flow uses: the gap
      // between the bars IS the net, which a net-only line would hide entirely.
      return (
        <FlowBalanceChart
          compact={compact}
          points={points.map((p) => ({
            label: axisLabel(p.timestamp, daily),
            inValue: p.inZat,
            outValue: p.outZat,
          }))}
          readoutLabels={points.map((p) => readoutLabel(p.timestamp, daily))}
          // Not "Shielded"/"Unshielded": these are bridge crossings, and the site's own word
          // for the two sides is inbound/outbound (`directionFilterLabel`).
          inLabel="Inbound"
          outLabel="Outbound"
          formatValue={formatZecCompact}
          ariaLabel={`ZEC arriving on and leaving Zcash per ${daily ? "day" : "month"}, on one scale`}
        />
      );
    }
    case "block-size": {
      if (!data.network) return unavailable("The block size series");
      const points = sliceRange(data.network, (p) => p.timestamp, range);
      // `avgBlockBytes` comes from a NOT NULL column so it is never absent per day, but an
      // empty window still has to be caught here rather than drawing an empty plot.
      if (points.length === 0) return unavailable("The block size series");
      return (
        <MultiLineChart
          compact={compact}
          labels={points.map((p) => utcDayFromSeconds(p.timestamp))}
          series={[
            {
              name: "Avg block size",
              values: points.map((p) => p.avgBlockBytes / 1024),
              className: "text-green",
            },
          ]}
          formatValue={(v) => `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} kB`}
          ariaLabel="Daily average block size in kilobytes"
        />
      );
    }
  }
}

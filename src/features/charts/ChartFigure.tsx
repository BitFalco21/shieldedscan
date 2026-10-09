"use client";

import { useState } from "react";
import type { ChartRange, CrossChainProtocol } from "@/domain";
import {
  feeTotalIsComplete,
  NU7,
  NU7_RELEASES,
  parseChartRange,
  protocolLabel,
  sliceRange,
  sliceTail,
  upgradeMarkers,
  utcDayFromSeconds,
} from "@/domain";
import { ChartLegend } from "@/components/ChartLegend";
import { DataUnavailable } from "@/components/DataUnavailable";
import { FlowBalanceChart } from "@/components/FlowBalanceChart";
import { MultiLineChart } from "@/components/MultiLineChart";
import { PoolAreaChart } from "@/components/PoolAreaChart";
import { RangeToggle } from "@/components/RangeToggle";
import { StackedAreaChart } from "@/components/StackedAreaChart";
import { readinessChart } from "@/features/network/upgrade/readiness-chart";
import { chainName } from "@/lib/chains";
import { FOLDED_FLOW_CLASS, flowPaletteClass, VENUE_CLASSES } from "@/lib/flow-palette";
import {
  compactCount,
  formatCount,
  formatSharePct,
  formatUsd,
  formatZec,
  formatZecCompact,
  formatZecVolumeCompact,
  formatZecTick,
  formatZecWhole,
  monthLong,
  monthShort,
} from "@/lib/format";
import { POOL_CLASSES } from "@/lib/pool-palette";
import { useQueryParam } from "@/lib/use-query-param";
import { BESIDE_RANKED_LINE, KIND_CLASSES, RANKED_LINES } from "@/lib/ranked-palette";
import type { ChartSlug } from "./catalog";
import { ChartActions } from "./ChartActions";
import type { ChartData } from "./chart-data";
import { chartLegend } from "./chart-legend";
import {
  chartTable,
  FOLDED_KEY,
  runningMonth,
  UNRANGED,
  type ChartCell,
  type ChartTable,
} from "./chart-table";
import { RankedBarsChart } from "./RankedBarsChart";
import { poolBands, poolLines } from "./pool-series";

/** An x-axis label: a day for the daily siblings, a short month for the monthly series. */
const axisLabel = (ts: number, daily: boolean) => (daily ? utcDayFromSeconds(ts) : monthShort(ts));

/** A hover-readout label: a day, or a month with its full year, which reads unambiguously alone. */
const readoutLabel = (ts: number, daily: boolean) =>
  daily ? utcDayFromSeconds(ts) : monthLong(ts);

const unavailable = (what: string) => <DataUnavailable what={what} refreshesWithin="15 minutes" />;

/** One column of a table, as a series' values. */
const column = (t: ChartTable, i: number) => t.rows.map((r) => r[i] ?? null);

/** Axis labels for a table's rows: days, Mondays or short months, by its period. */
const tableLabels = (t: ChartTable) =>
  t.timestamps.map((ts) => (t.period === "month" ? monthShort(ts) : utcDayFromSeconds(ts)));

/** Readout labels: unambiguous on their own, so a month carries its year and a week says so. */
const tableReadout = (t: ChartTable) =>
  t.timestamps.map((ts) =>
    t.period === "month"
      ? monthLong(ts)
      : t.period === "week"
        ? `Week of ${utcDayFromSeconds(ts)}`
        : utcDayFromSeconds(ts),
  );

/**
 * A count's axis labels whole numbers only: an axis tick at "1.5 reorgs" names a quantity that
 * cannot occur. Values a reader hovers are whole already, so the readout is unaffected.
 */
const wholeCount = (v: number) => (Number.isInteger(v) ? formatCount(v) : "");

/** Days in a timestamp's UTC month, to say when a monthly figure is partial. */
const daysInMonth = (ts: number) => {
  const d = new Date(ts * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};

export interface ChartFigureProps {
  slug: ChartSlug;
  data: ChartData;
  /**
   * A chart's own page: the range lives in the URL, so a shared link opens on what the sender
   * saw, and the toolbar carries the CSV download and the copy-link button.
   */
  detail?: boolean;
}

/**
 * The renderer half of the catalog: one component per slug, each reusing the exact chart
 * configuration its home page already ships, so /charts and the source page can never show
 * the same series differently.
 *
 * Every chart carries the ALL / 1Y / 180D / 90D / 60D / 30D toggle except the `UNRANGED` ones:
 * `ironwood-balance`, whose whole series is days old, and the monthly or weekly series with no
 * daily sibling, where thirty days would be one or four points. Ranges are windowed client-side from data already on the page;
 * the monthly charts switch to their daily sibling series below ALL, because thirty days
 * of a monthly series is one point. The grain switch is visible in the axis labels, which
 * is deliberate — resampling months into a fake daily line would be fabrication.
 */
export function ChartFigure({ slug, data, detail = false }: ChartFigureProps) {
  const [localRange, setLocalRange] = useState<ChartRange>("all");
  const [urlRange, setUrlRange] = useQueryParam("range");
  // ironwood-balance has no range control: its whole series is narrower than the shortest option.
  const ranged = !UNRANGED.has(slug);
  const range: ChartRange = !ranged
    ? "all"
    : detail
      ? parseChartRange(urlRange ?? undefined)
      : localRange;
  const setRange = (next: ChartRange) =>
    detail ? setUrlRange(next === "all" ? null : next) : setLocalRange(next);

  const toolbar = (
    <div
      className={`mb-3 flex flex-wrap items-center gap-3 ${detail ? "justify-between" : "justify-end"}`}
    >
      {ranged && <RangeToggle value={range} onChange={setRange} />}
      {detail && <ChartActions slug={slug} data={data} range={range} />}
    </div>
  );
  return (
    <div>
      {(ranged || detail) && toolbar}
      <Figure slug={slug} data={data} range={range} />
      <ChartLegend items={chartLegend(slug)} />
    </div>
  );
}

function Figure({ slug, data, range }: { slug: ChartSlug; data: ChartData; range: ChartRange }) {
  // The monthly charts read their daily sibling for every range short of ALL.
  const daily = range !== "all";
  switch (slug) {
    case "transactions-by-kind": {
      const source = daily ? data.days : data.months;
      if (!source) return unavailable("The monthly activity series");
      const points = sliceRange(source, (p) => p.timestamp, range);
      return (
        <StackedAreaChart
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
          formatTick={formatZecTick}
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
          formatTick={formatZecTick}
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
          points={points.map((p) => ({
            label: axisLabel(p.timestamp, daily),
            inValue: p.shieldedZat,
            outValue: p.unshieldedZat,
          }))}
          readoutLabels={points.map((p) => readoutLabel(p.timestamp, daily))}
          inLabel="Shielded"
          outLabel="Unshielded"
          formatValue={formatZecCompact}
          formatTick={formatZecTick}
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
          labels={m.map((p) => readoutLabel(p.timestamp, daily))}
          series={[
            {
              name: "Fully shielded",
              values: m.map((p) => p.shieldedZat),
              className: KIND_CLASSES.shielded,
            },
            {
              name: "Mixed",
              values: m.map((p) => p.mixedZat),
              className: KIND_CLASSES.mixed,
            },
            {
              name: "Transparent",
              values: m.map((p) => p.transparentZat),
              className: KIND_CLASSES.transparent,
            },
          ]}
          formatValue={formatZec}
          formatTick={formatZecTick}
          ariaLabel={`Median transaction fee per ${daily ? "day" : "month"}, by privacy kind`}
        />
      );
    }
    case "shielded-supply": {
      if (!data.supply) return unavailable("The shielded supply series");
      // One published point per day and no timestamps on it, so the tail IS the window.
      return <PoolAreaChart points={sliceTail(data.supply, range)} formatValue={formatZecWhole} />;
    }
    case "ironwood-balance": {
      if (!data.ironwood) return unavailable("The Ironwood balance series");
      return (
        <MultiLineChart
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
              // A complete period states its count once; "of" and "partial" appear only when
              // the total rests on fewer blocks than the period holds.
              values: points.map((p) =>
                feeTotalIsComplete(p)
                  ? formatCount(p.blocks)
                  : `${formatCount(p.blocksCovered)} of ${formatCount(p.blocks)} · partial`,
              ),
            },
          ]}
          formatValue={formatZecCompact}
          formatTick={formatZecTick}
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
          formatTick={formatZecTick}
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
    case "privacy-share": {
      const t = chartTable(slug, data, range);
      if (!t || t.rows.length < 2) return unavailable("The activity series");
      return (
        <MultiLineChart
          labels={tableLabels(t)}
          readoutLabels={tableReadout(t)}
          series={[
            { name: "Fully shielded", values: column(t, 0), className: KIND_CLASSES.shielded },
            { name: "Mixed", values: column(t, 1), className: KIND_CLASSES.mixed },
            { name: "Transparent", values: column(t, 2), className: KIND_CLASSES.transparent },
          ]}
          yMax={100}
          formatValue={(v) => formatSharePct(v)}
          // The denominator of every share at that point.
          contextRows={[
            {
              name: "Transactions",
              values: column(t, 3).map((v) => (v === null ? "—" : formatCount(v))),
            },
          ]}
          ariaLabel={`Share of transactions per ${t.period} by privacy kind`}
        />
      );
    }
    case "anonymity-set": {
      const t = chartTable(slug, data, range);
      if (!t || t.rows.length < 2) return unavailable("The note commitment tree series");
      return (
        <MultiLineChart
          labels={tableLabels(t)}
          series={[
            {
              name: "Sapling",
              values: column(t, 0),
              className: POOL_CLASSES.sapling,
              omitNullFromReadout: true,
            },
            {
              name: "Orchard",
              values: column(t, 1),
              className: POOL_CLASSES.orchard,
              omitNullFromReadout: true,
            },
            {
              name: "Ironwood",
              values: column(t, 2),
              className: POOL_CLASSES.ironwood,
              omitNullFromReadout: true,
            },
          ]}
          formatValue={compactCount}
          ariaLabel="Notes in each shielded pool's commitment tree, per day"
        />
      );
    }
    case "blocks-per-day": {
      const t = chartTable(slug, data, range);
      if (!t || t.rows.length < 2) return unavailable("The blocks per day series");
      return (
        <MultiLineChart
          labels={tableLabels(t)}
          series={[
            { name: "Blocks", values: column(t, 0), className: "text-green" },
            { name: "Target", values: column(t, 1), className: "text-ink-faint", dashed: true },
          ]}
          formatValue={wholeCount}
          ariaLabel="Blocks mined per day, against the protocol's daily target"
        />
      );
    }
    case "transparent-activity": {
      const t = chartTable(slug, data, range);
      if (!t || t.rows.filter((r) => r[0] !== null).length < 2) {
        return unavailable("The transparent activity series");
      }
      return (
        <MultiLineChart
          labels={tableLabels(t)}
          series={[
            {
              name: "Active addresses",
              values: column(t, 0),
              className: KIND_CLASSES.transparent,
            },
          ]}
          formatValue={compactCount}
          ariaLabel="Distinct transparent addresses active per day"
        />
      );
    }
    case "upgrade-readiness": {
      if (!data.releases) return unavailable("The release record");
      // Windowed on the same days the table keeps, so the CSV and the lines agree.
      const t = chartTable(slug, data, range);
      const kept = new Set(t?.timestamps.map((ts) => utcDayFromSeconds(ts)) ?? []);
      const { chart } = readinessChart(
        { ...data.releases, history: data.releases.history.filter((d) => kept.has(d.day)) },
        NU7,
        NU7_RELEASES,
      );
      if (!chart) return unavailable("The release record");
      return <MultiLineChart {...chart} />;
    }
    case "miner-concentration": {
      const t = chartTable(slug, data, range);
      if (!t || t.rows.length < 2) return unavailable("The mining series");
      return (
        <MultiLineChart
          labels={tableLabels(t)}
          readoutLabels={tableReadout(t)}
          series={[
            { name: "Largest address", values: column(t, 0), className: RANKED_LINES[0] },
            { name: "Largest 3", values: column(t, 1), className: RANKED_LINES[1] },
            { name: "Largest 10", values: column(t, 2), className: RANKED_LINES[2] },
            {
              name: "Paid to a shielded address",
              values: column(t, 3),
              className: BESIDE_RANKED_LINE,
            },
          ]}
          yMax={100}
          formatValue={(v) => formatSharePct(v)}
          contextRows={[
            {
              // The denominator, and whether the month is complete in the index.
              name: "Blocks",
              values: t.rows.map((r, i) => {
                const blocks = r[4] ?? null;
                if (blocks === null) return "—";
                const partial = (r[5] ?? 0) < daysInMonth(t.timestamps[i]!);
                return `${formatCount(blocks)}${partial ? " · partial month" : ""}`;
              }),
            },
          ]}
          ariaLabel="Share of each month's blocks paid to the largest one, three and ten payout addresses, and to a shielded address"
        />
      );
    }
    case "reorgs": {
      const t = chartTable(slug, data, range);
      if (!t || t.rows.length === 0) return unavailable("The reorg record");
      return (
        <MultiLineChart
          labels={tableLabels(t)}
          readoutLabels={tableReadout(t)}
          series={[{ name: "Reorgs", values: column(t, 0), className: "text-series" }]}
          // Each week is a count: a dot per week says so, where a bare line would imply a rate.
          markers
          formatValue={wholeCount}
          contextRows={[
            {
              name: "Deepest",
              values: column(t, 1).map((v) =>
                !v ? "—" : `${formatCount(v)} block${v === 1 ? "" : "s"}`,
              ),
            },
          ]}
          ariaLabel="Reorganisations this explorer's node observed per week"
        />
      );
    }
    case "inflow-by-chain":
    case "outflow-by-chain":
    case "volume-by-venue": {
      const t = chartTable(slug, data, range);
      if (!t || t.rows.length < 2) return unavailable("The cross-chain series");
      const venues = slug === "volume-by-venue";
      const label = (key: string) =>
        key === FOLDED_KEY
          ? "Other chains"
          : venues
            ? protocolLabel(key as CrossChainProtocol)
            : chainName(key);
      const colour = (key: string) =>
        key === FOLDED_KEY
          ? FOLDED_FLOW_CLASS
          : venues
            ? VENUE_CLASSES[key as CrossChainProtocol]
            : flowPaletteClass(key);
      return (
        <RankedBarsChart
          series={(t.keys ?? []).map((key, i) => ({
            key,
            label: label(key),
            colorClass: colour(key),
            values: column(t, i).map((v) => v ?? 0),
          }))}
          labels={tableLabels(t)}
          readoutLabels={tableReadout(t)}
          running={runningMonth(t, data.asOf)}
          foldKey={FOLDED_KEY}
          formatValue={formatZecCompact}
          formatSum={(v) => `${formatZecVolumeCompact(v)} ZEC`}
          formatTick={formatZecTick}
          ariaLabel={
            slug === "inflow-by-chain"
              ? "ZEC arriving on Zcash per month, by source chain"
              : slug === "outflow-by-chain"
                ? "ZEC leaving Zcash per month, by destination chain"
                : "ZEC swapped per month through each venue, both directions"
          }
        />
      );
    }
    case "shielded-capable-swaps": {
      const t = chartTable(slug, data, range);
      if (!t || t.rows.length < 2) return unavailable("The cross-chain series");
      return (
        <MultiLineChart
          labels={tableLabels(t)}
          readoutLabels={tableReadout(t)}
          series={[
            { name: "Share of swaps", values: column(t, 0), className: RANKED_LINES[0] },
            { name: "Share of ZEC", values: column(t, 1), className: RANKED_LINES[1] },
          ]}
          yMax={100}
          formatValue={(v) => formatSharePct(v)}
          ariaLabel="Share of swaps into ZEC each month sent to a shielded-capable address, by swaps and by ZEC"
        />
      );
    }
    case "shielded-share": {
      const t = chartTable(slug, data, range);
      if (!t || t.rows.length < 2) return unavailable("The supply series");
      const zec = (v: ChartCell) => (v === null ? "—" : formatZecWhole(v));
      return (
        <MultiLineChart
          labels={tableLabels(t)}
          readoutLabels={tableReadout(t)}
          series={[{ name: "Shielded", values: column(t, 0), className: KIND_CLASSES.shielded }]}
          formatValue={(v) => formatSharePct(v)}
          contextRows={[
            { name: "Shielded ZEC", values: column(t, 1).map(zec) },
            { name: "Circulating ZEC", values: column(t, 2).map(zec) },
          ]}
          ariaLabel={`Share of circulating ZEC held in the shielded pools, per ${t.period}`}
        />
      );
    }
    case "lockbox-balance": {
      const t = chartTable(slug, data, range);
      if (!t || t.rows.length < 2) return unavailable("The supply series");
      return (
        <MultiLineChart
          labels={tableLabels(t)}
          readoutLabels={tableReadout(t)}
          series={[{ name: "Lockbox", values: column(t, 0), className: "text-series" }]}
          formatValue={formatZecWhole}
          ariaLabel="ZEC held in the NU6 dev-fund lockbox at each day's close"
        />
      );
    }
  }
}

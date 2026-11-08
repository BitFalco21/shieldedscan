import {
  MINERS_OPEN_WINDOWS,
  blockSharePct,
  type MinerSeries,
  type MinersOverview,
  type MinersWindowKey,
  type MiningTerms,
  type NsmOverview,
} from "@/domain";
import { DataUnavailable } from "@/components/DataUnavailable";
import { FilterChips } from "@/components/FilterChips";
import { PageHeader } from "@/components/PageHeader";
import { Panel } from "@/components/Panel";
import { formatCount, formatSharePct } from "@/lib/format";
import { MinerDailyCharts } from "./MinerDailyCharts";
import { MinerFeesChart } from "./MinerFeesChart";
import { MinersTiles } from "./MinersTiles";
import { MoreMiningLinks } from "./MoreMiningLinks";
import { NsmSection } from "./NsmSection";
import { PoolShareBar } from "./PoolShareBar";
import { PoolShareByMonthChart } from "./PoolShareByMonthChart";
import { PoolTable } from "./PoolTable";
import { TipStrip } from "./TipStrip";
import { grouped, shareSegments, WINDOW_LABELS } from "./miners-view";

export interface MinersPageProps {
  overview: MinersOverview;
  /** The tip's terms, or null when they did not load: only that strip says so. */
  terms: MiningTerms | null;
  months: MinerSeries | null;
  /** The day series, trimmed to the days drawn. */
  days: MinerSeries | null;
  /** The NSM since NU7, or null when it did not load: only its section says so. */
  nsm: NsmOverview | null;
  windowHref: (key: MinersWindowKey) => string;
}

export function MinersPage({ overview, terms, months, days, nsm, windowHref }: MinersPageProps) {
  const groups = grouped(overview);
  const livePriceUsd = terms?.priceUsd ?? null;
  const pct = (n: number) => {
    const p = blockSharePct(n, overview.blocks);
    return p === null ? "—" : formatSharePct(p);
  };
  const span =
    overview.fromHeight === null || overview.toHeight === null
      ? `${overview.fromDay} → today`
      : `${overview.fromDay} → today · blocks ${formatCount(overview.fromHeight)}–${formatCount(overview.toHeight)}`;

  return (
    <>
      <PageHeader
        eyebrow="EXPLORE"
        title="Miners"
        lede="Who mined Zcash and what their blocks paid them. A pool is named only from payout addresses we reviewed."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <p className="text-xs text-ink-faint tabular-nums">{span}</p>
      </div>

      {overview.daysComputed < overview.daysExpected ? (
        <p className="mt-2 text-xs text-warn">
          {overview.daysExpected - overview.daysComputed} of the window&apos;s days are not computed
          yet; figures cover the rest.
        </p>
      ) : null}

      <MinersTiles overview={overview} grouped={groups} livePriceUsd={livePriceUsd} />

      {terms === null ? (
        <DataUnavailable what="The tip's mining terms" className="mt-6" />
      ) : (
        <TipStrip terms={terms} />
      )}

      <Panel
        title="BLOCK SHARE"
        className="mt-3"
        action={`of ${formatCount(overview.blocks)} blocks`}
      >
        <PoolShareBar segments={shareSegments(overview, groups)} total={overview.blocks} />
        <p className="mt-3 text-xs text-ink-faint">
          By single payout address: largest {pct(overview.topBlocks.top1)} · top 3{" "}
          {pct(overview.topBlocks.top3)} · top 10 {pct(overview.topBlocks.top10)}
        </p>
      </Panel>

      <Panel title="POOLS" className="mt-3">
        <PoolTable overview={overview} livePriceUsd={livePriceUsd} />
        <p className="mt-3 text-xs text-ink-faint">
          A pool adds up its reviewed payout addresses, so it is right only if every label is.
          Shielded coinbase blocks are counted, never attributed. USD uses each day&apos;s close,
          today the live price.
        </p>
      </Panel>

      <Panel title="POOL SHARE BY MONTH" className="mt-3">
        {months === null ? (
          <DataUnavailable what="The monthly series" inset />
        ) : (
          <PoolShareByMonthChart series={months} />
        )}
      </Panel>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title="ZEC TO MINERS PER DAY">
          {days === null ? (
            <DataUnavailable what="The daily series" inset />
          ) : (
            <MinerDailyCharts series={days} />
          )}
          <p className="mt-3 text-xs text-ink-faint">
            Transparent payouts. NU7 gives 3× the blocks at ⅓ the subsidy, so ZEC per day stays
            level.
          </p>
        </Panel>
        <Panel title="FEES PAID TO MINERS">
          {months === null ? (
            <DataUnavailable what="The monthly series" inset />
          ) : (
            <MinerFeesChart series={months} />
          )}
          <p className="mt-3 text-xs text-ink-faint">
            Per month, transparent payouts. From NU7 the miner keeps 40% of fees.
          </p>
        </Panel>
      </div>

      {nsm === null ? (
        <DataUnavailable what="The NSM figures" className="mt-6" />
      ) : (
        <NsmSection
          nsm={nsm}
          fromDay={overview.fromDay}
          toDay={overview.toDay}
          livePriceUsd={livePriceUsd}
        />
      )}

      <MoreMiningLinks />
    </>
  );
}

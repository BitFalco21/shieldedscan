"use client";

import { nu7PeriodIndex, seriesTransparent, type MinerSeries } from "@/domain";
import { StackedBarChart } from "@/components/StackedBarChart";
import { compactCountTick, formatCount, formatZecTick, formatZecWhole } from "@/lib/format";
import { SeriesTable } from "./SeriesTable";
import { dayLabel } from "./miners-view";

export interface MinerDailyChartsProps {
  /** The day series, trimmed to the days shown. */
  series: MinerSeries;
}

/** A day whose reward is not known draws no bar and reads "unknown", never 0. */
const UNKNOWN = -1;

const zecValue = (v: number) => (v === UNKNOWN ? "unknown" : formatZecWhole(v));

/**
 * ZEC paid to transparent payout addresses per day, above the day's blocks, on the same days:
 * NU7 tripled the blocks at a third of the subsidy, so the first chart stays level where the
 * second steps up. Today is drawn faded and hatched, so far.
 */
export function MinerDailyCharts({ series }: MinerDailyChartsProps) {
  const paid = seriesTransparent(series);
  const nu7 = nu7PeriodIndex(series);
  const marker = nu7 === null ? null : { index: nu7, label: "NU7" };
  const running = series.periods.findIndex((p) => p.partial);
  const partial = running < 0 ? null : { index: running, note: "so far" };
  const labels = series.periods.map((p) => dayLabel(p.period));
  const readoutLabels = series.periods.map((p) => dayLabel(p.period, true));
  return (
    <div className="space-y-4">
      <div>
        <p className="microlabel mb-1 text-ink-faint">ZEC PER DAY</p>
        <StackedBarChart
          series={[
            {
              key: "paid",
              label: "Paid to miners",
              colorClass: "text-series",
              values: paid.map((p) => p.rewardZat ?? UNKNOWN),
            },
          ]}
          labels={labels}
          readoutLabels={readoutLabels}
          ariaLabel="ZEC paid to transparent miner addresses per day"
          formatValue={zecValue}
          formatTick={formatZecTick}
          partial={partial}
          marker={marker}
          readout="total"
        />
      </div>
      <div>
        <p className="microlabel mb-1 text-ink-faint">BLOCKS PER DAY</p>
        <StackedBarChart
          series={[
            {
              key: "blocks",
              label: "Blocks",
              colorClass: "text-series",
              values: series.periods.map((p) => p.blocks),
            },
          ]}
          labels={labels}
          readoutLabels={readoutLabels}
          ariaLabel="Blocks per day"
          formatValue={(v) => formatCount(v)}
          formatTick={compactCountTick}
          partial={partial}
          marker={marker}
          readout="total"
        />
      </div>
      <SeriesTable
        caption="ZEC paid to miners and blocks per day"
        period="DAY"
        columns={["ZEC TO MINERS", "BLOCKS"]}
        rows={series.periods.map((p, i) => ({
          label: dayLabel(p.period, true) + (p.partial ? " (so far)" : ""),
          cells: [zecValue(paid[i]!.rewardZat ?? UNKNOWN), formatCount(p.blocks)],
        }))}
      />
    </div>
  );
}

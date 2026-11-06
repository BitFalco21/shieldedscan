"use client";

import { useState } from "react";
import { blockSharePct, type MinerSeries } from "@/domain";
import { StackedBarChart } from "@/components/StackedBarChart";
import { formatShareTick, formatSharePct } from "@/lib/format";
import { miningGroupClass } from "@/lib/mining-pool-palette";
import { MinersLegend } from "./MinersLegend";
import { SeriesTable } from "./SeriesTable";
import { monthLabel, segmentLabel, seriesBands } from "./miners-view";

export interface PoolShareByMonthChartProps {
  series: MinerSeries;
}

/**
 * Each month's blocks as 100%, stacked by pool. The bars are shares (the period's blocks are the
 * denominator, unrecorded ones included), so a month of NU7's faster blocks reads the same as one
 * before it. Colour follows the pool; pointing at, or focusing, a legend item brings it forward.
 */
export function PoolShareByMonthChart({ series }: PoolShareByMonthChartProps) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const bands = seriesBands(series);
  const pct = (blocks: number, i: number) => blockSharePct(blocks, series.periods[i]!.blocks) ?? 0;
  const running = series.periods.findIndex((p) => p.partial);
  return (
    <div>
      <StackedBarChart
        series={bands.map((b) => ({
          key: b.key,
          label: segmentLabel(b.key),
          colorClass: miningGroupClass(b.key),
          values: b.blocks.map(pct),
        }))}
        labels={series.periods.map((p) => monthLabel(p.period))}
        readoutLabels={series.periods.map((p) => monthLabel(p.period, true))}
        ariaLabel="Share of each month's blocks by mining pool"
        formatValue={(v) => formatSharePct(v)}
        formatTick={formatShareTick}
        highlightKey={highlighted}
        partial={running < 0 ? null : { index: running, note: "so far" }}
      />
      <MinersLegend
        items={bands.map((b) => ({
          key: b.key,
          label: segmentLabel(b.key),
          className: miningGroupClass(b.key),
        }))}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
      <SeriesTable
        caption="Share of each month's blocks by mining pool"
        period="MONTH"
        columns={bands.map((b) => segmentLabel(b.key))}
        rows={series.periods.map((p, i) => ({
          label: monthLabel(p.period, true) + (p.partial ? " (so far)" : ""),
          cells: bands.map((b) => formatSharePct(pct(b.blocks[i] ?? 0, i))),
        }))}
      />
    </div>
  );
}

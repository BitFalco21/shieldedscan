"use client";

import { seriesSharePct, type MinerSeries, type MiningPool } from "@/domain";
import { StackedBarChart } from "@/components/StackedBarChart";
import { formatShareTick, formatSharePct } from "@/lib/format";
import { miningGroupClass } from "@/lib/mining-pool-palette";
import { SeriesTable } from "./SeriesTable";
import { monthLabel } from "./miners-view";

export interface PoolMonthlyShareChartProps {
  series: MinerSeries;
  pool: MiningPool;
}

/** One pool's share of each month's blocks, unrecorded blocks in the denominator. */
export function PoolMonthlyShareChart({ series, pool }: PoolMonthlyShareChartProps) {
  const shares = seriesSharePct(series, pool.id);
  const running = series.periods.findIndex((p) => p.partial);
  return (
    <div>
      <StackedBarChart
        series={[
          {
            key: pool.id,
            label: pool.name,
            colorClass: miningGroupClass(pool.id),
            values: shares,
          },
        ]}
        labels={series.periods.map((p) => monthLabel(p.period))}
        readoutLabels={series.periods.map((p) => monthLabel(p.period, true))}
        ariaLabel={`${pool.name}'s share of each month's blocks`}
        formatValue={(v) => formatSharePct(v)}
        formatTick={formatShareTick}
        partial={running < 0 ? null : { index: running, note: "so far" }}
        readout="total"
      />
      <SeriesTable
        caption={`${pool.name}'s share of each month's blocks`}
        period="MONTH"
        columns={["SHARE"]}
        rows={series.periods.map((p, i) => ({
          label: monthLabel(p.period, true) + (p.partial ? " (so far)" : ""),
          cells: [formatSharePct(shares[i] ?? 0)],
        }))}
      />
    </div>
  );
}

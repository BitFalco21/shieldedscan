"use client";

import { seriesTransparent, type MinerSeries } from "@/domain";
import { StackedBarChart } from "@/components/StackedBarChart";
import { formatSharePct, formatZecTick, formatZecTwo } from "@/lib/format";
import { SeriesTable } from "./SeriesTable";
import { monthLabel } from "./miners-view";

export interface MinerFeesChartProps {
  series: MinerSeries;
}

/** A month whose fee total is not whole draws no bar and reads "unknown", never a partial sum. */
const UNKNOWN = -1;

const feeValue = (v: number) => (v === UNKNOWN ? "unknown" : formatZecTwo(v));

/**
 * Fees kept by miners paid to a transparent address, per month: all of a block's fees before NU7,
 * 40% from it (ZIP 235). The table gives each month's share of what those miners were paid, over
 * the same blocks; the reward already includes the fees, so the share is fees ÷ reward.
 */
export function MinerFeesChart({ series }: MinerFeesChartProps) {
  const months = seriesTransparent(series);
  const running = series.periods.findIndex((p) => p.partial);
  return (
    <div>
      <StackedBarChart
        series={[
          {
            key: "fees",
            label: "Fees to miners",
            colorClass: "text-series",
            values: months.map((m) => m.feeZat ?? UNKNOWN),
          },
        ]}
        labels={months.map((m) => monthLabel(m.period))}
        readoutLabels={months.map((m) => monthLabel(m.period, true))}
        ariaLabel="Fees paid to transparent miner addresses per month"
        formatValue={feeValue}
        formatTick={formatZecTick}
        partial={running < 0 ? null : { index: running, note: "so far" }}
        readout="total"
      />
      <SeriesTable
        caption="Fees paid to miners per month, and their share of what miners were paid"
        period="MONTH"
        columns={["FEES", "SHARE OF MINER INCOME"]}
        rows={months.map((m, i) => ({
          label: monthLabel(m.period, true) + (series.periods[i]?.partial ? " (so far)" : ""),
          cells: [
            feeValue(m.feeZat ?? UNKNOWN),
            m.feeZat === null || m.rewardZat === null || m.rewardZat === 0
              ? "unknown"
              : formatSharePct((100 * m.feeZat) / m.rewardZat, 2),
          ],
        }))}
      />
    </div>
  );
}

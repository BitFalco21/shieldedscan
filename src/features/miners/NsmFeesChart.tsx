"use client";

import type { NsmDay } from "@/domain";
import { ChartLegend } from "@/components/ChartLegend";
import { StackedBarChart } from "@/components/StackedBarChart";
import { formatZecSupply, formatZecTick } from "@/lib/format";
import { SeriesTable } from "./SeriesTable";
import { dayLabel } from "./miners-view";

export interface NsmFeesChartProps {
  /** The days from activation, oldest first. */
  days: NsmDay[];
  /** Whether the first day is activation's, so the NU7 rule stands before it. */
  fromActivation: boolean;
}

/** A day whose fees are not all known draws no bar and reads "unknown", never 0. */
const UNKNOWN = -1;

/** The slots the chart spans at least, so a young series draws days, not slabs. */
const MIN_SLOTS = 10;

const zecValue = (v: number) => (v < 0 ? "unknown" : formatZecSupply(v));

/**
 * Each day's fees from NU7 on, split as ZIP 235 splits them: the NSM's share at the bottom, on the
 * flat baseline where its trend reads, the miners' above it. One measure, ZEC. Before activation
 * there was no NSM, so those days are empty space labelled as such, never bars of zero.
 */
export function NsmFeesChart({ days, fromActivation }: NsmFeesChartProps) {
  const running = days.findIndex((d) => d.partial);
  const known = (d: NsmDay) => d.feeZat !== null && d.nsmZat !== null;
  const series = [
    {
      key: "nsm",
      label: "To the NSM",
      colorClass: "text-line-4",
      values: days.map((d) => (known(d) ? d.nsmZat! : UNKNOWN)),
    },
    {
      key: "miners",
      label: "To miners",
      colorClass: "text-series",
      values: days.map((d) => (known(d) ? d.feeZat! - d.nsmZat! : UNKNOWN)),
    },
  ];
  return (
    <div>
      <StackedBarChart
        series={series}
        labels={days.map((d) => dayLabel(d.day))}
        readoutLabels={days.map((d) => dayLabel(d.day, true))}
        ariaLabel="Fees per day since NU7, to the NSM and to miners"
        formatValue={zecValue}
        formatTick={formatZecTick}
        partial={running < 0 ? null : { index: running, note: "so far" }}
        marker={fromActivation ? { index: 0, label: "NU7" } : null}
        before={
          fromActivation && days.length < MIN_SLOTS
            ? { slots: MIN_SLOTS - days.length, note: "no NSM before NU7" }
            : null
        }
      />
      <ChartLegend
        items={series.map((s) => ({ label: s.label, className: s.colorClass, mark: "bar" }))}
      />
      <SeriesTable
        caption="Fees per day since NU7, to the NSM and to miners"
        period="DAY"
        columns={["TO THE NSM", "TO MINERS"]}
        rows={days.map((d, i) => ({
          label: dayLabel(d.day, true) + (d.partial ? " (so far)" : ""),
          cells: [zecValue(series[0]!.values[i]!), zecValue(series[1]!.values[i]!)],
        }))}
      />
    </div>
  );
}

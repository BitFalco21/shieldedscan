"use client";

import { useState } from "react";
import { RankedKey } from "@/components/RankedKey";
import { StackedBarChart, type BarSeries } from "@/components/StackedBarChart";

export interface InflowByChainChartProps {
  series: BarSeries[];
  labels: string[];
  readoutLabels: string[];
  /** The month still running when the data was read, and the day it reaches. */
  running: { index: number; throughDay: number } | null;
  /** The fold of the smaller chains: ranked last, since it is not one chain. */
  foldKey: string;
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
}

/**
 * Monthly inflow as stacked bars beside a ranked key. The key ranks the chains over the months
 * shown, or over the month under the pointer, and pointing at a chain brings its segments
 * forward: the one way to read a band above the bottom one in a stack.
 */
export function InflowByChainChart({
  series,
  labels,
  readoutLabels,
  running,
  foldKey,
  formatValue,
  formatTick,
}: InflowByChainChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // "to 9 Oct" wherever the running month is named, so no figure for it reads as a whole month.
  const throughNote =
    running === null
      ? ""
      : `to ${running.throughDay} ${(readoutLabels[running.index] ?? "").slice(0, 3)}`;
  const readouts = readoutLabels.map((label, i) =>
    i === running?.index ? `${label}, ${throughNote}` : label,
  );

  const values = (key: string) => series.find((s) => s.key === key)?.values ?? [];
  const sumOf = (key: string) =>
    active === null ? values(key).reduce((a, b) => a + b, 0) : (values(key)[active] ?? 0);
  const items = series.map((s) => ({
    key: s.key,
    label: s.label,
    colorClass: s.colorClass,
    value: sumOf(s.key),
  }));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const period = active === null ? `${readouts[0]} – ${readouts.at(-1)}` : (readouts[active] ?? "");

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start">
      <StackedBarChart
        series={series}
        labels={labels}
        readoutLabels={readouts}
        ariaLabel="ZEC arriving on Zcash per month, by source chain"
        formatValue={formatValue}
        formatTick={formatTick}
        partial={running === null ? null : { index: running.index, note: throughNote }}
        highlightKey={highlighted}
        readout="total"
        onActiveChange={setActive}
      />
      <RankedKey
        items={items}
        caption={`${period} · ${formatValue(total)}`}
        formatValue={formatValue}
        pinnedLast={[foldKey]}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </div>
  );
}

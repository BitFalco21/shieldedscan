"use client";

import type { NodeBands } from "@/domain";
import { ChartLegend } from "@/components/ChartLegend";
import { StackedBarChart } from "@/components/StackedBarChart";
import { formatCount, formatSharePct, formatShareTick } from "@/lib/format";
import { nodeBandClass } from "@/lib/node-band-palette";
import { useLegendHighlight } from "@/lib/use-legend-highlight";

export interface NodeBandsChartProps {
  bands: NodeBands;
  /** What the bands are, for a screen reader: "software release line", "hosting network". */
  what: string;
  /** The first recorded day: nothing before it exists, and the caption says so. */
  recordingSince: string | null;
}

/**
 * Each day's answering nodes as 100%, stacked by band: the shares of one day are of that day's
 * answering nodes, which the readout states beside them. A day is the network as it stood at that
 * day's last crawl.
 */
export function NodeBandsChart({ bands, what, recordingSince }: NodeBandsChartProps) {
  const pct = (n: number, j: number) => {
    const whole = bands.answering[j] ?? 0;
    return whole > 0 ? (100 * n) / whole : 0;
  };
  const classes = bands.keys.map((k, i) => nodeBandClass(k, i));
  // A band previewed or pinned in the legend, brought forward on the bars.
  const highlight = useLegendHighlight();
  return (
    <div>
      <StackedBarChart
        series={bands.keys.map((key, i) => ({
          key,
          label: bands.labels[i]!,
          colorClass: classes[i]!,
          values: bands.nodes[i]!.map(pct),
        }))}
        labels={bands.days}
        readoutLabels={bands.days}
        ariaLabel={`Share of each day's answering nodes by ${what}`}
        formatValue={(v) => formatSharePct(v)}
        formatTick={formatShareTick}
        highlightKey={highlight.highlighted}
        contextRows={[
          { name: "Answering nodes", values: bands.answering.map((n) => formatCount(n)) },
        ]}
      />
      <ChartLegend
        items={bands.labels.map((label, i) => ({
          label,
          className: classes[i]!,
          mark: "bar",
          key: bands.keys[i]!,
        }))}
        highlight={highlight}
      />
      <p className="mt-3 text-xs text-ink-faint">
        Nodes that answered our crawler in each day&apos;s last 24 hours
        {recordingSince ? `, recorded since ${recordingSince}` : ""}. Only nodes that accept
        connections can be counted.
      </p>
    </div>
  );
}

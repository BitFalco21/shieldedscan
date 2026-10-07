import type { ShieldedSupplyPoint } from "@/domain";
import { ChartHover } from "@/components/ChartHover";
import {
  CHART_H,
  CHART_W,
  COMPACT_TICK_FONT,
  TICK_FONT,
  XAxis,
  YAxis,
  axisFrame,
} from "@/components/chart-axes";

export interface PoolAreaChartProps {
  points: ShieldedSupplyPoint[];
  /**
   * Formats a total for the readout. Supply-scale figures round to whole ZEC — a sixteen-digit
   * pool balance defeats the point of a readout.
   */
  formatValue: (zat: number) => string;
  /** Gallery-size axes — see `COMPACT_TICK_FONT`. */
  compact?: boolean;
}

/** Total shielded supply over time — the amber series, on the shared axis frame. */
export function PoolAreaChart({ points, formatValue, compact = false }: PoolAreaChartProps) {
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.totalZat));
  // Anchored at zero, deliberately: a min-clipped axis on a SUPPLY chart exaggerates every
  // wiggle into a cliff, and "how much ZEC is shielded" is a zero-based question.
  const frame = axisFrame(
    points.length,
    max,
    formatValue,
    0,
    compact ? COMPACT_TICK_FONT : TICK_FONT,
  );
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${frame.x(i).toFixed(1)},${frame.y(p.totalZat).toFixed(1)}`)
    .join(" ");
  /*
   * The x axis is time, from each point's real timestamp: "total shielded supply over time"
   * is a claim about time. The height survives in the hover readout beside the date, because
   * it is what makes a figure checkable against a node.
   */
  const dayLabel = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
  return (
    <ChartHover
      labels={points.map(
        (p) => `${dayLabel(p.timestamp)} · block #${p.height.toLocaleString("en-US")}`,
      )}
      rows={[{ name: "Total shielded", values: points.map((p) => formatValue(p.totalZat)) }]}
      plotStart={frame.plotStart}
      plotEnd={frame.plotEnd}
    >
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Total shielded supply over time"
      >
        <YAxis frame={frame} ticks={frame.ticks} formatValue={formatValue} />
        <XAxis frame={frame} labels={points.map((p) => dayLabel(p.timestamp))} />
        <path
          d={`${line} L${frame.x(points.length - 1).toFixed(1)},${frame.y(0)} L${frame.x(0).toFixed(1)},${frame.y(0)} Z`}
          fill="var(--series)"
          opacity="0.08"
        />
        <path
          d={line}
          fill="none"
          stroke="var(--series)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </ChartHover>
  );
}

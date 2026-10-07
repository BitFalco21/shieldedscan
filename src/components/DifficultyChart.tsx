import type { MiningTrendPoint } from "@/domain";
import { ChartHover } from "@/components/ChartHover";

export interface DifficultyChartProps {
  points: MiningTrendPoint[];
  /**
   * Formats a difficulty for the readout and the range labels. Passed in so there is exactly
   * one formatter between the chart and the page around it, and so this component does not
   * import from `features/`.
   */
  formatValue: (difficulty: number) => string;
  /** One label per point, e.g. `2026-07-30 · #3,430,142`. Self-contained: a readout has no axis. */
  labels: string[];
}

/**
 * Difficulty over a window — exact header values, so the line is a measurement.
 *
 * Scaled to the window's own min and max rather than to zero: difficulty moves by a few
 * percent between retargets, so a zero-based axis would render every window as a flat line.
 * The shape therefore exaggerates small moves, which is why the axis range is printed
 * underneath and the readout gives the exact figure at every point.
 */
export function DifficultyChart({ points, formatValue, labels }: DifficultyChartProps) {
  if (points.length < 2) return null;

  const w = 320;
  const h = 120;
  const pad = 8;
  const values = points.map((p) => p.difficulty);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.difficulty).toFixed(1)}`)
    .join(" ");

  return (
    <>
      <ChartHover
        labels={labels}
        rows={[{ name: "Difficulty", values: points.map((p) => formatValue(p.difficulty)) }]}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-40 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Difficulty across ${points.length} points, ranging from ${formatValue(min)} to ${formatValue(max)}`}
        >
          <path d={`${line} L${w},${h} L0,${h} Z`} fill="var(--series)" opacity="0.07" />
          <path
            d={line}
            fill="none"
            stroke="var(--series)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </ChartHover>

      <div className="mt-2 flex justify-between text-[10px] tracking-[0.08em] text-ink-faint">
        <span>low {formatValue(min)}</span>
        <span>high {formatValue(max)}</span>
      </div>
    </>
  );
}

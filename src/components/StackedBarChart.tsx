import { useId } from "react";
import { ChartHover } from "@/components/ChartHover";
import {
  CHART_GUTTER_GAP,
  CHART_H,
  CHART_PAD_B,
  CHART_PAD_R,
  CHART_PAD_T,
  CHART_W,
  TICK_FONT,
  tickCharW,
  XAxis,
  YAxis,
} from "@/components/chart-axes";

export interface BarSeries {
  key: string;
  label: string;
  /** Class setting `color`; the segments fill with `currentColor`. */
  colorClass: string;
  /** One value per period, same length and order as every other series. */
  values: number[];
}

export interface StackedBarChartProps {
  series: BarSeries[];
  /** One label per period; only a few are drawn — see `XAxis`. */
  labels: string[];
  /** Unambiguous labels for the readout ("Oct 2026", not "Oct 26"). Falls back to `labels`. */
  readoutLabels?: string[];
  ariaLabel: string;
  formatValue: (value: number) => string;
  /** The y-axis labels, where coarser than `formatValue`; the readout keeps `formatValue`. */
  formatTick?: (value: number) => string;
  /** A period still running: drawn faded and hatched, with this note above its bar. */
  partial?: { index: number; note: string } | null;
  /** A series brought forward, the rest faded, so one band's trend reads across the stack. */
  highlightKey?: string | null;
  /** Readout rows: every series, or the total alone when a companion states the breakdown. */
  readout?: "series" | "total";
  onActiveChange?: (index: number | null) => void;
}

/**
 * Totals per period, stacked by series: one bar per period, because a monthly sum is a count of
 * that month and not a point on a curve, which is what an area between months would claim.
 *
 * Absolute heights, as `StackedAreaChart` keeps them: a share view would hide how much arrived.
 * Only the bottom series sits on a flat baseline, so `highlightKey` exists to give any other one
 * that reading on demand. Series stack in array order, first at the bottom.
 */
export function StackedBarChart({
  series,
  labels,
  readoutLabels,
  ariaLabel,
  formatValue,
  formatTick = formatValue,
  partial = null,
  highlightKey = null,
  readout = "series",
  onActiveChange,
}: StackedBarChartProps) {
  // React's ids carry punctuation a `url(#…)` reference may not survive.
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const n = labels.length;
  if (n === 0 || series.length === 0) return null;

  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const peak = Math.max(...totals, 0) || 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => peak * f);
  const padL =
    Math.max(...ticks.map((t) => formatTick(t).length)) * tickCharW(TICK_FONT) + CHART_GUTTER_GAP;
  const plotW = CHART_W - padL - CHART_PAD_R;
  const plotH = CHART_H - CHART_PAD_T - CHART_PAD_B;
  const slot = plotW / n;
  // A fifth of the slot as the gap keeps bars dominant at any count, as `FlowBalanceChart` does.
  const barW = slot * 0.8;
  const y = (v: number) => CHART_H - CHART_PAD_B - (v / peak) * plotH;
  const frame = {
    padL,
    tickFont: TICK_FONT,
    // Slot centres: a bar's label sits under the bar.
    x: (i: number) => padL + (i + 0.5) * slot,
    y,
    plotStart: padL / CHART_W,
    plotEnd: (CHART_W - CHART_PAD_R) / CHART_W,
    height: CHART_H,
  };

  const rows =
    readout === "series"
      ? series.map((s) => ({
          name: s.label,
          colorClass: s.colorClass,
          values: labels.map((_, i) => formatValue(s.values[i] ?? 0)),
        }))
      : [];

  return (
    <ChartHover
      labels={readoutLabels ?? labels}
      rows={rows}
      total={{ name: "Total", values: totals.map(formatValue) }}
      mode="bands"
      plotStart={frame.plotStart}
      plotEnd={frame.plotEnd}
      onActiveChange={onActiveChange}
    >
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <pattern
            id={hatchId}
            width={6}
            height={6}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1={0} y1={0} x2={0} y2={6} stroke="currentColor" strokeWidth={1.5} />
          </pattern>
        </defs>
        <YAxis frame={frame} ticks={ticks} formatValue={formatTick} />
        {labels.map((label, i) => {
          const left = padL + i * slot + (slot - barW) / 2;
          const running = i === partial?.index;
          let base = 0;
          return (
            <g key={`${label}-${i}`}>
              {series.map((s) => {
                const v = s.values[i] ?? 0;
                if (v <= 0) return null;
                const top = y(base + v);
                const height = y(base) - top;
                base += v;
                const faded = highlightKey !== null && s.key !== highlightKey;
                return (
                  <rect
                    key={s.key}
                    x={left}
                    y={top}
                    width={barW}
                    height={height}
                    fill="currentColor"
                    className={`chart-band ${s.colorClass} transition-opacity motion-reduce:transition-none ${
                      faded ? "opacity-15" : running ? "opacity-45" : ""
                    }`}
                  />
                );
              })}
              {running ? (
                <>
                  <rect
                    x={left}
                    y={y(totals[i]!)}
                    width={barW}
                    height={y(0) - y(totals[i]!)}
                    fill={`url(#${hatchId})`}
                    className="text-ink-faint"
                  />
                  <text
                    x={left + barW / 2}
                    y={y(totals[i]!) - 6}
                    textAnchor="middle"
                    fontSize={TICK_FONT}
                    className="chart-tick"
                  >
                    {partial!.note}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
        <XAxis frame={frame} labels={labels} />
      </svg>
    </ChartHover>
  );
}

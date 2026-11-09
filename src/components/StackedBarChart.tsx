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
import { niceAxis } from "@/lib/nice-ticks";

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
  /** A rule before the bar at `index`: a consensus upgrade the shape cannot be read without. */
  marker?: { index: number; label: string } | null;
  /**
   * Empty slots drawn before the first period, with `note` in them: a span the measure did not
   * exist in (the NSM before NU7). Without them a young series draws a few slab-wide bars; with
   * them the space says "not yet" in words, so it cannot read as periods of zero.
   */
  before?: { slots: number; note: string } | null;
  /** Readout rows: every series, or the total alone when a companion states the breakdown. */
  readout?: "series" | "total";
  /** The readout's name for the total; a one-series chart names its measure. */
  totalLabel?: string;
  /**
   * Readout rows stated beside the bars, pre-formatted per period, above the total: the counts a
   * rate is made of, which belong in the readout and not on the axis.
   */
  contextRows?: { name: string; values: string[] }[];
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
  marker = null,
  before = null,
  readout = "series",
  totalLabel = "Total",
  contextRows = [],
  onActiveChange,
}: StackedBarChartProps) {
  // React's ids carry punctuation a `url(#…)` reference may not survive.
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const n = labels.length;
  if (n === 0 || series.length === 0) return null;

  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const { max: ceiling, ticks } = niceAxis(0, Math.max(...totals, 0), { label: formatTick });
  const padL =
    Math.max(...ticks.map((t) => formatTick(t).length)) * tickCharW(TICK_FONT) + CHART_GUTTER_GAP;
  const plotW = CHART_W - padL - CHART_PAD_R;
  const plotH = CHART_H - CHART_PAD_T - CHART_PAD_B;
  const lead = Math.max(0, Math.floor(before?.slots ?? 0));
  const slot = plotW / (n + lead);
  // Where the first period's slot starts: everything left of it is the empty lead.
  const start = padL + lead * slot;
  // A fifth of the slot as the gap keeps bars dominant at any count, as `FlowBalanceChart` does.
  const barW = slot * 0.8;
  const y = (v: number) => CHART_H - CHART_PAD_B - (v / ceiling) * plotH;
  const frame = {
    padL,
    tickFont: TICK_FONT,
    // Slot centres: a bar's label sits under the bar.
    x: (i: number) => start + (i + 0.5) * slot,
    y,
    plotStart: start / CHART_W,
    plotEnd: (CHART_W - CHART_PAD_R) / CHART_W,
    height: CHART_H,
  };

  const rows = [
    ...(readout === "series"
      ? series.map((s) => ({
          name: s.label,
          colorClass: s.colorClass,
          values: labels.map((_, i) => formatValue(s.values[i] ?? 0)),
        }))
      : []),
    ...contextRows,
  ];

  return (
    <ChartHover
      labels={readoutLabels ?? labels}
      rows={rows}
      total={{ name: totalLabel, values: totals.map(formatValue) }}
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
          const left = start + i * slot + (slot - barW) / 2;
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
        {marker !== null && marker.index >= 0 && marker.index < n
          ? (() => {
              const at = start + marker.index * slot;
              // The label flips left of its rule in the last fifth, so it is never clipped.
              const near = at > CHART_W - plotW * 0.2;
              return (
                <g className="chart-marker">
                  <line x1={at} x2={at} y1={CHART_PAD_T} y2={CHART_H - CHART_PAD_B} />
                  <text
                    x={at + (near ? -5 : 5)}
                    y={CHART_PAD_T + 10}
                    textAnchor={near ? "end" : "start"}
                    fontSize={Math.round(TICK_FONT * (10 / 11))}
                    className="chart-marker-label"
                  >
                    {marker.label}
                  </text>
                </g>
              );
            })()
          : null}
        {before !== null &&
        lead > 0 &&
        before.note.length * tickCharW(TICK_FONT) < lead * slot - 16 ? (
          <text
            x={padL + (lead * slot) / 2}
            y={CHART_PAD_T + plotH / 2}
            textAnchor="middle"
            fontSize={TICK_FONT}
            className="chart-tick"
          >
            {before.note}
          </text>
        ) : null}
        {/* The axis spans the lead too, as blank labels: its end labels anchor at the plot's
            edges, so a few bars at the right would otherwise put the first label over the last. */}
        <XAxis
          frame={{ ...frame, x: (i: number) => padL + (i + 0.5) * slot }}
          labels={lead > 0 ? [...Array<string>(lead).fill(""), ...labels] : labels}
        />
      </svg>
    </ChartHover>
  );
}

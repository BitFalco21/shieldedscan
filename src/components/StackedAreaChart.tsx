import { ChartHover } from "@/components/ChartHover";
import {
  CHART_GUTTER_GAP,
  CHART_H,
  CHART_PAD_B,
  CHART_PAD_R,
  CHART_PAD_T,
  CHART_W,
  COMPACT_TICK_FONT,
  TICK_FONT,
  XAxis,
} from "@/components/chart-axes";

export interface AreaSeries {
  key: string;
  label: string;
  /** Class setting `color`; the band fills with `currentColor`. */
  colorClass: string;
  /**
   * One value per x position, same length and order as every other series.
   *
   * `null` means this band did not exist at that position — a pool before its activation, not
   * a pool measured at zero. It contributes nothing to the stack either way, but the hover
   * readout omits the row rather than printing "0.00".
   */
  values: (number | null)[];
}

export interface AreaMarker {
  /** Index into the x axis where the marker sits. */
  index: number;
  label: string;
}

export interface StackedAreaChartProps {
  series: AreaSeries[];
  /** One label per x position; only a few are drawn — see `XAxis`. */
  labels: string[];
  ariaLabel: string;
  /** Vertical annotations — network upgrades, in practice. */
  markers?: AreaMarker[];
  /** Formats the y-axis ticks and the peak callout. */
  formatValue: (value: number) => string;
  /**
   * The y-axis labels, where they need less precision than a stated value: a tick is a reference
   * line at a fraction of the peak, so eight decimals there are noise. Defaults to `formatValue`;
   * the hover readout always uses `formatValue`.
   */
  formatTick?: (value: number) => string;
  /**
   * Labels for the hover readout, where they stand alone and must be unambiguous — "Jun 2022"
   * rather than the axis's cramped "Jun 22". Falls back to `labels`.
   */
  readoutLabels?: string[];
  /** Gallery-size axes — see `COMPACT_TICK_FONT`. */
  compact?: boolean;
}

/**
 * A stacked area chart, hand-rolled.
 *
 * Absolute values, never normalised to 100%. A share-of-total view hides the denominator: a
 * fully-shielded share that jumps while monthly volume triples reads as a wave of privacy
 * adoption on a 100%-stacked chart, when the chain shows a flood of transactions. Bands sized
 * by count keep the share and the thing it is a share of visible together.
 *
 * Series stack in array order, first at the bottom. Colour arrives through `currentColor`
 * from the token layer, like every other coloured thing here.
 */

/**
 * Per-character advance this chart sizes its gutter with, at the base tick size. Narrower than
 * `tickCharW`'s, so this gutter is slightly tighter than the other charts'.
 */
const TICK_CHAR_W = 6.3;

export function StackedAreaChart({
  series,
  labels,
  ariaLabel,
  markers = [],
  formatValue,
  formatTick = formatValue,
  readoutLabels,
  compact = false,
}: StackedAreaChartProps) {
  const n = labels.length;
  if (n < 2 || series.length === 0) return null;
  const tickFont = compact ? COMPACT_TICK_FONT : TICK_FONT;
  // Marker labels keep their slightly-smaller-than-tick relationship at either size.
  const markerFont = Math.round(tickFont * (10 / 11));

  // Cumulative tops, so each band is drawn between its own top and the one below it.
  const tops: number[][] = [];
  const running = new Array<number>(n).fill(0);
  for (const s of series) {
    for (let i = 0; i < n; i += 1) running[i] = (running[i] ?? 0) + (s.values[i] ?? 0);
    tops.push([...running]);
  }
  const peak = Math.max(...running, 1);

  // The axis gutter is sized to its own longest tick rather than fixed: a fixed gutter clips
  // "1.18M ZEC" to ".18M ZEC".
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => peak * f);
  const padL =
    Math.max(...ticks.map((t) => formatTick(t).length)) * (TICK_CHAR_W / TICK_FONT) * tickFont +
    CHART_GUTTER_GAP;

  const x = (i: number) => padL + (i / (n - 1)) * (CHART_W - padL - CHART_PAD_R);
  const y = (v: number) =>
    CHART_H - CHART_PAD_B - (v / peak) * (CHART_H - CHART_PAD_T - CHART_PAD_B);

  // The shared XAxis draws the x labels, so density, edge anchoring and collision handling
  // match every other chart.
  const frame = {
    padL,
    tickFont,
    x,
    y,
    plotStart: padL / CHART_W,
    plotEnd: (CHART_W - CHART_PAD_R) / CHART_W,

    height: CHART_H,
  };

  // Built from the same arrays the bands are drawn from and formatted by the axis's
  // `formatValue`, so the readout is the chart's own numbers.
  const hoverRows = series.map((s) => ({
    name: s.label,
    colorClass: s.colorClass,
    // `null` is passed through, not formatted: `ChartHover` drops the row at that index.
    // `undefined` from a ragged array still formats as 0 — a different fault from a deliberate
    // absence.
    values: Array.from({ length: n }, (_, i) =>
      s.values[i] === null ? null : formatValue(s.values[i] ?? 0),
    ),
  }));
  const hoverTotal = {
    name: "Total",
    values: Array.from({ length: n }, (_, i) => formatValue(running[i] ?? 0)),
  };

  return (
    <ChartHover
      labels={readoutLabels ?? labels}
      rows={hoverRows}
      total={series.length > 1 ? hoverTotal : undefined}
      plotStart={frame.plotStart}
      plotEnd={frame.plotEnd}
    >
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        {/* Gridlines first, so the bands sit over them. Quarters: enough to read a value off,
          few enough not to compete with the data. */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={CHART_W - CHART_PAD_R} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text
              x={padL - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={tickFont}
              className="chart-tick"
            >
              {formatTick(t)}
            </text>
          </g>
        ))}

        {series.map((s, si) => {
          const top = tops[si]!;
          const below = si === 0 ? new Array<number>(n).fill(0) : tops[si - 1]!;
          const up = top.map(
            (v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
          );
          const down = [...below]
            .map((v, i) => ({ v, i }))
            .reverse()
            .map(({ v, i }) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`);
          return (
            <path
              key={s.key}
              d={`${up.join(" ")} ${down.join(" ")} Z`}
              fill="currentColor"
              className={`chart-band ${s.colorClass}`}
            />
          );
        })}

        {/* Upgrade markers. Consensus activation heights are chain facts, so these are the one
          kind of annotation this chart may assert — the shape is unreadable without them. */}
        {markers.map((m) => {
          // Labels flip to the left of their rule in the last fifth of the chart, so a recent
          // upgrade's label is not clipped at the right edge.
          const near = x(m.index) > CHART_W - (CHART_W - padL - CHART_PAD_R) * 0.2;
          return (
            <g key={m.label} className="chart-marker">
              <line x1={x(m.index)} x2={x(m.index)} y1={CHART_PAD_T} y2={CHART_H - CHART_PAD_B} />
              <text
                x={x(m.index) + (near ? -5 : 5)}
                y={CHART_PAD_T + 10}
                textAnchor={near ? "end" : "start"}
                fontSize={markerFont}
                className="chart-marker-label"
              >
                {m.label}
              </text>
            </g>
          );
        })}

        <XAxis frame={frame} labels={labels} />
      </svg>
    </ChartHover>
  );
}

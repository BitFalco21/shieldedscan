import { ChartHover, type ChartHoverRow } from "@/components/ChartHover";
import {
  CHART_W,
  TICK_FONT,
  XAxis,
  YAxis,
  axisFrame,
  chartSize,
  logAxisFrame,
} from "@/components/chart-axes";

export interface MultiLineSeries {
  name: string;
  /** One value per label; `null` draws a gap, never a fabricated zero. */
  values: (number | null)[];
  /** A colour class from the design tokens — the privacy ink grammar, for kind series. */
  className: string;
  /** Opacity carries the ink grammar's weight steps, so colour is never the only channel. */
  opacity?: number;
  /**
   * What a `null` means in the readout. By default it is an unmeasured value and reads "—".
   * A series whose nulls mean "did not exist" — a pool before its activation — sets this, and
   * the readout omits the row instead of implying something existed and went unmeasured. The
   * plotted line gaps identically either way.
   */
  omitNullFromReadout?: boolean;
  /** A reference rather than a measurement (a target, a threshold): drawn dashed. */
  dashed?: boolean;
  /**
   * A second channel beside colour, for a measured line whose ink sits close to another's on the
   * same chart: drawn dotted, a pattern no reference line uses.
   */
  dotted?: boolean;
}

export interface MultiLineChartProps {
  labels: string[];
  series: MultiLineSeries[];
  ariaLabel: string;
  formatValue?: (value: number) => string;
  /**
   * The y-axis labels, where they need less precision than a stated value: a tick is a reference
   * line at a fraction of the maximum, so eight decimals there are noise. Defaults to
   * `formatValue`; the hover readout always uses `formatValue`.
   */
  formatTick?: (value: number) => string;
  readoutLabels?: string[];
  /**
   * Facts about each point that are not plotted, appended below the series in the readout —
   * e.g. how many blocks a period's fee sum was measured over. A denominator is not a quantity
   * on the scale, so it cannot be a series, and `formatValue` sees one number rather than the
   * point it came from.
   *
   * Values are pre-formatted strings, one per x position, like `ChartHoverRow`. Not for
   * anything a reader would expect to see as a line: that must be a series.
   */
  contextRows?: ChartHoverRow[];
  /**
   * An emphasised total under the series in the readout, pre-formatted per point. Only for
   * series that add up to something a reader asks for, named by what it sums; `null` omits it.
   */
  total?: { name: string; values: (string | null)[] };
  /**
   * Where the y-axis starts. `"zero"` is the default.
   *
   * `"data"` clips the axis to the range present, and is only correct for a series whose
   * ratio to zero means nothing — a price, where a week's move is a flat line on a zero-based
   * axis. A count or an amount must never use it: there the ratio is the story, and a clipped
   * axis exaggerates or erases it. Opt-in and named at the call site so one caller's
   * assumption cannot silently describe another caller's data.
   */
  baseline?: "zero" | "data";
  /**
   * Phone-size axes and a taller frame, for a chart rendered across a phone's width. See
   * `PHONE_TICK_FONT`.
   */
  phone?: boolean;
  /**
   * The chart's drawn width in CSS px, where the caller measures it. The ticks are then sized to
   * render at the base size (`TICK_FONT` px) whatever the width, and the frame grows taller in
   * step so the plot keeps its shape; at a phone's width this matches `phone`. Overrides it.
   */
  renderedWidth?: number;
  /**
   * A fixed top of the y-axis, for a series with a natural ceiling — a share of a whole is out
   * of 100 whatever today's high is. Without it the axis stops at the data's own maximum and a
   * share chart prints ticks like 41.6%, which frame the line against nothing a reader knows.
   * Values above it still draw; the axis simply does not shrink below it.
   */
  yMax?: number;
  /**
   * A dot on every point, for a short series whose points ARE the data — a daily record a few
   * days old is a handful of measurements, and a bare line between two of them reads as if
   * every instant between was measured too.
   */
  markers?: boolean;
  /**
   * `"log"` puts the y axis on powers of ten, for series of one measure that differ by orders of
   * magnitude. A value at or below zero has no place on it and draws as a gap; the readout still
   * states it. `baseline` and `yMax` describe a linear axis and are ignored.
   */
  scale?: "linear" | "log";
  /**
   * Fill each line down to the axis floor (zero on the default baseline). Never stacked: these
   * series need not partition anything, and a stack would draw a total nobody measured. Linear
   * axes only, since a log axis has no zero.
   */
  fill?: boolean;
}

/**
 * Several series on ONE shared scale.
 *
 * A `null` breaks the path into segments rather than interpolating across the hole: a month
 * where a kind had no transactions has no median, and a line drawn through it would assert
 * one. The gap is the honest mark. Same reasoning as the redaction bars, one level down.
 *
 * The scale starts at zero unless a caller explicitly asks otherwise. Fee medians are small
 * numbers whose RATIO is the story ("shielded is half of transparent"), and a clipped axis
 * would exaggerate or erase that ratio depending on where it was clipped. See `baseline` for
 * the one case that legitimately inverts this.
 */
export function MultiLineChart({
  labels,
  series,
  ariaLabel,
  formatValue = String,
  formatTick = formatValue,
  readoutLabels,
  contextRows = [],
  total,
  baseline = "zero",
  phone = false,
  renderedWidth,
  yMax,
  markers = false,
  scale = "linear",
  fill = false,
}: MultiLineChartProps) {
  if (labels.length === 0 || series.length === 0) return null;

  const log = scale === "log";
  const values = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const positives = values.filter((v) => v > 0);
  if (log && positives.length === 0) return null;
  const max = log ? Math.max(...positives) : Math.max(...values, yMax ?? 0, 0) || 1;
  /*
   * A clipped axis gets a margin below the lowest point (a tenth of the visible span): a line
   * touching the frame reads as data running off the chart.
   *
   * Clamped at zero, because the span can exceed the low: over a series running from $18 to
   * $2,239 the margin alone would put a gridline at a negative price. `low > 0` above guards
   * the input, not this result. Clamping loses nothing — a series whose low is a fraction of
   * its high genuinely has a meaningful ratio to zero.
   */
  const low = values.length > 0 ? Math.min(...values) : 0;
  const min = baseline === "data" && low > 0 ? Math.max(0, low - (max - low) * 0.1) : 0;
  const { tickFont, height } = chartSize(phone, renderedWidth);
  const frame = log
    ? logAxisFrame(labels.length, Math.min(...positives), max, formatTick, tickFont, height)
    : axisFrame(labels.length, max, formatTick, min, tickFont, height);

  /** Whether a value has a place on the axis: everything on a linear one, only positives on a log. */
  const drawable = (v: number | null): v is number => v !== null && (!log || v > 0);

  /** Runs of drawable points, split on gaps, so gaps stay gaps. */
  const runs = (values: (number | null)[]): { i: number; v: number }[][] => {
    const out: { i: number; v: number }[][] = [];
    let current: { i: number; v: number }[] = [];
    values.forEach((v, i) => {
      if (!drawable(v)) {
        if (current.length > 0) out.push(current);
        current = [];
        return;
      }
      current.push({ i, v });
    });
    if (current.length > 0) out.push(current);
    return out;
  };
  const line = (run: { i: number; v: number }[]) =>
    run.map((p, k) => `${k ? "L" : "M"}${frame.x(p.i).toFixed(1)} ${frame.y(p.v).toFixed(1)}`);
  const segments = (values: (number | null)[]): string[] =>
    runs(values).map((r) => line(r).join(" "));
  /** A run closed down to the axis floor (zero unless `baseline` clips it), for `fill`. */
  const areas = (values: (number | null)[]): string[] =>
    runs(values).map((r) => {
      const base = frame.y(min).toFixed(1);
      const first = frame.x(r[0]!.i).toFixed(1);
      const last = frame.x(r[r.length - 1]!.i).toFixed(1);
      return `${line(r).join(" ")} L${last} ${base} L${first} ${base} Z`;
    });

  return (
    <ChartHover
      labels={readoutLabels ?? labels}
      rows={[
        ...series.map((s) => ({
          name: s.name,
          values: s.values.map((v) =>
            v === null ? (s.omitNullFromReadout ? null : "—") : formatValue(v),
          ),
        })),
        // After the plotted series, deliberately: a reader reads the quantity first and its
        // denominator second.
        ...contextRows,
      ]}
      total={total}
      /*
        Points, because that is how the lines are drawn: index 0 on the left edge of the plot,
        the last index on the right (`frame.x`). "bands" would put the crosshair half a slice
        off, which on a two-point series lands it in empty space.
      */
      mode="points"
      plotStart={frame.plotStart}
      plotEnd={frame.plotEnd}
    >
      <svg
        viewBox={`0 0 ${CHART_W} ${frame.height}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        <YAxis frame={frame} ticks={frame.ticks} formatValue={formatTick} />
        <XAxis frame={frame} labels={labels} />
        {fill && !log
          ? series.map((s) =>
              areas(s.values).map((d, i) => (
                <path
                  key={`${s.name}-fill-${i}`}
                  d={d}
                  fill="currentColor"
                  stroke="none"
                  className={s.className}
                  opacity={0.12}
                />
              )),
            )
          : null}
        {series.map((s) =>
          segments(s.values).map((d, i) => (
            <path
              key={`${s.name}-${i}`}
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className={s.className}
              opacity={s.opacity ?? 1}
              strokeDasharray={s.dashed ? "5 4" : s.dotted ? "1 3" : undefined}
              strokeLinecap={s.dotted ? "round" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
        {markers
          ? series.map((s) =>
              s.values.map((v, i) =>
                !drawable(v) ? null : (
                  <circle
                    key={`${s.name}-dot-${i}`}
                    cx={frame.x(i)}
                    cy={frame.y(v)}
                    r={Math.min(10, (4 * tickFont) / TICK_FONT)}
                    fill="currentColor"
                    className={s.className}
                    opacity={s.opacity ?? 1}
                  />
                ),
              ),
            )
          : null}
      </svg>
    </ChartHover>
  );
}

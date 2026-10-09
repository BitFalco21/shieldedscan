import { ChartHover, type ChartHoverRow } from "@/components/ChartHover";
import {
  CHART_H,
  CHART_W,
  COMPACT_TICK_FONT,
  PHONE_CHART_H,
  PHONE_TICK_FONT,
  TICK_FONT,
  XAxis,
  YAxis,
  axisFrame,
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
}

/**
 * A range drawn as a shaded area between two series: the middle half of a distribution, say. It
 * breaks wherever either edge is null, like a line, so a missing period is never shaded.
 */
export interface MultiLineBand {
  name: string;
  lower: (number | null)[];
  upper: (number | null)[];
  className: string;
  /** Fill opacity. Low, so the lines drawn over the band stay the thing read first. */
  opacity?: number;
}

export interface MultiLineChartProps {
  labels: string[];
  series: MultiLineSeries[];
  ariaLabel: string;
  formatValue?: (value: number) => string;
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
   * Gallery-size axes: the /charts grid renders this chart at ~half width, scaling the whole
   * viewBox down, so ticks are drawn larger to land back at a readable size. See
   * `COMPACT_TICK_FONT`.
   */
  compact?: boolean;
  /**
   * Phone-size axes and a taller frame, for a chart rendered across a phone's width. Takes
   * precedence over `compact`. See `PHONE_TICK_FONT`.
   */
  phone?: boolean;
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
  /** Shaded ranges, drawn beneath the lines, each with one readout row stating its two edges. */
  bands?: MultiLineBand[];
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
  readoutLabels,
  contextRows = [],
  baseline = "zero",
  compact = false,
  phone = false,
  yMax,
  markers = false,
  bands = [],
}: MultiLineChartProps) {
  if (labels.length === 0 || series.length === 0) return null;

  const values = [
    ...series.flatMap((s) => s.values),
    ...bands.flatMap((b) => [...b.lower, ...b.upper]),
  ].filter((v): v is number => v !== null);
  const max = Math.max(...values, yMax ?? 0, 0) || 1;
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
  const frame = axisFrame(
    labels.length,
    max,
    formatValue,
    min,
    phone ? PHONE_TICK_FONT : compact ? COMPACT_TICK_FONT : TICK_FONT,
    phone ? PHONE_CHART_H : CHART_H,
  );

  /** Path segments split on nulls, so gaps stay gaps. */
  const segments = (values: (number | null)[]): string[] => {
    const out: string[] = [];
    let current = "";
    values.forEach((v, i) => {
      if (v === null) {
        if (current) out.push(current);
        current = "";
        return;
      }
      current += `${current ? " L" : "M"}${frame.x(i).toFixed(1)} ${frame.y(v).toFixed(1)}`;
    });
    if (current) out.push(current);
    return out;
  };

  /** A band's closed shapes, one per run where both edges are present. */
  const bandShapes = (band: MultiLineBand): string[] => {
    const out: string[] = [];
    let run: number[] = [];
    const close = () => {
      if (run.length >= 2) {
        const up = run.map(
          (i, k) =>
            `${k === 0 ? "M" : "L"}${frame.x(i).toFixed(1)} ${frame.y(band.upper[i]!).toFixed(1)}`,
        );
        const down = [...run]
          .reverse()
          .map((i) => `L${frame.x(i).toFixed(1)} ${frame.y(band.lower[i]!).toFixed(1)}`);
        out.push(`${up.join(" ")} ${down.join(" ")} Z`);
      }
      run = [];
    };
    band.upper.forEach((u, i) => {
      if (u === null || band.lower[i] === null || band.lower[i] === undefined) close();
      else run.push(i);
    });
    close();
    return out;
  };

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
        ...bands.map((b) => ({
          name: b.name,
          values: b.lower.map((lo, i) => {
            const hi = b.upper[i];
            return lo === null || hi === null || hi === undefined
              ? "—"
              : `${formatValue(lo)} – ${formatValue(hi)}`;
          }),
        })),
        // After the plotted series, deliberately: a reader reads the quantity first and its
        // denominator second.
        ...contextRows,
      ]}
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
        <YAxis frame={frame} ticks={frame.ticks} formatValue={formatValue} />
        <XAxis frame={frame} labels={labels} />
        {bands.map((b) =>
          bandShapes(b).map((d, i) => (
            <path
              key={`${b.name}-band-${i}`}
              d={d}
              fill="currentColor"
              className={b.className}
              opacity={b.opacity ?? 0.14}
            />
          )),
        )}
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
              strokeDasharray={s.dashed ? "5 4" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
        {markers
          ? series.map((s) =>
              s.values.map((v, i) =>
                v === null ? null : (
                  <circle
                    key={`${s.name}-dot-${i}`}
                    cx={frame.x(i)}
                    cy={frame.y(v)}
                    r={phone ? 10 : compact ? 6 : 4}
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

import type { IssuanceEvent, IssuanceOutlook, IssuanceReading } from "@/domain";
import { MAX_SUPPLY_ZAT, issuanceAt, utcDayFromSeconds } from "@/domain";
import { ChartHover } from "@/components/ChartHover";
import {
  CHART_PAD_R,
  CHART_W,
  XAxis,
  YAxis,
  chartSize,
  tickCharW,
  ticksAxisFrame,
} from "@/components/chart-axes";
import { formatCount, formatZecTick, formatZecWhole, monthLong } from "@/lib/format";

export interface IssuanceChartProps {
  outlook: IssuanceOutlook;
  /** When the projection starts, Unix seconds: the "now" rule. */
  now: number;
  ariaLabel: string;
  /** The chart's drawn width in CSS px, so its text renders at the base size. See `MultiLineChart`. */
  renderedWidth?: number;
}

/** Hover positions: about one a month, evenly spaced in time so the crosshair tracks the clock. */
const MONTH_SECONDS = 30.4375 * 86_400;

/** Marker labels sit in at most this many rows above the plot; one that fits in none is left off. */
const LABEL_ROWS = 2;

/** A marker's label, as the chart prints it. */
function markerLabel(event: IssuanceEvent): string {
  return event.kind === "halving" ? `halving ${event.index}` : "reissuance";
}

/**
 * Issued ZEC over time: observed and filled up to now, then the schedule dashed to its end, against
 * the 21M cap.
 *
 * The x axis is time, so the observed closes and the projection's breakpoints are placed at their
 * own instants rather than at evenly spaced indices; the hover readout steps through an even grid of
 * instants over the same span, which keeps `ChartHover`'s crosshair on the clock. The y axis is
 * thirds of the cap, so the cap is the top gridline and the curve's approach to it reads directly.
 */
export function IssuanceChart({ outlook, now, ariaLabel, renderedWidth }: IssuanceChartProps) {
  const { observed, projected, events } = outlook;
  const first = observed[0] ?? projected[0];
  const last = projected[projected.length - 1];
  if (first === undefined || last === undefined || last.at <= first.at) return null;

  const { tickFont, height } = chartSize(false, renderedWidth);
  const markerFont = Math.round(tickFont * (10 / 11));
  const rowH = markerFont * 1.4;
  const ticks = [0, 1, 2, 3].map((k) => (MAX_SUPPLY_ZAT * k) / 3);

  const span = last.at - first.at;
  const n = Math.max(2, Math.round(span / MONTH_SECONDS) + 1);
  const grid = Array.from({ length: n }, (_, i) => first.at + (i * span) / (n - 1));
  const frame = ticksAxisFrame(n, ticks, formatZecTick, tickFont, height, LABEL_ROWS * rowH);
  const x = (t: number) => frame.x(((t - first.at) / span) * (n - 1));
  const plotTop = frame.y(MAX_SUPPLY_ZAT);
  const plotBottom = frame.y(0);

  const path = (points: { at: number; issuedZat: number }[]) =>
    points
      .map((p, k) => `${k ? "L" : "M"}${x(p.at).toFixed(1)} ${frame.y(p.issuedZat).toFixed(1)}`)
      .join(" ");
  const solid = path(observed);
  const area =
    observed.length > 1
      ? `${solid} L${x(observed[observed.length - 1]!.at).toFixed(1)} ${plotBottom.toFixed(1)} L${x(observed[0]!.at).toFixed(1)} ${plotBottom.toFixed(1)} Z`
      : null;
  // From the newest close, so the line is unbroken; anything after it was not observed.
  const lastClose = observed[observed.length - 1];
  const dashed = path(lastClose ? [lastClose, ...projected] : projected);

  // Labels laid left to right into the first row with room; each starts just right of its rule,
  // or ends just left of it near the right edge.
  const charW = tickCharW(markerFont) + markerFont * 0.1;
  const rowEnds = Array.from({ length: LABEL_ROWS }, () => -Infinity);
  const markers = [
    { label: "now", at: now },
    ...events.map((e) => ({ label: markerLabel(e), at: e.at })),
  ]
    .filter((m) => m.at >= first.at && m.at <= last.at)
    .map((m) => {
      const mx = x(m.at);
      const width = m.label.length * charW;
      const flip = mx + 4 + width > CHART_W - CHART_PAD_R;
      const from = flip ? mx - 4 - width : mx + 4;
      const row = rowEnds.findIndex((end) => from > end + 8);
      if (row >= 0) rowEnds[row] = from + width;
      return { ...m, mx, flip, row };
    });

  const readings = grid.map((t) => issuanceAt(outlook, t));
  const label = (r: IssuanceReading | null) =>
    r === null
      ? "—"
      : r.projected
        ? `${monthLong(r.at)} · estimate`
        : `${utcDayFromSeconds(r.at)} · block ${formatCount(r.height)}`;

  return (
    <ChartHover
      labels={readings.map(label)}
      rows={[
        {
          name: "Issued",
          values: readings.map((r) => (r && !r.projected ? formatZecWhole(r.issuedZat) : null)),
        },
        {
          name: "Projected",
          values: readings.map((r) => (r?.projected ? formatZecWhole(r.issuedZat) : null)),
        },
        {
          name: "Block",
          values: readings.map((r) => (r?.projected ? `≈ ${formatCount(r.height)}` : null)),
        },
      ]}
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
        <YAxis frame={frame} ticks={frame.ticks} formatValue={formatZecTick} />
        <XAxis frame={frame} labels={grid.map(monthLong)} />
        {/* The cap, over its gridline: the one reference the curve is read against. */}
        <g className="chart-marker">
          <line x1={frame.padL} x2={CHART_W - CHART_PAD_R} y1={plotTop} y2={plotTop} />
        </g>
        {markers.map((m) => (
          <g key={m.label} className="chart-marker">
            <line x1={m.mx} x2={m.mx} y1={plotTop} y2={plotBottom} />
            {m.row >= 0 ? (
              <text
                x={m.flip ? m.mx - 4 : m.mx + 4}
                y={plotTop - 6 - m.row * rowH}
                textAnchor={m.flip ? "end" : "start"}
                fontSize={markerFont}
                className="chart-marker-label"
              >
                {m.label}
              </text>
            ) : null}
          </g>
        ))}
        {area ? (
          <path d={area} fill="currentColor" stroke="none" className="text-series" opacity={0.14} />
        ) : null}
        {observed.length > 0 ? (
          <path
            d={solid}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="text-series"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <path
          d={dashed}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeDasharray="6 5"
          className="text-series"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </ChartHover>
  );
}

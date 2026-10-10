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

export interface FlowBalanceChartProps {
  points: { label: string; inValue: number; outValue: number }[];
  ariaLabel: string;
  /**
   * What the two directions are called, in the readout and the bar titles.
   *
   * Required: this component draws both shielding flows and cross-chain volume, where the
   * directions are ZEC arriving on and leaving Zcash across a bridge. A default would let one
   * caller's vocabulary silently describe another caller's data.
   */
  inLabel: string;
  outLabel: string;
  /** Formats a value for the readout. These are zatoshis; without it they render raw. */
  formatValue?: (value: number) => string;
  /** The y-axis labels, if coarser than `formatValue`; the readout keeps `formatValue`. */
  formatTick?: (value: number) => string;
  /** Unambiguous labels for the readout; falls back to each point's axis label. */
  readoutLabels?: string[];
}

/**
 * Two opposing flows around a zero line, on one shared scale.
 *
 * Gross in and out rather than a single net line: a month with 9,817 ZEC shielded and 9,814
 * unshielded nets to 3.7 and would draw as a flat month, when ~20,000 ZEC crossed the privacy
 * boundary. Both bars are drawn and the net is the visible imbalance between them.
 *
 * One shared `maxAbs` across both directions is the correctness argument for the component:
 * scaling each side to its own maximum would make every month look balanced.
 *
 * Direction is carried by position and opacity, never by red/green. ZEC leaving the shielded
 * pools is not "bad", and colouring it as loss would be an editorial claim.
 */
export function FlowBalanceChart({
  points,
  ariaLabel,
  inLabel,
  outLabel,
  formatValue = String,
  formatTick = formatValue,
  readoutLabels,
}: FlowBalanceChartProps) {
  if (points.length === 0) return null;

  // Shared across BOTH directions — see the note above.
  const maxAbs =
    Math.max(...points.map((p) => Math.max(Math.abs(p.inValue), Math.abs(p.outValue))), 0) || 1;

  // A diverging frame: zero sits mid-plot and the axis runs −max..+max, so both directions
  // read against the ruler the bars are drawn with. The gutter self-sizes against the signed
  // tick labels it will print.
  const signedWith = (format: (v: number) => string) => (value: number) =>
    `${value > 0 ? "+" : value < 0 ? "−" : ""}${format(Math.abs(value))}`;
  // The readout's net is a stated amount and keeps full precision; the axis ticks need less.
  const signed = signedWith(formatValue);
  const signedTick = signedWith(formatTick);
  const tickFont = TICK_FONT;
  const ticks = [-1, -0.5, 0, 0.5, 1].map((f) => maxAbs * f);
  const padL =
    Math.max(...ticks.map((t) => signedTick(t).length)) * tickCharW(tickFont) + CHART_GUTTER_GAP;
  const plotW = CHART_W - padL - CHART_PAD_R;
  // The gap shrinks with the slot: a fixed 2-unit gap would erase the bars at a 365-day range
  // (~2.5 units/slot). A fifth of the slot keeps bars dominant at any count.
  const gap = Math.min(2, (plotW / points.length) * 0.2);
  const plotH = CHART_H - CHART_PAD_T - CHART_PAD_B;
  const mid = CHART_PAD_T + plotH / 2;
  const barWidth = plotW / points.length - gap;
  const frame = {
    padL,
    tickFont,
    x: (i: number) => padL + (i / points.length) * plotW,
    y: (v: number) => mid - (v / maxAbs) * (plotH / 2),
    plotStart: padL / CHART_W,
    plotEnd: (CHART_W - CHART_PAD_R) / CHART_W,

    height: CHART_H,
  };

  return (
    <ChartHover
      labels={readoutLabels ?? points.map((point) => point.label)}
      rows={[
        { name: inLabel, values: points.map((p) => formatValue(p.inValue)) },
        { name: outLabel, values: points.map((p) => formatValue(p.outValue)) },
        // Net is derived here rather than passed in, so it can never disagree with the two
        // bars a reader is looking at.
        { name: "Net", values: points.map((p) => signed(p.inValue - p.outValue)) },
      ]}
      mode="bands"
      plotStart={frame.plotStart}
      plotEnd={frame.plotEnd}
    >
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        <YAxis frame={frame} ticks={ticks} formatValue={signedTick} />
        <XAxis frame={frame} labels={points.map((p) => p.label)} />
        <line
          x1={padL}
          y1={mid}
          x2={CHART_W - CHART_PAD_R}
          y2={mid}
          stroke="var(--ink-faint)"
          strokeWidth={1}
        />
        {points.map((point, index) => {
          const inHeight = (Math.abs(point.inValue) / maxAbs) * (plotH / 2);
          const outHeight = (Math.abs(point.outValue) / maxAbs) * (plotH / 2);
          const x = frame.x(index);
          return (
            <g key={point.label}>
              <rect
                x={x}
                y={mid - inHeight}
                width={barWidth}
                height={Math.max(inHeight, 0)}
                fill="var(--series)"
                opacity={1}
              >
                <title>{`${point.label}: ${formatValue(point.inValue)} ${inLabel.toLowerCase()}`}</title>
              </rect>
              <rect
                x={x}
                y={mid}
                width={barWidth}
                height={Math.max(outHeight, 0)}
                fill="var(--series)"
                opacity={0.35}
              >
                <title>{`${point.label}: ${formatValue(point.outValue)} ${outLabel.toLowerCase()}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </ChartHover>
  );
}

import type { ReactNode } from "react";

/**
 * Shared axis geometry, so every chart states its scale the same way. The hover readout
 * answers "what is this exact point", but only an axis answers "what am I looking at" before
 * any interaction — and screenshots and phones carry no hover.
 *
 *  - The left gutter sizes itself to its own longest tick. A fixed gutter clips "1.18M ZEC"
 *    to ".18M ZEC", and an axis that drops a leading digit is worse than no axis.
 *  - The tick font size lives on the frame and is emitted as a `fontSize` attribute, never
 *    in CSS: the gutter width, the label density and the glyphs all derive from one number.
 *    (A CSS rule would also silently override the attribute.)
 *  - X labels are sparse (~8 across at the base size, fewer when the font is larger), first
 *    and last always shown.
 */

export const CHART_W = 1000;
export const CHART_H = 320;
export const CHART_PAD_R = 12;
export const CHART_PAD_T = 16;
export const CHART_PAD_B = 30;
/** Space between the longest y tick label and the plot, in SVG units. */
export const CHART_GUTTER_GAP = 14;

/** Tick text size in SVG units — renders ~1:1 on a full-width chart page. */
export const TICK_FONT = 11;
/**
 * A phone's chart: ~285px of panel for a 1000-unit frame, so a tick needs ~40 units to land
 * near 11px, and the frame is taller (`PHONE_CHART_H`) so the plot is not a strip the hover
 * readout covers whole.
 */
export const PHONE_TICK_FONT = 40;
export const PHONE_CHART_H = 640;

/**
 * JetBrains Mono's advance per character, scaled with the font: 7.2 units/char at the
 * 11-unit base. Long ticks ("0.0001875 ZEC") measure ~7.0/char, so this keeps them unclipped.
 */
export const tickCharW = (tickFont: number): number => (7.2 / TICK_FONT) * tickFont;

export interface AxisFrame {
  padL: number;
  x: (i: number) => number;
  y: (v: number) => number;
  /** For `ChartHover`'s plot alignment. */
  plotStart: number;
  plotEnd: number;
  /** SVG-unit tick size the gutter was computed for; `YAxis`/`XAxis` render it. */
  tickFont: number;
  /** The viewBox height the frame was laid out in. */
  height: number;
}

/** Gutter + scales for a chart whose y axis runs 0..max (or min..max when given). */
export function axisFrame(
  n: number,
  max: number,
  formatValue: (v: number) => string,
  min = 0,
  tickFont = TICK_FONT,
  height = CHART_H,
): AxisFrame & { ticks: number[] } {
  const span = max - min || 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + span * f);
  const padL =
    Math.max(...ticks.map((t) => formatValue(t).length)) * tickCharW(tickFont) + CHART_GUTTER_GAP;
  // Room for the x labels below and the top tick's upper half above; a larger tick (the
  // phone's) buys more.
  const padB = Math.max(CHART_PAD_B, tickFont + 8);
  const padT = Math.max(CHART_PAD_T, tickFont * 0.7);
  return {
    padL,
    ticks,
    tickFont,
    x: (i: number) => padL + (n > 1 ? (i / (n - 1)) * (CHART_W - padL - CHART_PAD_R) : 0),
    y: (v: number) => height - padB - ((v - min) / span) * (height - padT - padB),
    plotStart: padL / CHART_W,
    plotEnd: (CHART_W - CHART_PAD_R) / CHART_W,
    height,
  };
}

/** The gridlines and tick labels for a frame. Render FIRST so data sits over the grid. */
export function YAxis({
  frame,
  ticks,
  formatValue,
}: {
  frame: AxisFrame;
  ticks: number[];
  formatValue: (v: number) => string;
}): ReactNode {
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={frame.padL}
            x2={CHART_W - CHART_PAD_R}
            y1={frame.y(t)}
            y2={frame.y(t)}
            className="chart-grid"
          />
          <text
            x={frame.padL - 8}
            y={frame.y(t) + 4}
            textAnchor="end"
            fontSize={frame.tickFont}
            className="chart-tick"
          >
            {formatValue(t)}
          </text>
        </g>
      ))}
    </>
  );
}

/**
 * Sparse x labels, first and last always present.
 *
 * The density self-sizes the way the gutter does: as many labels as fit with half a label of
 * air between neighbours, capped at ~8. Deriving the count from the labels' measured width,
 * rather than a fixed count, is what keeps long dates from fusing at larger font sizes.
 */
export function XAxis({ frame, labels }: { frame: AxisFrame; labels: string[] }): ReactNode {
  const n = labels.length;
  const labelW = Math.max(...labels.map((l) => l.length), 1) * tickCharW(frame.tickFont);
  const fit = Math.floor((CHART_W - frame.padL - CHART_PAD_R) / (labelW * 1.5));
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.min(8, fit))));
  return (
    <>
      {labels.map((label, i) => {
        if (i !== 0 && i !== n - 1 && i % every !== 0) return null;
        // A mid label too close to the last would collide with it; the last one wins. Measured
        // in drawn units, not indices: the last label is end-anchored, so it reaches a whole
        // label width back from its point while a mid label reaches half a width either side.
        if (i !== 0 && i !== n - 1 && frame.x(n - 1) - frame.x(i) < labelW * 1.5) return null;
        return (
          <text
            key={`${label}-${i}`}
            x={frame.x(i)}
            y={frame.height - 8}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fontSize={frame.tickFont}
            className="chart-tick"
          >
            {label}
          </text>
        );
      })}
    </>
  );
}

import type { ReactNode } from "react";
import { niceAxis } from "@/lib/nice-ticks";

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

/**
 * Gutter + scales for a chart whose data runs 0..max (or min..max when given). The axis is the
 * round one around that range (`niceAxis`), and the scale runs to its top tick.
 */
export function axisFrame(
  n: number,
  dataMax: number,
  formatValue: (v: number) => string,
  dataMin = 0,
  tickFont = TICK_FONT,
  height = CHART_H,
): AxisFrame & { ticks: number[] } {
  const { min, max, ticks } = niceAxis(dataMin, dataMax, { label: formatValue });
  const span = max - min;
  return frameFor(n, ticks, formatValue, tickFont, height, (v) => (v - min) / span);
}

/**
 * Gutter + scales for a LOG y axis: one tick per power of ten from the decade at or below the
 * lowest positive value to the one at or above the highest. For series of one measure that differ
 * by orders of magnitude; a value at or below zero has no place on it, and callers draw a gap.
 */
export function logAxisFrame(
  n: number,
  lowestPositive: number,
  max: number,
  formatValue: (v: number) => string,
  tickFont = TICK_FONT,
  height = CHART_H,
): AxisFrame & { ticks: number[] } {
  const bottom = Math.floor(Math.log10(lowestPositive));
  const top = Math.max(Math.ceil(Math.log10(max)), bottom + 1);
  // At most ~6 gridlines however many decades the data spans.
  const step = Math.ceil((top - bottom + 1) / 6);
  const ticks: number[] = [];
  for (let k = bottom; k <= top; k += step) ticks.push(10 ** k);
  return frameFor(n, ticks, formatValue, tickFont, height, (v) =>
    v > 0 ? (Math.log10(v) - bottom) / (top - bottom) : 0,
  );
}

/** The shared geometry: a gutter sized to the ticks, and `y` from a value's fraction of the axis. */
function frameFor(
  n: number,
  ticks: number[],
  formatValue: (v: number) => string,
  tickFont: number,
  height: number,
  fraction: (v: number) => number,
): AxisFrame & { ticks: number[] } {
  const padL =
    Math.max(...ticks.map((t) => formatValue(t).length)) * tickCharW(tickFont) + CHART_GUTTER_GAP;
  // Room for the x labels below and the top tick's upper half above; a larger tick (the
  // phone's) buys more. Below, two lines of tick: one would leave the lowest y label level
  // with the first x label, where "0 ZEC" and "2026-07-01" read as one run. At the base size
  // this is exactly `CHART_PAD_B`.
  const padB = Math.max(CHART_PAD_B, 2 * tickFont + 8);
  const padT = Math.max(CHART_PAD_T, tickFont * 0.7);
  return {
    padL,
    ticks,
    tickFont,
    x: (i: number) => padL + (n > 1 ? (i / (n - 1)) * (CHART_W - padL - CHART_PAD_R) : 0),
    y: (v: number) => height - padB - fraction(v) * (height - padT - padB),
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
            // Baseline a third of the font below the gridline, so the label centres on it at any
            // size: a fixed 4 units centres an 11-unit tick but leaves a phone's riding above it,
            // and the top one clipped.
            y={frame.y(t) + (4 / TICK_FONT) * frame.tickFont}
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
        // Stepped back from the last label, the newest period, so the step between the last two
        // is a whole step and never a stub with the space it lost left as a gap mid-axis.
        if (i !== 0 && i !== n - 1 && (n - 1 - i) % every !== 0) return null;
        // A mid label too close to either end would collide with it; the end label wins.
        // Measured in drawn units, not indices: the end labels are anchored at their outer edge,
        // so each reaches a whole label width inward while a mid label reaches half a width.
        if (i !== 0 && i !== n - 1 && frame.x(n - 1) - frame.x(i) < labelW * 1.5) return null;
        if (i !== 0 && i !== n - 1 && frame.x(i) - frame.x(0) < labelW * 1.5) return null;
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

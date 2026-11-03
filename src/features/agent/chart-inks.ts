import type { PlotInk, PlottableSeries } from "@/domain";
import { flowPaletteClass, VENUE_CLASSES } from "@/lib/flow-palette";
import { BESIDE_POOLS, POOL_CLASSES } from "@/lib/pool-palette";
import { BESIDE_RANKED_LINE, KIND_CLASSES, RANKED_LINES } from "@/lib/ranked-palette";

/**
 * The colours of a Zeno chart's lines. An entity keeps its site-wide colour, so Orchard or Bitcoin
 * reads the same here as on every chart; two lines on one chart are never too alike to tell apart.
 * `chart-colours.test.ts` measures every combination the series families allow, under every theme,
 * and fails if the two tables below are not exactly what the stylesheet requires.
 */

/** The site-wide colour of an entity: a pool, a privacy kind, a chain, a venue. */
function ownInk(ink: PlotInk): string {
  if ("pool" in ink) return POOL_CLASSES[ink.pool];
  if ("txKind" in ink) return KIND_CLASSES[ink.txKind];
  if ("chain" in ink) return flowPaletteClass(ink.chain);
  return VENUE_CLASSES[ink.venue];
}

/** The eight category colours chains are drawn in (`flowPaletteClass`). */
const FLOW_INKS = Array.from({ length: 8 }, (_, i) => `flow-${i + 1}`);

/** Every ink a line can be given, own or spare: the universe the colour test measures. */
export const CHART_INKS: readonly string[] = [
  ...new Set([
    ...RANKED_LINES,
    BESIDE_RANKED_LINE,
    BESIDE_POOLS,
    ...FLOW_INKS,
    ...Object.values(POOL_CLASSES),
    ...Object.values(VENUE_CLASSES),
  ]),
];

/**
 * Ink pairs too alike to share a chart on some theme: under the normal-vision floor, or under the
 * colour-blind floor even with a pattern. Where an entity's own ink is one of these beside an
 * earlier line's, it gives way to a spare, as a second chain sharing a flow colour does.
 */
export const CLASH_INKS: readonly (readonly [string, string])[] = [
  // Flow colours beside each other: the Sankey labels its ribbons; a line chart cannot.
  ["flow-1", "flow-7"],
  ["flow-2", "flow-5"],
  ["flow-4", "flow-6"],
  ["flow-6", "flow-rest"],
  // Flow colours beside the ranked lines, whose hues follow the theme.
  ["flow-1", "text-green"],
  ["flow-1", "text-line-2"],
  ["flow-2", "text-line-4"],
  ["flow-4", "text-line-4"],
  ["flow-5", "text-line-2"],
  ["flow-5", "text-line-4"],
  ["flow-6", "text-green"],
  ["flow-6", "text-line-3"],
  ["flow-6", "text-line-4"],
  ["flow-7", "text-green"],
  ["flow-7", "text-line-2"],
  ["flow-rest", "text-line-2"],
  ["flow-rest", "text-line-3"],
  ["flow-rest", "text-line-4"],
  ["text-green", "text-line-4"],
  ["text-line-3", "text-line-4"],
];

/**
 * Ink pairs a red-green colour-blind reader barely tells apart on some theme (OKLab ΔE×100 under
 * 8 for protanopia or deuteranopia), so where both are on one chart, one of the two lines is
 * dotted.
 */
export const NEAR_INKS: readonly (readonly [string, string])[] = [
  // Sprout beside Orchard, and beside the line drawn next to the pools.
  ["flow-4", "flow-rest"],
  ["flow-3", "flow-rest"],
  // The privacy kinds; under the amber theme --line-2 is violet beside --line-3's blue-grey.
  ["text-green", "text-line-2"],
  ["text-line-2", "text-line-3"],
  // Chains and venues in the flow colours, beside each other and the ranked lines.
  ["flow-1", "flow-8"],
  ["flow-4", "flow-8"],
  ["flow-3", "text-line-3"],
  ["flow-4", "text-line-3"],
  ["flow-6", "text-line-2"],
];

const listed = (list: readonly (readonly [string, string])[], a: string, b: string) =>
  list.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

const clash = (a: string, b: string) => a === b || listed(CLASH_INKS, a, b);

/**
 * One ink per series, in two passes. First every series claims its own ink unless an earlier line
 * already holds it or one too like it. Then a series with no ink of its own, or one that gave way,
 * takes the first spare unlike every ink on the chart. Beside a pool the spares start with
 * `BESIDE_POOLS`, the flow colour apart from all four pools.
 */
export function seriesInks(series: readonly PlottableSeries[]): string[] {
  const assigned: (string | null)[] = [];
  for (const s of series) {
    const own = s.ink === undefined ? null : ownInk(s.ink);
    const free = own !== null && !assigned.some((a) => a !== null && clash(a, own));
    assigned.push(free ? own : null);
  }
  const besidePools = series.some((s) => s.ink !== undefined && "pool" in s.ink);
  const spares = [
    ...(besidePools ? [BESIDE_POOLS] : []),
    ...RANKED_LINES,
    ...FLOW_INKS,
    BESIDE_RANKED_LINE,
  ];
  return assigned.map((ink, i) => {
    if (ink !== null) return ink;
    const spare = spares.find((c) => !assigned.some((a) => a !== null && clash(a, c)))!;
    assigned[i] = spare;
    return spare;
  });
}

/**
 * Which lines are dotted: a line whose ink is near an earlier solid line's is dotted, so every
 * near pair differs in pattern as well as colour. Dotted, not dashed, because a dashed line on
 * these charts means a reference rather than a measurement.
 */
export function seriesDotted(series: readonly PlottableSeries[]): boolean[] {
  const inks = seriesInks(series);
  const dotted: boolean[] = [];
  inks.forEach((ink, i) => {
    dotted.push(inks.slice(0, i).some((other, j) => !dotted[j] && listed(NEAR_INKS, ink, other)));
  });
  return dotted;
}

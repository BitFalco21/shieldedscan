import {
  chartSeries,
  utcDayFromSeconds,
  type PlotGrain,
  type PlottableSeries,
  type PlottedChart,
} from "@/domain";
import { monthLong, monthShort } from "@/lib/format";
import { BESIDE_POOLS, POOL_CLASSES } from "@/lib/pool-palette";
import { KIND_CLASSES, RANKED_LINES } from "@/lib/ranked-palette";
import { UNRANGED } from "@/features/charts/chart-table";

/**
 * How a Zeno chart is presented: each series' ink, the period labels, and the `/charts` pages to
 * open. Pure, so the component stays layout and the rules are tested on their own.
 */

/**
 * One ink per series. A pool or a privacy kind keeps its site-wide colour, so Orchard reads the
 * same here as on every chart; anything else takes the ranked inks in order, skipping one a pool
 * or kind already holds on this chart. Beside a pool, a series that is not one takes
 * `BESIDE_POOLS` first: the accent sits on Ironwood's gold under the amber theme.
 */
export function seriesInks(series: readonly PlottableSeries[]): string[] {
  const own = series.map((s) =>
    s.ink === undefined
      ? null
      : "pool" in s.ink
        ? POOL_CLASSES[s.ink.pool]
        : KIND_CLASSES[s.ink.txKind],
  );
  const besidePools = series.some((s) => s.ink !== undefined && "pool" in s.ink);
  const free = [...(besidePools ? [BESIDE_POOLS] : []), ...RANKED_LINES].filter(
    (ink) => !own.includes(ink),
  );
  let next = 0;
  return own.map((ink) => ink ?? free[next++ % free.length]!);
}

/**
 * Ink pairs a red-green colour-blind reader barely tells apart on some theme (OKLab ΔE×100 under
 * 8 for protanopia or deuteranopia), so where both are on one chart, one of the two lines is
 * dotted. `chart-colours.test.ts` measures every pair the catalogue allows, and fails if this list
 * misses one or names one that no longer needs it.
 */
export const NEAR_INKS: readonly (readonly [string, string])[] = [
  [POOL_CLASSES.sprout, POOL_CLASSES.orchard],
  [POOL_CLASSES.sprout, BESIDE_POOLS],
  [KIND_CLASSES.shielded, KIND_CLASSES.mixed],
  // Under the amber theme, whose --line-2 is violet beside --line-3's blue-grey.
  [KIND_CLASSES.mixed, KIND_CLASSES.transparent],
];

const near = (a: string, b: string) =>
  NEAR_INKS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/**
 * Which lines are dotted: a line whose ink is near an earlier solid line's is dotted, so every
 * near pair differs in pattern as well as colour. Dotted, not dashed, because a dashed line on
 * these charts means a reference rather than a measurement.
 */
export function seriesDotted(series: readonly PlottableSeries[]): boolean[] {
  const inks = seriesInks(series);
  const dotted: boolean[] = [];
  inks.forEach((ink, i) => {
    dotted.push(inks.slice(0, i).some((other, j) => !dotted[j] && near(ink, other)));
  });
  return dotted;
}

/** An axis label for a period: a day (a week by its Monday), or a short month. */
export function axisLabel(grain: PlotGrain, t: number): string {
  return grain === "month" ? monthShort(t) : utcDayFromSeconds(t);
}

/** A readout label, unambiguous alone: a month with its year, a week said to be one. */
export function readoutLabel(grain: PlotGrain, t: number): string {
  if (grain === "month") return monthLong(t);
  return grain === "week" ? `Week of ${utcDayFromSeconds(t)}` : utcDayFromSeconds(t);
}

export interface ChartLink {
  href: string;
  label: string;
}

/**
 * The `/charts` pages plotting these series, one per page. The href carries the page's own range
 * parameter when the chart was asked as a preset, and never anything from the conversation: the
 * question stays in this tab.
 */
export function chartLinks(chart: PlottedChart): ChartLink[] {
  const slugs = [
    ...new Set(chartSeries(chart).flatMap((s) => (s.chartSlug === null ? [] : [s.chartSlug]))),
  ];
  const preset = chart.range === null || chart.range === "all" ? null : chart.range;
  return slugs.map((slug) => {
    // A page without a range control would ignore the parameter, so it is not sent.
    const ranged = preset !== null && !(UNRANGED as ReadonlySet<string>).has(slug);
    return { href: `/charts/${slug}${ranged ? `?range=${preset}` : ""}`, label: `/charts/${slug}` };
  });
}

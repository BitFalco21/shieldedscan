import {
  chartSeries,
  utcDayFromSeconds,
  type PlotGrain,
  type PlottableSeries,
  type PlottedChart,
} from "@/domain";
import { monthLong, monthShort } from "@/lib/format";
import { POOL_CLASSES } from "@/lib/pool-palette";
import { KIND_CLASSES, RANKED_LINES } from "@/lib/ranked-palette";
import { UNRANGED } from "@/features/charts/chart-table";

/**
 * How a Zeno chart is presented: each series' ink, the period labels, and the `/charts` pages to
 * open. Pure, so the component stays layout and the rules are tested on their own.
 */

/**
 * One ink per series. A pool or a privacy kind keeps its site-wide colour, so Orchard reads the
 * same here as on every chart; anything else takes the ranked inks in order, skipping one a pool
 * or kind already holds on this chart.
 */
export function seriesInks(series: readonly PlottableSeries[]): string[] {
  const own = series.map((s) =>
    s.ink === undefined
      ? null
      : "pool" in s.ink
        ? POOL_CLASSES[s.ink.pool]
        : KIND_CLASSES[s.ink.txKind],
  );
  const free = RANKED_LINES.filter((ink) => !own.includes(ink));
  let next = 0;
  return own.map((ink) => ink ?? free[next++ % free.length]!);
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

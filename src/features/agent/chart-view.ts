import {
  chartKey,
  chartSeries,
  MAX_CHARTS_PER_ANSWER,
  utcDayFromSeconds,
  type PlotGrain,
  type PlottedChart,
} from "@/domain";
import { monthLong } from "@/lib/format";
import { UNRANGED } from "@/features/charts/chart-table";

/**
 * How a Zeno chart is presented: the period labels, the `/charts` pages to open, and (from
 * `chart-inks.ts`) each series' ink. Pure, so the component stays layout and the rules are tested
 * on their own.
 */

export { CLASH_INKS, NEAR_INKS, seriesDotted, seriesInks } from "./chart-inks";

/**
 * An axis label for a period: a day (a week by its Monday), or a month with its whole year. Not
 * "Oct 16", which beside day labels reads as the 16th of October.
 */
export function axisLabel(grain: PlotGrain, t: number): string {
  return grain === "month" ? monthLong(t) : utcDayFromSeconds(t);
}

/** A readout label, unambiguous alone: a month with its year, a week said to be one. */
export function readoutLabel(grain: PlotGrain, t: number): string {
  if (grain === "month") return monthLong(t);
  return grain === "week" ? `Week of ${utcDayFromSeconds(t)}` : utcDayFromSeconds(t);
}

/**
 * An answer's charts with one more off the stream: deduped and capped here as on the server, so a
 * misbehaving stream can neither repeat a chart nor fill the turn.
 */
export function withChart(charts: readonly PlottedChart[], chart: PlottedChart): PlottedChart[] {
  if (charts.some((c) => chartKey(c) === chartKey(chart))) return [...charts];
  return [...charts, chart].slice(0, MAX_CHARTS_PER_ANSWER);
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

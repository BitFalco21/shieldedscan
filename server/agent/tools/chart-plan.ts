import {
  DAY_SECONDS,
  nextPeriod,
  periodStart,
  plottableSeries,
  utcDayFromSeconds,
  type PlotGrain,
  type PlottableSeries,
  type PlotSeriesSpec,
} from "@/domain";
import type { ChartRequest } from "./chart-args";
import type { ChartRefusal } from "./chart-refusal";
import { seriesSource, type SeriesSource } from "./chart-sources";

/**
 * How a chart request is drawn before anything is read: the grain its window takes, the day it
 * starts from, or why no honest grain exists. Pure, so every rule is tested without a source.
 */

/** Spans up to this many days plot per day, and up to the next per week; longer, per month. */
const DAILY_UP_TO_DAYS = 120;
const WEEKLY_UP_TO_DAYS = 730;

/** The shortest window a monthly-only series is drawn over: about two whole months. */
export const MIN_MONTHLY_SPAN_DAYS = 59;

/** "X is" or "X, Y are", for a sentence naming series. */
const named = (labels: readonly string[]) =>
  `${labels.join(", ")} ${labels.length === 1 ? "is" : "are"}`;

export interface Entry {
  spec: PlotSeriesSpec;
  meta: PlottableSeries;
  src: SeriesSource;
}

export const entriesOf = (req: Pick<ChartRequest, "series">): Entry[] =>
  req.series.map((spec) => ({ spec, meta: plottableSeries(spec), src: seriesSource(spec) }));

/** The `/charts` pages behind these series, for a refusal to cite. */
export const pagesOf = (entries: readonly { meta: PlottableSeries }[]) =>
  entries.flatMap((e) => (e.meta.chartSlug === null ? [] : [e.meta.chartSlug]));

/** How a window is drawn: its grain, and the day it starts from. */
export interface ChartPlan {
  grain: PlotGrain;
  fromDay: number;
}

/** The grain and start a window is drawn at, or why no honest grain exists. */
export function chartPlan(req: ChartRequest, today: number): ChartPlan | ChartRefusal {
  const entries = entriesOf(req);
  // A series kept per month sets the grain for the whole chart.
  const monthsOnly = entries.filter((e) => e.src.daily === undefined);
  if (monthsOnly.length > 0) {
    const dayOnly = entries.filter((e) => e.meta.kind === "level" && e.src.daily !== undefined);
    if (dayOnly.length > 0) {
      return {
        reason: "monthly-only",
        message: `${named(monthsOnly.map((e) => e.meta.label))} kept per month and ${named(dayOnly.map((e) => e.meta.label))} drawn per day only — chart them separately`,
        closest: entries.map((e) => ({ series: [e.spec] })),
      };
    }
    return { grain: "month", fromDay: req.fromDay };
  }
  // An average, a median or a distinct count does not add up or re-average: only ever per day.
  if (entries.some((e) => e.meta.kind === "level")) {
    return reachCheck(entries, "day", req, today) ?? { grain: "day", fromDay: req.fromDay };
  }
  const spanDays = (Math.min(req.toDay, today + DAY_SECONDS) - req.fromDay) / DAY_SECONDS;
  const grain: PlotGrain =
    spanDays <= DAILY_UP_TO_DAYS ? "day" : spanDays <= WEEKLY_UP_TO_DAYS ? "week" : "month";
  if (grain === "month") return { grain, fromDay: req.fromDay };
  const edge = dailyEdge(entries, today);
  if (edge === null || periodStart(grain, req.fromDay) >= edge) {
    return { grain, fromDay: req.fromDay };
  }
  // A year asked of a source that keeps a year: the first whole period inside it, so "the last
  // year" reads weekly rather than dropping to thirteen months. The caption names the real start.
  if (req.fromDay >= edge - 7 * DAY_SECONDS) {
    const start = periodStart(grain, edge);
    return { grain, fromDay: start < edge ? nextPeriod(grain, start) : start };
  }
  // Further back than the daily sources go: read the monthly ones, never a cut-short window.
  return reachCheck(entries, grain, req, today) ?? { grain: "month", fromDay: req.fromDay };
}

/** The earliest day every daily source in the chart still serves, or null when all keep history. */
function dailyEdge(entries: readonly Entry[], today: number): number | null {
  const edges = entries.flatMap(({ src }) =>
    src.dailyReachDays === null ? [] : [today - (src.dailyReachDays - 1) * DAY_SECONDS],
  );
  return edges.length === 0 ? null : Math.max(...edges);
}

/** Why a window reaches past a daily source with no monthly one, or null when it does not. */
function reachCheck(
  entries: Entry[],
  grain: PlotGrain,
  req: ChartRequest,
  today: number,
): ChartRefusal | null {
  const edge = dailyEdge(entries, today);
  if (edge === null || periodStart(grain, req.fromDay) >= edge - 7 * DAY_SECONDS) return null;
  const short = entries.filter((e) => e.src.dailyReachDays !== null && e.src.monthly === undefined);
  // Every short daily source has a monthly one: the window reads months instead.
  if (short.length === 0) return null;
  return {
    reason: "reach",
    message: `${short.map((e) => e.meta.label).join(", ")} per day only reaches back a year, with no monthly series behind it — ask for at most the last year`,
    closest: [{ series: req.series, range: "1y" }],
    pages: pagesOf(short),
  };
}

/** The refusal for a window too short to be a chart, with the nearest one that is. */
export function shortWindow(entries: Entry[], grain: PlotGrain, req: ChartRequest): ChartRefusal {
  const monthsOnly = entries.filter((e) => e.src.daily === undefined);
  if (grain === "month" && monthsOnly.length > 0) {
    // Per chain or venue a day is not kept; the total is, so the same window can still be drawn.
    const directions = new Set(
      monthsOnly.flatMap((e) => (e.spec.family === "crosschain" ? [e.spec.direction] : [])),
    );
    const totals = [...directions].map((direction) => ({
      family: "crosschain",
      direction,
      by: "total",
      measure: "zec",
    }));
    const window =
      req.range === null
        ? { from: utcDayFromSeconds(req.fromDay), to: utcDayFromSeconds(req.toDay) }
        : { range: req.range };
    return {
      reason: "monthly-only",
      message: `${named(monthsOnly.map((e) => e.meta.label))} kept per month, and that window holds fewer than two months${
        totals.length > 0
          ? "; per day, only the total across all chains and venues is kept — for one chain's figure over those days in words, use the crosschain tool's aggregate"
          : ""
      }`,
      closest: [
        { series: req.series, range: "1y" },
        ...(totals.length > 0 ? [{ series: totals, ...window }] : []),
      ],
      pages: pagesOf(monthsOnly),
    };
  }
  return {
    reason: "window",
    message:
      "that window holds fewer than two periods to plot — a single figure is an answer in words, not a chart",
    closest: [{ series: req.series, range: "30d" }],
    pages: pagesOf(entries),
  };
}

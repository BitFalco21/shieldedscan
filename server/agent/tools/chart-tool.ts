import {
  absentBefore,
  alignMonths,
  chartCaption,
  chartCaveats,
  DAY_SECONDS,
  firstNonZero,
  lastPeriodIsPartial,
  MAX_PLOT_POINTS,
  nextPeriod,
  periodStart,
  plottableSeries,
  plotWindow,
  resampleDays,
  utcDayFromSeconds,
  type PlotGrain,
  type PlotPoint,
  type PlottedChart,
  type PlottedSeries,
  type PlotWindow,
} from "@/domain";
import { formatPlotExact } from "@/lib/plot-format";
import type { ChartRequest } from "./chart-args";
import {
  CHART_SOURCES,
  MAX_PRICE_PAGES,
  readPricePage,
  SERIES_SOURCES,
  type ChartSourceName,
  type SourceRows,
} from "./chart-sources";
import { DATA_NOTICE } from "./notes";

/**
 * `make_chart`'s work once its arguments are valid: choose the grain, read each source once, cut the
 * rows into periods, and hand back the chart with a summary for the model. Every number in the chart
 * is a value read from a source body here; nothing from the request reaches a value.
 */

/** Reads one path on one surface; the caller supplies the requesters. */
export type ChartReader = (
  surface: "v1" | "chain",
  path: string,
) => Promise<{ status: number; body: string }>;

export interface ChartOutcome {
  chart: PlottedChart;
  /** What the model reads: the caption, the caveats, and a summary of each series. */
  content: string;
}

/** Spans up to this many days plot per day, and up to the next per week; longer, per month. */
const DAILY_UP_TO_DAYS = 120;
const WEEKLY_UP_TO_DAYS = 730;

/**
 * Same-measure series this far apart in size leave the smaller a flat line on a linear axis. The
 * model chose the scale, so it is told, rather than the scale being switched under it.
 */
const LOG_HINT_RATIO = 100;

/** How a window is drawn: its grain, and the day it starts from. */
export interface ChartPlan {
  grain: PlotGrain;
  fromDay: number;
}

/** The grain and start a window is drawn at, or why no honest grain exists. */
export function chartPlan(req: ChartRequest, today: number): ChartPlan | string {
  const entries = req.series.map((id) => ({ id, meta: plottableSeries(id) }));
  // An average or a distinct count does not add up or re-average, so it is only ever per day.
  if (entries.some((e) => e.meta.kind === "level")) return { grain: "day", fromDay: req.fromDay };
  const spanDays = (Math.min(req.toDay, today + DAY_SECONDS) - req.fromDay) / DAY_SECONDS;
  const grain: PlotGrain =
    spanDays <= DAILY_UP_TO_DAYS ? "day" : spanDays <= WEEKLY_UP_TO_DAYS ? "week" : "month";
  if (grain === "month") return { grain, fromDay: req.fromDay };
  // The earliest day every daily source in the chart still serves.
  const edges = entries.flatMap(({ id }) => {
    const reach = SERIES_SOURCES[id].dailyReachDays;
    return reach === null ? [] : [today - (reach - 1) * DAY_SECONDS];
  });
  if (edges.length === 0) return { grain, fromDay: req.fromDay };
  const edge = Math.max(...edges);
  if (periodStart(grain, req.fromDay) >= edge) return { grain, fromDay: req.fromDay };
  // A year asked of a source that keeps a year: the first whole period inside it, so "the last
  // year" reads weekly rather than dropping to thirteen months. The caption names the real start.
  if (req.fromDay >= edge - 7 * DAY_SECONDS) {
    const start = periodStart(grain, edge);
    return { grain, fromDay: start < edge ? nextPeriod(grain, start) : start };
  }
  // Further back than the daily sources go: read the monthly ones, never a cut-short window.
  const short = entries.filter(({ id }) => SERIES_SOURCES[id].dailyReachDays !== null);
  if (short.every(({ id }) => SERIES_SOURCES[id].monthly !== undefined)) {
    return { grain: "month", fromDay: req.fromDay };
  }
  return `${short.map((s) => s.meta.label).join(", ")} per day only reaches back a year; ask for a shorter window`;
}

/** Whether a series has two neighbouring values above zero: the least a log axis can draw. */
const drawsOnLog = (values: readonly (number | null)[]) =>
  values.some((v, i) => v !== null && v > 0 && (values[i + 1] ?? 0) > 0);

/** Each source's rows, fetched once per call however many series share it; null if unreadable. */
async function readSources(
  names: readonly ChartSourceName[],
  read: ChartReader,
  window: PlotWindow,
): Promise<Map<ChartSourceName, SourceRows | null>> {
  const out = new Map<ChartSourceName, SourceRows | null>();
  for (const name of names) {
    if (name === "prices") {
      out.set(name, await readPrices(read, window));
      continue;
    }
    const spec = CHART_SOURCES[name];
    const res = await read(spec.surface, spec.path);
    out.set(name, res.status >= 200 && res.status < 300 ? spec.read(parse(res.body)) : null);
  }
  return out;
}

/** The closes in the window, paging back by `to` as `daily-price-map.ts` does. */
async function readPrices(read: ChartReader, window: PlotWindow): Promise<SourceRows | null> {
  const from = utcDayFromSeconds(window.starts[0]!);
  let to = utcDayFromSeconds(Math.min(window.end, window.dataEnd) - DAY_SECONDS);
  const points: PlotPoint[] = [];
  for (let page = 0; page < MAX_PRICE_PAGES; page++) {
    const res = await read("v1", `${CHART_SOURCES.prices.path}?from=${from}&to=${to}`);
    if (res.status < 200 || res.status >= 300) return null;
    const parsed = readPricePage(parse(res.body));
    if (parsed === null) return null;
    points.unshift(...parsed.points);
    const oldest = parsed.points[0];
    if (!parsed.truncated || oldest === undefined) return { close: points };
    to = utcDayFromSeconds(oldest.t - DAY_SECONDS);
  }
  // Still truncated after every page: a window we cannot read whole is not drawn in part.
  return null;
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** The chart for a valid request, or the message the model should see instead. */
export async function buildChart(
  req: ChartRequest,
  read: ChartReader,
  nowMs: number,
): Promise<ChartOutcome | string> {
  const today = Math.floor(nowMs / 1000 / DAY_SECONDS) * DAY_SECONDS;
  const plan = chartPlan(req, today);
  if (typeof plan === "string") return plan;
  const { grain } = plan;
  const window = plotWindow(grain, plan.fromDay, req.toDay, today);
  if (window.starts.length < 2) {
    return "that window holds fewer than two periods to plot — a single figure is an answer in words, not a chart";
  }
  if (window.starts.length > MAX_PLOT_POINTS) return "that window is too long to plot";

  const reads = req.series.map((id) => {
    const src = SERIES_SOURCES[id];
    const monthly = grain === "month" && src.monthly !== undefined;
    return { id, from: monthly ? src.monthly! : src.daily, monthly };
  });
  const rows = await readSources([...new Set(reads.map((p) => p.from.source))], read, window);

  const series: PlottedSeries[] = [];
  for (const { id, from, monthly } of reads) {
    const meta = plottableSeries(id);
    const points = rows.get(from.source)?.[from.field];
    if (points === undefined) {
      return `unavailable: ${meta.label} could not be read just now, so no chart was drawn — say so, and give no figure in its place`;
    }
    const resampled = monthly
      ? alignMonths(points, window)
      : resampleDays(points, meta.kind, window);
    const { values, floors } = meta.omitLeadingZeros
      ? absentBefore(resampled, window, firstNonZero(points))
      : resampled;
    if (values.filter((v) => v !== null).length < 2) {
      return `${meta.label} has fewer than two measured points in that window — answer in words, or chart a longer window`;
    }
    if (req.scale === "log" && !drawsOnLog(values)) {
      return `${meta.label} never stays above zero for two periods running there, so a log axis would draw nothing of it — use the linear scale`;
    }
    series.push({ id, values, floors });
  }

  const chart: PlottedChart = {
    v: 1,
    type: req.type,
    scale: req.scale,
    grain,
    timestamps: window.starts,
    series,
    partialLast: lastPeriodIsPartial(window),
    reachesPresent: req.toDay >= today,
    range: req.range,
  };
  return { chart, content: modelContent(chart, nowMs) };
}

/** A period as a reader names it. */
function periodName(grain: PlotGrain, t: number): string {
  const day = utcDayFromSeconds(t);
  return grain === "month" ? day.slice(0, 7) : grain === "week" ? `week of ${day}` : day;
}

/**
 * What the model reads. The caption and caveats are the console's own; the summary gives it the few
 * figures a sentence about a shape needs (first, last, extremes, the change), already formatted, so
 * describing the chart takes no arithmetic and no number the chart does not hold.
 */
export function modelContent(chart: PlottedChart, nowMs: number): string {
  const summaries = chart.series.map((s) => {
    const meta = plottableSeries(s.id);
    const measured = s.values
      .map((v, i) => ({ v, at: periodName(chart.grain, chart.timestamps[i]!) }))
      .filter((p): p is { v: number; at: string } => p.v !== null);
    const first = measured[0]!;
    const last = measured[measured.length - 1]!;
    const high = measured.reduce((a, b) => (b.v > a.v ? b : a));
    const low = measured.reduce((a, b) => (b.v < a.v ? b : a));
    const text = (p: { v: number; at: string }) => ({
      period: p.at,
      value: formatPlotExact(meta.unit, p.v),
    });
    return {
      series: meta.label,
      measuredPeriods: measured.length,
      periods: s.values.length,
      first: text(first),
      last: text(last),
      highest: text(high),
      lowest: text(low),
      // A closing value's change across the window is ours to state; a flow's has no meaning.
      ...(meta.kind === "stock"
        ? {
            changeFirstToLast: `${last.v - first.v >= 0 ? "+" : "−"}${formatPlotExact(meta.unit, Math.abs(last.v - first.v))}${
              first.v === 0
                ? ""
                : ` (${last.v >= first.v ? "+" : "−"}${(Math.abs((last.v - first.v) / first.v) * 100).toFixed(1)}%)`
            }`,
          }
        : {}),
      ...(s.floors.length > 0 ? { periodsThatAreFloors: s.floors.length } : {}),
    };
  });
  const maxima = chart.series.map((s) =>
    Math.max(...s.values.filter((v): v is number => v !== null)),
  );
  const spread = Math.max(...maxima) / Math.max(Math.min(...maxima), Number.MIN_VALUE);
  const hint =
    chart.scale === "linear" && chart.series.length > 1 && spread > LOG_HINT_RATIO
      ? " These series differ by more than 100×, so on this linear axis the smaller lies near zero: say so, or chart again with scale log."
      : "";
  const note = [
    `The reader sees this chart beneath your answer: ${chartCaption(chart)}.`,
    ...chartCaveats(chart),
    "Every number on it was read by this explorer. Say in one or two sentences what it shows, quoting figures only from the summary below; never reproduce its points as a table, a list or a drawing, and never call it an image. It is not carried into later turns: to show it again, chart it again." +
      hint,
  ].join(" ");
  const retrievedAt = new Date(nowMs).toISOString();
  return `<note source="chart">\n${note}\n</note>\n<data source="chart" retrieved-at="${retrievedAt}">\n${DATA_NOTICE}\n${JSON.stringify(summaries, null, 1).replace(/</g, "\\u003c")}\n</data>`;
}

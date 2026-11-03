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
  type PlottableSeries,
  type PlottedChart,
  type PlottedSeries,
  type PlotSeriesSpec,
} from "@/domain";
import { formatCount } from "@/lib/format";
import { formatPlotExact } from "@/lib/plot-format";
import type { ChartRequest } from "./chart-args";
import type { ChartSourceCache } from "./chart-cache";
import { readPriceHistory } from "./chart-prices";
import type { ChartRefusal } from "./chart-refusal";
import {
  CHART_SOURCES,
  seriesSource,
  type ChartSourceName,
  type SeriesSource,
  type SourceRows,
} from "./chart-sources";
import { DATA_NOTICE } from "./notes";

/**
 * `make_chart`'s work once its arguments are valid: choose the grain, read each source once (through
 * the shared cache), cut the rows into periods, and hand back the chart with a summary for the model.
 * Every number in the chart is a value read from a source body; nothing from the request reaches a
 * value.
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
 * Same-measure series this far apart in size leave the smaller a flat line on a linear axis: at
 * 1/50 of a desktop plot (~270px) it moves within ~5px. The model chose the scale, so the call is
 * refused with the way out, rather than the scale being switched under it.
 */
export const MAX_LINEAR_SPREAD = 50;

/** Sources keyed by a name inside their rows (`keyed` in `chart-sources.ts`). */
const KEYED_SOURCES: ReadonlySet<ChartSourceName> = new Set(["ccInflow", "ccOutflow", "ccVenues"]);

/** The shortest window a monthly-only series is drawn over: about two whole months. */
const MIN_MONTHLY_SPAN_DAYS = 59;

/** "Orchard balance's", "Orchard transactions'". */
const possessive = (label: string) => (label.endsWith("s") ? `${label}'` : `${label}'s`);

/** "X is" or "X, Y are", for a sentence naming series. */
const named = (labels: readonly string[]) =>
  `${labels.join(", ")} ${labels.length === 1 ? "is" : "are"}`;

interface Entry {
  spec: PlotSeriesSpec;
  meta: PlottableSeries;
  src: SeriesSource;
}

const pagesOf = (entries: readonly { meta: PlottableSeries }[]) =>
  entries.flatMap((e) => (e.meta.chartSlug === null ? [] : [e.meta.chartSlug]));

/**
 * Why these series cannot share a linear axis, or null when they can: one's peak is more than
 * `MAX_LINEAR_SPREAD` times another's. A log axis is offered only when every series can draw on
 * one, and only for a line, since an area needs a zero to fill to.
 */
export function linearSpreadRefusal(
  req: Pick<ChartRequest, "scale" | "type">,
  series: readonly { spec: PlotSeriesSpec; label: string; values: readonly (number | null)[] }[],
): ChartRefusal | null {
  if (req.scale !== "linear" || series.length < 2) return null;
  const peaks = series.map((s) => ({
    label: s.label,
    peak: Math.max(0, ...s.values.filter((v): v is number => v !== null)),
  }));
  const big = peaks.reduce((a, b) => (b.peak > a.peak ? b : a));
  const small = peaks.reduce((a, b) => (b.peak < a.peak ? b : a));
  if (small.peak * MAX_LINEAR_SPREAD >= big.peak) return null;
  const logWorks = req.type === "line" && series.every((s) => drawsOnLog(s.values));
  const why =
    small.peak === 0
      ? `${small.label} is zero throughout that window`
      : `${possessive(small.label)} highest value is under 1/${MAX_LINEAR_SPREAD} of ${possessive(big.label)}`;
  const specs = series.map((s) => s.spec);
  return {
    reason: "spread",
    message: `${why}, so on one linear axis it draws as a flat line — ${
      logWorks ? "chart again with scale log, or chart them separately" : "chart them separately"
    }`,
    closest: logWorks
      ? [{ series: specs, scale: "log" }]
      : specs.map((spec) => ({ series: [spec] })),
  };
}

/** How a window is drawn: its grain, and the day it starts from. */
export interface ChartPlan {
  grain: PlotGrain;
  fromDay: number;
}

const entriesOf = (req: ChartRequest): Entry[] =>
  req.series.map((spec) => ({ spec, meta: plottableSeries(spec), src: seriesSource(spec) }));

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
  if (grain !== "day" && short.length === 0) return null;
  const which = (short.length > 0 ? short : entries).map((e) => e.meta.label);
  return {
    reason: "reach",
    message: `${which.join(", ")} per day only reaches back a year, with no monthly series behind it — ask for at most the last year`,
    closest: [{ series: req.series, range: "1y" }],
    pages: pagesOf(short.length > 0 ? short : entries),
  };
}

/** Whether a series has two neighbouring values above zero: the least a log axis can draw. */
const drawsOnLog = (values: readonly (number | null)[]) =>
  values.some((v, i) => v !== null && v > 0 && (values[i + 1] ?? 0) > 0);

function parse(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** Each source's rows through the shared cache, fetched once however many series share it. */
async function readSources(
  names: readonly ChartSourceName[],
  read: ChartReader,
  cache: ChartSourceCache,
  today: number,
): Promise<Map<ChartSourceName, SourceRows | null>> {
  const out = new Map<ChartSourceName, SourceRows | null>();
  for (const name of names) {
    const rows = await cache.get(name, async () => {
      if (name === "prices") return readPriceHistory((path) => read("v1", path), today);
      const spec = CHART_SOURCES[name];
      const res = await read("chain", spec.path);
      return res.status >= 200 && res.status < 300 ? spec.read(parse(res.body)) : null;
    });
    out.set(name, rows);
  }
  return out;
}

/** The refusal for a window too short to be a chart, with the nearest one that is. */
function shortWindow(entries: Entry[], grain: PlotGrain, req: ChartRequest): ChartRefusal {
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

/** The chart for a valid request, or the refusal the model should pass on instead. */
export async function buildChart(
  req: ChartRequest,
  read: ChartReader,
  nowMs: number,
  cache: ChartSourceCache,
): Promise<ChartOutcome | ChartRefusal> {
  const today = Math.floor(nowMs / 1000 / DAY_SECONDS) * DAY_SECONDS;
  const plan = chartPlan(req, today);
  if ("reason" in plan) return plan;
  const { grain } = plan;
  const entries = entriesOf(req);
  const window = plotWindow(grain, plan.fromDay, req.toDay, today);
  // A series kept per month answers a window of whole months only: a week that straddles two
  // months would come back as those two whole months, which is not what was asked.
  const spanDays = (Math.min(req.toDay, today + DAY_SECONDS) - req.fromDay) / DAY_SECONDS;
  const monthsOnly = entries.some((e) => e.src.daily === undefined);
  if (window.starts.length < 2 || (monthsOnly && spanDays < MIN_MONTHLY_SPAN_DAYS)) {
    return shortWindow(entries, grain, req);
  }
  if (window.starts.length > MAX_PLOT_POINTS) {
    return { reason: "window", message: "that window is too long to plot" };
  }

  const reads = entries.map((e) => {
    const monthly = grain === "month" && e.src.monthly !== undefined;
    return { ...e, from: monthly ? e.src.monthly! : e.src.daily!, monthly };
  });
  const rows = await readSources([...new Set(reads.map((p) => p.from.source))], read, cache, today);

  const series: PlottedSeries[] = [];
  for (const { spec, meta, from, monthly } of reads) {
    const read = rows.get(from.source);
    // A source keyed by chain or venue lists only keys that ever moved: one it lacks never did.
    const points =
      read != null && KEYED_SOURCES.has(from.source)
        ? (read[from.field] ?? [])
        : read?.[from.field];
    if (points === undefined) {
      return {
        reason: "unavailable",
        message: `${meta.label} could not be read just now, so no chart was drawn — say so, and give no figure in its place`,
        pages: pagesOf([{ meta }]),
      };
    }
    const resampled = monthly
      ? alignMonths(points, window)
      : resampleDays(points, meta.kind, window);
    const { values, floors, of } = meta.omitLeadingZeros
      ? absentBefore(resampled, window, firstNonZero(points))
      : resampled;
    const measured = values.filter((v): v is number => v !== null);
    if (measured.length < 2 || measured.every((v) => v === 0)) {
      // Read, and never above zero in all of history: a true zero, not a gap in our reading.
      const neverAny =
        meta.omitLeadingZeros === true &&
        points.some((p) => p.v === 0) &&
        firstNonZero(points) === null;
      return {
        reason: "no-data",
        message: neverAny
          ? `${meta.label} has been zero throughout its history — say so in words`
          : measured.length < 2
            ? KEYED_SOURCES.has(from.source)
              ? `no swaps are recorded for ${meta.label} in that window — say so in words`
              : `${meta.label} has fewer than two measured points in that window — answer in words, or chart a longer window`
            : `${meta.label} is zero throughout that window — say so in words; a flat line at zero is not a chart`,
        closest: req.range === "all" || neverAny ? [] : [{ series: [spec], range: "all" }],
        pages: pagesOf([{ meta }]),
      };
    }
    if (req.scale === "log" && !drawsOnLog(values)) {
      return {
        reason: "log-zero",
        message: `${meta.label} never stays above zero for two periods running there, so a log axis would draw nothing of it — use the linear scale`,
        closest: [{ series: req.series, scale: "linear" }],
      };
    }
    series.push({ spec, values, floors, ...(of === undefined ? {} : { of }) });
  }
  const spread = linearSpreadRefusal(
    req,
    series.map((s) => ({ spec: s.spec, label: plottableSeries(s.spec).label, values: s.values })),
  );
  if (spread !== null) return spread;

  // Leading periods where no series has a value are not drawn: "all" of a series that began in 2025
  // starts in 2025, and the caption names that start.
  const lead = Math.min(...series.map((s) => s.values.findIndex((v) => v !== null)));
  const trimmed = lead > 0 ? series.map((s) => trimLeading(s, lead)) : series;

  const chart: PlottedChart = {
    v: 2,
    type: req.type,
    scale: req.scale,
    grain,
    timestamps: window.starts.slice(lead),
    series: trimmed,
    partialLast: lastPeriodIsPartial(window),
    reachesPresent: req.toDay >= today,
    range: req.range,
  };
  return { chart, content: modelContent(chart, nowMs) };
}

/** A series without its first `n` periods, its floor indices shifted to match. */
function trimLeading(s: PlottedSeries, n: number): PlottedSeries {
  return {
    spec: s.spec,
    values: s.values.slice(n),
    floors: s.floors.filter((i) => i >= n).map((i) => i - n),
    ...(s.of === undefined ? {} : { of: s.of.slice(n) }),
  };
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
    const meta = plottableSeries(s.spec);
    const measured = s.values
      .map((v, i) => ({ v, i, at: periodName(chart.grain, chart.timestamps[i]!) }))
      .filter((p): p is { v: number; i: number; at: string } => p.v !== null);
    const first = measured[0]!;
    const last = measured[measured.length - 1]!;
    const high = measured.reduce((a, b) => (b.v > a.v ? b : a));
    const low = measured.reduce((a, b) => (b.v < a.v ? b : a));
    // A share names its denominator, the month's blocks, beside every figure quoted.
    const text = (p: { v: number; i: number; at: string }) => ({
      period: p.at,
      value: formatPlotExact(meta.unit, p.v),
      ...(s.of?.[p.i] != null ? { ofBlocks: formatCount(s.of[p.i]!) } : {}),
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
  const crosschain = chart.series.some((s) => s.spec.family === "crosschain");
  const note = [
    `The reader sees this chart beneath your answer: ${chartCaption(chart)}.`,
    ...chartCaveats(chart),
    ...(crosschain
      ? [
          "Cross-chain series count the completed swaps this explorer indexed through public venues: a floor on real movement, never a total.",
        ]
      : []),
    "Every number on it was read by this explorer. Say in one or two sentences what it shows, quoting figures only from the summary below; never reproduce its points as a table, a list or a drawing, and never call it an image. It is not carried into later turns: to show it again, chart it again.",
  ].join(" ");
  const retrievedAt = new Date(nowMs).toISOString();
  return `<note source="chart">\n${note}\n</note>\n<data source="chart" retrieved-at="${retrievedAt}">\n${DATA_NOTICE}\n${JSON.stringify(summaries, null, 1).replace(/</g, "\\u003c")}\n</data>`;
}

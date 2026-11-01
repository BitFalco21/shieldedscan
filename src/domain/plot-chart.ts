import { CHART_RANGES, type ChartRange } from "./chart-range";
import { isOneOf } from "./closed-set";
import {
  MAX_PLOT_POINTS,
  MAX_PLOT_SERIES,
  PLOT_GRAINS,
  PLOT_SERIES_IDS,
  plottableSeries,
  sharedChartProblem,
  type PlotGrain,
  type PlotSeriesId,
  type PlottableSeries,
} from "./plottable";
import { utcDayFromSeconds } from "./time";

/**
 * A chart as it travels from the API to the console: catalogue ids, periods and numbers the
 * server read, and nothing else. No label, title or caption crosses the wire — both ends derive
 * those from the ids — so there is no free text in which a model could place a figure.
 */
export interface PlottedSeries {
  id: PlotSeriesId;
  /** One per period; null is unmeasured and draws a gap. */
  values: (number | null)[];
  /** Indices of periods whose value is a floor (some blocks' fees could not be read). */
  floors: number[];
}

export const PLOT_TYPES = ["line", "area"] as const;
export type PlotType = (typeof PLOT_TYPES)[number];
export const PLOT_SCALES = ["linear", "log"] as const;
export type PlotScale = (typeof PLOT_SCALES)[number];

export interface PlottedChart {
  v: 1;
  type: PlotType;
  scale: PlotScale;
  grain: PlotGrain;
  /** Period starts, unix seconds, oldest first. */
  timestamps: number[];
  series: PlottedSeries[];
  /** The last period was still running when read. */
  partialLast: boolean;
  /** The window runs to the latest data rather than to a past day. */
  reachesPresent: boolean;
  /** The trailing preset it was asked as, so the page link opens on the same range. */
  range: ChartRange | null;
}

const GRAIN_WORDS: Record<PlotGrain, string> = { day: "daily", week: "weekly", month: "monthly" };

/** The catalogue entries a chart plots, in its order. */
export function chartSeries(chart: PlottedChart): PlottableSeries[] {
  return chart.series.map((s) => plottableSeries(s.id));
}

/**
 * Exactly what is plotted, in one line: "Ironwood balance, Orchard balance · since 2026-07-06 ·
 * weekly · line". Built from the ids and periods alone, so the console and the note the model
 * reads say the same thing.
 */
export function chartCaption(chart: PlottedChart): string {
  const first = chart.timestamps[0];
  const last = chart.timestamps[chart.timestamps.length - 1];
  const labels = chartSeries(chart).map((s) => s.label);
  const span =
    first === undefined || last === undefined
      ? ""
      : chart.reachesPresent
        ? `since ${utcDayFromSeconds(first)}`
        : `${utcDayFromSeconds(first)} to ${utcDayFromSeconds(last)}`;
  return [
    labels.join(", "),
    span,
    GRAIN_WORDS[chart.grain],
    chart.scale === "log" ? `${chart.type}, log scale` : chart.type,
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** The caveats a caption carries beside it: a running period, and periods that are floors. */
export function chartCaveats(chart: PlottedChart): string[] {
  const out: string[] = [];
  if (chart.partialLast) {
    const period = chart.grain === "month" ? "month" : chart.grain === "week" ? "week" : "day";
    out.push(`The last ${period} is still running.`);
  }
  const floors = new Set(chart.series.flatMap((s) => s.floors)).size;
  if (floors > 0) {
    out.push(
      `${floors} ${floors === 1 ? "period is a floor" : "periods are floors"}: some blocks' fees could not be read.`,
    );
  }
  return out;
}

const isCell = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isFinite(v));

/**
 * A chart off the wire, or null for anything that is not exactly one. Strict on purpose, as the
 * console's other events are: an id outside the catalogue, a ragged series or a non-finite value is
 * a payload we do not understand, and drawing it would put something on the page nobody read.
 */
export function parsePlottedChart(raw: unknown): PlottedChart | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (c.v !== 1) return null;
  if (typeof c.type !== "string" || !isOneOf(PLOT_TYPES, c.type)) return null;
  if (typeof c.scale !== "string" || !isOneOf(PLOT_SCALES, c.scale)) return null;
  if (typeof c.grain !== "string" || !isOneOf(PLOT_GRAINS, c.grain)) return null;
  if (typeof c.partialLast !== "boolean" || typeof c.reachesPresent !== "boolean") return null;
  const ranges = CHART_RANGES.map((r) => r.value);
  if (c.range !== null && (typeof c.range !== "string" || !isOneOf(ranges, c.range))) return null;
  const ts = c.timestamps;
  if (!Array.isArray(ts) || ts.length < 2 || ts.length > MAX_PLOT_POINTS) return null;
  if (!ts.every((t) => typeof t === "number" && Number.isInteger(t))) return null;
  if (!ts.every((t, i) => i === 0 || t > (ts[i - 1] as number))) return null;
  const series = c.series;
  if (!Array.isArray(series) || series.length === 0 || series.length > MAX_PLOT_SERIES) {
    return null;
  }
  const parsed: PlottedSeries[] = [];
  for (const s of series as unknown[]) {
    if (typeof s !== "object" || s === null) return null;
    const { id, values, floors } = s as Record<string, unknown>;
    if (typeof id !== "string" || !isOneOf(PLOT_SERIES_IDS, id)) return null;
    if (parsed.some((p) => p.id === id)) return null;
    if (!Array.isArray(values) || values.length !== ts.length || !values.every(isCell)) return null;
    if (
      !Array.isArray(floors) ||
      !floors.every((f) => typeof f === "number" && Number.isInteger(f) && f >= 0 && f < ts.length)
    ) {
      return null;
    }
    parsed.push({ id, values: values as (number | null)[], floors: floors as number[] });
  }
  // One axis and one split per chart (`sharedChartProblem`), checked here too: the console must
  // not draw two measures on one scale whatever arrived.
  if (sharedChartProblem(parsed.map((p) => plottableSeries(p.id))) !== null) return null;
  return {
    v: 1,
    type: c.type,
    scale: c.scale,
    grain: c.grain,
    timestamps: ts as number[],
    series: parsed,
    partialLast: c.partialLast,
    reachesPresent: c.reachesPresent,
    range: (c.range ?? null) as ChartRange | null,
  };
}

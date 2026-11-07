import {
  isOneOf,
  MAX_PLOT_SERIES,
  parseSeriesSpec,
  PLOT_FAMILIES,
  PLOT_SCALES,
  PLOT_TYPES,
  plottableSeries,
  seriesKey,
  sharedChartProblem,
  type ChartRange,
  type PlotScale,
  type PlotSeriesSpec,
  type PlotType,
} from "@/domain";
import { closestForUnknown, type ChartRefusal } from "./chart-refusal";
import { parseDayWindow } from "./day-window";

/**
 * `make_chart`'s arguments, validated. The model chooses only WHAT to plot: series specs from closed
 * lists, a window and two drawing options. Nothing it sends is a figure, and anything that is not
 * one of these keys is refused by name rather than ignored, so a call carrying `values` or `title`
 * fails loudly instead of looking like it worked.
 */

export const CHART_ARG_KEYS = ["series", "range", "from", "to", "type", "scale"] as const;

/**
 * A validated request. It holds specs, enums and UTC day starts; `chart-args.test.ts` asserts at
 * compile time that no field is a free number, because the window's day starts are the only numbers
 * here and they come from parsed day strings or the clock, never from the model.
 */
export interface ChartRequest {
  series: PlotSeriesSpec[];
  type: PlotType;
  scale: PlotScale;
  /** Unix seconds at a UTC day start, inclusive. */
  fromDay: number;
  /** Unix seconds at a UTC day start, exclusive. */
  toDay: number;
  /** The trailing preset asked for, or null for an absolute window. */
  range: ChartRange | null;
}

const refuse = (
  reason: ChartRefusal["reason"],
  message: string,
  extra: Omit<ChartRefusal, "reason" | "message"> = {},
): ChartRefusal => ({ reason, message, ...extra });

export const isRefusal = (v: unknown): v is ChartRefusal =>
  typeof v === "object" && v !== null && "reason" in v && "message" in v;

/** The request, or the refusal the model should see to correct its call or answer in words. */
export function parseChartArgs(
  args: Record<string, unknown>,
  nowMs: number,
): ChartRequest | ChartRefusal {
  const unknown = Object.keys(args).filter((k) => !isOneOf(CHART_ARG_KEYS, k));
  if (unknown.length > 0) {
    const nearest = closestForUnknown(args);
    if (nearest?.reason === "per-address") return nearest;
    return refuse(
      "bad-parameter",
      `unknown argument ${unknown.join(", ")} — make_chart takes no figures, titles or data: name the series and this explorer reads every number itself. Arguments are ${CHART_ARG_KEYS.join(", ")}`,
    );
  }

  const series = parseSeries(args.series);
  if (isRefusal(series)) return series;

  const type = args.type ?? "line";
  if (typeof type !== "string" || !isOneOf(PLOT_TYPES, type)) {
    return refuse("bad-parameter", `type must be one of ${PLOT_TYPES.join(", ")}`);
  }
  const scale = args.scale ?? "linear";
  if (typeof scale !== "string" || !isOneOf(PLOT_SCALES, scale)) {
    return refuse("bad-parameter", `scale must be one of ${PLOT_SCALES.join(", ")}`);
  }
  if (type === "area" && scale === "log") {
    return refuse(
      "bad-parameter",
      "an area needs a zero to fill down to, and a log axis has none — use a line on a log scale",
      { closest: [{ ...args, type: "line" }] },
    );
  }

  const window = parseDayWindow(args, nowMs, (patch) => ({ series, ...patch }));
  if (isRefusal(window)) return window;

  return { series, type, scale, ...window };
}

function parseSeries(raw: unknown): PlotSeriesSpec[] | ChartRefusal {
  if (!Array.isArray(raw) || raw.length === 0) {
    return refuse(
      "bad-parameter",
      `series must be a list of 1 to ${MAX_PLOT_SERIES} series, each {family, …parameters}; families are ${PLOT_FAMILIES.join(", ")}`,
    );
  }
  // A list far past the cap is refused before any of it is parsed.
  if (raw.length > 4 * MAX_PLOT_SERIES) {
    return refuse("too-many-series", `at most ${MAX_PLOT_SERIES} series on one chart`);
  }
  const specs: PlotSeriesSpec[] = [];
  for (const item of raw) {
    const parsed = parseSeriesSpec(item);
    if (!parsed.ok) {
      const record =
        typeof item === "object" && item !== null ? (item as Record<string, unknown>) : { item };
      const nearest =
        parsed.reason === "not-chartable" || parsed.reason === "bad-parameter"
          ? closestForUnknown(record)
          : null;
      if (nearest !== null) return { ...nearest, message: `${parsed.message}; ${nearest.message}` };
      return refuse(parsed.reason, parsed.message);
    }
    // The same series twice is drawn once; a duplicate spelled two ways is still one series.
    if (!specs.some((s) => seriesKey(s) === seriesKey(parsed.spec))) specs.push(parsed.spec);
  }
  if (specs.length > MAX_PLOT_SERIES) {
    return refuse(
      "too-many-series",
      `at most ${MAX_PLOT_SERIES} series on one chart: past three, lines stop being tellable apart`,
      { closest: [{ series: specs.slice(0, MAX_PLOT_SERIES) }] },
    );
  }
  const metas = specs.map(plottableSeries);
  const problem = sharedChartProblem(metas);
  if (problem !== null) {
    return refuse(
      new Set(metas.map((m) => m.axis)).size > 1 ? "mixed-measures" : "split",
      problem,
      {
        closest: specs.map((s) => ({ series: [s] })),
        pages: metas.flatMap((m) => (m.chartSlug === null ? [] : [m.chartSlug])),
      },
    );
  }
  return specs;
}

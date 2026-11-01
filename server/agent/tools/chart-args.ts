import {
  CHART_RANGES,
  chartRangeDays,
  DAY_SECONDS,
  isOneOf,
  MAX_PLOT_SERIES,
  parseUtcDayStart,
  PLOT_EPOCH_DAY,
  PLOT_SCALES,
  PLOT_SERIES_IDS,
  PLOT_TYPES,
  plottableSeries,
  sharedChartProblem,
  type ChartRange,
  type PlotScale,
  type PlotSeriesId,
  type PlotType,
} from "@/domain";

/**
 * `make_chart`'s arguments, validated. The model chooses only WHAT to plot: catalogue ids, a window
 * and two drawing options. Nothing it sends is a figure, and anything that is not one of these keys
 * is refused by name rather than ignored, so a call carrying `values` or `title` fails loudly instead
 * of looking like it worked.
 */

export const CHART_ARG_KEYS = ["series", "range", "from", "to", "type", "scale"] as const;

/**
 * A validated request. It holds ids, enums and UTC day starts; `chart-args.test.ts` asserts at
 * compile time that no field is a free number, because the window's day starts are the only numbers
 * here and they come from parsed day strings or the clock, never from the model.
 */
export interface ChartRequest {
  series: PlotSeriesId[];
  type: PlotType;
  scale: PlotScale;
  /** Unix seconds at a UTC day start, inclusive. */
  fromDay: number;
  /** Unix seconds at a UTC day start, exclusive. */
  toDay: number;
  /** The trailing preset asked for, or null for an absolute window. */
  range: ChartRange | null;
}

const RANGE_VALUES = CHART_RANGES.map((r) => r.value);

/** The request, or the message the model should see to correct its call. */
export function parseChartArgs(
  args: Record<string, unknown>,
  nowMs: number,
): ChartRequest | string {
  const unknown = Object.keys(args).filter((k) => !isOneOf(CHART_ARG_KEYS, k));
  if (unknown.length > 0) {
    return `unknown argument ${unknown.join(", ")} — make_chart takes no figures, titles or data: name the series and this explorer reads every number itself. Arguments are ${CHART_ARG_KEYS.join(", ")}`;
  }

  const raw = args.series;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PLOT_SERIES) {
    return `series must be a list of 1 to ${MAX_PLOT_SERIES} series ids`;
  }
  const series: PlotSeriesId[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isOneOf(PLOT_SERIES_IDS, item)) {
      return `unknown series ${JSON.stringify(item)} — series must be among ${PLOT_SERIES_IDS.join(", ")}`;
    }
    if (series.includes(item)) return `series ${item} is listed twice`;
    series.push(item);
  }
  const problem = sharedChartProblem(series.map(plottableSeries));
  if (problem !== null) return problem;

  const type = args.type ?? "line";
  if (typeof type !== "string" || !isOneOf(PLOT_TYPES, type)) {
    return `type must be one of ${PLOT_TYPES.join(", ")}`;
  }
  const scale = args.scale ?? "linear";
  if (typeof scale !== "string" || !isOneOf(PLOT_SCALES, scale)) {
    return `scale must be one of ${PLOT_SCALES.join(", ")}`;
  }
  if (type === "area" && scale === "log") {
    return "an area needs a zero to fill down to, and a log axis has none — use a line on a log scale";
  }

  const today = Math.floor(nowMs / 1000 / DAY_SECONDS) * DAY_SECONDS;
  const epoch = parseUtcDayStart(PLOT_EPOCH_DAY)!;
  const window = parseWindow(args, today, epoch);
  if (typeof window === "string") return window;

  return { series, type, scale, ...window };
}

function parseWindow(
  args: Record<string, unknown>,
  today: number,
  epoch: number,
): Pick<ChartRequest, "fromDay" | "toDay" | "range"> | string {
  const tomorrow = today + DAY_SECONDS;
  if (args.range !== undefined) {
    if (args.from !== undefined || args.to !== undefined) {
      return "use range for a trailing window OR from/to for an absolute one, never both";
    }
    if (typeof args.range !== "string" || !isOneOf(RANGE_VALUES, args.range)) {
      return `range must be one of ${RANGE_VALUES.join(", ")}`;
    }
    const days = chartRangeDays(args.range);
    return {
      fromDay: days === null ? epoch : today - days * DAY_SECONDS,
      toDay: tomorrow,
      range: args.range,
    };
  }
  if (args.from === undefined) {
    if (args.to !== undefined) return "to needs a from — or use range for a trailing window";
    // The site's own default range: the whole series.
    return { fromDay: epoch, toDay: tomorrow, range: "all" };
  }
  const day = (key: "from" | "to"): number | string => {
    const value = args[key];
    const parsed = typeof value === "string" ? parseUtcDayStart(value.trim()) : null;
    return parsed ?? `${key} must be a real UTC day as YYYY-MM-DD`;
  };
  const fromDay = day("from");
  if (typeof fromDay === "string") return fromDay;
  const toDay = args.to === undefined ? tomorrow : day("to");
  if (typeof toDay === "string") return toDay;
  if (toDay <= fromDay) {
    return "to must be after from — and it is EXCLUSIVE, so a whole month ends on the 1st of the next";
  }
  if (fromDay < epoch) return `from must be on or after ${PLOT_EPOCH_DAY}, Zcash's launch`;
  if (toDay > tomorrow) return "to must not be in the future: nothing has been measured there yet";
  return { fromDay, toDay, range: null };
}

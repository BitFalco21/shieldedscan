import {
  CHART_RANGES,
  chartRangeDays,
  DAY_SECONDS,
  isOneOf,
  parseUtcDayStart,
  PLOT_EPOCH_DAY,
  type ChartRange,
} from "@/domain";

/**
 * The window a chart or an export is asked over: a trailing preset (`range`) or an absolute
 * `from`/`to` of UTC days, `to` exclusive, inside launch → tomorrow. Shared so the two tools refuse
 * the same windows in the same words. `closest` turns a fix into the caller's own arguments.
 */

export interface DayWindow {
  /** Unix seconds at a UTC day start, inclusive. */
  fromDay: number;
  /** Unix seconds at a UTC day start, exclusive. */
  toDay: number;
  /** The trailing preset asked for, or null for an absolute window. */
  range: ChartRange | null;
}

export interface WindowRefusal {
  reason: "bad-parameter" | "window";
  message: string;
  closest?: Record<string, unknown>[];
}

const RANGE_VALUES = CHART_RANGES.map((r) => r.value);

const refuse = (
  reason: WindowRefusal["reason"],
  message: string,
  closest?: Record<string, unknown>[],
): WindowRefusal => (closest === undefined ? { reason, message } : { reason, message, closest });

const isWindowRefusal = (v: unknown): v is WindowRefusal =>
  typeof v === "object" && v !== null && "reason" in v;

export function parseDayWindow(
  args: Record<string, unknown>,
  nowMs: number,
  closest: (patch: Record<string, unknown>) => Record<string, unknown>,
): DayWindow | WindowRefusal {
  const today = Math.floor(nowMs / 1000 / DAY_SECONDS) * DAY_SECONDS;
  const epoch = parseUtcDayStart(PLOT_EPOCH_DAY)!;
  const tomorrow = today + DAY_SECONDS;
  if (args.range !== undefined) {
    if (args.from !== undefined || args.to !== undefined) {
      return refuse(
        "bad-parameter",
        "use range for a trailing window OR from/to for an absolute one, never both",
      );
    }
    if (typeof args.range !== "string" || !isOneOf(RANGE_VALUES, args.range)) {
      return refuse("bad-parameter", `range must be one of ${RANGE_VALUES.join(", ")}`);
    }
    const days = chartRangeDays(args.range);
    return {
      fromDay: days === null ? epoch : today - days * DAY_SECONDS,
      toDay: tomorrow,
      range: args.range,
    };
  }
  if (args.from === undefined) {
    if (args.to !== undefined) {
      return refuse("bad-parameter", "to needs a from — or use range for a trailing window");
    }
    // The site's own default range: the whole series.
    return { fromDay: epoch, toDay: tomorrow, range: "all" };
  }
  const day = (key: "from" | "to"): number | WindowRefusal => {
    const value = args[key];
    const parsed = typeof value === "string" ? parseUtcDayStart(value.trim()) : null;
    return parsed ?? refuse("bad-parameter", `${key} must be a real UTC day as YYYY-MM-DD`);
  };
  const fromDay = day("from");
  if (isWindowRefusal(fromDay)) return fromDay;
  const toDay = args.to === undefined ? tomorrow : day("to");
  if (isWindowRefusal(toDay)) return toDay;
  if (fromDay >= tomorrow) {
    return refuse("window", "that window is in the future: nothing has been measured there yet", [
      closest({ range: "30d" }),
    ]);
  }
  if (toDay <= fromDay) {
    return refuse(
      "window",
      "to must be after from — and it is EXCLUSIVE, so a whole month ends on the 1st of the next",
    );
  }
  if (fromDay < epoch) {
    return refuse("window", `from must be on or after ${PLOT_EPOCH_DAY}, Zcash's launch`, [
      closest({ from: PLOT_EPOCH_DAY, ...(args.to === undefined ? {} : { to: args.to }) }),
    ]);
  }
  if (toDay > tomorrow) {
    return refuse("window", "to must not be in the future: nothing has been measured there yet", [
      closest({ from: args.from }),
    ]);
  }
  return { fromDay, toDay, range: null };
}

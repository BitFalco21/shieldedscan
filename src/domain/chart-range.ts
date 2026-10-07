import { DAY_SECONDS } from "./time";

/**
 * The time ranges a chart can be viewed at: ALL / 1Y / 180D / 90D / 60D / 30D.
 *
 * A range is a viewport over the same series. Every range short of ALL reads the daily
 * sibling series, since thirty days of a monthly series is one point; never resample monthly
 * data into a fake daily line.
 */
export type ChartRange = "all" | "1y" | "180d" | "90d" | "60d" | "30d";

export const CHART_RANGES: { value: ChartRange; label: string; days: number | null }[] = [
  { value: "all", label: "ALL", days: null },
  { value: "1y", label: "1Y", days: 365 },
  { value: "180d", label: "180D", days: 180 },
  { value: "90d", label: "90D", days: 90 },
  { value: "60d", label: "60D", days: 60 },
  { value: "30d", label: "30D", days: 30 },
];

export function chartRangeDays(range: ChartRange): number | null {
  return CHART_RANGES.find((r) => r.value === range)?.days ?? null;
}

/**
 * A range read off a URL. The set is closed, so anything unrecognised is a typo and means ALL
 * (unlike `parseChainFilter`, whose set is open).
 */
export function parseChartRange(raw: string | undefined): ChartRange {
  return CHART_RANGES.find((r) => r.value === raw)?.value ?? "all";
}

/** A century, well past the chain's own age — a ceiling, not a meaningful window. */
const MAX_WINDOW_DAYS = 36_500;

/**
 * A trailing window in days, read off a wire query string. Anything not a positive whole
 * number of days within the ceiling means all-time (null). Responses echo the applied window,
 * since all-time is also what an API that ignores the parameter returns.
 */
export function parseWindowDays(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const days = Number(raw);
  if (!Number.isInteger(days) || days <= 0 || days > MAX_WINDOW_DAYS) return null;
  return days;
}

/**
 * The trailing window of a time-stamped series.
 *
 * Anchored on the series' own last timestamp, never `Date.now()`: server render and client
 * hydration happen at different instants, and a clock-anchored cutoff would select different
 * points on each.
 */
export function sliceRange<T>(
  points: readonly T[],
  getTimestamp: (p: T) => number,
  range: ChartRange,
): T[] {
  const days = chartRangeDays(range);
  const last = points.at(-1);
  if (days === null || last === undefined) return [...points];
  const cutoff = getTimestamp(last) - days * DAY_SECONDS;
  return points.filter((p) => getTimestamp(p) >= cutoff);
}

/**
 * The trailing window of a series with one point per period but no timestamps — the
 * shielded-supply series carries block heights only. One point per day is its published
 * grain, so the last N points ARE the last N days.
 */
export function sliceTail<T>(points: readonly T[], range: ChartRange): T[] {
  const days = chartRangeDays(range);
  return days === null ? [...points] : points.slice(-days);
}

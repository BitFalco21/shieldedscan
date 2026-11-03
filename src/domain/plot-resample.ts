import type { PlotGrain, PlotKind } from "./plottable";
import { DAY_SECONDS } from "./time";

/**
 * Turning a source's rows into one value per plotted period, by rules a reader could check:
 * a closing value is the period's last reading, a flow is the sum of its days and is unmeasured
 * if any day is missing, and nothing is ever filled in. The periods are whole (a window's edges
 * snap outward), so the first and last points are never a fraction of a period passed off as one;
 * the only exception is the period still running, which is flagged.
 */

/** One reading: `t` is the start of its UTC day (or month, for a monthly source), in seconds. */
export interface PlotPoint {
  t: number;
  v: number | null;
  /** The reading is a floor: some of what it sums could not be read (a fee total's blocks). */
  floor?: boolean;
  /** For a share, what it is a share of (the month's blocks). */
  of?: number;
}

/** The plotted periods: `[start, end)` cut by grain, with data accepted only before `dataEnd`. */
export interface PlotWindow {
  grain: PlotGrain;
  starts: number[];
  /** Exclusive end of the last period. */
  end: number;
  /** The start of today: a day still filling is never read as a whole one. */
  dataEnd: number;
}

const date = (s: number) => new Date(s * 1000);

/** The start of the period `s` falls in: its UTC day, its ISO week (Monday) or its month. */
export function periodStart(grain: PlotGrain, s: number): number {
  const day = Math.floor(s / DAY_SECONDS) * DAY_SECONDS;
  if (grain === "day") return day;
  if (grain === "week") {
    // getUTCDay: Sunday 0 … Saturday 6; ISO weeks start on Monday.
    const back = (date(day).getUTCDay() + 6) % 7;
    return day - back * DAY_SECONDS;
  }
  const d = date(day);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

/** The start of the period after the one starting at `start`. */
export function nextPeriod(grain: PlotGrain, start: number): number {
  if (grain === "day") return start + DAY_SECONDS;
  if (grain === "week") return start + 7 * DAY_SECONDS;
  const d = date(start);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
}

/**
 * The whole periods covering `[from, to)`, keeping only those with at least one complete day
 * before `today` (a period that starts today has nothing to show yet).
 */
export function plotWindow(grain: PlotGrain, from: number, to: number, today: number): PlotWindow {
  const starts: number[] = [];
  const last = periodStart(grain, to - DAY_SECONDS);
  for (let p = periodStart(grain, from); p <= last && p < today; p = nextPeriod(grain, p)) {
    starts.push(p);
  }
  const end = starts.length === 0 ? from : nextPeriod(grain, starts[starts.length - 1]!);
  return { grain, starts, end, dataEnd: today };
}

/** Whether the last period runs past the last complete day, i.e. is still filling. */
export function lastPeriodIsPartial(window: PlotWindow): boolean {
  return window.starts.length > 0 && window.end > window.dataEnd;
}

export interface Resampled {
  values: (number | null)[];
  /** Indices of periods whose value is a floor. */
  floors: number[];
  /** Each period's denominator, for a share read from a monthly source. */
  of?: (number | null)[];
}

/**
 * Keyed rows from a source that lists only the periods something happened in (a chain's month of
 * swaps), made dense: inside the source's own extent, from its first row to its last across every
 * key, a period with no row is a measured zero. Outside it nothing was measured, so nothing is
 * added there. A row that does not start a period is a body we do not understand: null, never a
 * spine of zeros beside it.
 */
export function zeroFilled(
  byKey: Record<string, PlotPoint[]>,
  grain: "day" | "month",
): Record<string, PlotPoint[]> | null {
  const all = Object.values(byKey).flat();
  if (all.some((p) => periodStart(grain, p.t) !== p.t)) return null;
  if (all.length === 0) return byKey;
  const first = Math.min(...all.map((p) => p.t));
  const last = Math.max(...all.map((p) => p.t));
  const spine: number[] = [];
  for (let t = periodStart(grain, first); t <= last; t = nextPeriod(grain, t)) spine.push(t);
  return Object.fromEntries(
    Object.entries(byKey).map(([key, points]) => {
      const at = new Map(points.map((p) => [p.t, p]));
      return [key, spine.map((t) => at.get(t) ?? { t, v: 0 })];
    }),
  );
}

/**
 * The first reading above zero in a source's whole history, or null if it never held anything:
 * before it, a pool did not exist. Read off the whole history, never the window, so a real zero
 * after it (Sprout draining) stays a zero whatever window is asked for.
 */
export function firstNonZero(points: readonly PlotPoint[]): number | null {
  return points.find((p) => p.v !== null && p.v !== 0)?.t ?? null;
}

/**
 * Periods that ended before a pool existed made absent rather than a measured zero. A period the
 * pool existed for any part of keeps its value, so the activation week's count is that week's real
 * count rather than unmeasured.
 */
export function absentBefore(
  resampled: Resampled,
  window: PlotWindow,
  first: number | null,
): Resampled {
  const absent = (i: number) =>
    first === null || nextPeriod(window.grain, window.starts[i]!) <= first;
  return {
    values: resampled.values.map((v, i) => (absent(i) ? null : v)),
    floors: resampled.floors.filter((i) => !absent(i)),
    ...(resampled.of === undefined
      ? {}
      : { of: resampled.of.map((v, i) => (absent(i) ? null : v)) }),
  };
}

/**
 * Daily readings into one value per period.
 *
 * `level` series are only ever drawn per day; asking for more is a caller bug, refused loudly.
 */
export function resampleDays(
  points: readonly PlotPoint[],
  kind: PlotKind,
  window: PlotWindow,
): Resampled {
  if (kind === "level" && window.grain !== "day") {
    throw new Error("a level series has no honest weekly or monthly value");
  }
  const byDay = new Map(points.map((p) => [p.t, p]));
  const values: (number | null)[] = [];
  const floors: number[] = [];
  window.starts.forEach((start, index) => {
    const stop = Math.min(nextPeriod(window.grain, start), window.dataEnd);
    const days: (PlotPoint | undefined)[] = [];
    for (let t = start; t < stop; t += DAY_SECONDS) days.push(byDay.get(t));
    if (kind === "flow") {
      // A day without a reading makes the sum unknown, never smaller.
      if (days.some((d) => d === undefined || d.v === null)) {
        values.push(null);
        return;
      }
      const present = days as PlotPoint[];
      values.push(present.reduce((sum, d) => sum + (d.v as number), 0));
      if (present.some((d) => d.floor === true)) floors.push(index);
      return;
    }
    // A closing value is the period's last reading; a missing close stays missing.
    const lastRead = [...days].reverse().find((d) => d !== undefined);
    values.push(lastRead?.v ?? null);
    if (lastRead?.floor === true) floors.push(index);
  });
  return { values, floors };
}

/** A monthly source at month grain: each period is its own row, or unmeasured. */
export function alignMonths(points: readonly PlotPoint[], window: PlotWindow): Resampled {
  if (window.grain !== "month") throw new Error("only a month grain reads a monthly source");
  const byMonth = new Map(points.map((p) => [p.t, p]));
  const floors: number[] = [];
  const values = window.starts.map((start, index) => {
    const row = byMonth.get(start);
    if (row?.floor === true) floors.push(index);
    return row?.v ?? null;
  });
  const shares = points.some((p) => p.of !== undefined);
  return shares
    ? { values, floors, of: window.starts.map((start) => byMonth.get(start)?.of ?? null) }
    : { values, floors };
}

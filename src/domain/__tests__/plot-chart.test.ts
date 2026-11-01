import { describe, expect, it } from "vitest";
import {
  absentBefore,
  alignMonths,
  chartCaption,
  chartCaveats,
  firstNonZero,
  lastPeriodIsPartial,
  nextPeriod,
  parsePlottedChart,
  periodStart,
  PLOT_SERIES_IDS,
  PLOTTABLE_SERIES,
  plotWindow,
  resampleDays,
  type PlotPoint,
  type PlottedChart,
  type PlottableSeries,
} from "@/domain";

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const DAY = 86_400;

/** One reading per day from `first`, with the values given. */
const daily = (first: string, values: (number | null)[]): PlotPoint[] =>
  values.map((v, i) => ({ t: day(first) + i * DAY, v }));

describe("periods", () => {
  it("cuts days, ISO weeks from Monday, and calendar months", () => {
    // 2026-08-05 is a Wednesday.
    expect(periodStart("day", day("2026-08-05") + 3_600)).toBe(day("2026-08-05"));
    expect(periodStart("week", day("2026-08-05"))).toBe(day("2026-08-03"));
    expect(periodStart("week", day("2026-08-09"))).toBe(day("2026-08-03")); // Sunday
    expect(periodStart("month", day("2026-08-31"))).toBe(day("2026-08-01"));
    expect(nextPeriod("month", day("2026-12-01"))).toBe(day("2027-01-01"));
  });

  it("snaps a window outward to whole periods and never includes a period starting today", () => {
    const w = plotWindow("week", day("2026-07-01"), day("2026-08-04"), day("2026-08-03"));
    // 2026-07-01 is a Wednesday: its week starts Monday 2026-06-29. The week starting today
    // (Monday 2026-08-03) has no complete day yet and is left out.
    expect(w.starts[0]).toBe(day("2026-06-29"));
    expect(w.starts.at(-1)).toBe(day("2026-07-27"));
    expect(lastPeriodIsPartial(w)).toBe(false);
  });

  it("flags the last period while it is still running", () => {
    const w = plotWindow("month", day("2026-05-01"), day("2026-08-04"), day("2026-08-03"));
    expect(w.starts.at(-1)).toBe(day("2026-08-01"));
    expect(lastPeriodIsPartial(w)).toBe(true);
  });
});

describe("resampling", () => {
  const today = day("2026-08-17");
  const weeks = plotWindow("week", day("2026-08-03"), day("2026-08-17"), today);

  it("takes a closing value from the period's last reading", () => {
    const points = daily("2026-08-03", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(resampleDays(points, "stock", weeks).values).toEqual([7, 14]);
  });

  it("sums a flow, and calls the sum unknown when any day is missing or unread", () => {
    const full = daily(
      "2026-08-03",
      Array.from({ length: 14 }, () => 1),
    );
    expect(resampleDays(full, "flow", weeks).values).toEqual([7, 7]);
    const gap = full.filter((_, i) => i !== 9);
    expect(resampleDays(gap, "flow", weeks).values).toEqual([7, null]);
    const unread = full.map((p, i) => (i === 2 ? { ...p, v: null } : p));
    expect(resampleDays(unread, "flow", weeks).values).toEqual([null, 7]);
  });

  it("never reads today, even when the source serves it", () => {
    const days = plotWindow("day", day("2026-08-14"), day("2026-08-18"), today);
    const points = daily("2026-08-14", [1, 2, 3, 999]);
    expect(days.starts).toHaveLength(3);
    expect(resampleDays(points, "flow", days).values).toEqual([1, 2, 3]);
  });

  it("carries a floor to the period it is summed into", () => {
    const points = daily(
      "2026-08-03",
      Array.from({ length: 14 }, () => 1),
    ).map((p, i) => (i === 10 ? { ...p, floor: true } : p));
    expect(resampleDays(points, "flow", weeks).floors).toEqual([1]);
  });

  it("refuses to re-average a level series", () => {
    expect(() => resampleDays([], "level", weeks)).toThrow();
  });

  it("reads a monthly source one row per month, unmeasured where a month has no row", () => {
    const months = plotWindow("month", day("2026-05-01"), day("2026-08-01"), day("2026-08-03"));
    const rows: PlotPoint[] = [
      { t: day("2026-05-01"), v: 5 },
      { t: day("2026-07-01"), v: 7, floor: true },
    ];
    expect(alignMonths(rows, months)).toEqual({ values: [5, null, 7], floors: [2] });
  });

  it("makes periods before a pool existed absent, and keeps a real zero after it", () => {
    const days = plotWindow("day", day("2026-08-03"), day("2026-08-08"), today);
    const points = daily("2026-08-03", [0, 0, 4, 0, 2]);
    const resampled = resampleDays(points, "flow", days);
    expect(absentBefore(resampled, days, firstNonZero(points)).values).toEqual([
      null,
      null,
      4,
      0,
      2,
    ]);
  });

  it("keeps the activation week's real sum: the pool existed for part of it", () => {
    // Activation on Wednesday 2026-08-12: the first week is absent, the second sums every day,
    // the zeros before Wednesday included, since they are true counts of that week.
    const points = daily("2026-08-03", [0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5]);
    const resampled = resampleDays(points, "flow", weeks);
    expect(absentBefore(resampled, weeks, firstNonZero(points)).values).toEqual([null, 25]);
  });

  it("calls a pool that never held anything absent throughout", () => {
    const points = daily(
      "2026-08-03",
      Array.from({ length: 14 }, () => 0),
    );
    const resampled = resampleDays(points, "stock", weeks);
    expect(absentBefore(resampled, weeks, firstNonZero(points)).values).toEqual([null, null]);
  });
});

const chart = (over: Partial<PlottedChart> = {}): PlottedChart => ({
  v: 1,
  type: "line",
  scale: "linear",
  grain: "week",
  timestamps: [day("2026-07-06"), day("2026-07-13")],
  series: [
    { id: "ironwood-balance", values: [null, 5], floors: [] },
    { id: "orchard-balance", values: [9, 4], floors: [] },
  ],
  partialLast: false,
  reachesPresent: true,
  range: null,
  ...over,
});

describe("the caption", () => {
  it("says exactly what is plotted, from the ids and periods alone", () => {
    expect(chartCaption(chart())).toBe(
      "Ironwood balance, Orchard balance · since 2026-07-06 · weekly · line",
    );
    expect(chartCaption(chart({ reachesPresent: false, scale: "log", grain: "day" }))).toBe(
      "Ironwood balance, Orchard balance · 2026-07-06 to 2026-07-13 · daily · line, log scale",
    );
  });

  it("names a running period and the floors", () => {
    const fees = chart({
      partialLast: true,
      series: [{ id: "fees-paid", values: [1, 2], floors: [0, 1] }],
    });
    expect(chartCaveats(fees)).toEqual([
      "The last week is still running.",
      "2 periods are floors: some blocks' fees could not be read.",
    ]);
  });
});

describe("the wire", () => {
  it("round-trips a chart", () => {
    expect(parsePlottedChart(JSON.parse(JSON.stringify(chart())))).toEqual(chart());
  });

  it("drops anything that is not exactly a chart of catalogue series", () => {
    const bad: unknown[] = [
      null,
      { ...chart(), v: 2 },
      { ...chart(), type: "pie" },
      { ...chart(), timestamps: [day("2026-07-13"), day("2026-07-06")] },
      { ...chart(), series: [{ id: "made-up", values: [1, 2], floors: [] }] },
      { ...chart(), series: [{ id: "orchard-balance", values: [1], floors: [] }] },
      { ...chart(), series: [{ id: "orchard-balance", values: [1, "2"], floors: [] }] },
      { ...chart(), series: [{ id: "orchard-balance", values: [1, Infinity], floors: [] }] },
      { ...chart(), series: [{ id: "orchard-balance", values: [1, 2], floors: [9] }] },
      // Two measures on one axis.
      {
        ...chart(),
        series: [
          { id: "orchard-balance", values: [1, 2], floors: [] },
          { id: "zec-price", values: [1, 2], floors: [] },
        ],
      },
    ];
    for (const raw of bad) expect(parsePlottedChart(raw)).toBeNull();
  });
});

describe("the catalogue", () => {
  it("has unique ids, and a pool's leading zeros are absence", () => {
    expect(new Set(PLOT_SERIES_IDS).size).toBe(PLOT_SERIES_IDS.length);
    for (const s of PLOTTABLE_SERIES as readonly PlottableSeries[]) {
      if (s.ink !== undefined && "pool" in s.ink) expect(s.omitLeadingZeros).toBe(true);
    }
  });
});

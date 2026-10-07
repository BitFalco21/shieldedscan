import { describe, expect, it } from "vitest";
import type { TransparentDayRow, TransparentSeries } from "../transparent-daily";
import { buildTransparent, type TransparentWindow } from "../v1/transparent-series";

/**
 * `/v1/analytics/transparent`'s arithmetic. Volume sums over any window; a distinct address count
 * is stated only for a span it was counted over exactly, and everywhere else is absent with its
 * reason — a month cut by the window must not borrow its whole-month count.
 */

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const NOW = day("2026-10-05") + 3_600;

function row(iso: string, over: Partial<TransparentDayRow> = {}): TransparentDayRow {
  return {
    day: day(iso),
    outputs: 10,
    unaddressedOutputs: 1,
    outTransparentZat: 1_000,
    outMixedZat: 100,
    inputs: 8,
    unresolvedInputs: 0,
    inTransparentZat: 1_010,
    inMixedZat: 200,
    active: 5,
    sending: 3,
    receiving: 4,
    ...over,
  };
}

/** Late September and early October 2026, every day computed; September counted and final. */
const series: TransparentSeries = {
  days: [
    row("2026-09-29"),
    row("2026-09-30", { active: 7, unresolvedInputs: 2 }),
    row("2026-10-01"),
    row("2026-10-02"),
  ],
  months: [
    { month: day("2026-09-01"), active: 9, sending: 4, receiving: 8, days: 2, complete: true },
    { month: day("2026-10-01"), active: 6, sending: 3, receiving: 5, days: 2, complete: false },
  ],
  trailing: [{ days: 7, lastDay: day("2026-10-01"), active: 11, sending: 6, receiving: 9 }],
};
const FIRST = day("2026-09-29");

const win = (
  from: string | null,
  to: string | null,
  interval: "day" | "month",
): TransparentWindow => ({
  from,
  to,
  interval,
  fromTs: from === null ? 0 : day(from),
  toTs: to === null ? Number.POSITIVE_INFINITY : day(to),
});

describe("buildTransparent", () => {
  it("sums volume over the window and states each day's own address count", () => {
    const built = buildTransparent(series, win("2026-09-29", "2026-10-01", "day"), NOW, FIRST);
    expect(built.data.points.map((p) => p.addresses?.active)).toEqual([5, 7]);
    expect(built.data.totals.outputs).toEqual({
      count: 20,
      unaddressed: 2,
      value: {
        transparent: { zat: 2_000, zec: "0.00002000" },
        mixed: { zat: 200, zec: "0.00000200" },
        total: { zat: 2_200, zec: "0.00002200" },
      },
    });
    // Two days are not one span counted together: their sum would count an address twice.
    expect(built.data.totals.addresses).toBeNull();
    expect(built.unknowns["data.totals.addresses"]).toBe("omitted");
    // An input with no resolved value makes the input total a floor, and the answer says so.
    expect(built.coverage.notes.join(" ")).toMatch(/2 transparent input\(s\).*floor/);
  });

  it("states a whole month's count, and none for a month the window cuts", () => {
    const whole = buildTransparent(series, win("2026-09-01", "2026-10-01", "month"), NOW, FIRST);
    expect(whole.data.points.map((p) => p.addresses)).toEqual([
      { active: 9, sending: 4, receiving: 8 },
    ]);
    // The window IS one calendar month, so its total carries the month's count.
    expect(whole.data.totals.addresses).toEqual({ active: 9, sending: 4, receiving: 8 });

    const cut = buildTransparent(series, win("2026-09-30", "2026-10-02", "month"), NOW, FIRST);
    expect(cut.data.points.map((p) => p.addresses)).toEqual([null, null]);
    expect(cut.unknowns["data.points.0.addresses"]).toBe("omitted");
    expect(cut.unknowns["data.points.1.addresses"]).toBe("omitted");
  });

  it("withholds a month's count until it covers every day computed in it", () => {
    // October gained a day after it was counted: the stored count is two days stale.
    const stale: TransparentSeries = { ...series, days: [...series.days, row("2026-10-03")] };
    const built = buildTransparent(stale, win("2026-10-01", "2026-11-01", "month"), NOW, FIRST);
    expect(built.data.points[0]?.addresses).toBeNull();
    expect(built.unknowns["data.points.0.addresses"]).toBe("unmeasured");
    expect(built.coverage.notes.join(" ")).toMatch(
      /1 month\(s\) in this window have no address count yet/,
    );
  });

  it("states a trailing window's count when the window is exactly it", () => {
    const built = buildTransparent(series, win("2026-09-25", "2026-10-02", "day"), NOW, FIRST);
    expect(built.data.totals.addresses).toEqual({ active: 11, sending: 6, receiving: 9 });
    expect(built.data.trailing).toEqual([
      {
        days: 7,
        from: "2026-09-25",
        through: "2026-10-01",
        addresses: { active: 11, sending: 6, receiving: 9 },
      },
    ]);
  });

  it("names the days the window covers that are not computed yet, and today", () => {
    const built = buildTransparent(series, win("2026-09-29", "2026-10-06", "day"), NOW, FIRST);
    expect(built.coverage.status).toBe("partial");
    // Oct 3, 4 and 5 (today) are not stored; Oct 6 is after today and not counted as missing.
    expect(built.coverage.notes).toEqual(
      expect.arrayContaining([
        "The window includes today's unfinished UTC day; its figures cover the day so far.",
        "3 day(s) in this window are not computed yet.",
      ]),
    );
  });

  it("is complete for a settled window with every day computed", () => {
    const settled: TransparentSeries = {
      ...series,
      days: series.days.map((d) => ({ ...d, unresolvedInputs: 0 })),
    };
    const built = buildTransparent(settled, win("2026-09-29", "2026-10-01", "day"), NOW, FIRST);
    expect(built.coverage).toEqual({ status: "complete", notes: [] });
    expect(built.data.totals.days).toBe(2);
  });
});

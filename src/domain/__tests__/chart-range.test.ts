import { describe, expect, it } from "vitest";
import {
  CHART_RANGES,
  chartRangeDays,
  parseChartRange,
  parseWindowDays,
  sliceRange,
  sliceTail,
} from "../chart-range";

const DAY = 86_400;
/** 400 daily points ending at t=400d. */
const series = Array.from({ length: 400 }, (_, i) => ({ timestamp: (i + 1) * DAY }));

describe("sliceRange", () => {
  it("returns the whole series for ALL", () => {
    expect(sliceRange(series, (p) => p.timestamp, "all")).toHaveLength(400);
  });

  it("windows the trailing days, anchored on the series' own last point", () => {
    const sliced = sliceRange(series, (p) => p.timestamp, "30d");
    // Anchored at t=400d, cutoff 370d: inclusive, so 31 points — never Date.now(),
    // which would make server and client render different windows (hydration mismatch).
    expect(sliced).toHaveLength(31);
    expect(sliced[0]!.timestamp).toBe(370 * DAY);
    expect(sliced.at(-1)!.timestamp).toBe(400 * DAY);
  });

  it("returns everything when the series is shorter than the range", () => {
    const short = series.slice(-10);
    expect(sliceRange(short, (p) => p.timestamp, "90d")).toHaveLength(10);
  });

  it("is safe on an empty series", () => {
    expect(sliceRange([], () => 0, "1y")).toEqual([]);
  });
});

describe("sliceTail", () => {
  it("takes the last N points — one point per day is the published grain", () => {
    expect(sliceTail(series, "90d")).toHaveLength(90);
    expect(sliceTail(series, "all")).toHaveLength(400);
  });
});

describe("chartRangeDays", () => {
  it("maps every range, with ALL as null", () => {
    expect(chartRangeDays("all")).toBeNull();
    expect(chartRangeDays("1y")).toBe(365);
    expect(chartRangeDays("60d")).toBe(60);
    expect(chartRangeDays("30d")).toBe(30);
  });

  it("maps every declared range, so a new preset cannot ship without a length", () => {
    for (const range of CHART_RANGES) {
      expect(chartRangeDays(range.value)).toBe(range.days);
    }
  });
});

describe("CHART_RANGES", () => {
  it("runs widest to narrowest, which is the order the chips are read in", () => {
    const lengths = CHART_RANGES.map((r) => r.days ?? Number.POSITIVE_INFINITY);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });
});

describe("parseChartRange", () => {
  it("accepts every range this codebase declares", () => {
    for (const range of CHART_RANGES) {
      expect(parseChartRange(range.value)).toBe(range.value);
    }
  });

  it("coerces anything unrecognised to ALL — the set is closed, so a stranger is a typo", () => {
    expect(parseChartRange(undefined)).toBe("all");
    expect(parseChartRange("")).toBe("all");
    expect(parseChartRange("7d")).toBe("all");
    expect(parseChartRange("30D")).toBe("all");
    expect(parseChartRange("../../etc/passwd")).toBe("all");
  });
});

describe("parseWindowDays", () => {
  it("accepts a positive whole number of days", () => {
    expect(parseWindowDays("30")).toBe(30);
    expect(parseWindowDays("365")).toBe(365);
  });

  it("passes every range this codebase can send", () => {
    for (const range of CHART_RANGES) {
      if (range.days === null) continue;
      expect(parseWindowDays(String(range.days))).toBe(range.days);
    }
  });

  /*
   * A malformed number has no honest partial reading, so it means all-time. The response
   * echoes what it applied so a coerced value can be told apart from an ignored one.
   */
  it("means all-time for anything that is not one", () => {
    expect(parseWindowDays(undefined)).toBeNull();
    expect(parseWindowDays("")).toBeNull();
    expect(parseWindowDays("abc")).toBeNull();
    expect(parseWindowDays("30.5")).toBeNull();
    expect(parseWindowDays("0")).toBeNull();
    expect(parseWindowDays("-30")).toBeNull();
    expect(parseWindowDays("Infinity")).toBeNull();
    expect(parseWindowDays("NaN")).toBeNull();
  });

  it("caps a window past the ceiling rather than passing it to SQL", () => {
    expect(parseWindowDays("36500")).toBe(36_500);
    expect(parseWindowDays("36501")).toBeNull();
    expect(parseWindowDays("999999999999")).toBeNull();
  });
});

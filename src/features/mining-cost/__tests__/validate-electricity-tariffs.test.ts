import { describe, expect, it } from "vitest";
import {
  deviationStats,
  eurostatGeoToIso2,
  jsonStatRows,
  newestPopulatedPeriod,
  quarterMonths,
  semesterRange,
} from "../../../../scripts/validate-electricity-tariffs.mjs";

/**
 * The pure half of `tariffs:validate`. The live half reaches Eurostat, the ECB mirror and the
 * EIA and is run by hand; what CAN be pinned is that a JSON-stat body is decoded in the right
 * dimension order, that an empty-but-existing semester is never chosen, and that the summary
 * quotes absolute deviations so opposite errors do not cancel into a false "0%".
 */

describe("jsonStatRows", () => {
  it("decodes the row-major index in the body's own dimension order", () => {
    // geo is NOT last here — the decoder must read `id`, not assume time is the tail.
    const body = {
      id: ["freq", "geo", "time"],
      size: [1, 2, 2],
      dimension: {
        freq: { category: { index: { S: 0 } } },
        geo: { category: { index: { DE: 0, FR: 1 } } },
        time: { category: { index: { "2025-S1": 0, "2025-S2": 1 } } },
      },
      value: { "0": 0.2, "1": 0.21, "3": 0.18 }, // DE S1, DE S2, FR S2 (FR S1 missing)
    };
    expect(jsonStatRows(body)).toEqual([
      { geo: "DE", time: "2025-S1", value: 0.2 },
      { geo: "DE", time: "2025-S2", value: 0.21 },
      { geo: "FR", time: "2025-S2", value: 0.18 },
    ]);
  });

  it("refuses a body that is not JSON-stat", () => {
    expect(() => jsonStatRows({ id: ["geo"], size: [1, 2] })).toThrow(/JSON-stat/);
  });
});

describe("newestPopulatedPeriod", () => {
  it("skips a newer semester that exists but carries too few values", () => {
    const rows = [
      ...["DE", "FR", "IT"].map((geo) => ({ geo, time: "2025-S2", value: 0.2 })),
      { geo: "DE", time: "2026-S1", value: 0.2 },
      { geo: "EU27_2020", time: "2026-S1", value: 0.2 },
    ];
    expect(newestPopulatedPeriod(rows, 3)).toBe("2025-S2");
  });

  it("does not count aggregates as countries", () => {
    const rows = [
      { geo: "EU27_2020", time: "2025-S2", value: 0.2 },
      { geo: "EA", time: "2025-S2", value: 0.2 },
    ];
    expect(newestPopulatedPeriod(rows, 1)).toBeNull();
  });
});

describe("codes and periods", () => {
  it("maps Eurostat's two non-ISO codes and drops aggregates", () => {
    expect(eurostatGeoToIso2("EL")).toBe("GR");
    expect(eurostatGeoToIso2("UK")).toBe("GB");
    expect(eurostatGeoToIso2("DE")).toBe("DE");
    expect(eurostatGeoToIso2("EU27_2020")).toBeNull();
  });

  it("turns a semester into its calendar range and a quarter into its months", () => {
    expect(semesterRange("2025-S2")).toEqual({ start: "2025-07-01", end: "2025-12-31" });
    expect(semesterRange("2026-S1")).toEqual({ start: "2026-01-01", end: "2026-06-30" });
    expect(quarterMonths("Q2 2026")).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(quarterMonths("Q4 2025")).toEqual(["2025-10", "2025-11", "2025-12"]);
    expect(() => quarterMonths("2026-Q2")).toThrow();
  });
});

describe("deviationStats", () => {
  it("reports absolute deviations so opposite errors do not cancel", () => {
    const stats = deviationStats([
      { iso2: "A", name: "A", gpp: 0.11, reference: 0.1 }, // +10%
      { iso2: "B", name: "B", gpp: 0.09, reference: 0.1 }, // -10%
      { iso2: "C", name: "C", gpp: 0.1, reference: 0.1 }, // 0%
    ]);
    expect(stats?.countries).toBe(3);
    expect(stats?.medianPct).toBeCloseTo(10, 6);
    expect(stats?.signedMedianPct).toBeCloseTo(0, 6);
    expect(stats?.maxPct).toBeCloseTo(10, 6);
    expect(stats?.worst[0].iso2).not.toBe("C");
  });

  it("drops a row GPP never published rather than treating null as zero", () => {
    const stats = deviationStats([
      { iso2: "A", name: "A", gpp: null, reference: 0.1 },
      { iso2: "B", name: "B", gpp: 0.1, reference: 0.1 },
    ]);
    expect(stats?.countries).toBe(1);
    expect(deviationStats([{ iso2: "A", name: "A", gpp: null, reference: 0.1 }])).toBeNull();
  });
});

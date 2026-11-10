import { describe, expect, it } from "vitest";
import {
  COIN_AGE_BANDS,
  coinAgeBandIndex,
  coinAgeBandStarts,
  coinAgeBands,
  coinAgeTotalZat,
  dayBefore,
} from "../coin-age";

const keyOf = (creation: string, asOf: string) =>
  COIN_AGE_BANDS[coinAgeBandIndex(creation, asOf)]!.key;

describe("dayBefore", () => {
  it("steps whole days across a month and a year", () => {
    expect(dayBefore("2026-03-01", { days: 1 })).toBe("2026-02-28");
    expect(dayBefore("2024-03-01", { days: 1 })).toBe("2024-02-29");
    expect(dayBefore("2026-01-03", { days: 7 })).toBe("2025-12-27");
  });

  it("steps calendar months, clamping to the month's last day as SQL does", () => {
    expect(dayBefore("2026-03-31", { months: 1 })).toBe("2026-02-28");
    expect(dayBefore("2024-03-31", { months: 1 })).toBe("2024-02-29");
    expect(dayBefore("2026-01-15", { months: 3 })).toBe("2025-10-15");
    expect(dayBefore("2026-10-31", { months: 60 })).toBe("2021-10-31");
    expect(dayBefore("2028-02-29", { months: 12 })).toBe("2027-02-28");
  });
});

describe("coin age bands", () => {
  it("puts each boundary day in the younger band only after the span has fully passed", () => {
    // Created six days before: under a week. Seven days before: a week old.
    expect(keyOf("2026-10-25", "2026-10-31")).toBe("lt1w");
    expect(keyOf("2026-10-24", "2026-10-31")).toBe("1w1m");
    // Created the same day: under a week.
    expect(keyOf("2026-10-31", "2026-10-31")).toBe("lt1w");
    // A month before is the boundary (2026-09-30 for 2026-10-31).
    expect(keyOf("2026-10-01", "2026-10-31")).toBe("1w1m");
    expect(keyOf("2026-09-30", "2026-10-31")).toBe("1m3m");
    expect(keyOf("2021-11-01", "2026-10-31")).toBe("3y5y");
    expect(keyOf("2021-10-31", "2026-10-31")).toBe("5y");
    expect(keyOf("2016-10-28", "2026-10-31")).toBe("5y");
  });

  it("lists every band's first day newest first, the open band last", () => {
    const starts = coinAgeBandStarts("2026-10-31");
    expect(starts).toHaveLength(COIN_AGE_BANDS.length);
    expect(starts.at(-1)).toBeNull();
    const dated = starts.filter((s): s is string => s !== null);
    expect([...dated].sort().reverse()).toEqual(dated);
  });

  it("refuses a coin created after the day measured", () => {
    expect(() => coinAgeBandIndex("2026-11-01", "2026-10-31")).toThrow();
  });

  it("sums cells into every band, empty bands as zero, the total unchanged", () => {
    const cells = [
      { creationDay: "2026-10-30", valueZat: 5, outputs: 1 },
      { creationDay: "2026-10-29", valueZat: 7, outputs: 2 },
      { creationDay: "2018-01-01", valueZat: 100, outputs: 3 },
    ];
    const bands = coinAgeBands(cells, "2026-10-31");
    expect(bands.map((b) => b.key)).toEqual(COIN_AGE_BANDS.map((b) => b.key));
    expect(bands.find((b) => b.key === "lt1w")).toEqual({ key: "lt1w", valueZat: 12, outputs: 3 });
    expect(bands.find((b) => b.key === "5y")).toEqual({ key: "5y", valueZat: 100, outputs: 3 });
    expect(bands.filter((b) => b.valueZat === 0)).toHaveLength(COIN_AGE_BANDS.length - 2);
    expect(coinAgeTotalZat({ bands })).toBe(112);
  });
});

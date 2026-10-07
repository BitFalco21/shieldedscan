import { describe, expect, it } from "vitest";
import { capitalise, compactCount, formatCount, monthLong, monthShort } from "../format";

// 2024-03-01T00:00:00Z and 2023-12-31T23:59:59Z: the second must not read as January.
const MARCH_2024 = 1_709_251_200;
const LAST_SECOND_OF_2023 = 1_704_067_199;

describe("formatCount", () => {
  it("groups digits and keeps small and negative numbers readable", () => {
    expect(formatCount(18_418)).toBe("18,418");
    expect(formatCount(7)).toBe("7");
    expect(formatCount(-1_200)).toBe("-1,200");
  });
});

describe("month labels", () => {
  it("read the month in UTC, with a two-digit or a full year", () => {
    expect(monthShort(MARCH_2024)).toBe("Mar 24");
    expect(monthLong(MARCH_2024)).toBe("Mar 2024");
    expect(monthShort(LAST_SECOND_OF_2023)).toBe("Dec 23");
    expect(monthLong(LAST_SECOND_OF_2023)).toBe("Dec 2023");
  });
});

describe("compactCount", () => {
  it("steps to K and M at the thresholds", () => {
    expect(compactCount(740.4)).toBe("740");
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1_000)).toBe("1K");
    expect(compactCount(12_400)).toBe("12K");
    expect(compactCount(3_400_000)).toBe("3.4M");
  });
});

describe("capitalise", () => {
  it("upper-cases only the first character, and survives an empty string", () => {
    expect(capitalise("shielding pool")).toBe("Shielding pool");
    expect(capitalise("ZEC")).toBe("ZEC");
    expect(capitalise("")).toBe("");
  });
});

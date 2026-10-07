import { describe, expect, it } from "vitest";
import { DAY_MS, DAY_SECONDS, utcDayFromMs, utcDayFromSeconds } from "../time";

describe("UTC day helpers", () => {
  it("names the day a timestamp falls on, at both edges of the day", () => {
    const midnight = Date.UTC(2026, 9, 7) / 1000;
    expect(utcDayFromSeconds(midnight)).toBe("2026-10-07");
    expect(utcDayFromSeconds(midnight + DAY_SECONDS - 1)).toBe("2026-10-07");
    expect(utcDayFromSeconds(midnight + DAY_SECONDS)).toBe("2026-10-08");
    expect(utcDayFromMs(midnight * 1000 - 1)).toBe("2026-10-06");
    expect(DAY_MS).toBe(DAY_SECONDS * 1000);
  });
});

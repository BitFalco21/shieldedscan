import { describe, expect, it } from "vitest";
import { orchardDrainLatest, orchardDrainSeries, type OrchardDrain } from "@/domain";

const drain = (base: number | null): OrchardDrain => ({
  activationHeight: 100,
  baseHeight: 99,
  baseOrchardZat: base,
  days: [
    { timestamp: 0, closeHeight: 110, orchardZat: 900, migratedZat: 60, multiSourceZat: 5 },
    { timestamp: 86_400, closeHeight: 120, orchardZat: null, migratedZat: 0, multiSourceZat: 0 },
    { timestamp: 172_800, closeHeight: 130, orchardZat: 700, migratedZat: 124, multiSourceZat: 1 },
  ],
});

describe("orchardDrainSeries", () => {
  it("runs the totals and states each day's share of the pre-activation balance", () => {
    const s = orchardDrainSeries(drain(1_000));
    expect(s.map((p) => p.cumulativeZat)).toEqual([60, 60, 184]);
    expect(s.map((p) => p.cumulativeMultiSourceZat)).toEqual([5, 5, 6]);
    expect(s.map((p) => p.sharePct)).toEqual([6, 6, 18.4]);
  });

  it("states no share without a base, and nothing before a complete day", () => {
    expect(orchardDrainSeries(drain(null)).every((p) => p.sharePct === null)).toBe(true);
    expect(orchardDrainLatest({ ...drain(1_000), days: [] })).toBeNull();
    expect(orchardDrainLatest(drain(1_000))?.orchardZat).toBe(700);
  });
});

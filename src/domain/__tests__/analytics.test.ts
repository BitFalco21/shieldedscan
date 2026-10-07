import { describe, expect, it } from "vitest";
import type { ActivityPoint } from "../analytics";
import { shieldedSharePct, totalTxs } from "../analytics";

const base: ActivityPoint = {
  timestamp: 1_783_875_480,
  transparentTxs: 0,
  mixedTxs: 0,
  shieldedTxs: 0,
  medianFeeZat: 10_000,
  netPoolFlowZat: 0,
};

describe("totalTxs", () => {
  it("sums all three kinds", () => {
    expect(totalTxs({ ...base, transparentTxs: 100, mixedTxs: 20, shieldedTxs: 80 })).toBe(200);
  });

  it("is zero for an empty bucket", () => {
    expect(totalTxs(base)).toBe(0);
  });
});

describe("shieldedSharePct", () => {
  it("is zero for an empty bucket (no division by zero)", () => {
    expect(shieldedSharePct(base)).toBe(0);
  });

  it("counts mixed and shielded together against the total", () => {
    // 30 transparent, 20 mixed, 50 shielded -> (20 + 50) / 100 = 70%
    const point = { ...base, transparentTxs: 30, mixedTxs: 20, shieldedTxs: 50 };
    expect(shieldedSharePct(point)).toBe(70);
  });

  it("is exact (not rounded) when the share is not a whole number", () => {
    // 3 transparent, 1 mixed, 0 shielded -> 1 / 4 = 25%
    const point = { ...base, transparentTxs: 3, mixedTxs: 1, shieldedTxs: 0 };
    expect(shieldedSharePct(point)).toBe(25);
  });

  it("is a majority when mixed + shielded outweigh transparent", () => {
    // 10 transparent, 5 mixed, 45 shielded -> 50 / 60 = 83.33...%
    const point = { ...base, transparentTxs: 10, mixedTxs: 5, shieldedTxs: 45 };
    expect(shieldedSharePct(point)).toBeCloseTo((50 / 60) * 100, 10);
    expect(shieldedSharePct(point)).toBeGreaterThan(50);
  });
});

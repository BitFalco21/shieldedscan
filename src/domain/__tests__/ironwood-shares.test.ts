import { describe, expect, it } from "vitest";
import { freshShieldingPct, ironwoodSourceShares, type IronwoodInflow } from "@/domain/ironwood";

/**
 * Every source term gets a computed share, so consumers (including the agent, which does not
 * divide) can state the Orchard proportion directly.
 */

const INFLOW: IronwoodInflow = {
  activationHeight: 3_428_143,
  // 1,000 ZEC, chosen so every share below is exact and legible rather than rounded.
  balanceZat: 100_000_000_000,
  netFromOrchardZat: 70_000_000_000, // 70%
  netFromSaplingZat: 20_000_000_000, // 20%
  netFromSproutZat: 0, // 0%, and still its own term
  netFromTransparentZat: 9_000_000_000, // 9%
  fromTransparentTxCount: 42,
  txCount: 5_180,
  minedZat: 1_000_000_000, // 1%
  feesPaidZat: 0,
  balance: [],
};

describe("ironwoodSourceShares", () => {
  it("gives every source its own share, so no division is left to the reader", () => {
    const shares = ironwoodSourceShares(INFLOW);
    expect(shares).toEqual([
      { source: "orchard", zat: 70_000_000_000, pct: 70 },
      { source: "sapling", zat: 20_000_000_000, pct: 20 },
      { source: "sprout", zat: 0, pct: 0 },
      { source: "transparent", zat: 9_000_000_000, pct: 9 },
      { source: "mined", zat: 1_000_000_000, pct: 1 },
    ]);
  });

  it("keeps sprout as its own zero term rather than folding it away", () => {
    // A term folded away while zero would be misattributed the first day it is not.
    const sources = ironwoodSourceShares(INFLOW)?.map((s) => s.source);
    expect(sources).toContain("sprout");
  });

  it("agrees with freshShieldingPct on the transparent term", () => {
    // Two functions must not disagree about one published number.
    const transparent = ironwoodSourceShares(INFLOW)?.find((s) => s.source === "transparent");
    expect(transparent?.pct).toBe(freshShieldingPct(INFLOW));
  });

  it("reports a negative share rather than an absolute value", () => {
    // netFrom* is a net; Math.abs would render an outflow as an inflow.
    const shares = ironwoodSourceShares({ ...INFLOW, netFromOrchardZat: -5_000_000_000 });
    expect(shares?.find((s) => s.source === "orchard")?.pct).toBe(-5);
  });

  it("returns null on an empty pool, because 0% of nothing is not a measurement", () => {
    expect(ironwoodSourceShares({ ...INFLOW, balanceZat: 0 })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { minerFeeShareZat, unspendablePools } from "../consensus";
import { NU7_HEIGHT } from "../halving";

describe("minerFeeShareZat", () => {
  it("leaves every fee to the miner before NU7", () => {
    expect(minerFeeShareZat("mainnet", NU7_HEIGHT - 1, 402_368)).toBe(402_368);
  });

  it("leaves the miner 40% from NU7, rounding the 60% down on the block total", () => {
    expect(minerFeeShareZat("mainnet", NU7_HEIGHT, 10_000)).toBe(4_000);
    // 6 × 402,368 / 10 = 241,420.8, floored to 241,420 removed: the remainder favours the miner.
    expect(minerFeeShareZat("mainnet", NU7_HEIGHT, 402_368)).toBe(160_948);
    expect(minerFeeShareZat("mainnet", NU7_HEIGHT, 0)).toBe(0);
  });

  it("follows each network's own NU7 height", () => {
    expect(minerFeeShareZat("testnet", 4_465_025, 10_000)).toBe(10_000);
    expect(minerFeeShareZat("testnet", 4_465_026, 10_000)).toBe(4_000);
  });
});

describe("unspendablePools", () => {
  it("is the lockbox, and Sprout too from NU7", () => {
    expect(unspendablePools("mainnet", NU7_HEIGHT - 1)).toEqual(["lockbox"]);
    expect(unspendablePools("mainnet", NU7_HEIGHT)).toEqual(["lockbox", "sprout"]);
  });
});

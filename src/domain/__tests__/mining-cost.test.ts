import { describe, expect, it } from "vitest";
import {
  breakEvenTariffUsdPerKwh,
  costTier,
  electricityCostUsd,
  electricityMargin,
  estimatedNetworkSolps,
  kwhPerZec,
  machinePerDay,
  rankCountryCosts,
  type ElectricityTariffs,
  type MiningTerms,
} from "../mining-cost";
import { DEFAULT_MINING_HARDWARE, joulesPerKsol, MINING_HARDWARE } from "../mining-hardware";

/**
 * Pinned to a real read: block 3,472,658 carried a difficulty of 261,834,739.68542 with ZEC
 * at $1,007.86. At a difficulty of 216.3M the node's `getnetworksolps` was 23,005,253,630,
 * 2.7% off the constant's estimate.
 */
const terms: MiningTerms = {
  height: 3_472_658,
  difficulty: 261_834_739.68542,
  networkSolps: { value: 28_599_335_833, basis: "estimated" },
  minerSubsidyZat: 125_000_000,
  subsidyChangesAtHeight: 4_406_400,
  blockIntervalSeconds: 75,
  priceUsd: 1007.86,
  asOf: 1_788_600_000,
};

describe("the hardware table", () => {
  it("carries a source and a read day for every entry, and the default is the first", () => {
    for (const h of MINING_HARDWARE) {
      expect(h.source).toMatch(/^https:\/\//);
      expect(h.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(h.kSolPerSecond).toBeGreaterThan(0);
      expect(h.wallWatts).toBeGreaterThan(0);
    }
    expect(DEFAULT_MINING_HARDWARE).toBe(MINING_HARDWARE[0]);
  });

  it("derives the Z15 Pro's efficiency as Bitmain's own 3.31 J/kSol", () => {
    expect(joulesPerKsol(DEFAULT_MINING_HARDWARE)).toBeCloseTo(3.31, 2);
  });
});

describe("kwhPerZec", () => {
  it("reproduces the hand derivation: ~1,578 kWh per ZEC at the pinned terms", () => {
    expect(kwhPerZec(terms, DEFAULT_MINING_HARDWARE)).toBeCloseTo(1577.7, 0);
  });

  it("equals one machine's daily kWh over its daily ZEC — so it assumes nothing about the rest of the network", () => {
    const day = machinePerDay(terms, DEFAULT_MINING_HARDWARE)!;
    expect(day.kwh / day.zec).toBeCloseTo(kwhPerZec(terms, DEFAULT_MINING_HARDWARE)!, 6);
    expect(day.kwh).toBeCloseTo(66.72, 2);
  });

  it("rises 60% when the miner's subsidy falls to 0.78125 ZEC", () => {
    const after = kwhPerZec({ ...terms, minerSubsidyZat: 78_125_000 }, DEFAULT_MINING_HARDWARE)!;
    expect(after / kwhPerZec(terms, DEFAULT_MINING_HARDWARE)!).toBeCloseTo(1.6, 6);
  });

  it("is null, never Infinity, on a degenerate term", () => {
    expect(kwhPerZec({ ...terms, minerSubsidyZat: 0 }, DEFAULT_MINING_HARDWARE)).toBeNull();
    expect(
      kwhPerZec({ ...terms, networkSolps: { value: 0, basis: "node" } }, DEFAULT_MINING_HARDWARE),
    ).toBeNull();
  });
});

describe("the estimate the route falls back to", () => {
  it("is the difficulty constant over the interval", () => {
    expect(estimatedNetworkSolps(261_834_739.68542, 75)).toBeCloseTo(28_599_335_833, -3);
  });
  it("agrees with the node's own measurement to within a few percent at a real tip", () => {
    // getnetworksolps answered 23,005,253,630 while the tip difficulty was 216,327,100.78.
    const est = estimatedNetworkSolps(216_327_100.78, 75)!;
    expect(Math.abs(est / 23_005_253_630 - 1)).toBeLessThan(0.05);
  });
});

describe("cost, break-even and margin", () => {
  const kwh = kwhPerZec(terms, DEFAULT_MINING_HARDWARE)!;

  it("prices Germany's business tariff and the break-even tariff from the same kWh", () => {
    expect(electricityCostUsd(0.268, kwh)).toBeCloseTo(422.8, 0);
    expect(breakEvenTariffUsdPerKwh(1007.86, kwh)).toBeCloseTo(0.639, 3);
  });

  it("has no break-even without a price", () => {
    expect(breakEvenTariffUsdPerKwh(null, kwh)).toBeNull();
  });

  it("carries the denominator with the margin, and goes negative above break-even", () => {
    const m = electricityMargin(1007.86, 422.8);
    expect(m.denominator).toBe(1007.86);
    expect(m.pct).toBeCloseTo(58.05, 1);
    expect(electricityMargin(1007.86, 1200).pct).toBeLessThan(0);
  });
});

describe("tiers and ranking", () => {
  it("tiers on the fixed USD edges", () => {
    expect(costTier(74.99)).toBe(1);
    expect(costTier(75)).toBe(2);
    expect(costTier(249.99)).toBe(3);
    expect(costTier(400)).toBe(5);
  });

  const tariffs: ElectricityTariffs = {
    source: "test",
    sourceUrls: [],
    licence: "test",
    bands: { household: "", business: "" },
    quarter: "Q2 2026",
    readOn: "2026-09-05",
    rows: [
      { iso2: "DE", iso3: "DEU", name: "Germany", householdUsdKwh: 0.39, businessUsdKwh: 0.268 },
      { iso2: "ET", iso3: "ETH", name: "Ethiopia", householdUsdKwh: 0.006, businessUsdKwh: 0.015 },
      { iso2: "IE", iso3: "IRL", name: "Ireland", householdUsdKwh: 0.45, businessUsdKwh: null },
    ],
  };

  it("ranks cheapest first and drops a country with no tariff in the band", () => {
    const business = rankCountryCosts(tariffs, "business", 1577.7);
    expect(business.map((c) => c.iso3)).toEqual(["ETH", "DEU"]);
    const household = rankCountryCosts(tariffs, "household", 1577.7);
    expect(household.map((c) => c.iso3)).toEqual(["ETH", "DEU", "IRL"]);
  });
});

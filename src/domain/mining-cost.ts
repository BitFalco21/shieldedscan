import { estimateSolutionsPerSecond } from "./mining";
import type { MiningHardware } from "./mining-hardware";
import { joulesPerKsol } from "./mining-hardware";
import { DAY_SECONDS } from "./time";
import { ZATS_PER_ZEC } from "./transaction";

/**
 * What it costs, in electricity alone, to mine one ZEC — the arithmetic behind
 * `/mining-cost`, in one place.
 *
 * The formula is one machine's expected earnings against its meter:
 *
 *   kWh per ZEC = (machine watts × 24 h) / (machine share of the network × blocks per day ×
 *                 miner subsidy)
 *
 * which simplifies to `networkSolps × J/Sol × interval / minerSubsidy`. The figure therefore
 * does not assume the whole network runs the stated machine: it is what an operator of that
 * machine spends per ZEC earned in expectation at the current difficulty.
 *
 * Every figure is a floor: hardware, hosting, cooling, pool fees and orphans are excluded
 * from cost, and fees from revenue (small on Zcash). Nothing here is a profitability claim.
 */

/** The chain-side terms, read by the API from the node at one height. */
export interface MiningTerms {
  /** The tip the terms were read at. Rendered, so staleness is visible. */
  height: number;
  /** The tip's difficulty, byte-identical to the node's `getblockheader` float. */
  difficulty: number;
  /**
   * Network solution rate. `node` is `getnetworksolps`, the node's trailing 120-block
   * measurement; `estimated` is `SOLUTIONS_PER_DIFFICULTY × difficulty / interval`, the
   * fallback if the RPC does not answer. The two agree to within ~3%.
   */
  networkSolps: { value: number; basis: "node" | "estimated" };
  /** The miner's share of the block subsidy, from `getblocksubsidy`, in zatoshis. */
  minerSubsidyZat: number;
  /** The height at which that subsidy next changes — the halving, today. */
  subsidyChangesAtHeight: number;
  /** Mean seconds per block over recent chain, or the 75 s target when unmeasured. */
  blockIntervalSeconds: number;
  /** The tracked ZEC/USD price, or null when the tracker is cold. Never a substitute. */
  priceUsd: number | null;
  asOf: number;
}

export type TariffBand = "household" | "business";

/** One country's tariffs as the committed dataset carries them. */
export interface ElectricityTariff {
  iso2: string;
  iso3: string;
  name: string;
  householdUsdKwh: number | null;
  businessUsdKwh: number | null;
}

export interface ElectricityTariffs {
  source: string;
  sourceUrls: string[];
  licence: string;
  bands: Record<TariffBand, string>;
  /** The venue's own label for the period, e.g. "Q2 2026". */
  quarter: string;
  /** The UTC day the map pages were read by the refresh script. */
  readOn: string;
  rows: ElectricityTariff[];
}

/** One arm of the tariff check: GPP against an official series, percent of the official figure. */
export interface TariffDeviation {
  countries: number;
  /** Median of the ABSOLUTE deviations — "how far off", with opposite signs not cancelling. */
  medianPct: number;
  p90Pct: number;
  maxPct: number;
  /** Median of the signed deviations: GPP above the office is positive. */
  signedMedianPct: number;
}

/**
 * The record `scripts/validate-electricity-tariffs.mjs --write` leaves behind: the committed
 * GPP rows held against Eurostat (Europe, both bands) and the EIA (U.S.). Written by the
 * script only; `checkedOn` is the day the offices were read. The page quotes the Eurostat
 * medians; the single-country U.S. figures are kept for the record.
 */
export interface TariffValidation {
  checkedOn: string;
  gppQuarter: string;
  eurostat: {
    /** Eurostat's bi-annual period, e.g. "2025-S2" — never the same instant as GPP's quarter. */
    period: string;
    usdPerEur: number;
    business: TariffDeviation;
    household: TariffDeviation;
  };
  eia: {
    months: string[];
    business: {
      gppUsdKwh: number;
      commercialUsdKwh: number;
      pct: number;
      industrialUsdKwh: number;
      industrialPct: number;
    };
    household: { gppUsdKwh: number; residentialUsdKwh: number; pct: number };
  };
}

export function tariffFor(row: ElectricityTariff, band: TariffBand): number | null {
  return band === "business" ? row.businessUsdKwh : row.householdUsdKwh;
}

/**
 * Kilowatt-hours of electricity per ZEC mined in expectation, for one machine at the
 * network's current rate.
 *
 * Null rather than `Infinity` when a term is degenerate (a zero subsidy or a zero network).
 */
export function kwhPerZec(terms: MiningTerms, hardware: MiningHardware): number | null {
  const solps = terms.networkSolps.value;
  const subsidyZec = terms.minerSubsidyZat / ZATS_PER_ZEC;
  if (!(solps > 0) || !(subsidyZec > 0) || !(terms.blockIntervalSeconds > 0)) return null;
  // Network watts = solutions per second × joules per solution.
  const networkWatts = solps * (joulesPerKsol(hardware) / 1000);
  const joulesPerBlock = networkWatts * terms.blockIntervalSeconds;
  return joulesPerBlock / 3_600_000 / subsidyZec;
}

/** Electricity cost of one ZEC at a tariff, in USD. */
export function electricityCostUsd(tariffUsdPerKwh: number, kwhPerZecValue: number): number {
  return tariffUsdPerKwh * kwhPerZecValue;
}

/**
 * The tariff at which one ZEC of electricity costs exactly one ZEC — above it a machine
 * loses money on power alone. Null with no price: a break-even needs both sides.
 */
export function breakEvenTariffUsdPerKwh(
  priceUsd: number | null,
  kwhPerZecValue: number | null,
): number | null {
  if (priceUsd === null || kwhPerZecValue === null || !(kwhPerZecValue > 0)) return null;
  return priceUsd / kwhPerZecValue;
}

/**
 * Margin after electricity, as a share of the ZEC price, carried with its numerator and
 * denominator. Negative when the tariff is above break-even.
 */
export function electricityMargin(
  priceUsd: number,
  costUsd: number,
): { pct: number; numerator: number; denominator: number } {
  return {
    pct: ((priceUsd - costUsd) / priceUsd) * 100,
    numerator: priceUsd - costUsd,
    denominator: priceUsd,
  };
}

/** What one machine earns and burns in a day, for the reader's own tariff. */
export function machinePerDay(
  terms: MiningTerms,
  hardware: MiningHardware,
): { zec: number; kwh: number; shareOfNetwork: number } | null {
  const solps = terms.networkSolps.value;
  if (!(solps > 0) || !(terms.blockIntervalSeconds > 0)) return null;
  const share = (hardware.kSolPerSecond * 1000) / solps;
  const blocksPerDay = DAY_SECONDS / terms.blockIntervalSeconds;
  return {
    zec: share * blocksPerDay * (terms.minerSubsidyZat / ZATS_PER_ZEC),
    kwh: (hardware.wallWatts / 1000) * 24,
    shareOfNetwork: share,
  };
}

/**
 * The map's five cost tiers, in USD per ZEC. Fixed rather than quantile-based so the same
 * colour means the same cost across months, and so the legend can print the edges.
 */
export const COST_TIER_EDGES_USD = [75, 150, 250, 400] as const;

export function costTier(costUsd: number): 1 | 2 | 3 | 4 | 5 {
  if (costUsd < COST_TIER_EDGES_USD[0]) return 1;
  if (costUsd < COST_TIER_EDGES_USD[1]) return 2;
  if (costUsd < COST_TIER_EDGES_USD[2]) return 3;
  if (costUsd < COST_TIER_EDGES_USD[3]) return 4;
  return 5;
}

export interface CountryCost {
  iso3: string;
  name: string;
  tariffUsdPerKwh: number;
  costUsd: number;
}

/** Every country with a tariff in the band, cheapest first. */
export function rankCountryCosts(
  tariffs: ElectricityTariffs,
  band: TariffBand,
  kwhPerZecValue: number,
): CountryCost[] {
  const out: CountryCost[] = [];
  for (const row of tariffs.rows) {
    const t = tariffFor(row, band);
    if (t === null) continue;
    out.push({
      iso3: row.iso3,
      name: row.name,
      tariffUsdPerKwh: t,
      costUsd: electricityCostUsd(t, kwhPerZecValue),
    });
  }
  return out.sort((a, b) => a.costUsd - b.costUsd || a.iso3.localeCompare(b.iso3));
}

/**
 * The estimate the API falls back to when the node does not answer `getnetworksolps` —
 * exported so the route and the domain share one arithmetic.
 */
export function estimatedNetworkSolps(difficulty: number, intervalSeconds: number): number | null {
  return estimateSolutionsPerSecond(difficulty, intervalSeconds);
}

import type { PriceSeries, Stats, StatsRange } from "@/domain";
import { pools } from "./pools";
import { TIP_HEIGHT, TIP_TIME } from "./ids";

/**
 * The `/stats` page against fixtures. The pool list is the shared one, so the shielded total
 * here matches `/shielded`.
 */

const CIRCULATING_ZAT = 1_680_641_200_000_000;
const SPOT_USD = 836.83;

export const stats: Stats = {
  priceUsd: SPOT_USD,
  changeTodayPct: 4.74,
  shielded: {
    pools: [...pools].sort((a, b) => b.balanceZat - a.balanceZat),
    totalShieldedZat: pools.reduce((sum, p) => sum + p.balanceZat, 0),
    circulatingSupplyZat: CIRCULATING_ZAT,
    netShieldedTodayZat: 1_820_400_000_000,
  },
  height: TIP_HEIGHT,
  asOf: TIP_TIME,
};

/**
 * A deterministic walk per range — seeded, so the fixture renders the same chart on every
 * build and a diff of a screenshot means something.
 */
function walk(
  count: number,
  endUsd: number,
  stepSeconds: number,
  volatility: number,
  seed: number,
) {
  let state = seed;
  const random = () =>
    (state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296) / 4_294_967_296;
  const points = [];
  let usd = endUsd * 0.82;
  for (let i = 0; i < count; i++) {
    usd += (endUsd - usd) / (count - i) + (random() - 0.5) * volatility;
    points.push({ t: TIP_TIME - (count - 1 - i) * stepSeconds, usd: Math.max(usd, 1) });
  }
  // The last point is the spot price: on the live page the newest candle and the headline
  // come from one venue and agree.
  points[points.length - 1] = { t: TIP_TIME, usd: SPOT_USD };
  return points;
}

/**
 * Every range is present, including `all`. A window the venue cannot answer renders as
 * unavailable on the live page; that path is covered by unit tests rather than a permanently
 * broken chart in preview builds.
 */
export const priceSeries: Partial<Record<StatsRange, PriceSeries>> = {
  "24h": { range: "24h", points: walk(288, SPOT_USD, 300, 3.2, 11) },
  "7d": { range: "7d", points: walk(672, SPOT_USD, 900, 4.1, 23) },
  "30d": { range: "30d", points: walk(720, SPOT_USD, 3_600, 6.5, 37) },
  "1y": { range: "1y", points: walk(365, SPOT_USD, 86_400, 22, 53) },
  all: { range: "all", points: walk(520, SPOT_USD, 7 * 86_400, 34, 71) },
};

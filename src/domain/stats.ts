import type { ShieldedPool } from "./pool";

/**
 * The stats page: one number per screen, in two faces — price and shielded supply — each on
 * its own prerendered route so either can be linked and given its own card. The range is
 * client state (a viewport over a series the page already carries); the face gets a URL.
 */

/**
 * Every window either face may offer, shortest first — the union, not the intersection.
 *
 * A face publishes only the windows its source can answer, and `StatsChart` renders a chip
 * only for windows it was given. The price face has intraday ranges (the venue serves
 * intraday candles); the shielded face cuts one daily series, so it has no 24h or 7d.
 *
 * Price ranges are bounded by the venue's 721-candle cap, so each picks the coarsest interval
 * that still covers it: 24h → 5-minute (1-minute reaches only 12 hours), 7d → 15-minute,
 * 30d → hourly, longer → daily.
 */
export const STATS_RANGES = ["24h", "7d", "30d", "60d", "180d", "1y", "all"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

/** The window a reader lands on: long enough to have a shape, short enough to feel current. */
export const DEFAULT_STATS_RANGE: StatsRange = "7d";

export interface PricePoint {
  /** Unix seconds at the close of the candle. */
  t: number;
  usd: number;
}

export interface PriceSeries {
  range: StatsRange;
  points: PricePoint[];
}

export interface ShieldedStats {
  /** Every shielded pool, largest first. The four together are `totalShieldedZat`. */
  pools: ShieldedPool[];
  totalShieldedZat: number;
  /** The denominator of the headline share; it always travels with the total. */
  circulatingSupplyZat: number;
  /**
   * Change in the shielded total since the last stored daily close, in zatoshis — "today",
   * the same window as the price change. Null when there is no close to measure from; never
   * zero, which would claim nothing crossed the boundary.
   */
  netShieldedTodayZat: number | null;
}

export interface Stats {
  /**
   * Null is normal on a freshly restarted API. Render it as "unavailable" — never the Veil
   * (which means encrypted on-chain) and never a substituted value.
   */
  priceUsd: number | null;
  /**
   * Change since the venue's UTC open, as a percentage. Not a rolling 24 hours: the ticker
   * publishes today's open and no 24-hours-ago price, so never label it "24h".
   */
  changeTodayPct: number | null;
  shielded: ShieldedStats;
  /** The height the shielded figures were read at — what makes a screenshot checkable. */
  height: number;
  /** Unix seconds the price was read at. */
  asOf: number;
}

/**
 * Each pool's share of the shielded total — a different denominator from the headline share
 * of circulating supply, which is `shieldedShareOfCirculatingPct` in `pool.ts` and must not be
 * reimplemented here.
 */
export function poolShareOfShieldedPct(
  pool: ShieldedPool,
  totalShieldedZat: number,
): number | null {
  if (!Number.isFinite(totalShieldedZat) || totalShieldedZat <= 0) return null;
  return (pool.balanceZat / totalShieldedZat) * 100;
}

import type {
  BlocksDayPoint,
  ChainMonthPoint,
  FeeTotalPoint,
  FeeTotalSeries,
  NetworkDayPoint,
  PoolUsageDayPoint,
  ShieldedSupplyPoint,
  ShieldingFlowPoint,
  SupplyDayPoint,
  TransparentDayPoint,
} from "@/domain";
import { DAY_SECONDS } from "@/domain";
import {
  BLOCKS_DAILY_PATH,
  SUPPLY_DAYS_PATH,
  TRANSPARENT_DAYS_PATH,
} from "../../chart-series-routes";

/**
 * The series behind `make_chart`, as the private routes serve them, over the fixture clock
 * (2026-08-03). Synthetic and deterministic, shaped to exercise every rule the chart tool keeps:
 *
 *  - Ironwood holds nothing before 2026-07-28 (leading zeros are absence, not a measured zero) and
 *    Orchard drains into it afterwards, the shape the owner's example asks about.
 *  - Sapling's close is unread on one day, difficulty on another, active addresses on a third: a
 *    gap stays a gap.
 *  - The routes that serve today do so here too (`/days`, `/pool-usage`, `/network-daily`,
 *    `/supply`, the daily fee totals), so a tool that read a day still filling would be caught.
 *  - One day's fee total rests on fewer blocks than were mined: a floor.
 *  - `/days` and the daily fee totals reach back 366 days only, as in production.
 */

const FIRST_DAY = Date.UTC(2024, 0, 1) / 1000;
/** The fixture clock's day, 2026-08-03. */
const TODAY = Date.UTC(2026, 7, 3) / 1000;
/** Ironwood's activation day on mainnet, 2026-07-28. */
export const IRONWOOD_DAY = Date.UTC(2026, 6, 28) / 1000;
const ZEC = 100_000_000;

const daysFrom = (first: number, last: number): number[] => {
  const out: number[] = [];
  for (let t = first; t <= last; t += DAY_SECONDS) out.push(t);
  return out;
};

const monthsFrom = (year: number, month: number, lastYear: number, lastMonth: number) => {
  const out: number[] = [];
  for (let y = year, m = month; y < lastYear || (y === lastYear && m <= lastMonth);) {
    out.push(Date.UTC(y, m, 1) / 1000);
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  return out;
};

const index = (t: number) => Math.round((t - FIRST_DAY) / DAY_SECONDS);
const sinceIronwood = (t: number) => Math.round((t - IRONWOOD_DAY) / DAY_SECONDS);

/** Days with a reading that was not taken, one per series that can carry a null. */
export const UNREAD_SAPLING_DAY = Date.UTC(2026, 5, 15) / 1000;
export const UNREAD_DIFFICULTY_DAY = Date.UTC(2026, 6, 10) / 1000;
export const UNREAD_ACTIVE_DAY = Date.UTC(2026, 6, 20) / 1000;
/** The one day whose fee total is a floor. */
export const PARTIAL_FEE_DAY = Date.UTC(2026, 6, 21) / 1000;

const ALL_DAYS_WITH_TODAY = daysFrom(FIRST_DAY, TODAY);
const ALL_COMPLETE_DAYS = daysFrom(FIRST_DAY, TODAY - DAY_SECONDS);
const TRAILING_DAYS_WITH_TODAY = daysFrom(TODAY - 366 * DAY_SECONDS, TODAY);
const MONTHS = monthsFrom(2024, 0, 2026, 7);

function poolCloses(t: number) {
  const k = sinceIronwood(t);
  const ironwood = k < 0 ? 0 : (k + 1) * 300_000 * ZEC;
  const orchardBefore = 3_000_000 * ZEC + index(t) * 500 * ZEC;
  const orchard = k < 0 ? orchardBefore : orchardBefore - (k + 1) * 300_000 * ZEC;
  return {
    sprout: 25_000 * ZEC - index(t) * ZEC,
    sapling: 5_000_000 * ZEC - index(t) * 1_000 * ZEC,
    orchard,
    ironwood,
  };
}

export const SUPPLY_DAYS: SupplyDayPoint[] = ALL_COMPLETE_DAYS.map((t) => {
  const c = poolCloses(t);
  return {
    timestamp: t,
    transparentZat: 12_000_000 * ZEC,
    sproutZat: c.sprout,
    saplingZat: t === UNREAD_SAPLING_DAY ? null : c.sapling,
    orchardZat: c.orchard,
    ironwoodZat: c.ironwood,
    lockboxZat: 800_000 * ZEC,
  };
});

export const SHIELDED_SUPPLY: ShieldedSupplyPoint[] = ALL_DAYS_WITH_TODAY.map((t) => {
  const c = poolCloses(t);
  return {
    timestamp: t,
    height: 2_400_000 + index(t) * 1_152,
    totalZat: c.sprout + c.sapling + c.orchard + c.ironwood,
  };
});

export const MONTH_SERIES: ChainMonthPoint[] = MONTHS.map((t, m) => {
  const c = poolCloses(t);
  return {
    timestamp: t,
    topHeight: 2_400_000 + m * 35_000,
    transparentTxs: 100_000 + m * 1_000,
    mixedTxs: 20_000 + m * 100,
    shieldedTxs: 5_000 + m * 50,
    sproutZat: c.sprout,
    saplingZat: c.sapling,
    orchardZat: c.orchard,
    ironwoodZat: c.ironwood,
  };
});

export const DAY_SERIES: ChainMonthPoint[] = TRAILING_DAYS_WITH_TODAY.map((t) => {
  const i = index(t);
  const c = poolCloses(t);
  return {
    timestamp: t,
    topHeight: 2_400_000 + i * 1_152,
    transparentTxs: 3_000 + (i % 7) * 10,
    mixedTxs: 600 + (i % 5),
    shieldedTxs: 150 + (i % 3),
    sproutZat: c.sprout,
    saplingZat: c.sapling,
    orchardZat: c.orchard,
    ironwoodZat: c.ironwood,
  };
});

export const FLOW_MONTHS: ShieldingFlowPoint[] = MONTHS.map((t, m) => ({
  timestamp: t,
  shieldedZat: (10_000 + m * 100) * ZEC,
  unshieldedZat: (9_000 + m * 120) * ZEC,
}));

const feePoint = (t: number, feeZat: number, blocks: number): FeeTotalPoint => ({
  timestamp: t,
  feeZat,
  blocks,
  blocksCovered: t === PARTIAL_FEE_DAY ? blocks - 3 : blocks,
});

export const FEE_TOTALS: FeeTotalSeries = {
  monthly: MONTHS.map((t, m) => feePoint(t, 30 * ZEC + m * 1_000_000, 35_000)),
  daily: TRAILING_DAYS_WITH_TODAY.map((t) => feePoint(t, ZEC + index(t) * 100, 1_152)),
};

export const POOL_USAGE: PoolUsageDayPoint[] = ALL_DAYS_WITH_TODAY.map((t) => {
  const i = index(t);
  const k = sinceIronwood(t);
  return {
    timestamp: t,
    sproutTxs: i % 2,
    saplingTxs: 2_000 + (i % 13) * 10,
    orchardTxs: 1_500 + (i % 11) * 10,
    ironwoodTxs: k < 0 ? 0 : 400 + k * 50,
  };
});

export const BLOCKS_DAILY: BlocksDayPoint[] = ALL_COMPLETE_DAYS.map((t) => ({
  timestamp: t,
  blocks: 1_150 + (index(t) % 5),
  topHeight: 2_400_000 + (index(t) + 1) * 1_152,
}));

export const TRANSPARENT_DAYS: TransparentDayPoint[] = ALL_COMPLETE_DAYS.map((t) => ({
  timestamp: t,
  activeAddresses: t === UNREAD_ACTIVE_DAY ? null : 20_000 + (index(t) % 11) * 100,
}));

export const NETWORK_DAILY: NetworkDayPoint[] = ALL_DAYS_WITH_TODAY.map((t) => ({
  timestamp: t,
  avgDifficulty: t === UNREAD_DIFFICULTY_DAY ? null : 60_000_000 + index(t) * 1_000,
  avgBlockBytes: 4_000 + (index(t) % 9) * 100,
}));

/**
 * Path → payload for every chart source the fixture world serves itself. `/shielding-flow-days`
 * and `/v1/prices/daily` are already served (the insight topic and the price route), from their
 * own fixtures.
 */
export const CHART_SOURCE_PAYLOADS: Readonly<Record<string, unknown>> = {
  [SUPPLY_DAYS_PATH]: SUPPLY_DAYS,
  "/chain/analytics/supply": SHIELDED_SUPPLY,
  "/chain/analytics/months": MONTH_SERIES,
  "/chain/analytics/days": DAY_SERIES,
  "/chain/analytics/shielding-flow": FLOW_MONTHS,
  "/chain/analytics/fee-totals": FEE_TOTALS,
  "/chain/analytics/pool-usage": POOL_USAGE,
  [BLOCKS_DAILY_PATH]: BLOCKS_DAILY,
  [TRANSPARENT_DAYS_PATH]: TRANSPARENT_DAYS,
  "/chain/analytics/network-daily": NETWORK_DAILY,
};

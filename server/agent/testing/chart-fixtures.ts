import type {
  BlocksDayPoint,
  ChainInflowPoint,
  ChainMonthPoint,
  ChainOutflowPoint,
  FeeKindMonthPoint,
  FeeTotalPoint,
  FeeTotalSeries,
  MinerShareMonth,
  NetworkDayPoint,
  NoteTreeDayPoint,
  PoolMigrationDayPoint,
  PoolUsageDayPoint,
  ShieldingFlowPoint,
  SupplyDayPoint,
  TransparentDayPoint,
  VenueMonthPoint,
} from "@/domain";
import { DAY_SECONDS } from "@/domain";
import {
  BLOCKS_DAILY_PATH,
  MINER_SHARES_PATH,
  NOTE_TREES_PATH,
  SUPPLY_DAYS_PATH,
  TRANSPARENT_DAYS_PATH,
} from "../../chart-series-routes";
import {
  INFLOW_BY_CHAIN_PATH,
  OUTFLOW_BY_CHAIN_PATH,
  VENUE_MONTHS_PATH,
} from "../../crosschain-routes";

/**
 * The series behind `make_chart`, as the private routes serve them, over the fixture clock
 * (2026-08-03). Synthetic and deterministic, shaped to exercise every rule the chart tool keeps:
 *
 *  - Ironwood holds nothing before 2026-07-28 (leading zeros are absence, not a measured zero) and
 *    Orchard drains into it afterwards, the shape the owner's example asks about.
 *  - Sapling's close is unread on one day, difficulty on another, active addresses on a third: a
 *    gap stays a gap.
 *  - The routes that serve today do so here too (`/days`, `/pool-usage`, `/network-daily`,
 *    `/pool-migrations`, the daily fee totals), so a tool that read a day still filling would be caught.
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

/** ZEC migrated into each pool per day: into Ironwood from its activation, a trickle into Sapling. */
export const POOL_MIGRATIONS: PoolMigrationDayPoint[] = ALL_DAYS_WITH_TODAY.map((t) => {
  const k = sinceIronwood(t);
  return {
    timestamp: t,
    toSproutZat: 0,
    toSaplingZat: (index(t) % 4) * 10 * ZEC,
    toOrchardZat: 50 * ZEC + (index(t) % 6) * ZEC,
    toIronwoodZat: k < 0 ? 0 : 280_000 * ZEC + k * 1_000 * ZEC,
  };
});

/** Each pool's note tree at the day's close; Ironwood null before it existed. */
export const NOTE_TREES: NoteTreeDayPoint[] = ALL_COMPLETE_DAYS.map((t) => {
  const k = sinceIronwood(t);
  return {
    timestamp: t,
    saplingNotes: 70_000_000 + index(t) * 300,
    orchardNotes: 40_000_000 + index(t) * 900,
    ironwoodNotes: k < 0 ? null : 1_000 + k * 4_000,
  };
});

/** The median fee per kind per day, the trailing year. */
export const FEE_KIND_DAYS: FeeKindMonthPoint[] = TRAILING_DAYS_WITH_TODAY.map((t) => ({
  timestamp: t,
  transparentZat: 15_000 + (index(t) % 3) * 1_000,
  mixedZat: 10_000 + (index(t) % 4) * 500,
  shieldedZat: 5_000 + (index(t) % 2) * 100,
}));

/** The largest miners' blocks per month; the last month, still running, is part-computed. */
export const MINER_SHARES: MinerShareMonth[] = MONTHS.map((t, m) => {
  const last = m === MONTHS.length - 1;
  const days = last ? 2 : new Date(Date.UTC(2024, m + 1, 0)).getUTCDate();
  const blocks = days * 1_152;
  return {
    timestamp: t,
    blocks,
    days,
    top1Blocks: Math.round(blocks * (0.3 + (m % 5) / 100)),
    top3Blocks: Math.round(blocks * (0.6 + (m % 4) / 100)),
    top10Blocks: Math.round(blocks * 0.9),
    shieldedBlocks: Math.round(blocks * 0.02),
  };
});

/**
 * Cross-chain ZEC per month and counterpart chain, from March 2025. Months without a chain's row
 * are its quiet months (the route lists only months with swaps); Solana has none before 2025-09.
 */
const CROSSCHAIN_MONTHS = monthsFrom(2025, 2, 2026, 7);
export const INFLOW_BY_CHAIN: ChainInflowPoint[] = CROSSCHAIN_MONTHS.flatMap((t, m) => [
  { timestamp: t, chain: "BTC", inZat: (2_000 + m * 150) * ZEC },
  { timestamp: t, chain: "ETH", inZat: (3_000 + (m % 4) * 400) * ZEC },
  ...(m >= 6 ? [{ timestamp: t, chain: "SOL", inZat: (800 + m * 40) * ZEC }] : []),
]);
export const OUTFLOW_BY_CHAIN: ChainOutflowPoint[] = CROSSCHAIN_MONTHS.flatMap((t, m) => [
  { timestamp: t, chain: "BTC", outZat: (1_500 + m * 100) * ZEC },
  ...(m % 3 === 0 ? [] : [{ timestamp: t, chain: "ETH", outZat: (2_500 + m * 50) * ZEC }]),
]);
export const VENUE_MONTHS: VenueMonthPoint[] = CROSSCHAIN_MONTHS.flatMap((t, m) => [
  {
    timestamp: t,
    protocol: "near-intents",
    inZat: (4_000 + m * 200) * ZEC,
    outZat: (3_000 + m * 90) * ZEC,
  },
  {
    timestamp: t,
    protocol: "thorchain",
    inZat: (900 + m * 10) * ZEC,
    outZat: (700 + m * 20) * ZEC,
  },
  { timestamp: t, protocol: "maya", inZat: (300 + m * 5) * ZEC, outZat: (250 + m * 5) * ZEC },
]);

/**
 * Path → payload for every chart source the fixture world serves itself. `/shielding-flow-days`,
 * `/crosschain/volume-series` and `/v1/prices/daily` are already served (the insight topics and the
 * price route), from their own fixtures.
 */
export const CHART_SOURCE_PAYLOADS: Readonly<Record<string, unknown>> = {
  "/chain/analytics/pool-migrations": POOL_MIGRATIONS,
  [NOTE_TREES_PATH]: NOTE_TREES,
  "/chain/analytics/fee-kinds-days": FEE_KIND_DAYS,
  [MINER_SHARES_PATH]: MINER_SHARES,
  [INFLOW_BY_CHAIN_PATH]: INFLOW_BY_CHAIN,
  [OUTFLOW_BY_CHAIN_PATH]: OUTFLOW_BY_CHAIN,
  [VENUE_MONTHS_PATH]: VENUE_MONTHS,
  [SUPPLY_DAYS_PATH]: SUPPLY_DAYS,
  "/chain/analytics/months": MONTH_SERIES,
  "/chain/analytics/days": DAY_SERIES,
  "/chain/analytics/shielding-flow": FLOW_MONTHS,
  "/chain/analytics/fee-totals": FEE_TOTALS,
  "/chain/analytics/pool-usage": POOL_USAGE,
  [BLOCKS_DAILY_PATH]: BLOCKS_DAILY,
  [TRANSPARENT_DAYS_PATH]: TRANSPARENT_DAYS,
  "/chain/analytics/network-daily": NETWORK_DAILY,
};

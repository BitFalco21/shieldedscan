import {
  MINING_POOL_LABELS,
  SHIELDED_GROUP,
  UNATTRIBUTED_GROUP,
  minersWindowDays,
  utcDayOf,
  type MinerAddressRow,
  type MinerSeries,
  type MinerSeriesPoint,
  type MinerTotals,
  type MinersOverview,
  type MinersWindowKey,
  type MiningPoolBlock,
} from "@/domain";
import { DAY_SECONDS } from "@/domain/time";
import { blocks } from "./blocks";
import { ADDR_MINER_C, TIP_HEIGHT, TIP_TIME } from "./ids";

/**
 * The fixture chain's miners: shares shaped like a real month (one dominant pool on two addresses,
 * a long tail, a shielded share), scaled to the window asked for. Pool addresses are the reviewed
 * ones, so grouping is exercised as on the real chain; the unattributed tail uses the fixture's
 * solo address and two invented ones.
 */

const BLOCKS_PER_DAY = 3_456;
/** 0.41666668 ZEC plus a typical miner's share of fees. */
const REWARD_PER_BLOCK = 41_706_668;
const FEE_PER_BLOCK = 40_000;
const CLOSE_USD = 560;

const SHARES: readonly [address: string, share: number][] = [
  ["t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7", 0.262],
  ["t1SqwRAAdSig6dE4EBPLonAait219VmkUjP", 0.166],
  ["t1PEp2GJLSdhDfCKqc2J211WKDUS1NfoQNy", 0.154],
  ["t1TVdjqU1APVQmCRRnzbqfjz6wR2qtBnnoc", 0.131],
  ["t1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv", 0.066],
  ["t1VTjv7XF3hYqxQkxKmHHErvus3bDrbbkGg", 0.055],
  ["t1L2b66MXbgpVMXDfUa94GCBFAN4dCxGohM", 0.055],
  ["t1Y2tYgDJnH4m1uQPDXxvXQSh1Jbun3AP22", 0.016],
  ["t1e6hceYHkzCbwcwGZzKeMfXXW7x7gr19Cw", 0.009],
  ["t1eBv4a3wBhVaFgWYjXrFYTU7pruCWaBpLW", 0.003],
  ["t1cQA9Rxn31tqHcgZzydrpDjgsQGmjpBgpB", 0.003],
  [ADDR_MINER_C, 0.013],
  ["t1fpcZ2Dbwn4oj35oWBTUhtmUciSq7HG7LU", 0.008],
  ["t1Na7ykQ6vE4CbxBPuUDUQx5n6aEWXu1VQq", 0.004],
];
const SHIELDED_SHARE = 0.055;

const WINDOW_DAYS: Record<MinersWindowKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  all: 365,
};

function row(address: string, blocks: number, days: number, i: number): MinerAddressRow {
  const reward = blocks * REWARD_PER_BLOCK;
  // Today is half a day: its share of the window's reward is valued at the live price.
  const todayZat = Math.round(reward * (0.5 / (days - 0.5)));
  return {
    address,
    miningPool: MINING_POOL_LABELS[address]?.miningPool ?? null,
    blocks,
    rewardZat: reward,
    feeZat: blocks * FEE_PER_BLOCK,
    firstHeight: TIP_HEIGHT - Math.round((days - 0.5) * BLOCKS_PER_DAY) + i,
    lastHeight: TIP_HEIGHT - i,
    usd: { closedUsd: ((reward - todayZat) / 1e8) * CLOSE_USD, unpricedZat: 0, todayZat },
  };
}

function totals(rows: readonly MinerAddressRow[]): MinerTotals {
  return {
    blocks: rows.reduce((s, r) => s + r.blocks, 0),
    addresses: rows.length,
    rewardZat: rows.reduce((s, r) => s + r.rewardZat!, 0),
    feeZat: rows.reduce((s, r) => s + r.feeZat!, 0),
    usd: {
      closedUsd: rows.reduce((s, r) => s + r.usd.closedUsd, 0),
      unpricedZat: 0,
      todayZat: rows.reduce((s, r) => s + r.usd.todayZat, 0),
    },
  };
}

export function getMinersOverview(window: MinersWindowKey): MinersOverview {
  const days = WINDOW_DAYS[window];
  const all = Math.round((days - 0.5) * BLOCKS_PER_DAY);
  const rows = SHARES.map(([address, share], i) => row(address, Math.round(all * share), days, i));
  rows.sort((a, b) => b.blocks - a.blocks);
  const labelled = rows.filter((r) => r.miningPool !== null);
  const unattributed = rows.filter((r) => r.miningPool === null);
  const shieldedBlocks = Math.round(all * SHIELDED_SHARE);
  const transparent = totals(rows);
  const top = (k: number) => rows.slice(0, k).reduce((s, r) => s + r.blocks, 0);
  return {
    window,
    ...minersWindowDays(window, TIP_TIME),
    fromHeight: TIP_HEIGHT - all + 1,
    toHeight: TIP_HEIGHT,
    daysComputed: days,
    daysExpected: days,
    blocks: transparent.blocks + shieldedBlocks,
    unrecordedBlocks: 0,
    shieldedBlocks,
    noAddressBlocks: 0,
    transparent,
    unattributed: { ...totals(unattributed), largest: unattributed },
    labelled,
    topBlocks: { top1: top(1), top3: top(3), top10: top(10) },
    registry: Object.keys(MINING_POOL_LABELS).sort(),
  };
}

const POOL_GROUPS = [
  ["viabtc", 0.33],
  ["foundry", 0.17],
  ["f2pool", 0.15],
  ["luxor", 0.13],
  ["2miners", 0.055],
  ["antpool", 0.055],
  ["kupool", 0.016],
  ["kryptex", 0.009],
  ["nicehash", 0.003],
  ["mining-dutch", 0.003],
  [UNATTRIBUTED_GROUP, 0.024],
  [SHIELDED_GROUP, 0.055],
] as const;

/**
 * A group's share of a period. The oldest month is mostly unattributed (more than half its blocks
 * on addresses no label names), as Zcash's early years are: the month no count of reviewed pools
 * reaches a majority in, which the pools-to-51% chart must state rather than draw. The second
 * month has one pool past half the blocks, as ViaBTC was through 2025, so the chart's single-pool
 * bar is drawn somewhere.
 */
function mixOf(interval: "month" | "day", k: number, group: string, share: number): number {
  if (interval !== "month" || group === SHIELDED_GROUP) return share;
  if (k === 0) return group === UNATTRIBUTED_GROUP ? 0.53 : share * 0.45;
  if (k === 1) return group === "viabtc" ? 0.62 : share * 0.5;
  return share;
}

/** Twelve months, or the trailing 90 days, with shares drifting a little period to period. */
export function getMinerSeries(interval: "month" | "day"): MinerSeries {
  const today = Math.floor(TIP_TIME / DAY_SECONDS) * DAY_SECONDS;
  const count = interval === "month" ? 12 : 90;
  const periods = Array.from({ length: count }, (_, k) => {
    const i = count - 1 - k;
    const start =
      interval === "month"
        ? `${new Date(Date.UTC(2026, 6 - i, 1)).toISOString().slice(0, 10)}`
        : utcDayOf(today - i * DAY_SECONDS);
    const blocks = interval === "month" ? 30 * 1_150 : BLOCKS_PER_DAY;
    const scale = i === 0 ? 0.5 : 1;
    return {
      period: start,
      blocks: Math.round(blocks * scale),
      firstHeight: TIP_HEIGHT - (i + 1) * blocks,
      lastHeight: TIP_HEIGHT - i * blocks,
      partial: i === 0,
    };
  });
  const points: MinerSeriesPoint[] = periods.flatMap((p, k) =>
    POOL_GROUPS.map(([group, share], g) => {
      const drift = 1 + 0.15 * Math.sin(k / 2 + g);
      const blocks = Math.round(p.blocks * mixOf(interval, k, group, share) * drift);
      const priced = group !== SHIELDED_GROUP;
      return {
        period: p.period,
        group,
        blocks,
        rewardZat: priced ? blocks * REWARD_PER_BLOCK * (interval === "month" ? 3 : 1) : null,
        feeZat: blocks * FEE_PER_BLOCK,
      };
    }),
  );
  for (const p of periods) {
    p.blocks = points.filter((x) => x.period === p.period).reduce((s, x) => s + x.blocks, 0);
  }
  return {
    interval,
    fromDay: periods[0]!.period,
    toDay: utcDayOf(today),
    periods,
    points,
  };
}

export function getMiningPoolBlocks(id: string): MiningPoolBlock[] {
  const addresses = Object.keys(MINING_POOL_LABELS).filter(
    (a) => MINING_POOL_LABELS[a]!.miningPool === id,
  );
  if (addresses.length === 0) return [];
  // The fixture chain's own blocks, newest first, so every height links to a block page.
  return [...blocks]
    .reverse()
    .slice(0, 20)
    .map((b, i) => ({
      height: b.height,
      timestamp: b.timestamp,
      address: addresses[i % addresses.length]!,
      rewardZat: REWARD_PER_BLOCK + i * 1_000,
    }));
}

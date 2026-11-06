import { minerFeeShareZat } from "./consensus";
import { NU7_HEIGHT, nu6MinerSubsidyZat } from "./halving";
import { MINING_POOLS, type MiningPool, type MiningPoolId } from "./mining-pools";
import { DAY_SECONDS } from "./time";

/**
 * Who mined Zcash over a window of whole UTC days, and what their blocks paid them, grouped by
 * reviewed mining pool. Read from the daily payout rollup (`mining_day_payout`), never from blocks.
 *
 * A pool's figures add up its reviewed payout addresses (`MINING_POOL_LABELS`): right only if every
 * label is, and never inferred from a coinbase tag. An address with no reviewed label stays its
 * own row inside "unattributed", never merged with another. A shielded coinbase is counted and
 * never attributed: its amount is encrypted, so it has no ZEC and no USD here.
 *
 * "Paid to miners" is `reward_zat`: what the coinbase paid the miner's address, the subsidy share
 * plus the miner's part of the fees (all of them before NU7, 40% from it). Funding streams, the
 * lockbox and the NSM's share of fees are not in it.
 */

export const MINERS_WINDOWS = ["7d", "30d", "90d", "1y", "all"] as const;
export type MinersWindowKey = (typeof MINERS_WINDOWS)[number];

/**
 * The windows served. 1Y and ALL cover block 3,146,400 (2025-11-24), whose stored miner is the
 * NU6.1 lockbox disbursement multisig until its row is repaired; they open, in one line here,
 * once it is. Every server read is held to `MINERS_HISTORY_FROM_DAY` meanwhile.
 */
export const MINERS_OPEN_WINDOWS: readonly MinersWindowKey[] = ["7d", "30d", "90d"];

/**
 * The first day any miners figure may include, or null for all of history: the first day of the
 * first whole month after 2025-11-24. Set to null with the windows above.
 */
export const MINERS_HISTORY_FROM_DAY: string | null = "2025-12-01";

export const MINERS_DEFAULT_WINDOW: MinersWindowKey = "30d";

const WINDOW_DAYS: Record<MinersWindowKey, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  all: null,
};

/** An open window, or the default for anything else (an unknown or closed value is not an error). */
export function parseMinersWindow(raw: string | undefined | null): MinersWindowKey {
  return MINERS_OPEN_WINDOWS.find((w) => w === raw) ?? MINERS_DEFAULT_WINDOW;
}

/** `/mining`'s windows on `/miners`: its rolling 24h and 3d have no whole-day form, so 7d. */
export function minersWindowFromMining(raw: string | undefined): MinersWindowKey {
  if (raw === undefined || raw === "24h" || raw === "3d") return "7d";
  return parseMinersWindow(raw);
}

/** `YYYY-MM-DD` of a unix second, in UTC. */
export function utcDayOf(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * A window's days, `fromDay` and `toDay` inclusive: the last `n` UTC days, today (unfinished)
 * included, never before `MINERS_HISTORY_FROM_DAY`.
 */
export function minersWindowDays(
  key: MinersWindowKey,
  nowSec: number,
): { fromDay: string; toDay: string } {
  const today = Math.floor(nowSec / DAY_SECONDS) * DAY_SECONDS;
  const days = WINDOW_DAYS[key];
  const from = days === null ? "1970-01-01" : utcDayOf(today - (days - 1) * DAY_SECONDS);
  const floor = MINERS_HISTORY_FROM_DAY;
  return { fromDay: floor !== null && floor > from ? floor : from, toDay: utcDayOf(today) };
}

// ------------------------------------------------------------------------------------- USD

/**
 * A reward's USD value, in the parts it is valued from: each closed day's reward at that day's
 * stored close (summed server-side), and what cannot be valued that way. Today is decided by date,
 * never by a missing price row: the price feed stores an unfinished day's bar too.
 */
export interface MinerUsdParts {
  /** Σ reward × close over the window's closed days that have a stored close. */
  closedUsd: number;
  /** Reward on closed days with no stored close: left out of `closedUsd`, never priced at 0. */
  unpricedZat: number;
  /** Reward on today's unfinished UTC day, to be valued at the live price. */
  todayZat: number;
}

export interface MinerUsd {
  usd: number;
  /** Some reward had no close to value it at, so `usd` is a floor. */
  floor: boolean;
}

/**
 * Closed days at their own close, today at the live price. Null when the reward itself is not
 * known, or today has reward and there is no live price: a USD figure that silently left today out
 * would read as the whole window.
 */
export function minerValueUsd(
  rewardZat: number | null,
  parts: MinerUsdParts,
  livePriceUsd: number | null,
): MinerUsd | null {
  if (rewardZat === null) return null;
  if (parts.todayZat > 0 && livePriceUsd === null) return null;
  const today = parts.todayZat > 0 ? (parts.todayZat / 1e8) * livePriceUsd! : 0;
  return { usd: parts.closedUsd + today, floor: parts.unpricedZat > 0 };
}

// ------------------------------------------------------------------------- the overview

/** One payout address over the window. */
export interface MinerAddressRow {
  address: string;
  /** The reviewed pool the API's registry names it for, or null. A string, so skew degrades. */
  miningPool: string | null;
  blocks: number;
  /** Null unless every block carries the miner's reward. */
  rewardZat: number | null;
  /** The miner's fee share, included in `rewardZat`. Null unless every block's fees are known. */
  feeZat: number | null;
  firstHeight: number;
  lastHeight: number;
  usd: MinerUsdParts;
}

export interface MinerTotals {
  blocks: number;
  addresses: number;
  rewardZat: number | null;
  feeZat: number | null;
  usd: MinerUsdParts;
}

export interface MinersOverview {
  window: MinersWindowKey;
  fromDay: string;
  /** Today, unfinished. */
  toDay: string;
  fromHeight: number | null;
  toHeight: number | null;
  daysComputed: number;
  daysExpected: number;
  /** Every block in the window, unrecorded ones included: the denominator of every share. */
  blocks: number;
  unrecordedBlocks: number;
  shieldedBlocks: number;
  /** Paid to a bare public key (until 2018): no address to group by. */
  noAddressBlocks: number;
  /** Every transparent payout address together. */
  transparent: MinerTotals;
  /** Every address the registry does not label. */
  unattributed: MinerTotals & { largest: MinerAddressRow[] };
  /** Every labelled address with a block in the window. */
  labelled: MinerAddressRow[];
  /** Blocks of the largest one, three and ten single addresses. */
  topBlocks: { top1: number; top3: number; top10: number };
  /** The addresses the API grouped as labelled, sorted: the site checks it against its own. */
  registry: string[];
}

export interface MiningPoolGroup {
  pool: MiningPool;
  blocks: number;
  rewardZat: number | null;
  feeZat: number | null;
  usd: MinerUsdParts;
  /** Its addresses with a block in the window, largest first. */
  addresses: MinerAddressRow[];
}

export interface GroupedMiners {
  pools: MiningPoolGroup[];
  /** Labelled by the API under a pool id this site does not know: shown as plain addresses. */
  strays: MinerAddressRow[];
}

const sumOrNull = (values: (number | null)[]) =>
  values.some((v) => v === null) ? null : values.reduce<number>((s, v) => s + v!, 0);

const sumParts = (parts: MinerUsdParts[]): MinerUsdParts => ({
  closedUsd: parts.reduce((s, p) => s + p.closedUsd, 0),
  unpricedZat: parts.reduce((s, p) => s + p.unpricedZat, 0),
  todayZat: parts.reduce((s, p) => s + p.todayZat, 0),
});

const isMiningPoolId = (id: string): id is MiningPoolId => Object.hasOwn(MINING_POOLS, id);

/**
 * Labelled rows summed by pool, largest first. Only rows the API labelled enter a pool; a row
 * whose pool id this site does not know is returned apart, never folded into a pool or into
 * unattributed (whose sums the API computed without it).
 */
export function groupMinersByPool(rows: readonly MinerAddressRow[]): GroupedMiners {
  const byPool = new Map<MiningPoolId, MinerAddressRow[]>();
  const strays: MinerAddressRow[] = [];
  for (const row of rows) {
    if (row.miningPool !== null && isMiningPoolId(row.miningPool)) {
      byPool.set(row.miningPool, [...(byPool.get(row.miningPool) ?? []), row]);
    } else strays.push(row);
  }
  const pools = [...byPool].map(([id, addresses]) => ({
    pool: MINING_POOLS[id],
    blocks: addresses.reduce((s, a) => s + a.blocks, 0),
    rewardZat: sumOrNull(addresses.map((a) => a.rewardZat)),
    feeZat: sumOrNull(addresses.map((a) => a.feeZat)),
    usd: sumParts(addresses.map((a) => a.usd)),
    addresses: [...addresses].sort(
      (a, b) => b.blocks - a.blocks || (a.address < b.address ? -1 : 1),
    ),
  }));
  pools.sort((a, b) => b.blocks - a.blocks || a.pool.name.localeCompare(b.pool.name));
  return { pools, strays };
}

/** A share in percent of the window's blocks, or null when the window has none. */
export function blockSharePct(blocks: number, of: number): number | null {
  return of > 0 ? (100 * blocks) / of : null;
}

// ---------------------------------------------------------------------------- the series

/** A group in the series: a pool id, or one of these. */
export type MinerSeriesGroup = string;
export const UNATTRIBUTED_GROUP = "unattributed";
export const SHIELDED_GROUP = "shielded";
export const NO_ADDRESS_GROUP = "no-address";

export interface MinerSeriesPoint {
  /** The period's first day, `YYYY-MM-DD`. */
  period: string;
  group: MinerSeriesGroup;
  blocks: number;
  rewardZat: number | null;
  feeZat: number | null;
}

export interface MinerSeriesPeriod {
  period: string;
  /** Every block in the period, unrecorded ones included. */
  blocks: number;
  firstHeight: number | null;
  lastHeight: number | null;
  /** The period still running (it holds today). */
  partial: boolean;
}

export interface MinerSeries {
  interval: "month" | "day";
  fromDay: string;
  toDay: string;
  periods: MinerSeriesPeriod[];
  points: MinerSeriesPoint[];
}

/** Every group's blocks per period, as a share of the period's blocks (0 where it had none). */
export function seriesSharePct(series: MinerSeries, group: MinerSeriesGroup): number[] {
  return series.periods.map((p) => {
    const n = series.points.find((x) => x.period === p.period && x.group === group)?.blocks ?? 0;
    return blockSharePct(n, p.blocks) ?? 0;
  });
}

/**
 * What transparent payouts took per period: reward and fees summed over every group with an
 * address. Null for a period where any row's amount is not known; never a partial sum.
 */
export function seriesTransparent(
  series: MinerSeries,
): { period: string; rewardZat: number | null; feeZat: number | null; blocks: number }[] {
  return series.periods.map((p) => {
    const rows = series.points.filter(
      (x) => x.period === p.period && x.group !== SHIELDED_GROUP && x.group !== NO_ADDRESS_GROUP,
    );
    return {
      period: p.period,
      blocks: rows.reduce((s, r) => s + r.blocks, 0),
      rewardZat: rows.length === 0 ? null : sumOrNull(rows.map((r) => r.rewardZat)),
      feeZat: rows.length === 0 ? null : sumOrNull(rows.map((r) => r.feeZat)),
    };
  });
}

/** The index of the period holding NU7's first block, or null when the series does not. */
export function nu7PeriodIndex(series: MinerSeries): number | null {
  const i = series.periods.findIndex(
    (p) =>
      p.firstHeight !== null &&
      p.lastHeight !== null &&
      p.firstHeight <= NU7_HEIGHT &&
      p.lastHeight >= NU7_HEIGHT,
  );
  return i < 0 ? null : i;
}

// -------------------------------------------------------------------------- one pool

export interface MiningPoolBlock {
  height: number;
  timestamp: number;
  address: string;
  /** Null when the block's miner reward is not recorded. */
  rewardZat: number | null;
}

export interface MiningPoolBlocks {
  miningPool: string;
  /** Newest first. */
  blocks: MiningPoolBlock[];
}

// -------------------------------------------------------------------------- at the tip

/** The miner's percentage of a block's fees at `height` on mainnet (ZIP 235): 100, or 40 from NU7. */
export function minerFeeSharePct(height: number): number {
  return minerFeeShareZat("mainnet", height, 100);
}

/** The miner's subsidy per block just before NU7: what the tip strip says it "was". */
export const MINER_SUBSIDY_BEFORE_NU7_ZAT = nu6MinerSubsidyZat(NU7_HEIGHT - 1);

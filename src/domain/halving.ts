import { DAY_SECONDS } from "./time";

/**
 * Zcash's halving schedule.
 *
 * A height is exact and a date is an estimate; every function here keeps the two apart.
 *
 * Subsidy figures come from the node's `getblocksubsidy` and are never recomputed: the split
 * between miner, funding streams and lockbox changes by consensus rule at heights this code
 * does not model. At the next halving (4,406,400) today's funding stream (ZIP 214 revision 2,
 * NU6.1) and the NU6 lockbox (extended by ZIP 271) both expire, so the miner's share does not
 * halve: the node reports 1.25 ZEC to the miner, 0.125 (8%) to one stream and 0.1875 (12%) to
 * the lockbox at 4,406,399, and 0.78125 entirely to the miner at 4,406,400. ZIP 1015's
 * original dev fund ended earlier, at `FUNDING_EXPIRY_BEFORE_NU61`.
 */

/**
 * Blocks between halvings, post-Blossom: 1,046,400 + 1,680,000 = 2,726,400 + 1,680,000 =
 * 4,406,400. Pre-Blossom it was 840,000 blocks of 150 s — the same 126,000,000 seconds.
 */
export const HALVING_INTERVAL = 1_680_000;

/**
 * Blossom's activation, where the block target went 150 s → 75 s.
 *
 * Not a halving: the per-block subsidy halved (12.5 → 6.25) but so did the block target, so
 * issuance per day was unchanged (840,000 × 150 = 1,680,000 × 75 seconds per era). Carried as
 * data so the history table can label that step explicitly.
 */
export const BLOSSOM_HEIGHT = 653_600;

/**
 * Halvings that have already happened, oldest first (Canopy's, then NU6's).
 *
 * `nextHalvingHeight` derives from the last entry plus the interval, so the page moves to the
 * next event as soon as the tip crosses one.
 */
export const PAST_HALVING_HEIGHTS: readonly number[] = [1_046_400, 2_726_400];

/**
 * The halving after the last one listed: 2,726,400 + 1,680,000 = 4,406,400. Checked against the
 * node: getblocksubsidy(4,406,399) = 1.5625 ZEC and getblocksubsidy(4,406,400) = 0.78125 ZEC.
 * Where a tip is at hand, `nextHalvingHeight(tip)` also moves on once the chain passes it.
 */
export const NEXT_HALVING_HEIGHT =
  PAST_HALVING_HEIGHTS[PAST_HALVING_HEIGHTS.length - 1]! + HALVING_INTERVAL;

/**
 * Where the funding stream and the lockbox were scheduled to expire before NU6.1.
 *
 * Precedent for the one conditional claim `/halving` makes ("the miner takes 100% after the
 * next halving"): ZIP 1015's dev fund ran to this height until ZIP 214 revision 2 and ZIP 271
 * moved the expiry to the next halving. The streams ending is a property of current consensus,
 * not of Zcash.
 *
 * Unlike the other heights here this is not node-verifiable: the expiry moved before the
 * chain arrived, so `getblocksubsidy` at this height reports the replacement rules. Its source
 * is https://zips.z.cash/zip-0214 (revisions 1 and 2), and copy says "were scheduled to end
 * at", never "ended at".
 *
 * In-flight proposals that would change this schedule (ZIP 234 Issuance Smoothing, ZIPs 233
 * and 235, ZIP 1016) are deliberately not rendered: a draft status nothing here re-checks
 * goes stale silently.
 */
export const FUNDING_EXPIRY_BEFORE_NU61 = 3_146_400;

/**
 * The post-Blossom block target. The chain does not land on it exactly, which is why
 * `estimateHalvingSeconds` takes an observed interval.
 */
export const BLOCK_TARGET_SECONDS = 75;

/** The block-time target before Blossom (`BLOSSOM_HEIGHT`) halved it. */
export const PRE_BLOSSOM_TARGET_SECONDS = 150;

/** A subsidy split, in zatoshi, exactly as the node reported it for one height. */
export interface SubsidySplit {
  totalZat: number;
  minerZat: number;
  fundingStreamsZat: number;
  lockboxZat: number;
}

/**
 * What happened at a height where the per-block subsidy changed.
 *
 * `block-time-change` exists for Blossom alone, so the history table can show the 12.5 → 6.25
 * step labelled as not a halving.
 */
export type SubsidyEventKind = "halving" | "block-time-change";

/** One subsidy change, past or future. `at` is null for one that has not happened. */
export interface HalvingEvent {
  kind: SubsidyEventKind;
  height: number;
  /** Unix seconds of the block at `height`, from our index. Null when it is still ahead. */
  at: number | null;
  /** The split at `height − 1`, i.e. what a block paid immediately before. */
  before: SubsidySplit;
  /** The split at `height`. */
  after: SubsidySplit;
}

/**
 * Everything `/halving` renders, read at one moment.
 *
 * `observedIntervalSeconds` travels with the data because it is the input to every date on
 * the page and is shown beside the estimate.
 */
export interface HalvingSchedule {
  /** Chain tip the schedule was read at. Rendered, so any staleness is visible. */
  height: number;
  /** Mean seconds per block, measured over recent chain rather than assumed. */
  observedIntervalSeconds: number;
  /** Oldest first. The last entry is the next halving; every earlier one has happened. */
  events: HalvingEvent[];
  /**
   * Halvings after the next one, oldest first — node-sourced and bounded. See `subsidyTail`
   * for the full run to zero.
   */
  upcoming: { height: number; totalZat: number }[];
  asOf: number;
}

/** The halving the chain is counting toward. */
export function nextHalvingHeight(height: number): number {
  const last = PAST_HALVING_HEIGHTS[PAST_HALVING_HEIGHTS.length - 1] ?? 0;
  if (height < last) {
    // The tip is behind a halving we already list — return the first one ahead of it.
    const ahead = PAST_HALVING_HEIGHTS.find((h) => h > height);
    if (ahead !== undefined) return ahead;
  }
  let next = last;
  while (next <= height) next += HALVING_INTERVAL;
  return next;
}

/** The halving epoch the chain is inside: the interval that ends at the next halving. */
export function epochBounds(height: number): { from: number; to: number } {
  const to = nextHalvingHeight(height);
  return { from: to - HALVING_INTERVAL, to };
}

/** How far through the current epoch the chain is, 0..1. Pure block arithmetic, not an estimate. */
export function epochProgress(height: number): number {
  const { from, to } = epochBounds(height);
  return Math.min(1, Math.max(0, (height - from) / (to - from)));
}

/**
 * Seconds until a halving, from an observed block interval.
 *
 * The single implementation for `/halving` and `/v1/network/halving`, so the site states one
 * date. The chain runs slightly slower than the 75 s target (~75.35 s), which over ~960,000
 * blocks is about four days. A non-positive or unusable interval falls back to the target.
 */
export function estimateHalvingSeconds(blocksRemaining: number, intervalSeconds: number): number {
  const interval =
    Number.isFinite(intervalSeconds) && intervalSeconds > 0
      ? intervalSeconds
      : BLOCK_TARGET_SECONDS;
  return Math.max(0, blocksRemaining) * interval;
}

/** Per-recipient change across a halving, as a signed fraction (−0.5 is a halving). */
export interface SubsidyDelta {
  totalPct: number;
  minerPct: number;
  /** True when a recipient's stream stops entirely at this halving. */
  fundingStreamsEnd: boolean;
  lockboxEnds: boolean;
}

/**
 * What changes across a halving, per recipient.
 *
 * "The subsidy halves" is true of the total but not of the miner at 4,406,400: with the
 * funding stream and lockbox expiring, the miner goes from 1.25 (80% of 1.5625) to 0.78125
 * (100% of 0.78125), a fall of 37.5%. A recipient that was already zero returns 0.
 */
export function subsidyDelta(before: SubsidySplit, after: SubsidySplit): SubsidyDelta {
  const pct = (from: number, to: number) => (from === 0 ? 0 : to / from - 1);
  return {
    totalPct: pct(before.totalZat, after.totalZat),
    minerPct: pct(before.minerZat, after.minerZat),
    fundingStreamsEnd: before.fundingStreamsZat > 0 && after.fundingStreamsZat === 0,
    lockboxEnds: before.lockboxZat > 0 && after.lockboxZat === 0,
  };
}

/**
 * ZEC issued per day at a given per-block subsidy and observed block rate. An estimate: the
 * block rate is observed and a day is not a consensus unit.
 */
export function issuancePerDayZat(subsidyZat: number, intervalSeconds: number): number {
  const interval =
    Number.isFinite(intervalSeconds) && intervalSeconds > 0
      ? intervalSeconds
      : BLOCK_TARGET_SECONDS;
  return (DAY_SECONDS / interval) * subsidyZat;
}

/** One step down in the subsidy: the height it takes effect at, and the subsidy from then on. */
export interface SubsidyStep {
  height: number;
  totalZat: number;
}

/** The run from one subsidy to zero, with the figures a page states carried by name. */
export interface SubsidyTail {
  /** Each remaining step, oldest first. The last entry is always `totalZat: 0`. */
  steps: readonly SubsidyStep[];
  /** First height at which the subsidy is zero. Consensus and exact. */
  zeroHeight: number;
  /** The last subsidy above zero, in zatoshi — 1, by construction of integer halving. */
  lastPayingZat: number;
}

/**
 * The remaining subsidy steps from one, until the subsidy reaches zero zatoshi.
 *
 * Integer halving with a floor, as the protocol does, so it terminates. From 0.78125 ZEC there
 * are 27 steps to zero, ending at 49,766,400; including the halving at 4,406,400, 28 subsidy
 * changes remain. Callers read `steps.length`, `zeroHeight` and `lastPayingZat` rather than
 * restating either count.
 *
 * Not every step is a halving, so copy must not say "halves N more times": the floor discards
 * a zatoshi well before the end (`floor(9,765,625 / 2) = 4,882,812`) and the last step
 * truncates 1 zatoshi to 0. The node agrees: `getblocksubsidy(49,766,399)` = 1 zatoshi,
 * `getblocksubsidy(49,766,400)` = 0.
 */
export function subsidyTail(fromHeight: number, fromZat: number): SubsidyTail {
  const steps: SubsidyStep[] = [];
  let zat = Math.floor(fromZat);
  let height = fromHeight;
  let lastPayingZat = Math.max(0, zat);
  while (zat > 0) {
    lastPayingZat = zat;
    zat = Math.floor(zat / 2);
    height += HALVING_INTERVAL;
    steps.push({ height, totalZat: zat });
  }
  return { steps, zeroHeight: height, lastPayingZat: steps.length > 0 ? lastPayingZat : 0 };
}

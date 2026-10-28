import { NU7 } from "./network-upgrade";
import { DAY_SECONDS } from "./time";

/**
 * Zcash's halving schedule, on mainnet (the only network `/halving` serves).
 *
 * A height is exact and a date is an estimate; every function here keeps the two apart.
 *
 * NU7 (ZIP 218, activated by ZIP 259) changes the schedule without changing its timing: blocks go
 * from 75 to 25 seconds and the per-block subsidy is divided by 3, so a halving still comes every
 * 126,000,000 target seconds, now 5,040,000 blocks. The next halving moves from 4,406,400 to
 * 6,132,390 and the funding stream and lockbox move with it (ZIP 1016 as amended by zips#1370).
 * From `REISSUANCE_START_HEIGHT` each block also pays a reissuance bonus on top of the scheduled
 * subsidy (ZIP 234), which depends on how much ZEC has been removed from circulation and so cannot
 * be known in advance.
 *
 * Subsidy figures shown for a height the node can answer come from its `getblocksubsidy`. Past
 * `REISSUANCE_START_HEIGHT` the node refuses (the bonus needs the parent block), so the scheduled
 * part is computed by `scheduledSubsidyZat`, whose formula is pinned in tests to the node's answers
 * at every boundary it can still read.
 */

/**
 * Blocks between halvings after Blossom and before NU7: 1,046,400 + 1,680,000 = 2,726,400.
 * Pre-Blossom it was 840,000 blocks of 150 s, after NU7 5,040,000 of 25 s — the same
 * 126,000,000 seconds every time.
 */
export const HALVING_INTERVAL = 1_680_000;

/** Blocks between halvings once NU7's 25-second target applies. */
export const POST_NU7_HALVING_INTERVAL = 5_040_000;

/**
 * Blossom's activation, where the block target went 150 s → 75 s.
 *
 * Not a halving: the per-block subsidy halved (12.5 → 6.25) but so did the block target, so
 * issuance per day was unchanged. Carried as data so the history table can label that step.
 */
export const BLOSSOM_HEIGHT = 653_600;

/**
 * NU7's activation on mainnet, where the block target goes 75 s → 25 s and the per-block subsidy
 * is divided by 3. Not a halving, for the same reason Blossom was not one.
 */
export const NU7_HEIGHT: number = requireHeight(NU7.activationHeight.mainnet);

/**
 * Where ZIP 234 reissuance starts on mainnet: from this block the subsidy is the scheduled amount
 * plus a bonus of 0.0001375% of the ZEC removed from circulation so far. Derived by Zakura from the
 * network's parameters alone (`nsm_reissuance_height`, asserted as 8,939,664 in its tests at
 * v1.7.0) and confirmed against the node at the boundary: `getblocksubsidy(8,939,663)` answers,
 * `getblocksubsidy(8,939,664)` refuses for want of the parent block.
 */
export const REISSUANCE_START_HEIGHT = 8_939_664;

/** Halvings that have already happened, oldest first (Canopy's, then NU6's). */
export const PAST_HALVING_HEIGHTS: readonly number[] = [1_046_400, 2_726_400];

/**
 * Where the funding stream and the lockbox were scheduled to expire before NU6.1.
 *
 * Precedent for the one conditional claim `/halving` makes ("the miner takes 100% after the
 * next halving"): ZIP 1015's dev fund ran to this height until ZIP 214 revision 2 and ZIP 271
 * moved the expiry to the next halving, and NU7 then moved that halving. The streams ending is a
 * property of current consensus, not of Zcash.
 *
 * Unlike the other heights here this is not node-verifiable: the expiry moved before the
 * chain arrived, so `getblocksubsidy` at this height reports the replacement rules. Its source
 * is https://zips.z.cash/zip-0214 (revisions 1 and 2), and copy says "were scheduled to end
 * at", never "ended at".
 */
export const FUNDING_EXPIRY_BEFORE_NU61 = 3_146_400;

/**
 * The block target between Blossom and NU7. Callers that need the target at a given height use
 * `targetSpacingAt`.
 */
export const BLOCK_TARGET_SECONDS = 75;

/** The block-time target before Blossom (`BLOSSOM_HEIGHT`) halved it. */
export const PRE_BLOSSOM_TARGET_SECONDS = 150;

/** The block-time target from NU7 (`NU7_HEIGHT`), ZIP 218. */
export const POST_NU7_TARGET_SECONDS = 25;

/** `MaxBlockSubsidy`: 12.5 ZEC, the per-block subsidy at 150-second blocks before any halving. */
const MAX_BLOCK_SUBSIDY_ZAT = 1_250_000_000;

/** `SlowStartInterval`: the first 20,000 blocks ramped the subsidy up, outside this schedule. */
const SLOW_START_INTERVAL = 20_000;

function requireHeight(height: number | null): number {
  if (height === null) throw new Error("NU7's mainnet activation height is not set");
  return height;
}

/**
 * The mainnet block target at `height`. The same answer as `targetSpacingSeconds("mainnet", h)`
 * in `consensus.ts` (a test holds them together); repeated here because that module imports
 * this one.
 */
export function targetSpacingAt(height: number): 150 | 75 | 25 {
  if (height >= NU7_HEIGHT) return POST_NU7_TARGET_SECONDS;
  return height >= BLOSSOM_HEIGHT ? BLOCK_TARGET_SECONDS : PRE_BLOSSOM_TARGET_SECONDS;
}

/** The pre-NU7 third halving, 4,406,400, stretched by NU7: blocks after NU7 count a third. */
const THIRD_HALVING_HEIGHT =
  NU7_HEIGHT +
  ((PAST_HALVING_HEIGHTS[1]! + HALVING_INTERVAL - NU7_HEIGHT) * BLOCK_TARGET_SECONDS) /
    POST_NU7_TARGET_SECONDS;

/**
 * The height of the `index`th halving (1 = Canopy's). 6,132,390 for the third, then every
 * 5,040,000 blocks. Node-verified for the third: `getblocksubsidy(6,132,389)` = 0.52083333 ZEC and
 * `getblocksubsidy(6,132,390)` = 0.26041666 ZEC.
 */
export function halvingHeight(index: number): number {
  if (!Number.isInteger(index) || index < 1) throw new RangeError(`no halving ${index}`);
  if (index <= PAST_HALVING_HEIGHTS.length) return PAST_HALVING_HEIGHTS[index - 1]!;
  return THIRD_HALVING_HEIGHT + (index - 3) * POST_NU7_HALVING_INTERVAL;
}

/** How many halvings have happened at `height` (0 before Canopy's). */
function halvingIndex(height: number): number {
  if (height < halvingHeight(1)) return 0;
  if (height < THIRD_HALVING_HEIGHT) return height < halvingHeight(2) ? 1 : 2;
  return 3 + Math.floor((height - THIRD_HALVING_HEIGHT) / POST_NU7_HALVING_INTERVAL);
}

/** The halving after the last one that has happened: 6,132,390. */
export const NEXT_HALVING_HEIGHT = halvingHeight(PAST_HALVING_HEIGHTS.length + 1);

/** The halving the chain is counting toward. */
export function nextHalvingHeight(height: number): number {
  return halvingHeight(halvingIndex(height) + 1);
}

/** The halving epoch the chain is inside: from the last halving to the next. */
export function epochBounds(height: number): { from: number; to: number } {
  const index = halvingIndex(height);
  return { from: index === 0 ? 0 : halvingHeight(index), to: halvingHeight(index + 1) };
}

/**
 * Target seconds of chain between two heights: each block weighs its own era's target. Consensus
 * arithmetic, not an estimate: it is how the protocol itself measures time between halvings.
 */
export function targetSecondsBetween(from: number, to: number): number {
  if (to <= from) return 0;
  let seconds = 0;
  let h = from;
  for (const boundary of [BLOSSOM_HEIGHT, NU7_HEIGHT]) {
    if (h < boundary) {
      const end = Math.min(boundary, to);
      seconds += (end - h) * targetSpacingAt(h);
      h = end;
    }
    if (h >= to) return seconds;
  }
  return seconds + (to - h) * targetSpacingAt(h);
}

/**
 * How far through the current epoch the chain is, 0..1, in target time rather than blocks: across
 * NU7 a block is worth a third of the time, so a count of blocks would read the epoch as a quarter
 * done when half of it has passed.
 */
export function epochProgress(height: number): number {
  const { from, to } = epochBounds(height);
  const done = targetSecondsBetween(from, height) / targetSecondsBetween(from, to);
  return Math.min(1, Math.max(0, done));
}

/**
 * Seconds from block `from` to block `to`, estimated.
 *
 * The single implementation for `/halving` and `/v1/network/halving`, so the site states one
 * date. Blocks in the era `from` is in run at the observed interval, which the caller measures
 * within that era only; blocks in a later era run at its target, since nothing has been observed
 * of it yet. A non-positive or unusable interval falls back to the current era's target.
 */
export function estimateSecondsBetween(
  from: number,
  to: number,
  observedIntervalSeconds: number,
): number {
  if (to <= from) return 0;
  const interval =
    Number.isFinite(observedIntervalSeconds) && observedIntervalSeconds > 0
      ? observedIntervalSeconds
      : targetSpacingAt(from);
  const eraEnd = [BLOSSOM_HEIGHT, NU7_HEIGHT].find((b) => b > from) ?? Infinity;
  if (to <= eraEnd) return (to - from) * interval;
  return (eraEnd - from) * interval + targetSecondsBetween(eraEnd, to);
}

/**
 * The scheduled per-block subsidy at `height`, in zatoshi: `MaxBlockSubsidy` scaled to the era's
 * block target, then divided by 2 for each halving, both floors as the protocol takes them.
 * From `REISSUANCE_START_HEIGHT` a block pays this plus the ZIP 234 bonus, so there it is a floor,
 * not the reward. Not defined in the slow start, which this schedule never reads.
 */
export function scheduledSubsidyZat(height: number): number {
  if (height < SLOW_START_INTERVAL) throw new RangeError(`slow-start height ${height}`);
  const base = Math.floor((MAX_BLOCK_SUBSIDY_ZAT * targetSpacingAt(height)) / 150);
  return Math.floor(base / 2 ** halvingIndex(height));
}

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
 * `block-time-change` is Blossom and NU7: the subsidy per block fell because blocks came faster,
 * and issuance per day did not change.
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
  /** Mean seconds per block, measured over recent chain within the tip's era, 0 if unmeasured. */
  observedIntervalSeconds: number;
  /** Oldest first. The last entry is the next halving; every earlier one has happened. */
  events: HalvingEvent[];
  /**
   * Halvings after the next one, oldest first, with their scheduled subsidy. See `subsidyTail`
   * for the full run to zero.
   */
  upcoming: { height: number; totalZat: number }[];
  asOf: number;
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
 * "The subsidy halves" is true of the total but not of the miner at 6,132,390: with the
 * funding stream and lockbox expiring, the miner goes from 0.41666668 (80% of 0.52083333) to
 * 0.26041666 (100% of 0.26041666), a fall of 37.5%. A recipient that was already zero returns 0.
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
 * ZEC issued per day at a given per-block subsidy and block interval. An estimate: the block
 * rate is observed or a target, and a day is not a consensus unit.
 */
export function issuancePerDayZat(subsidyZat: number, intervalSeconds: number): number {
  const interval =
    Number.isFinite(intervalSeconds) && intervalSeconds > 0
      ? intervalSeconds
      : BLOCK_TARGET_SECONDS;
  return (DAY_SECONDS / interval) * subsidyZat;
}

/** One step down in the scheduled subsidy: the halving height, and the subsidy from then on. */
export interface SubsidyStep {
  height: number;
  totalZat: number;
}

/** The scheduled subsidy's run to zero, with the figures a page states carried by name. */
export interface SubsidyTail {
  /** Each remaining halving, oldest first. The last entry is always `totalZat: 0`. */
  steps: readonly SubsidyStep[];
  /** First height at which the scheduled subsidy is zero. Consensus and exact. */
  zeroHeight: number;
  /** The last scheduled subsidy above zero, in zatoshi — 1, by construction of integer halving. */
  lastPayingZat: number;
}

/**
 * The halvings after `afterHeight`, until the scheduled subsidy reaches zero zatoshi.
 *
 * After the third halving (0.26041666 ZEC) there are 25 more, the scheduled subsidy reaching zero
 * at 132,132,390. Callers read `steps.length`, `zeroHeight` and `lastPayingZat` rather than
 * restating either figure. This is the scheduled part only: from `REISSUANCE_START_HEIGHT` every
 * block adds the reissuance bonus, which continues for as long as removed ZEC remains to reissue.
 */
export function subsidyTail(afterHeight: number): SubsidyTail {
  const steps: SubsidyStep[] = [];
  let index = halvingIndex(afterHeight) + 1;
  let lastPayingZat = scheduledSubsidyZat(afterHeight);
  if (lastPayingZat === 0) return { steps, zeroHeight: afterHeight, lastPayingZat };
  for (;;) {
    const height = halvingHeight(index);
    const totalZat = scheduledSubsidyZat(height);
    steps.push({ height, totalZat });
    if (totalZat === 0) return { steps, zeroHeight: height, lastPayingZat };
    lastPayingZat = totalZat;
    index += 1;
  }
}

/**
 * The next height after `height` at which the per-block subsidy changes by schedule: NU7, a
 * halving, or the start of reissuance. Past `REISSUANCE_START_HEIGHT` the bonus moves the subsidy
 * every block, and this names the next halving, where the scheduled part changes.
 */
export function nextSubsidyChangeHeight(height: number): number {
  const fixed = [NU7_HEIGHT, REISSUANCE_START_HEIGHT].filter((h) => h > height);
  return Math.min(nextHalvingHeight(height), ...fixed);
}

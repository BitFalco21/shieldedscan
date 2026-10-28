import { describe, expect, it } from "vitest";
import { targetSpacingSeconds } from "../consensus";
import {
  BLOCK_TARGET_SECONDS,
  BLOSSOM_HEIGHT,
  FUNDING_EXPIRY_BEFORE_NU61,
  HALVING_INTERVAL,
  NEXT_HALVING_HEIGHT,
  NU7_HEIGHT,
  PAST_HALVING_HEIGHTS,
  POST_NU7_HALVING_INTERVAL,
  REISSUANCE_START_HEIGHT,
  epochBounds,
  epochProgress,
  estimateSecondsBetween,
  halvingHeight,
  issuancePerDayZat,
  nextHalvingHeight,
  nextSubsidyChangeHeight,
  scheduledSubsidyZat,
  subsidyDelta,
  subsidyTail,
  targetSecondsBetween,
  targetSpacingAt,
  type SubsidySplit,
} from "../halving";

/**
 * The halving schedule after NU7. Figures were read from the node's `getblocksubsidy` on Zakura
 * 1.7.0 (2026-10-28). Pinned as properties: NU7 is not a halving, the third halving keeps its
 * time, the miner's share does not halve there, and the scheduled subsidy terminates.
 */

const split = (total: number, miner: number, streams = 0, lockbox = 0): SubsidySplit => ({
  totalZat: total,
  minerZat: miner,
  fundingStreamsZat: streams,
  lockboxZat: lockbox,
});

/** Node-reported, height 3,543,404: 1.5625 ZEC split 1.25 / 0.125 / 0.1875. */
const BEFORE_NU7 = split(156_250_000, 125_000_000, 12_500_000, 18_750_000);
/** Node-reported, heights 3,543,405 and 6,132,389: 0.52083333 ZEC split 80 / 8 / 12. */
const AFTER_NU7 = split(52_083_333, 41_666_668, 4_166_666, 6_249_999);
/** Node-reported, height 6,132,390: 0.26041666 ZEC, entirely to the miner. */
const AFTER_THIRD = split(26_041_666, 26_041_666, 0, 0);

describe("the schedule", () => {
  it("puts the third halving where NU7 moves it, and the node agrees", () => {
    // 3,543,405 + 3 × (4,406,400 − 3,543,405): the remaining 75-second blocks, three times over.
    expect(NEXT_HALVING_HEIGHT).toBe(6_132_390);
    expect(halvingHeight(3)).toBe(6_132_390);
    expect(halvingHeight(4)).toBe(6_132_390 + POST_NU7_HALVING_INTERVAL);
  });

  it("keeps every halving 126,000,000 target seconds apart, across Blossom and NU7", () => {
    expect(840_000 * 150).toBe(HALVING_INTERVAL * BLOCK_TARGET_SECONDS);
    expect(POST_NU7_HALVING_INTERVAL * 25).toBe(126_000_000);
    expect(targetSecondsBetween(PAST_HALVING_HEIGHTS[1]!, halvingHeight(3))).toBe(126_000_000);
    expect(targetSecondsBetween(halvingHeight(3), halvingHeight(4))).toBe(126_000_000);
  });

  it("places the reissuance start between the third and fourth halvings", () => {
    expect(REISSUANCE_START_HEIGHT).toBeGreaterThan(halvingHeight(3));
    expect(REISSUANCE_START_HEIGHT).toBeLessThan(halvingHeight(4));
  });

  it("agrees with consensus.ts on the block target at every boundary", () => {
    for (const h of [
      0,
      BLOSSOM_HEIGHT - 1,
      BLOSSOM_HEIGHT,
      NU7_HEIGHT - 1,
      NU7_HEIGHT,
      9_000_000,
    ]) {
      expect(targetSpacingAt(h)).toBe(targetSpacingSeconds("mainnet", h));
    }
  });
});

describe("scheduledSubsidyZat", () => {
  it("matches the node at every boundary it can read", () => {
    expect(scheduledSubsidyZat(BLOSSOM_HEIGHT - 1)).toBe(1_250_000_000);
    expect(scheduledSubsidyZat(BLOSSOM_HEIGHT)).toBe(625_000_000);
    expect(scheduledSubsidyZat(PAST_HALVING_HEIGHTS[0]!)).toBe(312_500_000);
    expect(scheduledSubsidyZat(PAST_HALVING_HEIGHTS[1]!)).toBe(BEFORE_NU7.totalZat);
    expect(scheduledSubsidyZat(NU7_HEIGHT - 1)).toBe(BEFORE_NU7.totalZat);
    expect(scheduledSubsidyZat(NU7_HEIGHT)).toBe(AFTER_NU7.totalZat);
    expect(scheduledSubsidyZat(4_406_400)).toBe(AFTER_NU7.totalZat);
    expect(scheduledSubsidyZat(6_132_389)).toBe(AFTER_NU7.totalZat);
    expect(scheduledSubsidyZat(6_132_390)).toBe(AFTER_THIRD.totalZat);
    expect(scheduledSubsidyZat(REISSUANCE_START_HEIGHT - 1)).toBe(AFTER_THIRD.totalZat);
  });

  it("refuses the slow start, which it does not model", () => {
    expect(() => scheduledSubsidyZat(19_999)).toThrow(RangeError);
  });
});

describe("nextHalvingHeight", () => {
  it("points at the third halving from today's chain, past NU7 or not", () => {
    expect(nextHalvingHeight(3_533_753)).toBe(6_132_390);
    expect(nextHalvingHeight(NU7_HEIGHT)).toBe(6_132_390);
  });

  it("is no longer 4,406,400, which NU7 turned into an ordinary block", () => {
    expect(nextHalvingHeight(4_406_399)).toBe(6_132_390);
    expect(nextHalvingHeight(4_406_400)).toBe(6_132_390);
  });

  it("flips to the following one the moment the tip crosses a halving", () => {
    expect(nextHalvingHeight(6_132_389)).toBe(6_132_390);
    expect(nextHalvingHeight(6_132_390)).toBe(6_132_390 + POST_NU7_HALVING_INTERVAL);
  });

  it("answers for a tip behind a halving that has already happened", () => {
    expect(nextHalvingHeight(1_000_000)).toBe(1_046_400);
    expect(nextHalvingHeight(2_000_000)).toBe(2_726_400);
  });
});

describe("nextSubsidyChangeHeight", () => {
  it("names NU7 first, then the halving, then the start of reissuance", () => {
    expect(nextSubsidyChangeHeight(3_533_753)).toBe(NU7_HEIGHT);
    expect(nextSubsidyChangeHeight(NU7_HEIGHT)).toBe(6_132_390);
    expect(nextSubsidyChangeHeight(6_132_390)).toBe(REISSUANCE_START_HEIGHT);
    expect(nextSubsidyChangeHeight(REISSUANCE_START_HEIGHT)).toBe(halvingHeight(4));
  });
});

describe("epochProgress", () => {
  it("measures target time, so blocks after NU7 count a third", () => {
    // 807,353 blocks of 75 s out of 126,000,000 s: 48.06%, where a block count would say 23.7%.
    expect(epochProgress(3_533_753)).toBeCloseTo(0.4806, 4);
    expect(epochBounds(3_533_753)).toEqual({ from: 2_726_400, to: 6_132_390 });
  });

  it("is continuous across NU7", () => {
    const before = epochProgress(NU7_HEIGHT - 1);
    const at = epochProgress(NU7_HEIGHT);
    expect(at - before).toBeCloseTo(75 / 126_000_000, 12);
  });

  it("reads 0 at the start of an epoch and approaches 1 at its end", () => {
    expect(epochProgress(2_726_400)).toBe(0);
    expect(epochProgress(6_132_389)).toBeCloseTo(1, 6);
  });

  it("never leaves 0..1", () => {
    for (const h of [0, 1, 653_600, 4_406_400, 9_999_999]) {
      const p = epochProgress(h);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe("estimateSecondsBetween", () => {
  it("runs the current era at the observed pace and NU7's era at its 25-second target", () => {
    const tip = 3_533_753;
    const seconds = estimateSecondsBetween(tip, 6_132_390, 78);
    expect(seconds).toBe((NU7_HEIGHT - tip) * 78 + (6_132_390 - NU7_HEIGHT) * 25);
  });

  it("lands the third halving in late 2028, where 4,406,400 would have been", () => {
    // Read 2026-10-28 16:24 UTC at block 3,533,746.
    const at =
      Date.UTC(2026, 9, 28, 16, 24) / 1000 + estimateSecondsBetween(3_533_746, 6_132_390, 78);
    expect(new Date(at * 1000).getUTCFullYear()).toBe(2028);
  });

  it("uses the observed interval alone inside one era", () => {
    expect(estimateSecondsBetween(NU7_HEIGHT, NU7_HEIGHT + 1_000, 26)).toBe(26_000);
  });

  it("falls back to the current era's target rather than returning nonsense", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(estimateSecondsBetween(3_000_000, 3_001_000, bad)).toBe(1_000 * 75);
      expect(estimateSecondsBetween(NU7_HEIGHT, NU7_HEIGHT + 1_000, bad)).toBe(1_000 * 25);
    }
  });

  it("never counts backwards", () => {
    expect(estimateSecondsBetween(10, 5, 75)).toBe(0);
  });
});

describe("subsidyDelta", () => {
  it("reports the total halving and the miner's SMALLER fall at the third halving", () => {
    const d = subsidyDelta(AFTER_NU7, AFTER_THIRD);
    expect(d.totalPct).toBeCloseTo(-0.5, 6);
    expect(d.minerPct).toBeCloseTo(-0.375, 6);
    expect(d.fundingStreamsEnd).toBe(true);
    expect(d.lockboxEnds).toBe(true);
  });

  it("reports no change for a recipient that was already zero", () => {
    const before = split(625_000_000, 500_000_000, 125_000_000, 0);
    const after = split(312_500_000, 250_000_000, 62_500_000, 0);
    const d = subsidyDelta(before, after);
    expect(d.minerPct).toBeCloseTo(-0.5, 10);
    expect(d.lockboxEnds).toBe(false);
  });
});

describe("issuancePerDayZat", () => {
  it("shows NU7 leaves daily issuance alone and the halving halves it", () => {
    const now = issuancePerDayZat(BEFORE_NU7.totalZat, 75) / 1e8;
    expect(now).toBeCloseTo(1_800, 0);
    expect(issuancePerDayZat(AFTER_NU7.totalZat, 25) / 1e8).toBeCloseTo(now, 0);
    expect(issuancePerDayZat(AFTER_THIRD.totalZat, 25) / 1e8).toBeCloseTo(900, 0);
  });
});

describe("subsidyTail", () => {
  it("runs 25 more halvings after the third, to zero at 132,132,390", () => {
    const tail = subsidyTail(6_132_390);
    expect(tail.steps).toHaveLength(25);
    expect(tail.steps[tail.steps.length - 1]!.totalZat).toBe(0);
    expect(tail.zeroHeight).toBe(132_132_390);
    expect(tail.zeroHeight).toBe(6_132_390 + tail.steps.length * POST_NU7_HALVING_INTERVAL);
  });

  it("starts one interval after the third halving, at half its subsidy", () => {
    const tail = subsidyTail(6_132_390);
    expect(tail.steps[0]).toEqual({ height: 11_172_390, totalZat: 13_020_833 });
  });

  it("is the same run from any height inside the epoch", () => {
    expect(subsidyTail(3_533_753).steps[0]).toEqual({ height: 6_132_390, totalZat: 26_041_666 });
  });

  it("names the final paying step, one zatoshi", () => {
    const tail = subsidyTail(6_132_390);
    expect(tail.lastPayingZat).toBe(1);
    expect(tail.steps[tail.steps.length - 2]!.totalZat).toBe(1);
  });

  it("answers for a scheduled subsidy that is already zero rather than looping", () => {
    const tail = subsidyTail(132_132_390);
    expect(tail.steps).toEqual([]);
    expect(tail.zeroHeight).toBe(132_132_390);
    expect(tail.lastPayingZat).toBe(0);
  });
});

describe("FUNDING_EXPIRY_BEFORE_NU61", () => {
  it("sits between the last halving and the next, off the halving grid", () => {
    expect(FUNDING_EXPIRY_BEFORE_NU61).toBeGreaterThan(PAST_HALVING_HEIGHTS[1]!);
    expect(FUNDING_EXPIRY_BEFORE_NU61).toBeLessThan(nextHalvingHeight(3_533_753));
    expect((FUNDING_EXPIRY_BEFORE_NU61 - PAST_HALVING_HEIGHTS[0]!) % HALVING_INTERVAL).not.toBe(0);
  });
});

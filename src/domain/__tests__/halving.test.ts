import { describe, expect, it } from "vitest";
import {
  BLOCK_TARGET_SECONDS,
  BLOSSOM_HEIGHT,
  FUNDING_EXPIRY_BEFORE_NU61,
  HALVING_INTERVAL,
  NEXT_HALVING_HEIGHT,
  PAST_HALVING_HEIGHTS,
  epochBounds,
  epochProgress,
  estimateHalvingSeconds,
  issuancePerDayZat,
  nextHalvingHeight,
  subsidyDelta,
  subsidyTail,
  type SubsidySplit,
} from "../halving";

/**
 * The halving schedule. Figures were read from the node's `getblocksubsidy` and the block
 * index. Two key facts are pinned as properties: the miner's share does not halve at
 * 4,406,400, and the schedule terminates.
 */

const split = (total: number, miner: number, streams = 0, lockbox = 0): SubsidySplit => ({
  totalZat: total,
  minerZat: miner,
  fundingStreamsZat: streams,
  lockboxZat: lockbox,
});

/** Node-reported, height 3,445,362 / 2,726,400: 1.5625 ZEC split 1.25 / 0.125 / 0.1875. */
const CURRENT = split(156_250_000, 125_000_000, 12_500_000, 18_750_000);
/** Node-reported, height 4,406,400: 0.78125 ZEC, entirely to the miner. */
const NEXT = split(78_125_000, 78_125_000, 0, 0);

describe("the interval", () => {
  it("is the one that actually spaces the observed halvings", () => {
    expect(PAST_HALVING_HEIGHTS[1]! - PAST_HALVING_HEIGHTS[0]!).toBe(HALVING_INTERVAL);
    expect(PAST_HALVING_HEIGHTS[1]! + HALVING_INTERVAL).toBe(4_406_400);
  });

  it("names the next halving as the one the chain is counting toward now", () => {
    expect(NEXT_HALVING_HEIGHT).toBe(4_406_400);
    expect(nextHalvingHeight(PAST_HALVING_HEIGHTS[1]!)).toBe(NEXT_HALVING_HEIGHT);
  });

  it("spans the same wall-clock time either side of Blossom, which is why Blossom is not a halving", () => {
    // 840,000 blocks of 150s before, 1,680,000 of 75s after — both 126,000,000 seconds.
    expect(840_000 * 150).toBe(HALVING_INTERVAL * BLOCK_TARGET_SECONDS);
    expect(BLOSSOM_HEIGHT).toBeLessThan(PAST_HALVING_HEIGHTS[0]!);
  });
});

describe("nextHalvingHeight", () => {
  it("points at the third halving from today's chain", () => {
    expect(nextHalvingHeight(3_445_362)).toBe(4_406_400);
  });

  it("flips to the following one the moment the tip crosses a halving", () => {
    // The page must never count down to a block that has passed.
    expect(nextHalvingHeight(4_406_399)).toBe(4_406_400);
    expect(nextHalvingHeight(4_406_400)).toBe(4_406_400 + HALVING_INTERVAL);
    expect(nextHalvingHeight(4_406_401)).toBe(4_406_400 + HALVING_INTERVAL);
  });

  it("answers for a tip behind a halving that has already happened", () => {
    expect(nextHalvingHeight(1_000_000)).toBe(1_046_400);
    expect(nextHalvingHeight(2_000_000)).toBe(2_726_400);
  });
});

describe("epochProgress", () => {
  it("is exact block arithmetic, not an estimate", () => {
    // (3,445,362 − 2,726,400) / 1,680,000 — measured at 42.80% on the live chain.
    expect(epochProgress(3_445_362)).toBeCloseTo(0.428, 3);
  });

  it("reads 0 at the start of an epoch and approaches 1 at its end", () => {
    expect(epochProgress(2_726_400)).toBe(0);
    expect(epochProgress(4_406_399)).toBeCloseTo(1, 5);
    expect(epochBounds(3_445_362)).toEqual({ from: 2_726_400, to: 4_406_400 });
  });

  it("never leaves 0..1", () => {
    for (const h of [0, 1, 653_600, 4_406_400, 9_999_999]) {
      const p = epochProgress(h);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe("estimateHalvingSeconds", () => {
  it("uses the observed interval, which is four days off the target over the real distance", () => {
    // 961,038 blocks remaining; observed 75.35s against the 75s target.
    const observed = estimateHalvingSeconds(961_038, 75.35);
    const target = estimateHalvingSeconds(961_038, BLOCK_TARGET_SECONDS);
    expect(Math.round((observed - target) / 86_400)).toBe(4);
  });

  it("falls back to the consensus target rather than returning nonsense", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(estimateHalvingSeconds(1_000, bad)).toBe(1_000 * BLOCK_TARGET_SECONDS);
    }
  });

  it("never counts backwards", () => {
    expect(estimateHalvingSeconds(-5, 75)).toBe(0);
  });
});

describe("subsidyDelta", () => {
  it("reports the total halving and the miner's SMALLER fall", () => {
    const d = subsidyDelta(CURRENT, NEXT);

    // "The subsidy halves" is true of the total and false of the miner: the streams and the
    // lockbox expire at the same height.
    expect(d.totalPct).toBeCloseTo(-0.5, 10);
    expect(d.minerPct).toBeCloseTo(-0.375, 10);
    expect(d.minerPct).toBeGreaterThan(d.totalPct);
  });

  it("names the streams and the lockbox as ending", () => {
    const d = subsidyDelta(CURRENT, NEXT);
    expect(d.fundingStreamsEnd).toBe(true);
    expect(d.lockboxEnds).toBe(true);
  });

  it("reports no change for a recipient that was already zero", () => {
    // The first halving had no lockbox on either side — that is 0, not a division by zero.
    const before = split(625_000_000, 500_000_000, 125_000_000, 0);
    const after = split(312_500_000, 250_000_000, 62_500_000, 0);
    const d = subsidyDelta(before, after);

    expect(d.minerPct).toBeCloseTo(-0.5, 10);
    expect(d.lockboxEnds).toBe(false);
    expect(Number.isFinite(d.totalPct)).toBe(true);
  });
});

describe("issuancePerDayZat", () => {
  it("matches the measured chain: ~1,792 ZEC/day now, ~896 after", () => {
    expect(issuancePerDayZat(CURRENT.totalZat, 75.35) / 1e8).toBeCloseTo(1792, 0);
    expect(issuancePerDayZat(NEXT.totalZat, 75.35) / 1e8).toBeCloseTo(896, 0);
  });
});

describe("subsidyTail", () => {
  it("terminates, and at the height the protocol actually stops issuing", () => {
    // The subsidy is a zatoshi count, so integer halving with a floor terminates, as the
    // protocol does. The node agrees: getblocksubsidy(49,766,399) = 1 zatoshi and
    // getblocksubsidy(49,766,400) = 0. The step count is stated only in `subsidyTail`'s doc.
    const tail = subsidyTail(4_406_400, NEXT.totalZat);

    expect(tail.steps).toHaveLength(27);
    expect(tail.steps[tail.steps.length - 1]!.totalZat).toBe(0);
    expect(tail.zeroHeight).toBe(49_766_400);
  });

  it("keeps the count and the zero height in agreement, because the page prints both", () => {
    // Copy says "steps down N more times … from block H the subsidy is zero", which is only
    // self-consistent while H is N intervals away.
    const tail = subsidyTail(4_406_400, NEXT.totalZat);

    expect(tail.zeroHeight).toBe(4_406_400 + tail.steps.length * HALVING_INTERVAL);
  });

  it("names the final paying step, which is one zatoshi rather than a halving", () => {
    const tail = subsidyTail(4_406_400, NEXT.totalZat);

    expect(tail.lastPayingZat).toBe(1);
    expect(tail.steps[tail.steps.length - 2]!.totalZat).toBe(1);
  });

  it("does not halve every step, which is why the copy says 'rounded down'", () => {
    // Not every step is a halving: the floor discards a zatoshi well before the end, and the
    // last step truncates 1 to 0. Copy must not say "halves N more times".
    const tail = subsidyTail(4_406_400, NEXT.totalZat);
    const inexact = tail.steps.filter((s, i) => {
      const prev = i === 0 ? NEXT.totalZat : tail.steps[i - 1]!.totalZat;
      return prev / 2 !== s.totalZat;
    });

    expect(inexact.length).toBeGreaterThan(0);
    // 9,765,625 is odd, so the very next step drops a zatoshi rather than halving.
    const odd = tail.steps.findIndex((s) => s.totalZat === 9_765_625);
    expect(tail.steps[odd + 1]!.totalZat).toBe(4_882_812);
  });

  it("halves each step and spaces them by one interval", () => {
    const tail = subsidyTail(4_406_400, NEXT.totalZat);

    expect(tail.steps[0]).toEqual({ height: 4_406_400 + HALVING_INTERVAL, totalZat: 39_062_500 });
    expect(tail.steps[1]!.height - tail.steps[0]!.height).toBe(HALVING_INTERVAL);
  });

  it("answers for a subsidy that is already zero rather than looping or lying", () => {
    const tail = subsidyTail(6_086_400, 0);

    expect(tail.steps).toEqual([]);
    expect(tail.zeroHeight).toBe(6_086_400);
    expect(tail.lastPayingZat).toBe(0);
  });
});

describe("FUNDING_EXPIRY_BEFORE_NU61", () => {
  it("sits between the last halving and the next, where a funding boundary can", () => {
    // ZIP 1015's dev fund ran to here; NU6.1 moved the expiry to the next halving. It is a real
    // height off the halving grid; do not "correct" it onto the grid.
    expect(FUNDING_EXPIRY_BEFORE_NU61).toBeGreaterThan(PAST_HALVING_HEIGHTS[1]!);
    expect(FUNDING_EXPIRY_BEFORE_NU61).toBeLessThan(nextHalvingHeight(3_445_362));
    expect((FUNDING_EXPIRY_BEFORE_NU61 - PAST_HALVING_HEIGHTS[0]!) % HALVING_INTERVAL).not.toBe(0);
  });
});

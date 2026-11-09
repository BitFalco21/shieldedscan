import { describe, expect, it } from "vitest";
import {
  BLOSSOM_HEIGHT,
  NU7_HEIGHT,
  REISSUANCE_START_HEIGHT,
  blockSubsidyZat,
  estimateSecondsBetween,
  halvingHeight,
  scheduledSubsidyZat,
  subsidyTail,
} from "../halving";
import {
  OBSERVED_POINTS,
  PROJECTED_THROUGH_HALVING,
  SCHEDULED_ISSUANCE_TOTAL_ZAT,
  issuanceAt,
  issuanceOutlook,
  scheduledIssuanceThroughZat as issued,
} from "../issuance";
import { MAX_SUPPLY_ZAT } from "../pool";

describe("scheduledIssuanceThroughZat", () => {
  it("equals the node's pools plus NSM at 3,555,246, to the zatoshi", () => {
    // 1,703,236,659,973,526 in the six value pools + 37,142,105,860 NSM, read from the node.
    expect(issued(3_555_246)).toBe(1_703_236_659_973_526 + 37_142_105_860);
    expect(issued(3_555_246)).toBe(1_703_273_802_079_386);
  });

  it("pays nothing at genesis and ramps through the slow start", () => {
    expect(issued(0)).toBe(0);
    expect(issued(1)).toBe(62_500);
    expect(issued(9_999)).toBe(3_124_687_500_000);
    // From block 10,000 the rate is 62,500 × (h + 1).
    expect(issued(10_000)).toBe(3_124_687_500_000 + 62_500 * 10_001);
    // The whole slow start: 125,000 ZEC.
    expect(issued(19_999)).toBe(12_500_000_000_000);
    expect(issued(20_000)).toBe(12_500_000_000_000 + 1_250_000_000);
  });

  it("matches a block-by-block sum across Blossom", () => {
    let sum = 0;
    for (let h = 0; h <= BLOSSOM_HEIGHT + 1_000; h += 1) sum += blockSubsidyZat(h);
    expect(issued(BLOSSOM_HEIGHT + 1_000)).toBe(sum);
  });

  it("steps by exactly the block's subsidy at every boundary", () => {
    const edges = [
      BLOSSOM_HEIGHT,
      halvingHeight(1),
      halvingHeight(2),
      NU7_HEIGHT,
      halvingHeight(3),
      REISSUANCE_START_HEIGHT,
      halvingHeight(4),
    ];
    for (const h of edges) {
      expect(issued(h) - issued(h - 1)).toBe(scheduledSubsidyZat(h));
      expect(issued(h - 1) - issued(h - 2)).toBe(scheduledSubsidyZat(h - 1));
    }
  });

  it("reaches half and three quarters of the cap at the first two halvings", () => {
    expect(issued(halvingHeight(1) - 1)).toBe(MAX_SUPPLY_ZAT / 2);
    expect(issued(halvingHeight(2) - 1)).toBe((MAX_SUPPLY_ZAT * 3) / 4);
    // NU7 keeps the time between halvings, so the third lands on 7/8 less rounding.
    expect(issued(halvingHeight(3) - 1)).toBe(1_837_499_999_137_005);
  });

  it("ends just under 21M ZEC and never moves after the last paying block", () => {
    const zero = subsidyTail(halvingHeight(3)).zeroHeight;
    expect(SCHEDULED_ISSUANCE_TOTAL_ZAT).toBe(2_099_999_931_937_005);
    expect(SCHEDULED_ISSUANCE_TOTAL_ZAT).toBeLessThan(MAX_SUPPLY_ZAT);
    expect(MAX_SUPPLY_ZAT - SCHEDULED_ISSUANCE_TOTAL_ZAT).toBe(68_062_995);
    expect(issued(zero - 2)).toBeLessThan(SCHEDULED_ISSUANCE_TOTAL_ZAT);
    expect(issued(zero)).toBe(SCHEDULED_ISSUANCE_TOTAL_ZAT);
    expect(issued(zero + 10_000_000)).toBe(SCHEDULED_ISSUANCE_TOTAL_ZAT);
  });

  it("refuses a height that is not a block", () => {
    expect(() => issued(-1)).toThrow(RangeError);
    expect(() => issued(1.5)).toThrow(RangeError);
  });
});

describe("issuanceOutlook", () => {
  const now = 1_793_000_000;
  const tip = { height: 3_533_753, observedIntervalSeconds: 75.35 };
  const day = 86_400;
  const closes = Array.from({ length: 1_000 }, (_, i) => ({
    timestamp: now - (1_000 - i) * day,
    height: tip.height - (999 - i) * 1_152,
  }));
  const outlook = issuanceOutlook(closes, tip, now);

  it("draws each close at its day's last second, capped at now, valued by the schedule", () => {
    expect(outlook.observed.length).toBe(OBSERVED_POINTS);
    expect(outlook.observed[0]).toEqual({
      at: closes[0]!.timestamp + day - 1,
      height: closes[0]!.height,
      issuedZat: issued(closes[0]!.height),
    });
    const last = outlook.observed.at(-1)!;
    expect(last.height).toBe(tip.height);
    expect(last.at).toBe(now - 1);
  });

  it("projects from the tip through every change of subsidy or block time", () => {
    const heights = outlook.projected.map((p) => p.height);
    expect(heights).toEqual([
      tip.height,
      NU7_HEIGHT,
      halvingHeight(3),
      REISSUANCE_START_HEIGHT,
      halvingHeight(4),
      halvingHeight(5),
      halvingHeight(6),
    ]);
    expect(outlook.projected[0]!.at).toBe(now);
    for (const p of outlook.projected) {
      expect(p.at).toBe(now + estimateSecondsBetween(tip.height, p.height, 75.35));
      expect(p.issuedZat).toBe(issued(p.height));
    }
  });

  it("marks the halvings ahead and the start of reissuance, with /halving's dates", () => {
    expect(outlook.events.map((e) => [e.kind, e.index ?? null, e.height])).toEqual([
      ["halving", 3, halvingHeight(3)],
      ["reissuance", null, REISSUANCE_START_HEIGHT],
      ["halving", 4, halvingHeight(4)],
      ["halving", 5, halvingHeight(5)],
      ["halving", PROJECTED_THROUGH_HALVING, halvingHeight(PROJECTED_THROUGH_HALVING)],
    ]);
    const third = outlook.events[0]!;
    expect(third.at).toBe(now + estimateSecondsBetween(tip.height, third.height, 75.35));
  });

  it("drops a close above the tip rather than draw it past now", () => {
    const ahead = issuanceOutlook([{ timestamp: now, height: tip.height + 5 }], tip, now);
    expect(ahead.observed).toEqual([]);
  });
});

describe("issuanceAt", () => {
  const now = 1_793_000_000;
  const tip = { height: 3_600_000, observedIntervalSeconds: 25 };
  const outlook = issuanceOutlook(
    [
      { timestamp: now - 2 * 86_400, height: 3_590_000 },
      { timestamp: now - 86_400, height: 3_596_000 },
    ],
    tip,
    now,
  );

  it("reads the newest close at or before an instant up to now", () => {
    expect(issuanceAt(outlook, now - 86_400 - 1)).toMatchObject({
      projected: false,
      height: 3_590_000,
    });
    expect(issuanceAt(outlook, now)).toMatchObject({ projected: false, height: 3_596_000 });
    expect(issuanceAt(outlook, now - 3 * 86_400)).toBeNull();
  });

  it("interpolates the schedule's height by time after now, and values it exactly", () => {
    const third = outlook.projected[1]!;
    const reading = issuanceAt(outlook, third.at)!;
    expect(reading).toMatchObject({ projected: true, height: third.height });
    expect(reading.issuedZat).toBe(issued(third.height));
    // 25 s blocks: a day after now is 3,456 blocks on.
    const later = issuanceAt(outlook, now + 86_400)!;
    expect(later.height).toBe(tip.height + 3_456);
    expect(later.issuedZat).toBe(issued(tip.height + 3_456));
    expect(issuanceAt(outlook, outlook.projected.at(-1)!.at + 1)).toBeNull();
  });
});

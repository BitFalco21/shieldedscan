import { describe, expect, it } from "vitest";
import { poolsToMajority, type MinerSeries } from "../miners";

const period = (p: string, blocks: number) => ({
  period: p,
  blocks,
  firstHeight: 1,
  lastHeight: blocks,
  partial: false,
});
const cell = (p: string, group: string, blocks: number) => ({
  period: p,
  group,
  blocks,
  rewardZat: null,
  feeZat: null,
});
const series = (periods: MinerSeries["periods"], points: MinerSeries["points"]): MinerSeries => ({
  interval: "month",
  fromDay: periods[0]!.period,
  toDay: periods.at(-1)!.period,
  periods,
  points,
});

describe("pools to a majority", () => {
  it("counts reviewed pools, largest first, against every block of the month", () => {
    // 1,000 blocks; 40 unrecorded, so the groups sum to 960 and the denominator stays 1,000.
    const [m] = poolsToMajority(
      series(
        [period("2026-09-01", 1_000)],
        [
          cell("2026-09-01", "foundry", 200),
          cell("2026-09-01", "viabtc", 300),
          cell("2026-09-01", "f2pool", 150),
          cell("2026-09-01", "unattributed", 250),
          cell("2026-09-01", "shielded", 60),
        ],
      ),
    );
    // 300 (30%), +200 = 500 (50%: short), +150 = 650 (65%).
    expect(m).toEqual({
      period: "2026-09-01",
      partial: false,
      blocks: 1_000,
      pools: 3,
      poolsBlocks: 650,
      top1Blocks: 300,
      top3Blocks: 650,
      reviewedBlocks: 650,
    });
  });

  it("stops at exactly 51%, decided in integers", () => {
    const [m] = poolsToMajority(
      series(
        [period("2026-09-01", 100)],
        [
          cell("2026-09-01", "viabtc", 30),
          cell("2026-09-01", "luxor", 21),
          cell("2026-09-01", "f2pool", 20),
        ],
      ),
    );
    expect(m!.pools).toBe(2);
    expect(m!.poolsBlocks).toBe(51);
  });

  it("is null when every reviewed pool together mined less than 51%", () => {
    // Unattributed 500 of 1,000: more than 49%, so no count of reviewed pools reaches a majority.
    const [m] = poolsToMajority(
      series(
        [period("2017-01-01", 1_000)],
        [
          cell("2017-01-01", "f2pool", 300),
          cell("2017-01-01", "nicehash", 150),
          cell("2017-01-01", "unattributed", 500),
          cell("2017-01-01", "no-address", 50),
        ],
      ),
    );
    expect(m!.pools).toBeNull();
    expect(m!.reviewedBlocks).toBe(450);
    expect(m!.poolsBlocks).toBe(450);
    expect(m!.top3Blocks).toBe(450);
  });

  it("never counts the unattributed, shielded or no-address groups as a pool", () => {
    const [m] = poolsToMajority(
      series(
        [period("2026-09-01", 100)],
        [cell("2026-09-01", "unattributed", 90), cell("2026-09-01", "viabtc", 10)],
      ),
    );
    expect(m!.pools).toBeNull();
    expect(m!.top1Blocks).toBe(10);
  });

  it("answers a month with no blocks as null, never as zero pools", () => {
    const [m] = poolsToMajority(series([period("2026-09-01", 0)], []));
    expect(m!.pools).toBeNull();
    expect(m!.reviewedBlocks).toBe(0);
  });
});

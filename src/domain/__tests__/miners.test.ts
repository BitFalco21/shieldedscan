import { describe, expect, it } from "vitest";
import { NU7_HEIGHT } from "../halving";
import {
  groupMinersByPool,
  MINER_SUBSIDY_BEFORE_NU7_ZAT,
  minerFeeSharePct,
  minersWindowDays,
  minersWindowFromMining,
  minerValueUsd,
  nu7PeriodIndex,
  parseMinersWindow,
  seriesSharePct,
  seriesTransparent,
  type MinerAddressRow,
  type MinerSeries,
} from "../miners";

const NOON_6_NOV = Date.UTC(2026, 10, 6, 12) / 1000;
const parts = { closedUsd: 0, unpricedZat: 0, todayZat: 0 };

const row = (over: Partial<MinerAddressRow>): MinerAddressRow => ({
  address: "t1Some",
  miningPool: null,
  blocks: 1,
  rewardZat: 100_000_000,
  feeZat: 0,
  firstHeight: 1,
  lastHeight: 1,
  usd: parts,
  ...over,
});

describe("windows", () => {
  it("opens every window, 1Y and ALL included, since the NU6.1 row's repair", () => {
    expect(parseMinersWindow("7d")).toBe("7d");
    expect(parseMinersWindow("90d")).toBe("90d");
    expect(parseMinersWindow("1y")).toBe("1y");
    expect(parseMinersWindow("all")).toBe("all");
    expect(parseMinersWindow("nonsense")).toBe("30d");
    expect(parseMinersWindow(undefined)).toBe("30d");
  });

  it("are whole UTC days ending today, today included", () => {
    expect(minersWindowDays("7d", NOON_6_NOV)).toEqual({
      fromDay: "2026-10-31",
      toDay: "2026-11-06",
    });
    expect(minersWindowDays("30d", NOON_6_NOV).fromDay).toBe("2026-10-08");
    // One second before midnight is still the 6th; midnight is the 7th.
    expect(minersWindowDays("7d", Date.UTC(2026, 10, 7) / 1000 - 1).toDay).toBe("2026-11-06");
    expect(minersWindowDays("7d", Date.UTC(2026, 10, 7) / 1000).toDay).toBe("2026-11-07");
  });

  it("reach back a year for 1Y and to the first day for ALL", () => {
    expect(minersWindowDays("1y", NOON_6_NOV).fromDay).toBe("2025-11-07");
    expect(minersWindowDays("all", NOON_6_NOV).fromDay).toBe("1970-01-01");
  });

  it("map /mining's windows: rolling and absent ones to 7D, the others to themselves", () => {
    expect(minersWindowFromMining(undefined)).toBe("7d");
    expect(minersWindowFromMining("24h")).toBe("7d");
    expect(minersWindowFromMining("3d")).toBe("7d");
    expect(minersWindowFromMining("7d")).toBe("7d");
    expect(minersWindowFromMining("90d")).toBe("90d");
    expect(minersWindowFromMining("1y")).toBe("1y");
    expect(minersWindowFromMining("nonsense")).toBe("30d");
  });
});

describe("minerValueUsd", () => {
  it("adds closed days at their close to today at the live price", () => {
    const v = minerValueUsd(
      300_000_000,
      { closedUsd: 800, unpricedZat: 0, todayZat: 100_000_000 },
      500,
    );
    expect(v).toEqual({ usd: 1_300, floor: false });
  });

  it("is a floor when some day had no close, never priced at 0", () => {
    const v = minerValueUsd(
      300_000_000,
      { closedUsd: 800, unpricedZat: 100_000_000, todayZat: 0 },
      500,
    );
    expect(v).toEqual({ usd: 800, floor: true });
  });

  it("is null when the reward is unknown, or today has reward and no live price", () => {
    expect(minerValueUsd(null, parts, 500)).toBeNull();
    expect(minerValueUsd(1, { ...parts, todayZat: 1 }, null)).toBeNull();
    // No reward today: the live price is not needed.
    expect(minerValueUsd(1, { ...parts, closedUsd: 3 }, null)).toEqual({ usd: 3, floor: false });
  });
});

describe("groupMinersByPool", () => {
  it("sums only labelled rows by pool, largest first, and keeps unknown ids apart", () => {
    const g = groupMinersByPool([
      row({ address: "a", miningPool: "viabtc", blocks: 5 }),
      row({ address: "b", miningPool: "foundry", blocks: 7 }),
      row({ address: "c", miningPool: "viabtc", blocks: 4, rewardZat: null }),
      row({ address: "d", miningPool: "not-a-pool", blocks: 9 }),
    ]);
    expect(g.pools.map((p) => [p.pool.id, p.blocks, p.addresses.map((a) => a.address)])).toEqual([
      ["viabtc", 9, ["a", "c"]],
      ["foundry", 7, ["b"]],
    ]);
    // One unknown reward makes the pool's sum unknown, never a partial total.
    expect(g.pools[0]!.rewardZat).toBeNull();
    expect(g.strays.map((s) => s.address)).toEqual(["d"]);
  });

  it("never puts an unlabelled address in a pool", () => {
    const g = groupMinersByPool([row({ address: "x", miningPool: null })]);
    expect(g.pools).toEqual([]);
    expect(g.strays.map((s) => s.address)).toEqual(["x"]);
  });
});

const SERIES: MinerSeries = {
  interval: "day",
  fromDay: "2026-11-05",
  toDay: "2026-11-06",
  periods: [
    {
      period: "2026-11-05",
      blocks: 10,
      firstHeight: NU7_HEIGHT - 10,
      lastHeight: NU7_HEIGHT - 1,
      partial: false,
    },
    {
      period: "2026-11-06",
      blocks: 21,
      firstHeight: NU7_HEIGHT,
      lastHeight: NU7_HEIGHT + 20,
      partial: true,
    },
  ],
  points: [
    { period: "2026-11-05", group: "viabtc", blocks: 6, rewardZat: 600, feeZat: 6 },
    { period: "2026-11-05", group: "shielded", blocks: 4, rewardZat: null, feeZat: 40 },
    { period: "2026-11-06", group: "viabtc", blocks: 20, rewardZat: 800, feeZat: null },
  ],
};

describe("series", () => {
  it("shares name the period's blocks, unrecorded ones included", () => {
    expect(seriesSharePct(SERIES, "viabtc")).toEqual([60, (100 * 20) / 21]);
    expect(seriesSharePct(SERIES, "foundry")).toEqual([0, 0]);
  });

  it("sums transparent payouts only: a shielded coinbase's fees never join a miner's income", () => {
    expect(seriesTransparent(SERIES)).toEqual([
      { period: "2026-11-05", blocks: 6, rewardZat: 600, feeZat: 6 },
      { period: "2026-11-06", blocks: 20, rewardZat: 800, feeZat: null },
    ]);
  });

  it("finds the period holding NU7's first block", () => {
    expect(nu7PeriodIndex(SERIES)).toBe(1);
  });
});

describe("at the tip", () => {
  it("states the miner's fee share and the pre-NU7 subsidy from the consensus rules", () => {
    expect(minerFeeSharePct(NU7_HEIGHT - 1)).toBe(100);
    expect(minerFeeSharePct(NU7_HEIGHT)).toBe(40);
    expect(MINER_SUBSIDY_BEFORE_NU7_ZAT).toBe(125_000_000);
  });
});

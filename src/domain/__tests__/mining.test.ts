import { describe, expect, it } from "vitest";
import {
  attributedSharePct,
  avgBlockSeconds,
  estimateSolutionsPerSecond,
  foldMinerGroups,
  MINER_SIGNATURES,
  minerNodeSoftware,
  minerSharePct,
  type MinerGroup,
  type MiningWindow,
  parseMiningWindow,
  selfDeclaredMiner,
  shieldedCoinbaseSharePct,
  topMinerSharePct,
  windowSolutionRate,
  ZEBRA_COINBASE_MARK,
} from "../mining";

const group = (over: Partial<MinerGroup>): MinerGroup => ({
  address: "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7",
  name: null,
  basis: "unattributed",
  blocks: 1,
  selfDeclaredBlocks: 0,
  rewardZat: 137_510_000,
  feeZat: null,
  avgIntervalSeconds: null,
  ...over,
});

describe("selfDeclaredMiner", () => {
  // Tags captured from mainnet blocks 3,430,118–3,430,142.
  it("names an operator that wrote its own name into the coinbase", () => {
    expect(selfDeclaredMiner("🦓jjFoundry Zcash Pool #PrivacyMatters")).toBe("Foundry USA");
    expect(selfDeclaredMiner("/NiceHash/")).toBe("NiceHash");
  });

  it("does not treat the Zebra mark as an identity", () => {
    // Most sampled blocks carried this mark alone. It identifies node software, not a pool.
    expect(selfDeclaredMiner(ZEBRA_COINBASE_MARK)).toBeNull();
  });

  it("does not treat a worker name as a pool name", () => {
    // One payout address, varying trailing names: workers on some pool, not separate pools.
    expect(selfDeclaredMiner("🦓Mined by duan8626aTpn%")).toBeNull();
    expect(selfDeclaredMiner("🦓Mined by xluos8T<%")).toBeNull();
  });

  it("is null when there is no tag at all", () => {
    expect(selfDeclaredMiner(null)).toBeNull();
  });

  it("matches case-insensitively but never partially across a word boundary it invented", () => {
    expect(selfDeclaredMiner("FOUNDRY ZCASH POOL")).toBe("Foundry USA");
    expect(selfDeclaredMiner("Foundry")).toBeNull();
  });

  it("ships only signatures with a recorded observation height", () => {
    // A needle is added only once observed on-chain.
    for (const sig of MINER_SIGNATURES) {
      expect(sig.observedAt).toBeGreaterThan(0);
      expect(sig.needle.length).toBeGreaterThan(0);
    }
  });
});

describe("minerNodeSoftware", () => {
  it("reports Zebra from its coinbase mark, as software rather than identity", () => {
    expect(minerNodeSoftware("🦓")).toBe("zebra");
    expect(minerNodeSoftware("🦓jjFoundry Zcash Pool #PrivacyMatters")).toBe("zebra");
  });

  it("is null when the tag names no implementation", () => {
    expect(minerNodeSoftware("/NiceHash/")).toBeNull();
    expect(minerNodeSoftware(null)).toBeNull();
  });
});

describe("parseMiningWindow", () => {
  it("accepts the offered windows", () => {
    expect(parseMiningWindow("24h")).toBe("24h");
    expect(parseMiningWindow("1y")).toBe("1y");
  });

  it("defaults rather than failing on anything else", () => {
    expect(parseMiningWindow(undefined)).toBe("7d");
    expect(parseMiningWindow("'; DROP TABLE block;--")).toBe("7d");
    expect(parseMiningWindow("100y")).toBe("7d");
  });
});

describe("shares", () => {
  it("is zero rather than NaN on an empty window", () => {
    // A NaN must never reach the page.
    expect(minerSharePct(0, 0)).toBe(0);
    expect(topMinerSharePct([], 0)).toBe(0);
    expect(shieldedCoinbaseSharePct([], 0)).toBe(0);
    expect(attributedSharePct([], 0)).toBe(0);
  });

  it("sums the largest payout addresses for the concentration floor", () => {
    const groups = [
      group({ address: "t1a", blocks: 8 }),
      group({ address: "t1b", blocks: 5 }),
      group({ address: "t1c", blocks: 4 }),
      group({ address: "t1d", blocks: 3 }),
      group({ address: "t1e", blocks: 2 }),
      group({ address: "t1f", blocks: 3 }),
    ];
    // Top five by blocks: 8 + 5 + 4 + 3 + 3 = 23 of 25.
    expect(topMinerSharePct(groups, 25)).toBeCloseTo(92);
  });

  it("does not depend on the order groups arrive in", () => {
    const ascending = [group({ address: "t1a", blocks: 1 }), group({ address: "t1b", blocks: 9 })];
    const descending = [...ascending].reverse();
    expect(topMinerSharePct(ascending, 10, 1)).toBe(topMinerSharePct(descending, 10, 1));
    expect(topMinerSharePct(ascending, 10, 1)).toBeCloseTo(90);
  });

  it("counts a shielded coinbase by its null address, not by a name", () => {
    const groups = [group({ address: null, blocks: 3 }), group({ address: "t1a", blocks: 17 })];
    expect(shieldedCoinbaseSharePct(groups, 20)).toBeCloseTo(15);
  });

  it("counts only named groups as attributed", () => {
    const groups = [
      group({ address: "t1a", blocks: 5, name: "Foundry USA", basis: "self-declared" }),
      group({ address: "t1b", blocks: 15 }),
    ];
    expect(attributedSharePct(groups, 20)).toBeCloseTo(25);
  });
});

describe("foldMinerGroups", () => {
  const many = Array.from({ length: 14 }, (_, i) =>
    group({ address: `t1addr${i}`, blocks: 14 - i, rewardZat: 100 }),
  );

  it("keeps the largest and folds the rest without losing a block", () => {
    const { shown, folded } = foldMinerGroups(many, 10);
    expect(shown).toHaveLength(10);
    expect(folded).not.toBeNull();
    // 14 groups with 14…1 blocks: 105 total, top ten hold 95, the tail holds 10.
    const shownBlocks = shown.reduce((s, g) => s + g.blocks, 0);
    expect(shownBlocks + (folded?.blocks ?? 0)).toBe(105);
    expect(folded?.groups).toBe(4);
  });

  it("folds nothing when the ranking already fits", () => {
    const { shown, folded } = foldMinerGroups(many.slice(0, 3), 10);
    expect(shown).toHaveLength(3);
    expect(folded).toBeNull();
  });

  it("does not mutate the caller's array", () => {
    const input = [group({ address: "t1a", blocks: 1 }), group({ address: "t1b", blocks: 9 })];
    foldMinerGroups(input, 1);
    expect(input[0]?.address).toBe("t1a");
  });
});

describe("avgBlockSeconds", () => {
  const window = (over: Partial<MiningWindow>): MiningWindow => ({
    key: "7d",
    fromHeight: 3_430_118,
    toHeight: 3_430_142,
    blocks: 25,
    spanSeconds: 1_920,
    avgDifficulty: 207_630_000,
    avgTxCount: 5.2,
    avgFeeZat: null,
    solutionsPerSecond: null,
    ...over,
  });

  it("divides the span by the gaps, not by the blocks", () => {
    // 25 blocks span 24 intervals; dividing by 25 would report 76.8s for a chain at 80s.
    expect(avgBlockSeconds(window({}))).toBeCloseTo(80);
  });

  it("is null where an interval is not defined", () => {
    expect(avgBlockSeconds(window({ blocks: 1 }))).toBeNull();
    expect(avgBlockSeconds(window({ blocks: 0 }))).toBeNull();
  });

  describe("solution rate", () => {
    it("prefers the node's figure and says so", () => {
      const rate = windowSolutionRate(window({ solutionsPerSecond: 1_234 }));
      expect(rate).toEqual({ solps: 1_234, basis: "node" });
    });

    it("falls back to the estimate, labelled as one", () => {
      const rate = windowSolutionRate(window({}));
      expect(rate?.basis).toBe("estimated");
      // 8192 * 207.63M / 80s ≈ 21.3 GSol/s — the order of magnitude Zcash is quoted in.
      expect(rate?.solps).toBeGreaterThan(2e10);
      expect(rate?.solps).toBeLessThan(2.2e10);
    });

    it("never divides into Infinity or NaN", () => {
      expect(estimateSolutionsPerSecond(207_630_000, 0)).toBeNull();
      expect(estimateSolutionsPerSecond(207_630_000, -5)).toBeNull();
      expect(estimateSolutionsPerSecond(207_630_000, null)).toBeNull();
      expect(estimateSolutionsPerSecond(Number.NaN, 80)).toBeNull();
      // A single-block window has no interval, so there is no rate to state.
      expect(windowSolutionRate(window({ blocks: 1 }))).toBeNull();
    });
  });
});

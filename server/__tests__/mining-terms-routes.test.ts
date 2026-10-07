import { describe, expect, it } from "vitest";
import {
  buildMiningTerms,
  miningTermsRoutes,
  type MiningTermsChainSource,
} from "../mining-terms-routes";

/**
 * The terms route against a fake node. The one property every case guards: **the basis says
 * where the solution rate came from**, and a node that does not answer degrades to a labelled
 * estimate rather than a silent one or a failure.
 */

const chain = (over: Partial<MiningTermsChainSource> = {}): MiningTermsChainSource => ({
  getChainFacts: async () => ({ height: 3_472_984, bestBlockHash: "ab".repeat(32) }),
  getDifficultyByHash: async () => 216_327_100.7843388,
  getNetworkSolps: async () => 23_005_253_630,
  getBlockSubsidy: async () => ({ miner: 1.25 }),
  ...over,
});

const quote = (priceUsd: number) => ({
  current: () => ({ usd: priceUsd, change24hPct: 0, fetchedAt: 0 }),
});

describe("buildMiningTerms", () => {
  it("prefers the node's own solution rate and says so", async () => {
    const t = await buildMiningTerms({ chain: chain(), pool: null, price: quote(1007.86) });
    expect(t.networkSolps).toEqual({ value: 23_005_253_630, basis: "node" });
    expect(t.minerSubsidyZat).toBe(125_000_000);
    expect(t.subsidyChangesAtHeight).toBe(4_406_400);
    expect(t.blockIntervalSeconds).toBe(75);
    expect(t.priceUsd).toBe(1007.86);
    expect(t.height).toBe(3_472_984);
  });

  it("falls back to the difficulty estimate, labelled, when the node lacks the RPC", async () => {
    const t = await buildMiningTerms({
      chain: chain({ getNetworkSolps: async () => null }),
      pool: null,
      price: null,
    });
    expect(t.networkSolps.basis).toBe("estimated");
    // 8192 × difficulty / 75 s — the constant the node's answer was checked against.
    expect(t.networkSolps.value).toBeCloseTo((8192 * 216_327_100.7843388) / 75, -3);
    expect(t.priceUsd).toBeNull();
  });

  it("reads the difficulty of the TIP HASH, not of whatever height that was", async () => {
    let asked = "";
    await buildMiningTerms({
      chain: chain({
        getDifficultyByHash: async (h) => {
          asked = h;
          return 1;
        },
      }),
      pool: null,
      price: null,
    });
    expect(asked).toBe("ab".repeat(32));
  });
});

describe("GET /chain/mining/terms", () => {
  it("serves the terms and reuses them inside the cache window", async () => {
    let calls = 0;
    const app = miningTermsRoutes({
      chain: chain({
        getNetworkSolps: async () => {
          calls += 1;
          return 23_005_253_630;
        },
      }),
      pool: null,
      price: quote(1007.86),
    });
    const a = await app.request("/chain/mining/terms");
    const b = await app.request("/chain/mining/terms");
    expect(a.status).toBe(200);
    expect((await a.json()).networkSolps.basis).toBe("node");
    expect(b.status).toBe(200);
    expect(calls).toBe(1);
  });
});

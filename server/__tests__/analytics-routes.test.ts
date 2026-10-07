import { describe, expect, it } from "vitest";
import type { PoolName } from "@/domain";
import {
  IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK,
  SHIELDED_POOL_SUM_SQL,
  toNetworkDay,
} from "../analytics-routes";
import type { AnalyticsNetwork } from "../analytics-routes";

/**
 * The strip-a-pool tripwire for the pool sum shared by the activity and supply queries, so they
 * cannot sum different sets of pools (a missing pool would make every migration into it read as
 * ZEC leaving the pools).
 *
 * `Record<PoolName, true>` is the exhaustiveness half: adding a fifth pool to the domain makes
 * this file fail to compile until the entry is added here, and the runtime half then fails until
 * the sum carries the new column.
 */
describe("SHIELDED_POOL_SUM_SQL", () => {
  const everyPool: Record<PoolName, true> = {
    ironwood: true,
    orchard: true,
    sapling: true,
    sprout: true,
  };

  it("sums exactly one column for every shielded pool the domain defines", () => {
    const terms = SHIELDED_POOL_SUM_SQL.replace(/^\(|\)$/g, "").split(" + ");
    expect([...terms].sort()).toEqual(Object.keys(everyPool).sort());
  });

  it("is parenthesised, so it composes inside a larger expression", () => {
    expect(SHIELDED_POOL_SUM_SQL).toBe("(sprout + sapling + orchard + ironwood)");
  });
});

/**
 * NU6.3 activated at a different height on each network. The figures would be correct with the
 * wrong height (no Ironwood bundle exists below activation), but the label would lie and the
 * inflow query would scan blocks it has no business in, so the height itself is pinned.
 *
 * `Record<AnalyticsNetwork, ...>` makes a new network fail to compile until its height is filled
 * in, rather than silently inheriting mainnet's.
 */
describe("IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK", () => {
  // Read from each node's own getblockchaininfo.upgrades. Pinned, not fetched: an activation
  // height cannot change once active.
  const fromTheNodes: Record<AnalyticsNetwork, number> = {
    mainnet: 3_428_143,
    testnet: 4_134_000,
  };

  it("matches what each node reported", () => {
    for (const [network, height] of Object.entries(fromTheNodes)) {
      expect(
        IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK[network as AnalyticsNetwork],
        `${network} height drifted from the node it was read off`,
      ).toBe(height);
    }
  });

  it("gives the networks DIFFERENT heights — the whole bug was one value serving both", () => {
    const heights = Object.values(IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK);
    expect(new Set(heights).size).toBe(heights.length);
  });

  it("carries no height that could have been derived from the pool column", () => {
    // `min(height) WHERE ironwood_pool_zat IS NOT NULL` looks like the same fact and is not:
    // 3,428,144 on mainnet (off by one) and 4,134,683 on testnet (off by 683). Pinning those
    // instead would swap a known-right constant for a differently-wrong one.
    expect(IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK.mainnet).not.toBe(3_428_144);
    expect(IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK.testnet).not.toBe(4_134_683);
  });
});

/**
 * The mapper for `/chain/analytics/network-daily`. `block.difficulty` is NULL on rows written
 * before the column existed, `AVG` over an all-NULL day is NULL, and `Number(null)` is 0: a
 * chart would draw years of Zcash at zero difficulty. Downstream checks (`typeof === "number"`)
 * cannot catch a fabricated zero, so the refusal is here, where the NULL is still visible.
 *
 * `avgBlockBytes` comes from `size_bytes NOT NULL`, so coercing it is correct; the pair shows the
 * two columns are treated differently on purpose.
 */
describe("toNetworkDay", () => {
  it("keeps a day with no recorded difficulty as null, never 0", () => {
    expect(toNetworkDay({ ts: "1477612800", difficulty: null, bytes: "2665.74" })).toEqual({
      timestamp: 1_477_612_800,
      avgDifficulty: null,
      avgBlockBytes: 2665.74,
    });
  });

  it("passes a measured difficulty through unchanged", () => {
    expect(toNetworkDay({ ts: "1637107200", difficulty: 60_517_493.4, bytes: "1234.5" })).toEqual({
      timestamp: 1_637_107_200,
      avgDifficulty: 60_517_493.4,
      avgBlockBytes: 1234.5,
    });
  });

  it("does not confuse a genuine zero with an absent one", () => {
    // Unreachable for difficulty on a live chain, and that is the point: the mapper must not
    // be the thing deciding what 0 means. It reports what the column said.
    expect(toNetworkDay({ ts: "1", difficulty: 0, bytes: "0" }).avgDifficulty).toBe(0);
  });
});

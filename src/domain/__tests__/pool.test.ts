import { describe, expect, it } from "vitest";
import type { ShieldedPool, SupplyBreakdown } from "../pool";
import type { Transaction } from "../transaction";
import {
  POOL_BUNDLE,
  POOL_NAMES,
  POOL_NEEDS_TRUSTED_SETUP,
  circulatingZat,
  minedZat,
  poolBalances,
  setupFreeShieldedZat,
  totalShieldedZat,
  txPools,
} from "../pool";
import { hasShielded, netShieldedZat, reportsValueBalance } from "../classify";

describe("totalShieldedZat", () => {
  it("sums balances across the three pools", () => {
    const pools: ShieldedPool[] = [
      { pool: "orchard", balanceZat: 1_000 },
      { pool: "sapling", balanceZat: 2_000 },
      { pool: "sprout", balanceZat: 3_000 },
    ];
    expect(totalShieldedZat(pools)).toBe(6_000);
  });

  it("returns 0 for an empty list", () => {
    expect(totalShieldedZat([])).toBe(0);
  });
});

describe("POOL_BUNDLE / poolBalances — the one table every pool question reads", () => {
  /**
   * `POOL_BUNDLE` is a `Record<PoolName, …>`, so a new pool fails to compile in exactly one
   * place; everything below is derived from it.
   */
  const base: Transaction = {
    txid: "a".repeat(64),
    blockHeight: 1,
    blockHash: "b".repeat(64),
    timestamp: 0,
    isCoinbase: false,
    version: 5,
    sizeBytes: 100,
    lockTime: 0,
    expiryHeight: null,
    rawHex: null,
    feeZat: 10_000,
    bindingSigValid: null,
    transparentInputs: [],
    transparentOutputs: [],
    sprout: null,
    sapling: null,
    orchard: null,
    ironwood: null,
  };

  it("lists every balance-publishing bundle, newest pool first, and omits Sprout", () => {
    const tx = {
      ...base,
      sprout: { joinSplits: 1 },
      sapling: { spends: 1, outputs: 0, valueBalanceZat: -5 },
      ironwood: { actions: 2, valueBalanceZat: 4 },
    };
    expect(poolBalances(tx)).toEqual([
      { pool: "ironwood", zat: 4 },
      { pool: "sapling", zat: -5 },
    ]);
  });

  it("has an accessor for every pool name and nothing else", () => {
    expect(Object.keys(POOL_BUNDLE).sort()).toEqual([...POOL_NAMES].sort());
  });

  it("keeps the three named functions consistent with the table", () => {
    const sproutOnly = { ...base, sprout: { joinSplits: 2 } };
    expect(hasShielded(sproutOnly)).toBe(true);
    expect(reportsValueBalance(sproutOnly)).toBe(false);
    expect(txPools(sproutOnly)).toEqual(["sprout"]);
    const mixed = {
      ...base,
      orchard: { actions: 1, valueBalanceZat: 7 },
      sapling: { spends: 1, outputs: 1, valueBalanceZat: -3 },
    };
    expect(netShieldedZat(mixed)).toBe(4);
    expect(txPools(mixed)).toEqual(["orchard", "sapling"]);
  });
});

describe("circulatingZat / setupFreeShieldedZat — read off one partition", () => {
  // Mainnet's partition at block 3,497,881 (2026-09-27, /v1/supply), so the figures the
  // /fact-check page states are pinned against the chain rather than against a fixture.
  const partition: SupplyBreakdown = {
    height: 3_497_881,
    pools: [
      { pool: "transparent", balanceZat: 1_199_365_185_485_480 },
      { pool: "sprout", balanceZat: 2_231_740_137_602 },
      { pool: "sapling", balanceZat: 50_240_652_355_834 },
      { pool: "orchard", balanceZat: 38_024_780_522_418 },
      { pool: "lockbox", balanceZat: 6_590_287_500_000 },
      { pool: "ironwood", balanceZat: 399_054_558_053_146 },
    ],
  };

  it("excludes only the lockbox, matching the API's circulatingSupplyZat at that height", () => {
    // /v1/chain reported 1,688,916,916,554,480 at the same height.
    expect(circulatingZat(partition)).toBe(1_688_916_916_554_480);
    expect(minedZat(partition) - circulatingZat(partition)).toBe(6_590_287_500_000);
  });

  it("counts Orchard and Ironwood as setup-free, Sapling and Sprout as not", () => {
    expect(setupFreeShieldedZat(partition)).toBe(38_024_780_522_418 + 399_054_558_053_146);
    expect(POOL_NEEDS_TRUSTED_SETUP).toEqual({
      ironwood: false,
      orchard: false,
      sapling: true,
      sprout: true,
    });
  });

  it("never counts the transparent pool or the lockbox as setup-free shielded value", () => {
    const onlyPublic: SupplyBreakdown = {
      height: 1,
      pools: [
        { pool: "transparent", balanceZat: 5 },
        { pool: "lockbox", balanceZat: 7 },
      ],
    };
    expect(setupFreeShieldedZat(onlyPublic)).toBe(0);
    expect(circulatingZat(onlyPublic)).toBe(5);
  });
});

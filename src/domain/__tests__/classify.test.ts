import { describe, expect, it } from "vitest";
import type { Transaction } from "../transaction";
import { poolMigration } from "../pool";
import {
  hasShielded,
  netShieldedZat,
  reportsValueBalance,
  txDirection,
  txDirectionLabel,
  txKind,
  txKindLabel,
} from "../classify";

const base: Transaction = {
  txid: "ab".repeat(32),
  blockHeight: 100,
  blockHash: "0b".repeat(32),
  timestamp: 1_783_875_480,
  isCoinbase: false,
  version: 5,
  sizeBytes: 1000,
  lockTime: 0,
  expiryHeight: 140,
  rawHex: null,
  feeZat: 1000,
  bindingSigValid: true,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};
const tIn = { address: "t1ExampleInputAddress0000000001", valueZat: 100_000_000 };
const tOut = { address: "t1ExampleOutputAddress000000001", valueZat: 99_990_000 };
const orchard = { actions: 2, valueBalanceZat: -100_000_000 };

describe("txKind", () => {
  it("coinbase wins over everything", () => {
    expect(txKind({ ...base, isCoinbase: true, transparentOutputs: [tOut] })).toBe("coinbase");
  });
  it("transparent only", () => {
    expect(txKind({ ...base, transparentInputs: [tIn], transparentOutputs: [tOut] })).toBe(
      "transparent",
    );
  });
  it("fully shielded", () => {
    expect(txKind({ ...base, orchard })).toBe("shielded");
  });
  it("mixed when both sides present", () => {
    expect(txKind({ ...base, transparentInputs: [tIn], orchard })).toBe("mixed");
  });
});

describe("txDirection", () => {
  it("shielded for fully shielded", () => {
    expect(txDirection({ ...base, orchard })).toBe("shielded");
  });
  it("shielding when transparent funds enter the pool", () => {
    expect(txDirection({ ...base, transparentInputs: [tIn], orchard })).toBe("shielding");
  });
  it("unshielding when the pool pays transparent outputs", () => {
    expect(txDirection({ ...base, transparentOutputs: [tOut], orchard })).toBe("unshielding");
  });
  it("null for transparent and coinbase", () => {
    expect(
      txDirection({ ...base, transparentInputs: [tIn], transparentOutputs: [tOut] }),
    ).toBeNull();
    expect(txDirection({ ...base, isCoinbase: true, transparentOutputs: [tOut] })).toBeNull();
  });
});

describe("txKindLabel", () => {
  it("labels each kind", () => {
    expect(txKindLabel({ ...base, transparentInputs: [tIn], orchard })).toBe("SHIELDING");
    expect(txKindLabel({ ...base, transparentOutputs: [tOut], orchard })).toBe("UNSHIELDING");
    expect(txKindLabel({ ...base, orchard })).toBe("SHIELDED");
    expect(txKindLabel({ ...base, transparentInputs: [tIn], transparentOutputs: [tOut] })).toBe(
      "TRANSPARENT",
    );
    expect(txKindLabel({ ...base, isCoinbase: true, transparentOutputs: [tOut] })).toBe("COINBASE");
  });

  // `txKindLabel` derives from `txDirectionLabel`; asserting they agree catches a second,
  // divergent switch.
  it("agrees with txDirectionLabel wherever a direction exists", () => {
    const cases: Transaction[] = [
      { ...base, orchard },
      { ...base, transparentInputs: [tIn], orchard },
      { ...base, transparentOutputs: [tOut], orchard },
      { ...base, transparentInputs: [tIn], transparentOutputs: [tOut] },
      { ...base, isCoinbase: true, transparentOutputs: [tOut] },
    ];
    for (const tx of cases) {
      const dir = txDirectionLabel(tx);
      if (dir !== null) expect(txKindLabel(tx)).toBe(dir);
    }
  });

  it("carries no arrow notation on any branch", () => {
    const cases: Transaction[] = [
      { ...base, orchard },
      { ...base, transparentInputs: [tIn], orchard },
      { ...base, transparentOutputs: [tOut], orchard },
      { ...base, transparentInputs: [tIn], transparentOutputs: [tOut] },
      { ...base, isCoinbase: true, transparentOutputs: [tOut] },
      { ...base, sprout: { joinSplits: 1 }, transparentOutputs: [tOut] },
    ];
    for (const tx of cases) expect(txKindLabel(tx)).not.toMatch(/→|->/);
  });
});

/**
 * Ironwood-only transactions, modelled on real ones. `ced64c371…` in block 3,428,167 touches
 * Ironwood and nothing else (2 actions, no transparent side) and must classify as shielded.
 */
describe("ironwood classification", () => {
  const ironwoodOnly: Transaction = {
    ...base,
    ironwood: { actions: 2, valueBalanceZat: -10_000 },
  };

  it("classifies an ironwood-only transaction as fully shielded", () => {
    expect(txKind(ironwoodOnly)).toBe("shielded");
    expect(txDirection(ironwoodOnly)).toBe("shielded");
    expect(txKindLabel(ironwoodOnly)).toBe("SHIELDED");
  });

  it("treats ironwood plus a transparent side as mixed", () => {
    const shielding: Transaction = {
      ...ironwoodOnly,
      transparentInputs: [{ address: "t1Somebody", valueZat: 100_000_000 }],
    };
    expect(txKind(shielding)).toBe("mixed");
    expect(txDirection(shielding)).toBe("shielding");
  });

  it("nets an Orchard → Ironwood migration to the fee, not the migrated amount", () => {
    // `508c9d57…`: 5 ZEC leaves Orchard, 5 ZEC enters Ironwood, 0.0004 is the fee. The net
    // must include every pool, or it reads as five ZEC vanishing.
    const migration: Transaction = {
      ...base,
      orchard: { actions: 6, valueBalanceZat: -500_040_000 },
      ironwood: { actions: 2, valueBalanceZat: 500_000_000 },
    };
    expect(netShieldedZat(migration)).toBe(-40_000);
    expect(txKind(migration)).toBe("shielded");
  });

  it("keeps Sprout out of the value-balance question", () => {
    // Sprout is shielded but publishes no per-bundle balance, so a net figure would be a
    // fabricated zero. The two predicates must disagree here.
    const sproutOnly: Transaction = { ...base, sprout: { joinSplits: 2 } };
    expect(hasShielded(sproutOnly)).toBe(true);
    expect(reportsValueBalance(sproutOnly)).toBe(false);
  });
});

/**
 * Pool migrations, modelled on `ea0a65f6…` in block 3,428,172 (Sapling + Orchard → Ironwood).
 * The amount that crossed between pools is public.
 */
describe("poolMigration", () => {
  const migration: Transaction = {
    ...base,
    sapling: { spends: 1, outputs: 2, valueBalanceZat: -10_554_966_347 },
    orchard: { actions: 22, valueBalanceZat: -199_396_763_179 },
    ironwood: { actions: 2, valueBalanceZat: 209_951_599_526 },
  };

  it("names both source pools, the destination, and the amount that crossed", () => {
    expect(poolMigration(migration)).toEqual({
      // Newest pool first, the same order `txPools` and the type badges use.
      fromPools: ["orchard", "sapling"],
      toPool: "ironwood",
      amountZat: 209_951_599_526,
    });
  });

  it("leaves exactly the fee behind, which is the cross-check", () => {
    // The three balances must net to the fee: −105.54966347 − 1993.96763179 + 2099.51599526.
    expect(netShieldedZat(migration)).toBe(-130_000);
  });

  it("is not a migration when value only leaves pools", () => {
    // `ced64c371…`: Ironwood only, balance negative — a z→z transfer paying its fee out of
    // the pool. No destination pool, so nothing crossed.
    const inside: Transaction = { ...base, ironwood: { actions: 2, valueBalanceZat: -10_000 } };
    expect(poolMigration(inside)).toBeNull();
  });

  it("is not a migration when a transparent side is involved", () => {
    // Value entering a pool from transparent inputs is shielding, not a pool crossing, and
    // the shielding case already has its own wording.
    const shielding: Transaction = {
      ...base,
      transparentInputs: [{ address: "t1Somebody", valueZat: 100_000_000 }],
      orchard: { actions: 2, valueBalanceZat: 99_985_000 },
    };
    expect(poolMigration(shielding)).toBeNull();
  });

  it("refuses to apportion across two destinations", () => {
    // With two pools gaining, "how much went where" would be a guess. Null, not a split.
    const ambiguous: Transaction = {
      ...base,
      sapling: { spends: 1, outputs: 1, valueBalanceZat: 50_000_000 },
      orchard: { actions: 2, valueBalanceZat: -100_000_000 },
      ironwood: { actions: 2, valueBalanceZat: 49_990_000 },
    };
    expect(poolMigration(ambiguous)).toBeNull();
  });
});

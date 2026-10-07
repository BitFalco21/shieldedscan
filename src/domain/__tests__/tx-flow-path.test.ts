import { describe, expect, it } from "vitest";
import type { Transaction } from "../transaction";
import { txFlowPath } from "../tx-flow-path";

/**
 * The path a transaction's value took, as the DIRECTION column draws it.
 *
 * Every case here is either a claim the chain settles or a refusal. The refusals are the
 * half worth guarding: a path is a stronger statement than the word beside it, so anything
 * the published balances do not settle must return null and let the flat chip list stand.
 */

const base: Transaction = {
  txid: "ab".repeat(32),
  blockHeight: 3_449_072,
  blockHash: "0b".repeat(32),
  timestamp: 1_783_875_480,
  isCoinbase: false,
  version: 5,
  sizeBytes: 1000,
  lockTime: 0,
  expiryHeight: 140,
  rawHex: null,
  feeZat: 10_000,
  bindingSigValid: true,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};

const t = (valueZat: number) => ({ address: "t1Somebody", valueZat });

describe("txFlowPath", () => {
  it("names where a coinbase's newly created value landed", () => {
    // Issued value has no source, so the source end is `mined`, not a pool or transparent.
    const coinbase: Transaction = {
      ...base,
      isCoinbase: true,
      feeZat: null,
      transparentOutputs: [t(250_000_000), t(62_500_000)],
    };
    expect(txFlowPath(coinbase)).toEqual({ from: ["mined"], to: ["transparent"] });
  });

  it("names both destinations of a ZIP-213 coinbase that shields part of the reward", () => {
    // Consensus (ZIP 213) allows a coinbase to pay into a shielded pool; the path names where.
    const shieldedCoinbase: Transaction = {
      ...base,
      isCoinbase: true,
      feeZat: null,
      transparentOutputs: [t(62_500_000)],
      orchard: { actions: 2, valueBalanceZat: 250_000_000 },
    };
    expect(txFlowPath(shieldedCoinbase)).toEqual({
      from: ["mined"],
      to: ["transparent", "orchard"],
    });
  });

  it("drops the transparent end of a coinbase that pays only into a pool", () => {
    const allShielded: Transaction = {
      ...base,
      isCoinbase: true,
      feeZat: null,
      orchard: { actions: 2, valueBalanceZat: 312_500_000 },
    };
    expect(txFlowPath(allShielded)).toEqual({ from: ["mined"], to: ["orchard"] });
  });

  it("draws a pool migration source-first", () => {
    // `ea0a65f6…`, block 3,428,172: Sapling and Orchard drain into Ironwood.
    const migration: Transaction = {
      ...base,
      sapling: { spends: 1, outputs: 2, valueBalanceZat: -10_554_966_347 },
      orchard: { actions: 22, valueBalanceZat: -199_396_763_179 },
      ironwood: { actions: 2, valueBalanceZat: 209_951_599_526 },
    };
    expect(txFlowPath(migration)).toEqual({
      from: ["orchard", "sapling"],
      to: ["ironwood"],
    });
  });

  it("draws a shielding transaction from transparent into the pools it entered", () => {
    const shielding: Transaction = {
      ...base,
      transparentInputs: [t(100_000_000)],
      orchard: { actions: 2, valueBalanceZat: 60_000_000 },
      ironwood: { actions: 2, valueBalanceZat: 39_990_000 },
    };
    expect(txFlowPath(shielding)).toEqual({
      from: ["transparent"],
      to: ["ironwood", "orchard"],
    });
  });

  it("draws an unshielding transaction out to transparent", () => {
    // Asserted separately from its mirror: an implementation that hardcoded one side would
    // pass the shielding case and be backwards here.
    const unshielding: Transaction = {
      ...base,
      transparentOutputs: [t(99_990_000)],
      orchard: { actions: 2, valueBalanceZat: -99_990_000 },
    };
    expect(txFlowPath(unshielding)).toEqual({ from: ["orchard"], to: ["transparent"] });
  });

  it("names the pool on both ends of a transfer that stayed inside one pool", () => {
    // Nothing crossed a boundary; stating it explicitly keeps the column answerable on every row.
    const inside: Transaction = { ...base, ironwood: { actions: 2, valueBalanceZat: -10_000 } };
    expect(txFlowPath(inside)).toEqual({ from: ["ironwood"], to: ["ironwood"] });
  });

  it("names Sprout on both ends, which publishes no per-bundle balance", () => {
    // Nothing to check and nothing to contradict: one pool, no transparent side.
    const sprout: Transaction = { ...base, sprout: { joinSplits: 1 } };
    expect(txFlowPath(sprout)).toEqual({ from: ["sprout"], to: ["sprout"] });
  });

  it("still draws a Sprout crossing, where an agreement test would refuse it", () => {
    // `750b0dc0…`. Sprout's public values live on each JoinSplit rather than as a bundle
    // balance, so it can never contradict the direction — the value came from nowhere else.
    const sprout: Transaction = {
      ...base,
      transparentOutputs: [t(99_990_000)],
      sprout: { joinSplits: 1 },
    };
    expect(txFlowPath(sprout)).toEqual({ from: ["sprout"], to: ["transparent"] });
  });

  it("states both ends of a wholly transparent transaction", () => {
    const transparent: Transaction = {
      ...base,
      transparentInputs: [t(100_000_000)],
      transparentOutputs: [t(99_980_000)],
    };
    expect(txFlowPath(transparent)).toEqual({ from: ["transparent"], to: ["transparent"] });
  });

  it("refuses a path when two pools gain, because the split would be a guess", () => {
    const ambiguous: Transaction = {
      ...base,
      orchard: { actions: 4, valueBalanceZat: -200_000_000 },
      sapling: { spends: 1, outputs: 1, valueBalanceZat: 100_000_000 },
      ironwood: { actions: 2, valueBalanceZat: 99_990_000 },
    };
    expect(txFlowPath(ambiguous)).toBeNull();
  });

  it("refuses a path when the pools contradict the net direction", () => {
    // Transparent AND Sapling spent into Orchard: the net crossing is inward, so the WORD is
    // SHIELDING and correct, while `TRANSPARENT → ORCHARD SAPLING` would say Sapling gained.
    const disagreeing: Transaction = {
      ...base,
      transparentInputs: [t(100_000_000)],
      sapling: { spends: 1, outputs: 1, valueBalanceZat: -50_000_000 },
      orchard: { actions: 2, valueBalanceZat: 149_990_000 },
    };
    expect(txFlowPath(disagreeing)).toBeNull();
  });

  it("refuses a path across two pools when no migration is detectable", () => {
    // Sprout publishes no balance, so there is no leaving pool to name and this is not a
    // migration. Two pools with one direction unknowable is exactly a refusal.
    const twoPools: Transaction = {
      ...base,
      sprout: { joinSplits: 1 },
      sapling: { spends: 1, outputs: 1, valueBalanceZat: 100_000_000 },
    };
    expect(txFlowPath(twoPools)).toBeNull();
  });
});

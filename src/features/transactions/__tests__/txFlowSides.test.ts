import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain";
import { txFlowSides } from "../txFlowSides";
import { shieldedFacts } from "../shieldedFacts";

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

describe("txFlowSides", () => {
  it("transparent tx: no veils either side", () => {
    expect(txFlowSides({ ...base, transparentInputs: [tIn], transparentOutputs: [tOut] })).toEqual({
      spendingVeil: false,
      receivingVeil: false,
    });
  });

  it("t→z: transparent inputs left, receiving veil right", () => {
    expect(
      txFlowSides({
        ...base,
        transparentInputs: [tIn],
        orchard: { actions: 2, valueBalanceZat: 100_000_000 },
        ironwood: null,
      }),
    ).toEqual({ spendingVeil: false, receivingVeil: true });
  });

  it("z→t: spending veil left, transparent outputs right", () => {
    expect(
      txFlowSides({
        ...base,
        transparentOutputs: [tOut],
        orchard: { actions: 2, valueBalanceZat: -100_000_000 },
        ironwood: null,
      }),
    ).toEqual({ spendingVeil: true, receivingVeil: false });
  });

  it("z→z with negative net: veils on both sides", () => {
    expect(txFlowSides({ ...base, orchard: { actions: 2, valueBalanceZat: -10_000 } })).toEqual({
      spendingVeil: true,
      receivingVeil: true,
    });
  });

  it("z→z with net = 0: still veils on both sides (regression for finding 1)", () => {
    expect(txFlowSides({ ...base, orchard: { actions: 2, valueBalanceZat: 0 } })).toEqual({
      spendingVeil: true,
      receivingVeil: true,
    });
  });

  it("sprout-only unshield with transparent outputs: spending veil only (regression for finding 2 gating)", () => {
    expect(
      txFlowSides({
        ...base,
        transparentOutputs: [tOut],
        sprout: { joinSplits: 2 },
      }),
    ).toEqual({ spendingVeil: true, receivingVeil: false });
  });

  it("mixed with both transparent sides: receiving veil stacks with transparent outputs (regression for finding 3)", () => {
    expect(
      txFlowSides({
        ...base,
        transparentInputs: [tIn],
        transparentOutputs: [tOut],
        orchard: { actions: 2, valueBalanceZat: 50_000 },
        ironwood: null,
      }),
    ).toEqual({ spendingVeil: false, receivingVeil: true });
  });

  it("coinbase, transparent-only: no veils either side", () => {
    expect(txFlowSides({ ...base, isCoinbase: true, transparentOutputs: [tOut] })).toEqual({
      spendingVeil: false,
      receivingVeil: false,
    });
  });
});

describe("shieldedFacts", () => {
  it("Sprout-only tx: includes SPROUT JOINSPLITS, excludes NET TO POOL (regression for finding 1a)", () => {
    const tx = {
      ...base,
      sprout: { joinSplits: 2 },
      sapling: null,
      orchard: null,
      ironwood: null,
    };
    const facts = shieldedFacts(tx);
    expect(facts).toContainEqual({ label: "SPROUT JOINSPLITS", value: "2" });
    expect(facts.some((f) => f.label === "NET TO SHIELDED")).toBe(false);
  });

  it("Orchard tx with zero valueBalanceZat: NET TO SHIELDED value does not start with +", () => {
    const tx = {
      ...base,
      orchard: { actions: 2, valueBalanceZat: 0 },
      ironwood: null,
    };
    const facts = shieldedFacts(tx);
    const netToPool = facts.find((f) => f.label === "NET TO SHIELDED");
    expect(netToPool).toBeDefined();
    expect(netToPool!.value).not.toMatch(/^\+/);
  });

  it("Orchard tx with positive valueBalanceZat: NET TO SHIELDED value starts with +", () => {
    const tx = {
      ...base,
      orchard: { actions: 2, valueBalanceZat: 300_000_000 },
      ironwood: null,
    };
    const facts = shieldedFacts(tx);
    const netToPool = facts.find((f) => f.label === "NET TO SHIELDED");
    expect(netToPool).toBeDefined();
    expect(netToPool!.value).toMatch(/^\+/);
  });
});

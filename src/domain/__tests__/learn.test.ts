import { describe, expect, it } from "vitest";
import type { Transaction } from "../transaction";
import {
  LEARN_SIDE_CAP,
  learnIntoPoolsZat,
  learnOutOfPoolsZat,
  learnShape,
  learnTx,
} from "../learn";

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
  feeZat: 15_000,
  bindingSigValid: true,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};
const tIn = { address: "t1ExampleInputAddress0000000001", valueZat: 10_001_474 };
const tOut = { address: "t1ExampleOutputAddress000000001", valueZat: 2_000_000 };

describe("learnShape", () => {
  it("names each shape the way the rest of the site does", () => {
    expect(learnShape({ ...base, isCoinbase: true, transparentOutputs: [tOut] })).toBe("coinbase");
    expect(learnShape({ ...base, transparentInputs: [tIn], transparentOutputs: [tOut] })).toBe(
      "transparent",
    );
    expect(learnShape({ ...base, ironwood: { actions: 2, valueBalanceZat: -10_000 } })).toBe(
      "shielded",
    );
    expect(
      learnShape({
        ...base,
        transparentInputs: [tIn],
        ironwood: { actions: 2, valueBalanceZat: 9_986_474 },
      }),
    ).toBe("shielding");
    expect(
      learnShape({
        ...base,
        transparentOutputs: [tOut],
        ironwood: { actions: 2, valueBalanceZat: -2_015_000 },
      }),
    ).toBe("unshielding");
  });

  it("refuses to name one direction when the pools moved opposite ways", () => {
    // Transparent on both sides, Sapling spent, Orchard gained: no single direction exists.
    const tx: Transaction = {
      ...base,
      transparentInputs: [tIn],
      transparentOutputs: [tOut],
      sapling: { spends: 1, outputs: 0, valueBalanceZat: -5_000_000 },
      orchard: { actions: 2, valueBalanceZat: 3_000_000 },
    };
    expect(learnShape(tx)).toBe("mixed");
  });
});

describe("learnTx", () => {
  it("keeps every count and total exact when the lists are capped", () => {
    const many = Array.from({ length: LEARN_SIDE_CAP + 5 }, (_, i) => ({
      address: `t1Batch${String(i).padStart(26, "0")}`,
      valueZat: 1_000 + i,
    }));
    const t = learnTx({ ...base, transparentInputs: [tIn], transparentOutputs: many });
    expect(t.outputs).toHaveLength(LEARN_SIDE_CAP);
    expect(t.outputCount).toBe(many.length);
    expect(t.outputTotalZat).toBe(many.reduce((s, o) => s + o.valueZat, 0));
  });

  it("reads pool amounts from the pools' own balances, never from transparent totals", () => {
    const shielding = learnTx({
      ...base,
      transparentInputs: [tIn],
      ironwood: { actions: 2, valueBalanceZat: 9_986_474 },
    });
    expect(learnIntoPoolsZat(shielding)).toBe(9_986_474);
    expect(learnOutOfPoolsZat(shielding)).toBeNull();

    const unshielding = learnTx({
      ...base,
      transparentOutputs: [tOut],
      ironwood: { actions: 2, valueBalanceZat: -2_015_000 },
    });
    expect(learnOutOfPoolsZat(unshielding)).toBe(2_015_000);
    expect(learnIntoPoolsZat(unshielding)).toBeNull();
  });

  it("drops a pool that moved nothing, and lists Sprout without inventing a balance", () => {
    const t = learnTx({
      ...base,
      transparentOutputs: [tOut],
      sprout: { joinSplits: 1 },
      orchard: { actions: 2, valueBalanceZat: 0 },
    });
    expect(t.pools).toEqual(expect.arrayContaining(["sprout", "orchard"]));
    expect(t.poolMoves).toEqual([]);
    expect(learnOutOfPoolsZat(t)).toBeNull();
  });

  it("carries a mempool transaction as unconfirmed rather than at a height", () => {
    expect(learnTx({ ...base, blockHeight: null }).blockHeight).toBeNull();
  });
});

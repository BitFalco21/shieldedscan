import { describe, expect, it } from "vitest";
import { blockComposition } from "../block";
import type { Transaction } from "../transaction";

/** A block's contents by pool: a migration uses two pools and counts in both. */
const tx = (over: Partial<Transaction>): Transaction =>
  ({
    txid: "00".repeat(32),
    isCoinbase: false,
    transparentInputs: [],
    transparentOutputs: [],
    sprout: null,
    sapling: null,
    orchard: null,
    ironwood: null,
    ...over,
  }) as unknown as Transaction;

describe("blockComposition", () => {
  it("counts the transactions that used each pool beside the kinds", () => {
    const composition = blockComposition([
      tx({ isCoinbase: true, transparentOutputs: [{ address: "t1m", valueZat: 1 }] }),
      tx({
        orchard: { actions: 2, valueBalanceZat: 5 },
        ironwood: { actions: 2, valueBalanceZat: -4 },
      }),
      tx({ sapling: { spends: 0, outputs: 2, valueBalanceZat: -3 } }),
      tx({ sprout: { joinSplits: 1 } }),
    ] as Transaction[]);
    expect(composition.byPool).toEqual({ ironwood: 1, orchard: 1, sapling: 1, sprout: 1 });
    expect(composition.transparentTxs + composition.mixedTxs + composition.shieldedTxs).toBe(4);
  });

  it("is all zeros for a block that touched no pool", () => {
    const composition = blockComposition([
      tx({ isCoinbase: true, transparentOutputs: [{ address: "t1m", valueZat: 1 }] }),
    ]);
    expect(composition.byPool).toEqual({ ironwood: 0, orchard: 0, sapling: 0, sprout: 0 });
  });
});

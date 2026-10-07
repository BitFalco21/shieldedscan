import { describe, expect, it } from "vitest";
import { assetTickerIsKnown, type CrossChainTransfer } from "../crosschain";
import type { Transaction } from "../transaction";
import {
  issuanceZatBetween,
  lockboxLegForBlocks,
  pairSwapsWithTxs,
  pulseEventForTransfer,
  pulseEventForTx,
  pulseRadius,
  type PulseBlockPools,
  type PulseEvent,
} from "../pulse";

/**
 * Every case is a claim the chain settles or a refusal. This module adds amounts to
 * `txFlowPath`'s directions and must not soften any of its refusals.
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

describe("pulseEventForTx — coinbase", () => {
  it("sizes a coinbase on the subsidy, which is its outputs less the fees it collected", () => {
    // A coinbase collects the block's fees, so its outputs are subsidy + fees. Never a
    // hard-coded split.
    const coinbase: Transaction = {
      ...base,
      isCoinbase: true,
      feeZat: null,
      transparentOutputs: [t(250_000_000), t(62_500_000)],
    };
    const event = pulseEventForTx(coinbase, null, 40_000);
    expect(event.kind).toBe("coinbase");
    expect(event.shape).toBe("path");
    expect(event.subsidyZat).toBe(312_500_000 - 40_000);
    expect(event.subsidyIncludesFees).toBeUndefined();
    // The legs stay the per-destination outputs; apportioning the fee would be a guess.
    expect(event.legs).toEqual([{ from: "mined", to: "transparent", amountZat: 312_500_000 }]);
  });

  it("refuses to separate subsidy from fees when the block's fee total is not derivable", () => {
    const coinbase: Transaction = {
      ...base,
      isCoinbase: true,
      feeZat: null,
      transparentOutputs: [t(312_500_000)],
    };
    const event = pulseEventForTx(coinbase, null, null);
    expect(event.subsidyZat).toBeNull();
    expect(event.subsidyIncludesFees).toBe(true);
  });

  it("names both destinations of a ZIP-213 coinbase that shields part of the reward", () => {
    const shielded: Transaction = {
      ...base,
      isCoinbase: true,
      feeZat: null,
      transparentOutputs: [t(62_500_000)],
      orchard: { actions: 2, valueBalanceZat: 250_000_000 },
    };
    expect(pulseEventForTx(shielded, null, 0).legs).toEqual([
      { from: "mined", to: "transparent", amountZat: 62_500_000 },
      { from: "mined", to: "orchard", amountZat: 250_000_000 },
    ]);
  });

  it("refuses a subsidy it cannot total, rather than reading a missing net as zero", () => {
    // Unreachable on mainnet (only Sprout can be null and ZIP 213 postdates it), but reading
    // the null as 0 would understate the issuance.
    const coinbase: Transaction = {
      ...base,
      isCoinbase: true,
      feeZat: null,
      transparentOutputs: [t(62_500_000)],
      sprout: { joinSplits: 1 },
    };
    const event = pulseEventForTx(coinbase, null, 40_000);
    expect(event.subsidyZat).toBeNull();
    // The fee total WAS known, so this is a different unknown from the one below.
    expect(event.subsidyIncludesFees).toBeUndefined();
    expect(pulseEventForTx(coinbase, 0, 40_000).subsidyZat).toBe(62_500_000 - 40_000);
  });

  it("draws a wholly shielded coinbase as mined→orchard and nothing else", () => {
    const allShielded: Transaction = {
      ...base,
      isCoinbase: true,
      feeZat: null,
      orchard: { actions: 2, valueBalanceZat: 312_500_000 },
    };
    expect(pulseEventForTx(allShielded, null, 0).legs).toEqual([
      { from: "mined", to: "orchard", amountZat: 312_500_000 },
    ]);
  });
});

describe("pulseEventForTx — paths", () => {
  it("gives a multi-source migration one leg per source, each at its own published balance", () => {
    // `ea0a65f6…`, block 3,428,172: Sapling −105.54966347 and Orchard −1,993.96763179 out,
    // Ironwood +2,099.51599526 in. The 0.0013 gap is the fee leaving the shielded side.
    const migration: Transaction = {
      ...base,
      feeZat: 130_000,
      sapling: { spends: 1, outputs: 2, valueBalanceZat: -10_554_966_347 },
      orchard: { actions: 22, valueBalanceZat: -199_396_763_179 },
      ironwood: { actions: 4, valueBalanceZat: 209_951_599_526 },
    };
    const event = pulseEventForTx(migration, null);
    expect(event.shape).toBe("path");
    expect(event.legs).toEqual([
      { from: "orchard", to: "ironwood", amountZat: 199_396_763_179 },
      { from: "sapling", to: "ironwood", amountZat: 10_554_966_347 },
    ]);
    expect(event.feeZat).toBe(130_000);
  });

  it("carries a shielding leg at the pool's own balance, which excludes the fee", () => {
    const shielding: Transaction = {
      ...base,
      feeZat: 10_000,
      transparentInputs: [t(100_010_000)],
      orchard: { actions: 2, valueBalanceZat: 100_000_000 },
    };
    expect(pulseEventForTx(shielding, null).legs).toEqual([
      { from: "transparent", to: "orchard", amountZat: 100_000_000 },
    ]);
  });

  it("drops a pool that moved nothing rather than naming it beside one that did", () => {
    // `00fd2aa0…`: an Orchard bundle with a balance of exactly zero beside a Sapling
    // unshielding. `txFlowPath` names Orchard because it is present; it moved nothing.
    const unshielding: Transaction = {
      ...base,
      feeZat: 10_000,
      transparentOutputs: [t(2_718_900_000_000)],
      sapling: { spends: 4, outputs: 2, valueBalanceZat: -2_718_900_010_000 },
      orchard: { actions: 2, valueBalanceZat: 0 },
    };
    const event = pulseEventForTx(unshielding, null);
    expect(event.legs).toEqual([
      { from: "sapling", to: "transparent", amountZat: 2_718_900_010_000 },
    ]);
    expect(event.legs.some((l) => l.from === "orchard" || l.to === "orchard")).toBe(false);
  });

  it("draws a wholly transparent transfer as a ledger event at its public value", () => {
    const transparent: Transaction = {
      ...base,
      transparentInputs: [t(500_010_000)],
      transparentOutputs: [t(300_000_000), t(200_000_000)],
    };
    const event = pulseEventForTx(transparent, null);
    expect(event.shape).toBe("ledger");
    expect(event.legs).toEqual([
      { from: "transparent", to: "transparent", amountZat: 500_000_000 },
    ]);
  });
});

describe("pulseEventForTx — the Veil", () => {
  it("veils a transfer that stayed inside one pool, and carries no amount for it", () => {
    // The bundle's own balance is roughly minus the fee, so it must not be the amount.
    const inside: Transaction = {
      ...base,
      feeZat: 10_000,
      orchard: { actions: 4, valueBalanceZat: -10_000 },
    };
    const event = pulseEventForTx(inside, null);
    expect(event.shape).toBe("veil");
    expect(event.legs).toEqual([{ from: "orchard", to: "orchard", amountZat: null }]);
  });

  it("veils a Sprout-only transfer too, whatever Sprout's net says", () => {
    const inside: Transaction = { ...base, feeZat: 10_000, sprout: { joinSplits: 2 } };
    const event = pulseEventForTx(inside, 0);
    expect(event.shape).toBe("veil");
    expect(event.legs).toEqual([{ from: "sprout", to: "sprout", amountZat: null }]);
  });
});

describe("pulseEventForTx — Sprout", () => {
  it("takes a Sprout leg's amount from the net it is handed, in domain sign", () => {
    // `sproutNetZat` arrives already negated at the store boundary: positive = entering.
    const shielding: Transaction = {
      ...base,
      feeZat: 10_000,
      transparentInputs: [t(100_010_000)],
      sprout: { joinSplits: 1 },
    };
    expect(pulseEventForTx(shielding, 100_000_000).legs).toEqual([
      { from: "transparent", to: "sprout", amountZat: 100_000_000 },
    ]);
  });

  it("leaves a Sprout leg's amount null when the net was not carried, on a PATH not a veil", () => {
    // A null here means "not carried in this view", not "encrypted by design", so the shape
    // must not be `veil`.
    const unshielding: Transaction = {
      ...base,
      feeZat: 10_000,
      transparentOutputs: [t(100_000_000)],
      sprout: { joinSplits: 1 },
    };
    const event = pulseEventForTx(unshielding, null);
    expect(event.shape).toBe("path");
    expect(event.legs).toEqual([{ from: "sprout", to: "transparent", amountZat: null }]);
  });
});

describe("pulseEventForTx — the hub", () => {
  it("refuses a direction when the pools contradict each other, and states signed legs", () => {
    // `c0ffee01…`'s shape: transparent on both sides, Sapling down, Orchard up. No single
    // direction, so every leg attaches to the hub and the sign carries the direction.
    const mixed: Transaction = {
      ...base,
      feeZat: 15_000,
      transparentInputs: [t(200_000_000)],
      transparentOutputs: [t(50_000_000)],
      sapling: { spends: 2, outputs: 1, valueBalanceZat: -25_000_000 },
      orchard: { actions: 3, valueBalanceZat: 174_985_000 },
    };
    const event = pulseEventForTx(mixed, null);
    expect(event.shape).toBe("hub");
    expect(event.legs).toEqual([
      { from: "hub", to: "transparent", amountZat: -150_000_000 },
      { from: "hub", to: "orchard", amountZat: 174_985_000 },
      { from: "hub", to: "sapling", amountZat: -25_000_000 },
    ]);
    expect(event.feeZat).toBe(15_000);
  });

  it("never puts a node at both ends of a hub leg", () => {
    const mixed: Transaction = {
      ...base,
      transparentInputs: [t(200_000_000)],
      transparentOutputs: [t(50_000_000)],
      sapling: { spends: 2, outputs: 1, valueBalanceZat: -25_000_000 },
      orchard: { actions: 3, valueBalanceZat: 174_985_000 },
    };
    for (const leg of pulseEventForTx(mixed, null).legs) {
      expect([leg.from, leg.to].filter((e) => e === "hub")).toHaveLength(1);
    }
  });

  it("gives a hub's Sprout leg the net it is handed, and null when it has none", () => {
    const mixed: Transaction = {
      ...base,
      transparentInputs: [t(200_000_000)],
      transparentOutputs: [t(50_000_000)],
      sprout: { joinSplits: 1 },
      orchard: { actions: 3, valueBalanceZat: 174_985_000 },
      sapling: { spends: 2, outputs: 1, valueBalanceZat: -25_000_000 },
    };
    expect(pulseEventForTx(mixed, -30_000_000).legs).toContainEqual({
      from: "hub",
      to: "sprout",
      amountZat: -30_000_000,
    });
    expect(pulseEventForTx(mixed, null).legs).toContainEqual({
      from: "hub",
      to: "sprout",
      amountZat: null,
    });
  });

  it("drops a zero-balance pool from a hub as well as from a path", () => {
    const mixed: Transaction = {
      ...base,
      transparentInputs: [t(200_000_000)],
      transparentOutputs: [t(50_000_000)],
      sapling: { spends: 2, outputs: 1, valueBalanceZat: -25_000_000 },
      orchard: { actions: 3, valueBalanceZat: 174_985_000 },
      ironwood: { actions: 2, valueBalanceZat: 0 },
    };
    expect(pulseEventForTx(mixed, null).legs.some((l) => l.to === "ironwood")).toBe(false);
  });
});

describe("pulseEventForTx — mempool", () => {
  it("marks a transaction with no block as pending, with no height to light", () => {
    const pending: Transaction = {
      ...base,
      blockHeight: null,
      blockHash: null,
      transparentInputs: [t(500_010_000)],
      transparentOutputs: [t(500_000_000)],
    };
    const event = pulseEventForTx(pending, null);
    expect(event.pending).toBe(true);
    expect(event.height).toBeNull();
    expect(event.blockHash).toBeNull();
  });

  it("leaves a confirmed transaction's pending flag absent rather than false", () => {
    const confirmed = pulseEventForTx({ ...base, transparentOutputs: [t(1)] }, null);
    expect(confirmed.pending).toBeUndefined();
    expect(confirmed.height).toBe(3_449_072);
  });
});

const transfer: CrossChainTransfer = {
  id: "near-5521",
  direction: "in",
  protocol: "near-intents",
  counterpartChain: "ETH",
  counterpartAsset: "ETH",
  counterpartAmount: 0.15,
  counterpartIsSynthetic: false,
  counterpartTxHash: null,
  counterpartAddress: null,
  zcashTxid: "cd".repeat(32),
  zcashAddress: "t1KLMNoPqRsTuVwXyZaBcDeFgHiJkLmNoPq",
  zecAmountZat: 390_000_000,
  usdValueAtSwap: null,
  counterpartUsdAtSwap: null,
  venueDepositAddress: null,
  status: "completed",
  timestamp: 1_783_875_400,
};

describe("pulseEventForTransfer", () => {
  it("draws a completed inbound crossing from the chain into the transparent box", () => {
    const event = pulseEventForTransfer(transfer);
    expect(event).not.toBeNull();
    expect(event?.kind).toBe("swap");
    expect(event?.venue).toBe("near-intents");
    expect(event?.zcashTxid).toBe("cd".repeat(32));
    expect(event?.at).toBe(1_783_875_400);
    // A venue's row names no Zcash block, so it lights none.
    expect(event?.height).toBeNull();
    expect(event?.legs).toEqual([{ from: "chain:ETH", to: "transparent", amountZat: 390_000_000 }]);
  });

  it("ends a crossing delivered to a unified address at the boundary hub", () => {
    const event = pulseEventForTransfer({ ...transfer, zcashAddress: `u1${"a".repeat(40)}` });
    expect(event?.legs).toEqual([{ from: "chain:ETH", to: "hub", amountZat: 390_000_000 }]);
  });

  it("ends a crossing delivered to a sapling address at the boundary hub", () => {
    const event = pulseEventForTransfer({ ...transfer, zcashAddress: `zs1${"a".repeat(40)}` });
    expect(event?.legs[0]?.to).toBe("hub");
  });

  it("ends at the hub when the venue published no Zcash address to classify", () => {
    // An address we cannot read must not be attributed to the transparent box.
    expect(pulseEventForTransfer({ ...transfer, zcashAddress: null })?.legs[0]?.to).toBe("hub");
  });

  it("reverses the ends for an outbound crossing", () => {
    const event = pulseEventForTransfer({ ...transfer, direction: "out" });
    expect(event?.legs).toEqual([{ from: "transparent", to: "chain:ETH", amountZat: 390_000_000 }]);
  });

  it("refuses a pending crossing — it has not happened yet", () => {
    expect(pulseEventForTransfer({ ...transfer, status: "pending" })).toBeNull();
  });

  it("refuses a refunded crossing — it was undone", () => {
    expect(pulseEventForTransfer({ ...transfer, status: "refunded" })).toBeNull();
  });

  it("carries the venue's own counterpart facts, so a title derives from the event alone", () => {
    const event = pulseEventForTransfer({ ...transfer, counterpartAsset: "USDT" });
    expect(event?.counterpartChain).toBe("ETH");
    expect(event?.counterpartAsset).toBe("USDT");
    expect(event?.counterpartIsSynthetic).toBe(false);
    expect(assetTickerIsKnown(event!.counterpartAsset!)).toBe(true);
  });

  it("keeps a placeholder where a ticker belongs, so the event can say `ticker unknown`", () => {
    // NEAR Intents' "<CHAIN> asset" placeholder is kept verbatim, never coerced to a ticker.
    const event = pulseEventForTransfer({ ...transfer, counterpartAsset: "SOL asset" });
    expect(event?.counterpartAsset).toBe("SOL asset");
    expect(assetTickerIsKnown(event!.counterpartAsset!)).toBe(false);
  });

  it("marks a wrapped counterpart, because 1 ZEC and 1 wrapped ZEC are not one claim", () => {
    const event = pulseEventForTransfer({
      ...transfer,
      counterpartChain: "MAYA",
      counterpartAsset: "ZEC/ZEC",
      counterpartIsSynthetic: true,
    });
    expect(event?.counterpartIsSynthetic).toBe(true);
    expect(event?.legs[0]?.from).toBe("chain:MAYA");
  });

  it("uppercases the chain node so one chain is one node", () => {
    expect(pulseEventForTransfer({ ...transfer, counterpartChain: "eth" })?.legs[0]?.from).toBe(
      "chain:ETH",
    );
  });
});

describe("pairSwapsWithTxs", () => {
  const txEvent = (txid: string): PulseEvent =>
    pulseEventForTx(
      { ...base, txid, transparentInputs: [t(390_010_000)], transparentOutputs: [t(390_000_000)] },
      null,
    );

  it("folds a swap into its Zcash-leg transaction as one movement with a chain head", () => {
    const tx = txEvent("cd".repeat(32));
    const swap = pulseEventForTransfer(transfer)!;
    const paired = pairSwapsWithTxs([swap, tx]);
    expect(paired).toHaveLength(1);
    const merged = paired[0]!;
    expect(merged.id).toBe(tx.id);
    expect(merged.venue).toBe("near-intents");
    expect(merged.legs[0]).toEqual({
      from: "chain:ETH",
      to: "transparent",
      amountZat: 390_000_000,
    });
    expect(merged.legs).toHaveLength(2);
  });

  it("appends the chain head at the far end for an outbound crossing", () => {
    const tx = txEvent("cd".repeat(32));
    const swap = pulseEventForTransfer({ ...transfer, direction: "out" })!;
    const merged = pairSwapsWithTxs([tx, swap])[0]!;
    expect(merged.legs[merged.legs.length - 1]).toEqual({
      from: "transparent",
      to: "chain:ETH",
      amountZat: 390_000_000,
    });
  });

  it("carries the venue's counterpart facts onto the transaction it folds into", () => {
    const tx = txEvent("cd".repeat(32));
    const swap = pulseEventForTransfer({ ...transfer, counterpartAsset: "SOL asset" })!;
    const merged = pairSwapsWithTxs([swap, tx])[0]!;
    expect(merged.counterpartChain).toBe("ETH");
    expect(merged.counterpartAsset).toBe("SOL asset");
    expect(merged.counterpartIsSynthetic).toBe(false);
  });

  it("leaves the chain head and the chain's own legs DISJOINT when they do not meet", () => {
    // Neither the venue's row nor the chain's settles what happened between them, so the two
    // segments must not be joined up.
    const shielding = pulseEventForTx(
      {
        ...base,
        txid: "cd".repeat(32),
        transparentInputs: [t(390_010_000)],
        orchard: { actions: 2, valueBalanceZat: 390_000_000 },
      },
      null,
    );
    const swap = pulseEventForTransfer({ ...transfer, zcashAddress: `u1${"a".repeat(40)}` })!;
    const merged = pairSwapsWithTxs([swap, shielding])[0]!;
    expect(merged.legs).toEqual([
      { from: "chain:ETH", to: "hub", amountZat: 390_000_000 },
      { from: "transparent", to: "orchard", amountZat: 390_000_000 },
    ]);
  });

  it("pairs on the txid alone and never on amount or time", () => {
    // Identical amount, identical instant, different transaction: not the same movement.
    const tx = txEvent("ef".repeat(32));
    const swap = pulseEventForTransfer({ ...transfer, timestamp: tx.at })!;
    const paired = pairSwapsWithTxs([swap, tx]);
    expect(paired).toHaveLength(2);
    expect(paired.map((e) => e.venue)).toEqual(["near-intents", undefined]);
  });

  it("leaves a swap whose Zcash leg has not settled standing on its own", () => {
    const swap = pulseEventForTransfer({ ...transfer, zcashTxid: null })!;
    expect(pairSwapsWithTxs([swap])).toEqual([swap]);
  });

  it("keeps every non-swap event and its order", () => {
    const a = txEvent("11".repeat(32));
    const b = txEvent("22".repeat(32));
    expect(pairSwapsWithTxs([a, b]).map((e) => e.id)).toEqual([a.id, b.id]);
  });
});

const pools = (lockboxZat: number | null): PulseBlockPools["pools"] => ({
  transparent: 1,
  sprout: 1,
  sapling: 1,
  orchard: 1,
  ironwood: 1,
  lockbox: lockboxZat,
});

const blockPools = (
  height: number,
  hash: string,
  prevHash: string,
  lockboxZat: number | null,
): PulseBlockPools => ({
  height,
  hash,
  prevHash,
  timestamp: 1_783_875_480,
  receivedAt: 1_783_875_483,
  pools: pools(lockboxZat),
});

describe("lockboxLegForBlocks", () => {
  const prev = blockPools(100, "aa", "99", 1_000_000);
  const cur = blockPools(101, "bb", "aa", 1_018_750_000 + 1_000_000);

  it("draws the delta between two chained blocks", () => {
    const event = lockboxLegForBlocks(prev, cur);
    expect(event?.kind).toBe("lockbox");
    expect(event?.height).toBe(101);
    expect(event?.blockHash).toBe("bb");
    expect(event?.legs).toEqual([{ from: "mined", to: "lockbox", amountZat: 1_018_750_000 }]);
  });

  it("refuses when there is no previous block to subtract", () => {
    expect(lockboxLegForBlocks(null, cur)).toBeNull();
  });

  it("refuses when the two rows do not chain, so the delta spans a gap", () => {
    expect(lockboxLegForBlocks({ ...prev, hash: "zz" }, cur)).toBeNull();
  });

  it("refuses when either side did not report the pool — never a fabricated zero", () => {
    expect(lockboxLegForBlocks({ ...prev, pools: pools(null) }, cur)).toBeNull();
    expect(lockboxLegForBlocks(prev, { ...cur, pools: pools(null) })).toBeNull();
  });

  it("refuses a delta of zero — nothing was deferred, so there is no movement to draw", () => {
    expect(lockboxLegForBlocks(prev, { ...cur, pools: pools(1_000_000) })).toBeNull();
  });

  it("refuses a negative delta, which no transaction can produce", () => {
    expect(lockboxLegForBlocks(prev, { ...cur, pools: pools(1) })).toBeNull();
  });
});

describe("pulseRadius", () => {
  it("floors an amount this view does not carry rather than drawing nothing", () => {
    expect(pulseRadius(null)).toBe(6);
  });

  it("floors an amount of zero", () => {
    expect(pulseRadius(0)).toBe(6);
  });

  it("never falls below the floor or rises above the cap", () => {
    for (const zat of [null, 0, 1, 100, 1e8, 1e11, 1e15, Number.MAX_SAFE_INTEGER]) {
      const r = pulseRadius(zat);
      expect(r).toBeGreaterThanOrEqual(6);
      expect(r).toBeLessThanOrEqual(16);
    }
  });

  it("grows with the amount and never shrinks", () => {
    const amounts = [0, 1, 1_000, 100_000_000, 10_000_000_000, 1e12, 1e14];
    const radii = amounts.map((a) => pulseRadius(a));
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]!).toBeGreaterThanOrEqual(radii[i - 1]!);
    }
    // And it genuinely moves, or the floor would be the only size anything ever gets.
    expect(radii[radii.length - 1]!).toBeGreaterThan(radii[0]!);
  });

  it("scales by area, so four times the value is twice the distance up the range", () => {
    // Radius ∝ √amount keeps area proportional to value, which is what an eye reads.
    const one = pulseRadius(1_000_000_000) - 6;
    const four = pulseRadius(4_000_000_000) - 6;
    expect(four / one).toBeCloseTo(2, 6);
  });

  it("sizes a signed hub leg on its magnitude", () => {
    expect(pulseRadius(-4_000_000_000)).toBe(pulseRadius(4_000_000_000));
  });

  it("honours a caller's own floor and cap", () => {
    expect(pulseRadius(null, 2, 9)).toBe(2);
    expect(pulseRadius(Number.MAX_SAFE_INTEGER, 2, 9)).toBe(9);
  });
});

describe("issuanceZatBetween", () => {
  const at = (height: number, six: Partial<PulseBlockPools["pools"]> = {}): PulseBlockPools => ({
    height,
    hash: `h${height}`,
    prevHash: `h${height - 1}`,
    timestamp: 1_783_875_480,
    receivedAt: null,
    pools: {
      transparent: 100,
      sprout: 10,
      sapling: 20,
      orchard: 30,
      ironwood: 40,
      lockbox: 50,
      ...six,
    },
  });

  it("is the difference of the six closes, which is what was issued between them", () => {
    // Movements between pools cancel, leaving only what the chain created.
    const issued = issuanceZatBetween(
      at(100),
      at(200, { transparent: 90, sapling: 25, orchard: 30, ironwood: 45, lockbox: 62 }),
    );
    expect(issued).toBe(90 + 10 + 25 + 30 + 45 + 62 - (100 + 10 + 20 + 30 + 40 + 50));
  });

  it("is zero across a span in which nothing was mined, which is a measurement", () => {
    expect(issuanceZatBetween(at(100), at(100))).toBe(0);
  });

  it("refuses without a row to subtract, rather than reading the newer row as issuance", () => {
    expect(issuanceZatBetween(null, at(200))).toBeNull();
  });

  it("refuses when ANY of the twelve figures is absent — never a pool read as zero", () => {
    for (const pool of [
      "transparent",
      "sprout",
      "sapling",
      "orchard",
      "ironwood",
      "lockbox",
    ] as const) {
      expect(issuanceZatBetween(at(100, { [pool]: null }), at(200))).toBeNull();
      expect(issuanceZatBetween(at(100), at(200, { [pool]: null }))).toBeNull();
    }
  });

  it("refuses a negative difference, which no issuance can be", () => {
    expect(issuanceZatBetween(at(200), at(100, { transparent: 1 }))).toBeNull();
  });
});

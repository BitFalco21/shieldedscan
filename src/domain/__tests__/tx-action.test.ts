import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain";
import { formatZecAmount } from "@/lib/format";
import { txAction, type ActionPart } from "../tx-action";

/** The sentence as a reader hears it, with each chip written as `[name]`. */
function read(parts: readonly ActionPart[]): string {
  return parts
    .map((p) => {
      switch (p.kind) {
        case "text":
        case "verb":
          return p.text;
        case "zec":
          return `${p.zat === null ? "▓▓▓▓▓▓" : formatZecAmount(p.zat)} ZEC`;
        case "end":
          return `${p.before ?? ""}[${p.end}]${p.after ?? ""}`;
        default:
          return `<${p.kind}>`;
      }
    })
    .join("");
}

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
  feeZat: 10_000,
  bindingSigValid: true,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};

describe("txAction", () => {
  it("draws a fully shielded transfer behind the Veil, with no number at all", () => {
    const action = txAction({ ...base, orchard: { actions: 2, valueBalanceZat: -10_000 } });
    expect(read(action.parts)).toBe("Moved ▓▓▓▓▓▓ ZEC privately inside [orchard]");
    // Even the fee does not belong in a sentence about what moved, and nothing is priced.
    expect(read(action.parts)).not.toMatch(/\d/);
    expect(action.amountZat).toBeNull();
    expect(action.limit).toMatch(/viewing key/);
  });

  it("counts and totals a transparent transaction without guessing the recipient", () => {
    const action = txAction({
      ...base,
      transparentInputs: [{ address: "t1Alice", valueZat: 419_921_000 }],
      transparentOutputs: [
        { address: "t1Recipient", valueZat: 400_000_000 },
        { address: "t1Alice", valueZat: 19_911_000 },
      ],
    });
    const sentence = read(action.parts);
    // The outputs total — never one output picked as "the" payment.
    expect(sentence).toBe(
      "Moved 4.19911 ZEC from 1 [transparent] input to 2 [transparent] outputs",
    );
    expect(action.limit).toBe("Which output is the payment and which is change.");
    // The exact framing chain-analysis relies on must never appear, nor any address.
    expect(sentence).not.toMatch(/sent .* to/);
    expect(sentence).not.toContain("t1");
  });

  it("uses the pool's own balance for a shielding, not the fee-inclusive input total", () => {
    const action = txAction({
      ...base,
      transparentInputs: [
        { address: "t1Alice", valueZat: 240_000_000 },
        { address: "t1Alice", valueZat: 60_100_000 },
      ],
      orchard: { actions: 2, valueBalanceZat: 300_000_000 },
    });
    // Inputs total 3.001 ZEC, but exactly 3.00 crossed into the pool.
    expect(read(action.parts)).toBe("Shielded 3.00 ZEC from [transparent] into [orchard]");
    expect(action.amountZat).toBe(300_000_000);
  });

  it("describes an unshielding by what LEFT THE POOL, not by what landed", () => {
    const action = txAction({
      ...base,
      transparentOutputs: [{ address: "t1Bob", valueZat: 550_000_000 }],
      orchard: { actions: 3, valueBalanceZat: -550_010_000 },
    });
    // 5.5001 left the pool; 5.50 reached the output and 0.0001 was the fee.
    expect(read(action.parts)).toBe(
      "Unshielded 5.5001 ZEC from [orchard] to 1 [transparent] output",
    );
    expect(action.limit).toBe("Where it came from inside Orchard.");
  });

  it("does not claim both directions when the pools all moved one way", () => {
    // Mainnet `dbb5361b…` (block 3,432,823): one transparent input, one transparent output,
    // Ironwood +0.00159649. Nothing was unshielded — and the output is still not called change.
    const action = txAction({
      ...base,
      transparentInputs: [{ address: "t1Ku2K", valueZat: 16_991_940_940 }],
      transparentOutputs: [{ address: "t1Ku2K", valueZat: 16_991_766_291 }],
      ironwood: { actions: 2, valueBalanceZat: 159_649 },
    });
    expect(read(action.parts)).toBe(
      "Shielded 0.00159649 ZEC from [transparent] into [ironwood], and paid 1 [transparent] output",
    );
    expect(read(action.parts)).not.toMatch(/both ways/);
    expect(action.limit).toMatch(/which transparent output is a payment and which is change/);
  });

  it("names no direction when the pools moved opposite ways", () => {
    const action = txAction({
      ...base,
      transparentInputs: [{ address: "t1A", valueZat: 50_000_000 }],
      transparentOutputs: [{ address: "t1B", valueZat: 9_980_000 }],
      sapling: { spends: 1, outputs: 0, valueBalanceZat: -30_000_000 },
      orchard: { actions: 2, valueBalanceZat: 70_000_000 },
    });
    expect(read(action.parts)).toBe(
      "Moved value both ways between [transparent], [orchard] and [sapling]",
    );
    expect(action.amountZat).toBeNull();
  });

  it("states no amount for a Sprout crossing rather than a fabricated 0.00", () => {
    const action = txAction({
      ...base,
      transparentInputs: [{ address: "t1A", valueZat: 50_000_000 }],
      sprout: { joinSplits: 1 },
    } as Transaction);
    expect(read(action.parts)).not.toContain("0.00");
    expect(action.amountZat).toBeNull();
  });

  it("describes a coinbase as paid out from issuance, withholding nothing", () => {
    const action = txAction({
      ...base,
      isCoinbase: true,
      feeZat: null,
      transparentOutputs: [
        { address: "t1Miner", valueZat: 250_000_000 },
        { address: "t3Stream", valueZat: 62_500_000 },
      ],
    });
    expect(read(action.parts)).toBe(
      "Paid out 3.125 ZEC — new coins plus the block’s fees — from [mined] to 2 [transparent] outputs",
    );
    expect(action.limitLabel).toBe("ON CHAIN");
  });

  it("states a ZIP-213 coinbase's pool share from that pool's own balance", () => {
    const action = txAction({
      ...base,
      isCoinbase: true,
      feeZat: null,
      orchard: { actions: 1, valueBalanceZat: 250_000_000 },
    });
    expect(read(action.parts)).toContain("2.50 ZEC");
    expect(read(action.parts)).toContain("to [orchard]");
    expect(action.limit).toMatch(/recipient is encrypted/);
  });
});

/**
 * A migration is fully shielded, but describing it as a transfer "inside" the pools it spans
 * is wrong — the amount that crossed is a published fact. From `ea0a65f6…`, block 3,428,172.
 */
describe("txAction for a pool migration", () => {
  const migration: Transaction = {
    ...base,
    sapling: { spends: 1, outputs: 2, valueBalanceZat: -10_554_966_347 },
    orchard: { actions: 22, valueBalanceZat: -199_396_763_179 },
    ironwood: { actions: 2, valueBalanceZat: 209_951_599_526 },
  };

  it("calls it a migration and names the amount that crossed", () => {
    expect(read(txAction(migration).parts)).toBe(
      "Migrated 2,099.51599526 ZEC from [orchard] and [sapling] into [ironwood]",
    );
  });

  it("stops short of the parties, which stay encrypted", () => {
    const action = txAction(migration);
    expect(read(action.parts)).not.toMatch(/sent .* to/);
    expect(action.limit).toMatch(/Who moved it/);
  });

  it("still describes a same-pool shielded transfer as a transfer", () => {
    const inside: Transaction = { ...base, ironwood: { actions: 2, valueBalanceZat: -10_000 } };
    expect(read(txAction(inside).parts)).toBe("Moved ▓▓▓▓▓▓ ZEC privately inside [ironwood]");
  });
});

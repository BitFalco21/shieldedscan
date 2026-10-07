import { describe, expect, it } from "vitest";
import type { Transaction } from "../transaction";
import { blockMiner } from "../miner";

const coinbaseBase: Transaction = {
  txid: "cb".repeat(32),
  blockHeight: 3_426_987,
  blockHash: "0b".repeat(32),
  timestamp: 1_783_875_480,
  isCoinbase: true,
  version: 5,
  sizeBytes: 312,
  lockTime: 0,
  expiryHeight: null,
  rawHex: null,
  feeZat: null,
  bindingSigValid: null,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};

const ordinaryTx: Transaction = {
  ...coinbaseBase,
  txid: "ab".repeat(32),
  isCoinbase: false,
  transparentOutputs: [{ address: "t1SomeoneElse", valueZat: 900_000_000 }],
};

describe("blockMiner", () => {
  it("picks the miner over the funding stream in a real NU6 coinbase", () => {
    // Block 3,426,987, captured from the node: 1.25035 ZEC to the miner and exactly 8% of
    // the 1.5625 ZEC subsidy to the funding stream.
    const coinbase: Transaction = {
      ...coinbaseBase,
      transparentOutputs: [
        { address: "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP", valueZat: 125_035_000 },
        { address: "t3cFfPt1Bcvgez9ZbMBFWeZsskxTkPzGCow", valueZat: 12_500_000 },
      ],
    };
    expect(blockMiner([coinbase, ordinaryTx])).toEqual({
      kind: "transparent",
      address: "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
    });
  });

  it("picks the miner across Canopy's three funding streams, whatever the output order", () => {
    // 3.125 ZEC subsidy: miner 80%, ZF 5%, Bootstrap 7%, Major Grants 8%. Streams first,
    // because output ordering is the miner's choice and must not be relied on.
    const coinbase: Transaction = {
      ...coinbaseBase,
      transparentOutputs: [
        { address: "t3ZcashFoundation", valueZat: 15_625_000 },
        { address: "t3BootstrapProject", valueZat: 21_875_000 },
        { address: "t3MajorGrants", valueZat: 25_000_000 },
        { address: "t1TheActualMiner", valueZat: 250_000_000 },
      ],
    };
    expect(blockMiner([coinbase])).toEqual({ kind: "transparent", address: "t1TheActualMiner" });
  });

  it("reports a shielded coinbase as shielded rather than naming a funding stream", () => {
    const coinbase: Transaction = {
      ...coinbaseBase,
      // The reward went to an Orchard address; only the stream stayed transparent.
      transparentOutputs: [
        { address: "t3cFfPt1Bcvgez9ZbMBFWeZsskxTkPzGCow", valueZat: 12_500_000 },
      ],
      orchard: { actions: 1, valueBalanceZat: 125_000_000 },
      ironwood: null,
    };
    expect(blockMiner([coinbase])).toEqual({ kind: "shielded" });
  });

  it("reports an Ironwood-shielded coinbase as shielded, not as its funding stream", () => {
    // A coinbase shielded into Ironwood must report `shielded`, not fall through and name the
    // funding stream as the miner.
    const coinbase: Transaction = {
      ...coinbaseBase,
      transparentOutputs: [
        { address: "t3cFfPt1Bcvgez9ZbMBFWeZsskxTkPzGCow", valueZat: 12_500_000 },
      ],
      ironwood: { actions: 2, valueBalanceZat: 125_000_000 },
    };
    expect(blockMiner([coinbase])).toEqual({ kind: "shielded" });
  });

  it("reports a Sprout-shielded coinbase as shielded, though Sprout publishes no balance", () => {
    const coinbase: Transaction = {
      ...coinbaseBase,
      transparentOutputs: [{ address: "t3SomeFundingStream", valueZat: 12_500_000 }],
      sprout: { joinSplits: 1 },
    };
    expect(blockMiner([coinbase])).toEqual({ kind: "shielded" });
  });

  it("is unknown when the block's transactions carry no coinbase", () => {
    expect(blockMiner([ordinaryTx])).toEqual({ kind: "unknown" });
    expect(blockMiner([])).toEqual({ kind: "unknown" });
  });

  it("is unknown when the LARGEST output names no address, never the founders' 20% below it", () => {
    // Mainnet block 1: the miner was paid 50,000 zat to a bare public key (no address) and the
    // founders 12,500 zat to their P2SH address. The founders must not be named as miner.
    const block1: Transaction = {
      ...coinbaseBase,
      blockHeight: 1,
      transparentOutputs: [
        { address: "", valueZat: 50_000 },
        { address: "t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd", valueZat: 12_500 },
      ],
    };
    expect(blockMiner([block1])).toEqual({ kind: "unknown" });
    // Order does not matter: miners build their own coinbase.
    const reversed = { ...block1, transparentOutputs: [...block1.transparentOutputs].reverse() };
    expect(blockMiner([reversed])).toEqual({ kind: "unknown" });
  });

  it("is unknown when no coinbase output names an address", () => {
    const coinbase: Transaction = {
      ...coinbaseBase,
      transparentOutputs: [{ address: "", valueZat: 125_035_000 }],
    };
    expect(blockMiner([coinbase])).toEqual({ kind: "unknown" });
  });
});

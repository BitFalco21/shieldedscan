import { describe, expect, it } from "vitest";
import type { Transaction } from "../transaction";
import { blockMiner, minerRewardAboveIssuance } from "../miner";

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
    expect(blockMiner([coinbase, ordinaryTx], 3_426_987)).toEqual({
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
    expect(blockMiner([coinbase], 3_426_987)).toEqual({
      kind: "transparent",
      address: "t1TheActualMiner",
    });
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
    expect(blockMiner([coinbase], 3_426_987)).toEqual({ kind: "shielded" });
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
    expect(blockMiner([coinbase], 3_426_987)).toEqual({ kind: "shielded" });
  });

  it("reports a Sprout-shielded coinbase as shielded, though Sprout publishes no balance", () => {
    const coinbase: Transaction = {
      ...coinbaseBase,
      transparentOutputs: [{ address: "t3SomeFundingStream", valueZat: 12_500_000 }],
      sprout: { joinSplits: 1 },
    };
    expect(blockMiner([coinbase], 3_426_987)).toEqual({ kind: "shielded" });
  });

  it("is unknown when the block's transactions carry no coinbase", () => {
    expect(blockMiner([ordinaryTx], 3_426_987)).toEqual({ kind: "unknown" });
    expect(blockMiner([], 3_426_987)).toEqual({ kind: "unknown" });
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
    expect(blockMiner([block1], 1)).toEqual({ kind: "unknown" });
    // Order does not matter: miners build their own coinbase.
    const reversed = { ...block1, transparentOutputs: [...block1.transparentOutputs].reverse() };
    expect(blockMiner([reversed], 1)).toEqual({ kind: "unknown" });
  });

  it("is unknown when no coinbase output names an address", () => {
    const coinbase: Transaction = {
      ...coinbaseBase,
      transparentOutputs: [{ address: "", valueZat: 125_035_000 }],
    };
    expect(blockMiner([coinbase], 3_426_987)).toEqual({ kind: "unknown" });
  });
});

/** Mainnet block 3,146,400's coinbase as the chain has it: miner, FPF stream, ten ZIP-271 chunks. */
const VIABTC = "t1at7nVNsv6taLRrNRvnQdtfLNRDfsGc3Ak";
const FPF = "t3cFfPt1Bcvgez9ZbMBFWeZsskxTkPzGCow";
const MULTISIG = "t3ev37Q2uL1sfTsiJQJiWJoFzQpDhmnUwYo";
const NU61 = 3_146_400;
const nu61Outputs = [
  { address: VIABTC, valueZat: 125_000_000 },
  { address: FPF, valueZat: 12_500_000 },
  ...Array.from({ length: 10 }, () => ({ address: MULTISIG, valueZat: 787_500_000_000 })),
];

describe("blockMiner at the NU6.1 lockbox disbursement", () => {
  const coinbaseAt = (height: number, outputs: Transaction["transparentOutputs"]) => ({
    ...coinbaseBase,
    blockHeight: height,
    transparentOutputs: outputs,
  });

  it("names the miner, never the ZIP-271 multisig, on the real coinbase", () => {
    expect(blockMiner([coinbaseAt(NU61, nu61Outputs)], NU61)).toEqual({
      kind: "transparent",
      address: VIABTC,
    });
  });

  it("names the miner whatever the output order", () => {
    const reordered = [...nu61Outputs].reverse();
    expect(blockMiner([coinbaseAt(NU61, reordered)], NU61)).toEqual({
      kind: "transparent",
      address: VIABTC,
    });
  });

  it("sets the chunks aside on testnet's NU6.1 block too", () => {
    const h = 3_536_500;
    const outputs = [
      { address: "tmMinerTestnet", valueZat: 125_000_000 },
      ...Array.from({ length: 10 }, () => ({
        address: "t2RnBRiqrN1nW4ecZs1Fj3WWjNdnSs4kiX8",
        valueZat: 787_500_000_000,
      })),
    ];
    expect(blockMiner([coinbaseAt(h, outputs)], h)).toEqual({
      kind: "transparent",
      address: "tmMinerTestnet",
    });
  });

  it("sets nothing aside at any other height: the multisig is an ordinary address there", () => {
    const outputs = [
      { address: VIABTC, valueZat: 125_000_000 },
      { address: MULTISIG, valueZat: 787_500_000_000 },
    ];
    for (const h of [NU61 - 1, NU61 + 1]) {
      expect(blockMiner([coinbaseAt(h, outputs)], h)).toEqual({
        kind: "transparent",
        address: MULTISIG,
      });
    }
  });

  it("sets aside only the exact chunk amount, never the address alone", () => {
    const outputs = [
      { address: VIABTC, valueZat: 125_000_000 },
      { address: MULTISIG, valueZat: 787_500_000_001 },
    ];
    expect(blockMiner([coinbaseAt(NU61, outputs)], NU61)).toEqual({
      kind: "transparent",
      address: MULTISIG,
    });
  });

  it("keeps ordinary blocks either side of NU6.1 and NU7 unchanged", () => {
    const cases: [number, Transaction["transparentOutputs"], string][] = [
      // NU6, before NU6.1: 1.25 ZEC + fees to the miner, 0.125 to the FPF stream.
      [
        NU61 - 1,
        [
          { address: FPF, valueZat: 12_500_000 },
          { address: VIABTC, valueZat: 125_010_000 },
        ],
        VIABTC,
      ],
      [
        NU61 + 1,
        [
          { address: VIABTC, valueZat: 125_000_000 },
          { address: FPF, valueZat: 12_500_000 },
        ],
        VIABTC,
      ],
      // NU7 (3,543,405): 0.41666668 ZEC + 40% of fees to the miner, 0.04166666 to the stream.
      [
        3_543_405,
        [
          { address: FPF, valueZat: 4_166_666 },
          { address: VIABTC, valueZat: 41_786_668 },
        ],
        VIABTC,
      ],
    ];
    for (const [h, outputs, miner] of cases) {
      expect(blockMiner([coinbaseAt(h, outputs)], h)).toEqual({
        kind: "transparent",
        address: miner,
      });
    }
  });
});

describe("minerRewardAboveIssuance", () => {
  it("flags the disbursement recorded as a miner reward, and passes the corrected one", () => {
    expect(minerRewardAboveIssuance(NU61, 7_875_000_000_000, 0)).toBe(true);
    expect(minerRewardAboveIssuance(NU61, 125_000_000, 0)).toBe(false);
  });

  it("passes the miner's reward with fees in every era, the bound included", () => {
    expect(minerRewardAboveIssuance(500_000, 1_000_000_000 + 7_000, 7_000)).toBe(false);
    expect(minerRewardAboveIssuance(1_046_400, 250_000_000, 0)).toBe(false);
    expect(minerRewardAboveIssuance(3_543_405, 41_786_668, 300_000)).toBe(false);
    // The whole subsidy plus every fee is the most a block can pay: equal is not above.
    expect(minerRewardAboveIssuance(3_543_405, 52_083_333 + 300_000, 300_000)).toBe(false);
    expect(minerRewardAboveIssuance(3_543_405, 52_083_333 + 300_001, 300_000)).toBe(true);
  });

  it("holds the slow start to its ramp", () => {
    // 62,500 zat per height below 10,000: block 100's subsidy is 6,250,000.
    expect(minerRewardAboveIssuance(100, 6_250_000, 0)).toBe(false);
    expect(minerRewardAboveIssuance(100, 6_250_001, 0)).toBe(true);
  });

  it("cannot decide past reissuance, or without the fee total", () => {
    expect(minerRewardAboveIssuance(8_939_664, 1, 0)).toBeNull();
    expect(minerRewardAboveIssuance(NU61, 7_875_000_000_000, null)).toBeNull();
  });
});

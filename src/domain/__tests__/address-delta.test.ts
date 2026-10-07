import { describe, expect, it } from "vitest";
import type { Transaction } from "../transaction";
import { addressDeltaZat } from "../address";

const ADDR = "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7";
const OTHER = "t1OtherPartyAddress00000000000001";

const base: Transaction = {
  txid: "ab".repeat(32),
  blockHeight: 3_426_950,
  blockHash: "0b".repeat(32),
  timestamp: 1_783_875_480,
  isCoinbase: false,
  version: 5,
  sizeBytes: 400,
  lockTime: 0,
  expiryHeight: null,
  rawHex: null,
  feeZat: 15_000,
  bindingSigValid: null,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};

/**
 * `addressDeltaZat` is the NET column on the address page: arithmetic the chain implies, not
 * a guess about which output was the payment and which was change. These tests pin both the
 * arithmetic and that boundary.
 */
describe("addressDeltaZat", () => {
  it("counts only the outputs paying this address", () => {
    const tx: Transaction = {
      ...base,
      transparentOutputs: [
        { address: ADDR, valueZat: 400_000_000 },
        { address: OTHER, valueZat: 19_911_000 },
      ],
    };
    expect(addressDeltaZat(tx, ADDR)).toBe(400_000_000);
  });

  it("nets spending against receiving in one transaction", () => {
    // The change case, handled by arithmetic instead of a guess: the address spends 4.19921
    // and one output comes back to it. The net is what left, and no claim is made about
    // which output was "the payment".
    const tx: Transaction = {
      ...base,
      transparentInputs: [{ address: ADDR, valueZat: 419_921_000 }],
      transparentOutputs: [
        { address: OTHER, valueZat: 400_000_000 },
        { address: ADDR, valueZat: 19_906_000 },
      ],
    };
    expect(addressDeltaZat(tx, ADDR)).toBe(-400_015_000);
  });

  it("returns zero when the address is named on neither side", () => {
    const tx: Transaction = {
      ...base,
      transparentInputs: [{ address: OTHER, valueZat: 100_000_000 }],
      transparentOutputs: [{ address: OTHER, valueZat: 99_985_000 }],
    };
    expect(addressDeltaZat(tx, ADDR)).toBe(0);
  });

  it("returns zero — not a guess — when the address exactly round-trips", () => {
    const tx: Transaction = {
      ...base,
      transparentInputs: [{ address: ADDR, valueZat: 100_000_000 }],
      transparentOutputs: [{ address: ADDR, valueZat: 100_000_000 }],
    };
    expect(addressDeltaZat(tx, ADDR)).toBe(0);
  });

  it("ignores outputs whose script names no address", () => {
    // OP_RETURN and multisig outputs carry "" rather than an address; it must never match a
    // real address, or their value would be credited to whoever is being viewed.
    const tx: Transaction = {
      ...base,
      transparentOutputs: [
        { address: "", valueZat: 50_000_000 },
        { address: ADDR, valueZat: 10_000_000 },
      ],
    };
    expect(addressDeltaZat(tx, ADDR)).toBe(10_000_000);
    expect(addressDeltaZat(tx, "")).toBe(50_000_000);
  });

  it("reports only the transparent side of a shielding transaction", () => {
    // t->z: 1 ZEC leaves this address into the Orchard pool. The delta is −1 ZEC and stops
    // there; the shielded value balance is never attributed to a transparent address.
    const tx: Transaction = {
      ...base,
      transparentInputs: [{ address: ADDR, valueZat: 100_000_000 }],
      orchard: { actions: 2, valueBalanceZat: 99_985_000 },
      ironwood: null,
    };
    expect(addressDeltaZat(tx, ADDR)).toBe(-100_000_000);
  });

  it("credits a coinbase payout, which has no transparent inputs", () => {
    const tx: Transaction = {
      ...base,
      isCoinbase: true,
      feeZat: null,
      transparentOutputs: [
        { address: ADDR, valueZat: 125_000_000 },
        { address: OTHER, valueZat: 12_500_000 },
      ],
    };
    expect(addressDeltaZat(tx, ADDR)).toBe(125_000_000);
  });
});

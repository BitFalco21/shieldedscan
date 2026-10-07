import { describe, expect, it } from "vitest";
import type { Transaction } from "../transaction";
import { publicValueZat, totalFeeZat } from "../value";

const base: Transaction = {
  txid: "cd".repeat(32),
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
const tIn = { address: "t1PubValInputAddress000000001x", valueZat: 200_000_000 };
const tOut = { address: "t1PubValOutputAddress00000001x", valueZat: 150_000_000 };

describe("publicValueZat", () => {
  it("null for fully shielded", () => {
    expect(publicValueZat({ ...base, orchard: { actions: 2, valueBalanceZat: -1000 } })).toBeNull();
  });
  it("prefers transparent outputs", () => {
    expect(publicValueZat({ ...base, transparentInputs: [tIn], transparentOutputs: [tOut] })).toBe(
      150_000_000,
    );
  });
  it("falls back to transparent inputs (t→z shielding)", () => {
    expect(
      publicValueZat({
        ...base,
        transparentInputs: [tIn],
        orchard: { actions: 2, valueBalanceZat: 199_000_000 },
        ironwood: null,
      }),
    ).toBe(200_000_000);
  });
  it("null when nothing public at all", () => {
    expect(publicValueZat(base)).toBeNull();
  });
});

describe("totalFeeZat", () => {
  const paid = (feeZat: number): Transaction => ({ ...base, feeZat });

  it("sums the fees of the transactions that have one", () => {
    expect(totalFeeZat([paid(10_000), paid(100_000), paid(1_000)])).toBe(111_000);
  });

  it("is null when ANY fee is unknown — never a partial sum dressed as a total", () => {
    expect(totalFeeZat([paid(10_000), { ...base, feeZat: null }, paid(1_000)])).toBeNull();
  });

  it("skips the coinbase, which collects fees rather than paying one", () => {
    const coinbase: Transaction = { ...base, isCoinbase: true, feeZat: null };
    expect(totalFeeZat([coinbase, paid(10_000)])).toBe(10_000);
  });

  it("is zero, not null, for a block whose only transaction is the coinbase", () => {
    expect(totalFeeZat([{ ...base, isCoinbase: true, feeZat: null }])).toBe(0);
  });
});

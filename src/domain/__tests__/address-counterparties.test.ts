import { describe, expect, it } from "vitest";
import { addressCounterparties, counterpartySummary } from "../address-counterparties";
import type { Transaction } from "../transaction";

const ME = "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7";
const A = "t1PartyA0000000000000000000000001";
const B = "t1PartyB0000000000000000000000002";
const C = "t1PartyC0000000000000000000000003";

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
  feeZat: 10_000,
  bindingSigValid: null,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: null,
  ironwood: null,
};

const tx = (over: Partial<Transaction>): Transaction => ({ ...base, ...over });

describe("addressCounterparties", () => {
  it("names the inputs when this address received, in on-chain order", () => {
    const r = addressCounterparties(
      tx({
        transparentInputs: [
          { address: B, valueZat: 300 },
          { address: A, valueZat: 900 },
        ],
        transparentOutputs: [{ address: ME, valueZat: 1_190 }],
      }),
      ME,
    );
    expect(r.direction).toBe("from");
    expect(r.shown).toEqual([
      { kind: "address", address: B, zat: 300 },
      { kind: "address", address: A, zat: 900 },
    ]);
  });

  it("names the other outputs when it sent, change back to itself excluded", () => {
    const r = addressCounterparties(
      tx({
        transparentInputs: [{ address: ME, valueZat: 1_000 }],
        transparentOutputs: [
          { address: A, valueZat: 600 },
          { address: ME, valueZat: 390 },
        ],
      }),
      ME,
    );
    expect(r.direction).toBe("to");
    expect(r.shown).toEqual([{ kind: "address", address: A, zat: 600 }]);
  });

  it("groups an address's repeated inputs into one entry, summed", () => {
    const r = addressCounterparties(
      tx({
        transparentInputs: [
          { address: A, valueZat: 100 },
          { address: B, valueZat: 50 },
          { address: A, valueZat: 200 },
        ],
        transparentOutputs: [{ address: ME, valueZat: 340 }],
      }),
      ME,
    );
    expect(r.shown).toEqual([
      { kind: "address", address: A, zat: 300 },
      { kind: "address", address: B, zat: 50 },
    ]);
  });

  it("calls a script naming no address non-standard, with its real amount", () => {
    const r = addressCounterparties(
      tx({
        transparentInputs: [{ address: ME, valueZat: 1_000 }],
        transparentOutputs: [
          { address: "", valueZat: 0 },
          { address: "", valueZat: 400 },
          { address: A, valueZat: 590 },
        ],
      }),
      ME,
    );
    expect(r.shown).toEqual([
      { kind: "address", address: A, zat: 590 },
      { kind: "nonStandard", zat: 400, count: 2 },
    ]);
  });

  it("names the pool a shielding went into, with its published balance, before any change", () => {
    const r = addressCounterparties(
      tx({
        transparentInputs: [{ address: ME, valueZat: 1_000 }],
        transparentOutputs: [{ address: A, valueZat: 190 }],
        ironwood: { actions: 2, valueBalanceZat: 800 },
      }),
      ME,
    );
    expect(r.direction).toBe("to");
    expect(r.shown).toEqual([
      { kind: "pool", pool: "ironwood", zat: 800, settled: true },
      { kind: "address", address: A, zat: 190 },
    ]);
  });

  it("names the pool an unshielding came from", () => {
    const r = addressCounterparties(
      tx({
        transparentOutputs: [{ address: ME, valueZat: 75_000_000 }],
        orchard: { actions: 2, valueBalanceZat: -75_010_000 },
      }),
      ME,
    );
    expect(r.direction).toBe("from");
    expect(r.shown).toEqual([{ kind: "pool", pool: "orchard", zat: 75_010_000, settled: true }]);
  });

  it("gives Sprout no amount: it publishes no value balance", () => {
    const r = addressCounterparties(
      tx({
        transparentOutputs: [{ address: ME, valueZat: 500 }],
        sprout: { joinSplits: 1 },
      }),
      ME,
    );
    const sprout = r.shown.find((p) => p.kind === "pool");
    expect(sprout).toEqual({ kind: "pool", pool: "sprout", zat: null, settled: true });
  });

  it("claims no direction for pools that moved opposite ways", () => {
    const r = addressCounterparties(
      tx({
        transparentInputs: [{ address: ME, valueZat: 1_000 }],
        transparentOutputs: [{ address: A, valueZat: 500 }],
        sapling: { spends: 1, outputs: 1, valueBalanceZat: 600 },
        orchard: { actions: 2, valueBalanceZat: -110 },
      }),
      ME,
    );
    const pools = r.shown.filter((p) => p.kind === "pool");
    expect(pools.length).toBeGreaterThan(0);
    for (const p of pools) expect(p).toMatchObject({ settled: false, zat: null });
  });

  it("reads a coinbase as new coins", () => {
    const r = addressCounterparties(
      tx({ isCoinbase: true, transparentOutputs: [{ address: ME, valueZat: 156_250_000 }] }),
      ME,
    );
    expect(r).toMatchObject({ direction: "from", shown: [{ kind: "mined" }] });
  });

  it("says itself when nobody else took part, a fee-only consolidation included", () => {
    const consolidation = addressCounterparties(
      tx({
        transparentInputs: [
          { address: ME, valueZat: 600 },
          { address: ME, valueZat: 400 },
        ],
        transparentOutputs: [{ address: ME, valueZat: 990 }],
      }),
      ME,
    );
    expect(consolidation).toMatchObject({ direction: "self", shown: [] });
  });

  it("shows both sides when the address nets to zero while others took part", () => {
    const r = addressCounterparties(
      tx({
        transparentInputs: [
          { address: ME, valueZat: 100 },
          { address: C, valueZat: 200 },
        ],
        transparentOutputs: [
          { address: ME, valueZat: 100 },
          { address: B, valueZat: 190 },
        ],
      }),
      ME,
    );
    expect(r.direction).toBe("both");
    expect(r.shown).toEqual([]);
    expect(r.inputs).toEqual([{ kind: "address", address: C, zat: 200 }]);
    expect(r.outputs).toEqual([{ kind: "address", address: B, zat: 190 }]);
  });
});

describe("counterpartySummary", () => {
  it("names pools and counts the rest, scripts included, naming no address", () => {
    expect(
      counterpartySummary(
        [
          { kind: "address", address: A, zat: 1 },
          { kind: "address", address: B, zat: 1 },
          { kind: "nonStandard", zat: 0, count: 2 },
        ],
        "input",
      ),
    ).toBe("4 inputs");
    expect(
      counterpartySummary(
        [
          { kind: "pool", pool: "ironwood", zat: 5, settled: true },
          { kind: "address", address: A, zat: 1 },
        ],
        "output",
      ),
    ).toBe("ironwood + 1 output");
  });
});

import { describe, expect, it } from "vitest";
import type { Transaction } from "../transaction";
import { txDirection, txKind } from "../classify";
import {
  TX_KIND_FILTERS,
  TX_MIXED_DIRECTION_FILTERS,
  isMixedDirectionFilter,
  matchesTxKindFilter,
  parseTxKindFilter,
  txKindFilterLabel,
} from "../list";

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

/** Transparent in, nothing transparent out: value entered the pools. */
const shielding: Transaction = {
  ...base,
  transparentInputs: [tIn],
  orchard: { actions: 2, valueBalanceZat: 99_990_000 },
};
/** Transparent out, nothing transparent in: value left the pools. */
const unshielding: Transaction = {
  ...base,
  transparentOutputs: [tOut],
  orchard: { actions: 2, valueBalanceZat: -99_990_000 },
};
/**
 * Mixed, but the pools moved in OPPOSITE directions — a migration carrying a transparent
 * side. `txDirection` returns null rather than apportioning, so this row belongs to `mixed`
 * and to nothing narrower (roughly 0.09% of mixed transactions).
 */
const indeterminate: Transaction = {
  ...base,
  transparentInputs: [tIn],
  transparentOutputs: [tOut],
  sapling: { spends: 1, outputs: 0, valueBalanceZat: 50_000_000 },
  orchard: { actions: 2, valueBalanceZat: -50_000_000 },
};
const transparent: Transaction = { ...base, transparentInputs: [tIn], transparentOutputs: [tOut] };
const fullyShielded: Transaction = { ...base, orchard: { actions: 2, valueBalanceZat: 0 } };
const coinbase: Transaction = { ...base, isCoinbase: true, transparentOutputs: [tOut] };

describe("parseTxKindFilter", () => {
  it("accepts every offered filter, including the direction refinements", () => {
    for (const filter of TX_KIND_FILTERS) {
      expect(parseTxKindFilter(filter)).toBe(filter);
    }
  });

  it("offers both directions", () => {
    expect(TX_KIND_FILTERS).toContain("shielding");
    expect(TX_KIND_FILTERS).toContain("unshielding");
  });

  it("anything unrecognised means all, as it always has", () => {
    for (const junk of [undefined, "", "SHIELDING", "z-to-t", "mixed;drop", "../../etc"]) {
      expect(parseTxKindFilter(junk)).toBe("all");
    }
  });
});

describe("txKindFilterLabel", () => {
  it("uses the vocabulary the TYPE column already renders", () => {
    expect(txKindFilterLabel("shielding")).toBe("SHIELDING");
    expect(txKindFilterLabel("unshielding")).toBe("UNSHIELDING");
    expect(txKindFilterLabel("all")).toBe("ALL");
  });
});

describe("isMixedDirectionFilter", () => {
  it("is true for exactly the two refinements", () => {
    for (const filter of TX_KIND_FILTERS) {
      expect(isMixedDirectionFilter(filter)).toBe(
        (TX_MIXED_DIRECTION_FILTERS as readonly string[]).includes(filter),
      );
    }
  });
});

describe("matchesTxKindFilter", () => {
  const every = [shielding, unshielding, indeterminate, transparent, fullyShielded, coinbase];

  it("all keeps everything", () => {
    for (const tx of every) expect(matchesTxKindFilter(tx, "all")).toBe(true);
  });

  it("agrees with txKind for the kinds", () => {
    for (const tx of every) {
      for (const kind of ["transparent", "shielded", "mixed", "coinbase"] as const) {
        expect(matchesTxKindFilter(tx, kind)).toBe(txKind(tx) === kind);
      }
    }
  });

  it("narrows mixed by direction", () => {
    expect(matchesTxKindFilter(shielding, "shielding")).toBe(true);
    expect(matchesTxKindFilter(shielding, "unshielding")).toBe(false);
    expect(matchesTxKindFilter(unshielding, "unshielding")).toBe(true);
    expect(matchesTxKindFilter(unshielding, "shielding")).toBe(false);
  });

  it("MIXED is the parent: it keeps both directions AND the rows that have neither", () => {
    for (const tx of [shielding, unshielding, indeterminate]) {
      expect(matchesTxKindFilter(tx, "mixed")).toBe(true);
    }
    // The whole reason there is no fourth chip: this row is reachable under `mixed` only.
    expect(txDirection(indeterminate)).toBeNull();
    expect(matchesTxKindFilter(indeterminate, "shielding")).toBe(false);
    expect(matchesTxKindFilter(indeterminate, "unshielding")).toBe(false);
  });

  it("a fully shielded transaction is never a direction match, though its direction is set", () => {
    // txDirection(fullyShielded) is "shielded", which is NOT a crossing. Filtering by
    // shielding must not sweep it in — the pools were never left.
    expect(txDirection(fullyShielded)).toBe("shielded");
    expect(matchesTxKindFilter(fullyShielded, "shielding")).toBe(false);
    expect(matchesTxKindFilter(fullyShielded, "unshielding")).toBe(false);
  });

  it("the two directions partition mixed, minus the indeterminate rows", () => {
    const mixed = every.filter((tx) => matchesTxKindFilter(tx, "mixed"));
    const byDirection = mixed.filter(
      (tx) => matchesTxKindFilter(tx, "shielding") || matchesTxKindFilter(tx, "unshielding"),
    );
    expect(mixed).toHaveLength(3);
    expect(byDirection).toHaveLength(2);
  });
});

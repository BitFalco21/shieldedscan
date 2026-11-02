import { describe, expect, it } from "vitest";
import { parseTxListFilter } from "../list";
import { POOL_NAMES } from "../pool";

describe("parseTxListFilter", () => {
  it("reads every shielded pool", () => {
    for (const pool of POOL_NAMES) {
      expect(parseTxListFilter(undefined, pool)).toEqual({ kind: "all", pool });
    }
  });

  it("lets a pool win over a kind: the two never combine", () => {
    expect(parseTxListFilter("coinbase", "sprout")).toEqual({ kind: "all", pool: "sprout" });
    expect(parseTxListFilter("transparent", "orchard")).toEqual({ kind: "all", pool: "orchard" });
  });

  it("reads an unrecognised pool as none, keeping the kind", () => {
    for (const raw of ["transparent", "lockbox", "Sprout", "", "banana", undefined]) {
      expect(parseTxListFilter("shielded", raw), String(raw)).toEqual({
        kind: "shielded",
        pool: null,
      });
    }
  });
});

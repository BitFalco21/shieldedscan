import { describe, expect, it } from "vitest";
import type { TxDirection, TxKind } from "@/domain";
import { txDirectionColumn } from "../tx-direction-column";

const KINDS: TxKind[] = ["transparent", "shielded", "mixed", "coinbase"];
const DIRECTIONS: TxDirection[] = ["shielding", "unshielding", "shielded", null];

describe("txDirectionColumn", () => {
  it("stores the two crossings verbatim for a mixed transaction", () => {
    expect(txDirectionColumn("mixed", "shielding")).toBe("shielding");
    expect(txDirectionColumn("mixed", "unshielding")).toBe("unshielding");
  });

  it("stores 'indeterminate' — never NULL — for a mixed transaction whose pools disagree", () => {
    // The repair's remaining work is `direction IS NULL`. A null here would make it revisit
    // these rows forever, and would make "the pools disagree" look like "not yet backfilled".
    expect(txDirectionColumn("mixed", null)).toBe("indeterminate");
  });

  it("stores nothing for any other kind, including a fully shielded one", () => {
    // txDirection says "shielded" here, which is true and is NOT a crossing. Storing it would
    // duplicate `kind`, which is exactly why the column was dropped in the first place.
    expect(txDirectionColumn("shielded", "shielded")).toBeNull();
    expect(txDirectionColumn("transparent", null)).toBeNull();
    expect(txDirectionColumn("coinbase", null)).toBeNull();
  });

  it("every non-mixed kind yields null whatever direction is passed", () => {
    for (const kind of KINDS.filter((k) => k !== "mixed")) {
      for (const direction of DIRECTIONS) {
        expect(txDirectionColumn(kind, direction)).toBeNull();
      }
    }
  });

  it("every mixed row yields one of the three stored values — the column is never null", () => {
    // What makes the backfill terminate: each visited row is written with a value, so the
    // `direction IS NULL` predicate strictly shrinks.
    for (const direction of DIRECTIONS) {
      expect(["shielding", "unshielding", "indeterminate"]).toContain(
        txDirectionColumn("mixed", direction),
      );
    }
  });

  it("only ever emits values the CHECK constraint accepts", () => {
    const allowed = new Set(["shielding", "unshielding", "indeterminate", null]);
    for (const kind of KINDS) {
      for (const direction of DIRECTIONS) {
        expect(allowed.has(txDirectionColumn(kind, direction))).toBe(true);
      }
    }
  });
});

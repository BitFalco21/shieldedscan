import { describe, expect, it } from "vitest";
import { txDirection, txKind } from "@/domain";
import type { StoredMixedRow } from "../repair-direction";
import { directionForRow, rowToClassifiable } from "../repair-direction";

function row(over: Partial<StoredMixedRow> = {}): StoredMixedRow {
  return {
    txid: "ab".repeat(32),
    sprout_joinsplits: null,
    sapling_value_balance_zat: null,
    orchard_value_balance_zat: null,
    ironwood_value_balance_zat: null,
    t_in: 0,
    t_out: 0,
    ...over,
  };
}

/**
 * A Sprout-only mixed transaction: transparent value on one side, JoinSplits on the other, and no
 * value balance anywhere (Sprout publishes none). These are about a quarter of all mixed rows. If
 * the row-to-transaction mapping drops Sprout, the transaction has no shielded bundle, `txKind`
 * says `transparent`, and `txDirection` returns at its `kind !== "mixed"` guard, so every one
 * would be stored as `indeterminate`.
 */
describe("a Sprout-only mixed transaction", () => {
  it("is mixed at all — the joinsplit count is what says the pool was touched", () => {
    const tx = rowToClassifiable(row({ t_in: 2, sprout_joinsplits: 1 }));
    expect(tx.sprout).toEqual({ joinSplits: 1 });
    expect(txKind(tx)).toBe("mixed");
  });

  it("has a real direction whenever transparent value sits on exactly one side", () => {
    expect(directionForRow(row({ t_in: 2, sprout_joinsplits: "1" }))).toBe("shielding");
    expect(directionForRow(row({ t_out: 2, sprout_joinsplits: "1" }))).toBe("unshielding");
  });

  it("is honestly indeterminate only when transparent value sits on BOTH sides", () => {
    // Sprout publishes no per-bundle balance, so there is nothing to break the tie. That is a
    // genuine refusal rather than the bug above — `reportsValueBalance` exists for this.
    expect(directionForRow(row({ t_in: 1, t_out: 1, sprout_joinsplits: "2" }))).toBe(
      "indeterminate",
    );
  });

  it("treats a stored 0 as no bundle, matching what parseSprout emits", () => {
    // The writer stores 0 for "derived, and this transaction has no joinsplits" — a real
    // distinction from NULL, per the column's own note. 0 must not conjure a Sprout bundle.
    const tx = rowToClassifiable(
      row({ t_in: 1, sprout_joinsplits: 0, orchard_value_balance_zat: "5" }),
    );
    expect(tx.sprout).toBeNull();
  });
});

describe("rowToClassifiable", () => {
  it("rebuilds a transaction the classifier reads as mixed", () => {
    const tx = rowToClassifiable(row({ t_in: 3, orchard_value_balance_zat: 5_000 }));
    expect(txKind(tx)).toBe("mixed");
    expect(tx.transparentInputs).toHaveLength(3);
    expect(tx.transparentOutputs).toHaveLength(0);
  });

  it("treats BIGINT strings from pg as numbers, and NULL as an absent bundle", () => {
    // `pg` returns BIGINT as a string. Number("−5000") is fine; Number(null) is 0, which is
    // how this codebase published five years of zero difficulty — so null is mapped, never
    // coerced.
    const tx = rowToClassifiable(row({ t_in: "2", orchard_value_balance_zat: "-5000" }));
    expect(tx.orchard).toEqual({ actions: 0, valueBalanceZat: -5000 });
    expect(tx.sapling).toBeNull();
    expect(tx.ironwood).toBeNull();
    expect(tx.transparentInputs).toHaveLength(2);
  });

  it("keeps a zero value balance as a PRESENT bundle, not an absent one", () => {
    // A pool can publish exactly 0 — the bundle exists, the net is nil. Reading 0 as "no
    // bundle" would silently reclassify the transaction.
    const tx = rowToClassifiable(row({ t_in: 1, orchard_value_balance_zat: "0" }));
    expect(tx.orchard).toEqual({ actions: 0, valueBalanceZat: 0 });
    expect(txKind(tx)).toBe("mixed");
  });
});

describe("directionForRow", () => {
  it("transparent in, nothing out — value entered the pools", () => {
    expect(directionForRow(row({ t_in: 1, orchard_value_balance_zat: "99990000" }))).toBe(
      "shielding",
    );
  });

  it("transparent out, nothing in — value left the pools", () => {
    expect(directionForRow(row({ t_out: 1, orchard_value_balance_zat: "-99990000" }))).toBe(
      "unshielding",
    );
  });

  it("transparent on BOTH sides falls through to the pools' own balances", () => {
    // The `dbb5361b…` case: one input, one output, and a pool that gained. Nothing was
    // unshielded, and the summary used to say otherwise.
    expect(directionForRow(row({ t_in: 1, t_out: 1, ironwood_value_balance_zat: "159649" }))).toBe(
      "shielding",
    );
    expect(directionForRow(row({ t_in: 1, t_out: 1, ironwood_value_balance_zat: "-159649" }))).toBe(
      "unshielding",
    );
  });

  it("pools moving in OPPOSITE directions store 'indeterminate', never a guess", () => {
    const migration = row({
      t_in: 1,
      t_out: 1,
      sapling_value_balance_zat: "50000000",
      orchard_value_balance_zat: "-50000000",
    });
    // The domain refuses to name a direction here, and the column records that refusal
    // rather than erasing it.
    expect(txDirection(rowToClassifiable(migration))).toBeNull();
    expect(directionForRow(migration)).toBe("indeterminate");
  });

  it("never returns null — which is what makes the repair terminate", () => {
    /*
     * The loop's remaining work is `direction IS NULL`. If any row could be written back as
     * NULL, that row would be re-selected forever. Exhaustive over the shapes a mixed row can
     * take: each side present or not, each pool up, down, zero or absent.
     */
    const balances = [null, "0", "5000", "-5000"] as const;
    // Sprout varies too, because a Sprout-only row is a shape with no balance at all.
    const joinsplits = [null, 0, 3] as const;
    let checked = 0;
    for (const t_in of [0, 1]) {
      for (const t_out of [0, 1]) {
        if (t_in === 0 && t_out === 0) continue; // not mixed: no transparent side at all
        for (const sprout of joinsplits) {
          for (const sapling of balances) {
            for (const orchard of balances) {
              for (const ironwood of balances) {
                const shielded =
                  (sprout !== null && sprout !== 0) ||
                  sapling !== null ||
                  orchard !== null ||
                  ironwood !== null;
                if (!shielded) continue; // not mixed: no shielded side at all
                const stored = directionForRow(
                  row({
                    t_in,
                    t_out,
                    sprout_joinsplits: sprout,
                    sapling_value_balance_zat: sapling,
                    orchard_value_balance_zat: orchard,
                    ironwood_value_balance_zat: ironwood,
                  }),
                );
                expect(["shielding", "unshielding", "indeterminate"]).toContain(stored);
                checked += 1;
              }
            }
          }
        }
      }
    }
    // A silent zero here would mean the loop above stopped exercising anything.
    expect(checked).toBeGreaterThan(100);
  });

  it("agrees with the domain classifier on every shape it is given", () => {
    // The repair must not become a second derivation. Wherever the domain names a direction,
    // the stored value is that same word; only its refusal is translated.
    const cases = [
      row({ t_in: 1, orchard_value_balance_zat: "1" }),
      row({ t_out: 1, orchard_value_balance_zat: "-1" }),
      row({ t_in: 1, t_out: 1, sapling_value_balance_zat: "7" }),
      row({ t_in: 1, t_out: 1, sapling_value_balance_zat: "7", orchard_value_balance_zat: "-7" }),
    ];
    for (const c of cases) {
      const domain = txDirection(rowToClassifiable(c));
      expect(directionForRow(c)).toBe(domain ?? "indeterminate");
    }
  });
});

import { describe, expect, it } from "vitest";
import { blockTotalFeeZat, computeFeeZat, feeFromTermsZat, parseBlock } from "@/data/chain/parse";
import type { RpcBlock } from "@/data/chain/rpc-types";
import { feeForStoredRow } from "../repair-fees";
import block460495 from "@/data/chain/__fixtures__/block-460495.json";
import block3428150 from "@/data/chain/__fixtures__/block-3428150.json";

/**
 * The repair reads its fee terms out of Postgres instead of from a freshly parsed block, so the
 * risk is the translation into the shared equation: stored value balances are in domain sign and
 * the equation is defined in RPC sign (a missed flip gives the right magnitude with the wrong
 * sign). These tests compare the repair's result against `computeFeeZat` on the same real
 * transactions.
 */

const sprout = block460495 as unknown as RpcBlock;
const ironwood = block3428150 as unknown as RpcBlock;

/** The row shape the repair reads, built from a parsed transaction as the store would store it. */
function storedRowFor(block: RpcBlock, prefix: string) {
  const parsed = parseBlock(block);
  const tx = parsed.transactions.find((t) => t.txid.startsWith(prefix));
  if (!tx) throw new Error(`fixture has no tx starting ${prefix}`);
  const transparentOut = tx.outputs.reduce((sum, o) => sum + o.valueZat, 0);
  const hasIoRows = tx.outputs.length > 0 || tx.inputRefs.length > 0;
  return {
    row: {
      txid: tx.txid,
      is_coinbase: tx.isCoinbase,
      transparent_in: hasIoRows ? "0" : null,
      transparent_out: hasIoRows ? String(transparentOut) : null,
      unresolved_inputs: 0,
      has_io_rows: hasIoRows,
      // Stored exactly as `#writeTransactions` writes them: RPC sign for the sprout term,
      // DOMAIN sign (negated) for the three bundle balances.
      sprout_vpub_net_zat: String(tx.rpcSproutVB),
      sapling_value_balance_zat: tx.sapling ? String(tx.sapling.valueBalanceZat) : null,
      orchard_value_balance_zat: tx.orchard ? String(tx.orchard.valueBalanceZat) : null,
      ironwood_value_balance_zat: tx.ironwood ? String(tx.ironwood.valueBalanceZat) : null,
    },
    tx,
  };
}

describe("feeForStoredRow", () => {
  it("agrees with computeFeeZat on a Sprout unshielding", () => {
    const { row, tx } = storedRowFor(sprout, "750b0dc0");
    expect(feeForStoredRow(row)).toBe(10_000);
    expect(feeForStoredRow(row)).toBe(computeFeeZat(tx, 0));
  });

  it("agrees with computeFeeZat on an Orchard → Ironwood migration", () => {
    // The sign-flip canary. Both bundle balances are large and opposite, so a missing or
    // doubled negation shows up as −30,000 or as hundreds of millions, never as a near miss.
    const { row, tx } = storedRowFor(ironwood, "25d87ba6");
    expect(feeForStoredRow(row)).toBe(30_000);
    expect(feeForStoredRow(row)).toBe(computeFeeZat(tx, 0));
  });

  it("agrees with computeFeeZat across every transaction in both fixtures", () => {
    // The property, rather than two hand-picked rows: whatever the ingest path derives, the
    // repair path must derive identically, or a repaired chain disagrees with a freshly
    // ingested one and nothing in the UI would reveal which is right.
    for (const [name, block] of [
      ["sprout", sprout],
      ["ironwood", ironwood],
    ] as const) {
      const parsed = parseBlock(block);
      for (const tx of parsed.transactions) {
        if (tx.inputRefs.length > 0) continue; // real inputs live in earlier blocks
        const { row } = storedRowFor(block, tx.txid);
        expect(feeForStoredRow(row), `${name} ${tx.txid.slice(0, 12)}`).toBe(computeFeeZat(tx, 0));
      }
    }
  });

  it("returns null for coinbase, never 0", () => {
    const parsed = parseBlock(sprout);
    const coinbase = parsed.transactions.find((t) => t.isCoinbase);
    const { row } = storedRowFor(sprout, coinbase!.txid);
    expect(feeForStoredRow(row)).toBeNull();
  });

  it("returns null when an input is unresolved rather than a partial sum", () => {
    const { row } = storedRowFor(sprout, "750b0dc0");
    expect(feeForStoredRow({ ...row, unresolved_inputs: 1 })).toBeNull();
  });

  it("treats a transaction with no I/O rows as transparent-total 0, not unknown", () => {
    // `has_io_rows: false` means fully shielded with a transparent side of genuinely zero, which
    // makes the whole value balance the fee; reading it as "unknown" would null computable fees.
    //
    // The Ironwood migration is the right witness and the Sprout unshielding is not: a z→t
    // transaction has a transparent output, so it has I/O rows and merely a zero input sum.
    const { row } = storedRowFor(ironwood, "25d87ba6");
    expect(row.has_io_rows).toBe(false);
    expect(row.transparent_in).toBeNull();
    expect(feeForStoredRow(row)).toBe(30_000);
  });

  it("reads a missing sprout term as 0 rather than corrupting the sum", () => {
    // NULL means "not yet derived". A row reaching phase 2 un-derived would be a bug in the
    // phase ordering, but it must degrade to the pre-Sprout arithmetic rather than NaN.
    const { row } = storedRowFor(ironwood, "25d87ba6");
    expect(feeForStoredRow({ ...row, sprout_vpub_net_zat: null })).toBe(30_000);
  });
});

describe("feeFromTermsZat", () => {
  it("is the one place the equation lives, and sums every pool", () => {
    // Each pool contributes independently: bump one term, the fee moves by exactly that much.
    const base = {
      transparentInZat: 0,
      transparentOutZat: 0,
      rpcSproutVB: 0,
      rpcSaplingVB: 0,
      rpcOrchardVB: 0,
      rpcIronwoodVB: 0,
    };
    expect(feeFromTermsZat(base)).toBe(0);
    for (const pool of ["rpcSproutVB", "rpcSaplingVB", "rpcOrchardVB", "rpcIronwoodVB"] as const) {
      expect(feeFromTermsZat({ ...base, [pool]: 7_000 }), pool).toBe(7_000);
    }
    expect(feeFromTermsZat({ ...base, transparentInZat: 5_000 })).toBe(5_000);
    expect(feeFromTermsZat({ ...base, transparentOutZat: 5_000 })).toBe(-5_000);
  });
});

describe("blockTotalFeeZat", () => {
  it("sums known fees", () => {
    expect(blockTotalFeeZat([10_000, 20_000, 5_000])).toBe(35_000);
  });

  it("is null if any single fee is unknown — never a partial sum", () => {
    // A partial total renders as a confident figure that is quietly short. This is the whole
    // reason `block.total_fee_zat` is nullable.
    expect(blockTotalFeeZat([10_000, null, 5_000])).toBeNull();
  });

  it("totals 0 for a block with only a coinbase", () => {
    // A measurement, not an absence: that block genuinely collected no fees.
    expect(blockTotalFeeZat([])).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import type { BlockSummary } from "../block";
import { blockFeesZat, blockSummaryOf } from "../block";
import { blocks } from "@/fixtures/blocks";

/**
 * A block's fee total, as the chain implies it rather than as the index happens to hold it.
 * A block not yet ingested has a null total; that is right in general, but a coinbase-only
 * block collects no fees by construction, so its total is zero without the index.
 */

const base = blocks[0]!;
// Through `blockSummaryOf`, as the detail page does: a list row and a full block read their count
// the same way, so the rule is pinned for both.
const withTxids = (txids: string[], totalFeeZat: number | null): BlockSummary =>
  blockSummaryOf({ ...base, txids, totalFeeZat });

describe("blockFeesZat", () => {
  it("is exactly zero for a block holding only its coinbase", () => {
    // Before ingest catches up the index answers null; the derived zero must still show.
    expect(blockFeesZat(withTxids(["cb"], null))).toBe(0);
  });

  it("stays zero for a coinbase-only block even once the index answers", () => {
    // Both paths must agree, or the row changes under the reader for no reason they can see.
    expect(blockFeesZat(withTxids(["cb"], 0))).toBe(0);
  });

  it("stays UNKNOWN for a multi-transaction block the index has not reached", () => {
    // A fee needs its inputs resolved; until ingest has done that the total is unknown, not 0.
    expect(blockFeesZat(withTxids(["cb", "other"], null))).toBeNull();
  });

  it("passes a known total through untouched", () => {
    expect(blockFeesZat(withTxids(["cb", "other"], 12_345))).toBe(12_345);
  });

  it("does not derive anything from a count of ZERO", () => {
    // An empty list means the contents were not given, not that the block is empty, so the
    // stored value stands, null included.
    expect(blockFeesZat(withTxids([], null))).toBeNull();
    expect(blockFeesZat(withTxids([], 500))).toBe(500);
  });

  it("passes a known zero through for a multi-transaction block", () => {
    // A block can legitimately contain a second transaction that paid nothing derivable as
    // zero; that is a measurement, not the derivation above.
    expect(blockFeesZat(withTxids(["cb", "other"], 0))).toBe(0);
  });
});

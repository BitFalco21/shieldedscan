import { describe, expect, it } from "vitest";
import { newestDistinctTxids } from "../address-txids";

const row = (txid: string, block_height: number) => ({ txid, block_height });

describe("newestDistinctTxids", () => {
  it("keeps one txid per transaction, newest block first, txid descending within a block", () => {
    const rows = [row("aa", 10), row("cc", 10), row("aa", 10), row("bb", 9), row("bb", 9)];
    expect(newestDistinctTxids(rows, 10)).toEqual(["cc", "aa", "bb"]);
  });

  it("stops at the limit", () => {
    const rows = [row("a1", 5), row("a2", 4), row("a3", 3)];
    expect(newestDistinctTxids(rows, 2)).toEqual(["a1", "a2"]);
  });

  it("cuts inside a block by the same txid order", () => {
    const rows = [row("ab", 7), row("ff", 7), row("cd", 7)];
    expect(newestDistinctTxids(rows, 2)).toEqual(["ff", "cd"]);
  });

  it("returns nothing for no rows", () => {
    expect(newestDistinctTxids([], 5)).toEqual([]);
  });
});

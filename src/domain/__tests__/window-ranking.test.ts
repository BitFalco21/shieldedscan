import { describe, expect, it } from "vitest";
import { bucketMeasure, rankBuckets, type ChainWindowBucket } from "../analytics";

/**
 * Property tests for ranking a window's buckets.
 *
 * The two failures guarded are both silent: a null measure treated as zero lets an unmeasured
 * period win a "lowest" question, and a tie reported as a winner names one day out of several.
 */

function bucket(over: Partial<ChainWindowBucket> & { timestamp: number }): ChainWindowBucket {
  return {
    daysCovered: 1,
    transparentTxs: 0,
    mixedTxs: 0,
    shieldedTxs: 0,
    shieldingTxs: 0,
    unshieldingTxs: 0,
    indeterminateTxs: 0,
    blocks: 0,
    shieldedZat: 0,
    unshieldedZat: 0,
    feeZat: 0,
    blocksCovered: 0,
    avgDifficulty: null,
    avgBlockBytes: null,
    ...over,
  };
}

describe("bucketMeasure", () => {
  it("sums the three kinds for transactions, as the site does everywhere else", () => {
    const b = bucket({ timestamp: 1, transparentTxs: 3, mixedTxs: 4, shieldedTxs: 5 });
    expect(bucketMeasure(b, "transactions")).toBe(12);
    expect(bucketMeasure(b, "shielded-transactions")).toBe(5);
  });

  it("returns null — never zero — where the bucket carries no value", () => {
    const b = bucket({ timestamp: 1, avgDifficulty: null, avgBlockBytes: null });
    expect(bucketMeasure(b, "difficulty")).toBeNull();
    expect(bucketMeasure(b, "block-size")).toBeNull();
  });
});

describe("rankBuckets", () => {
  it("orders highest first and returns at most the limit", () => {
    const out = rankBuckets(
      [
        bucket({ timestamp: 1, transparentTxs: 10 }),
        bucket({ timestamp: 2, transparentTxs: 30 }),
        bucket({ timestamp: 3, transparentTxs: 20 }),
      ],
      "transactions",
      "highest",
      2,
    );
    expect(out.ranked.map((b) => b.timestamp)).toEqual([2, 3]);
    expect(out.considered).toBe(3);
    expect(out.tiedAtTop).toBe(1);
  });

  it("orders lowest first when asked, which is what a 'quietest' question needs", () => {
    const out = rankBuckets(
      [bucket({ timestamp: 1, transparentTxs: 10 }), bucket({ timestamp: 2, transparentTxs: 30 })],
      "transactions",
      "lowest",
      5,
    );
    expect(out.ranked.map((b) => b.timestamp)).toEqual([1, 2]);
  });

  /*
   * A null difficulty must not sort as zero: ascending, every unmeasured day would win the
   * "lowest-difficulty day" question.
   */
  it("drops unmeasured buckets rather than ranking them as zero", () => {
    const out = rankBuckets(
      [
        bucket({ timestamp: 1, avgDifficulty: null }),
        bucket({ timestamp: 2, avgDifficulty: 500 }),
        bucket({ timestamp: 3, avgDifficulty: null }),
        bucket({ timestamp: 4, avgDifficulty: 900 }),
      ],
      "difficulty",
      "lowest",
      5,
    );
    expect(out.ranked.map((b) => b.timestamp)).toEqual([2, 4]);
    expect(out.unmeasured).toBe(2);
    expect(out.considered).toBe(2);
  });

  it("reports a tie at the top rather than picking a winner", () => {
    const out = rankBuckets(
      [
        bucket({ timestamp: 1, transparentTxs: 40 }),
        bucket({ timestamp: 2, transparentTxs: 40 }),
        bucket({ timestamp: 3, transparentTxs: 5 }),
      ],
      "transactions",
      "highest",
      5,
    );
    expect(out.tiedAtTop).toBe(2);
  });

  it("breaks ties by timestamp so the same question gives the same rows twice", () => {
    const buckets = [
      bucket({ timestamp: 9, transparentTxs: 40 }),
      bucket({ timestamp: 2, transparentTxs: 40 }),
    ];
    expect(rankBuckets(buckets, "transactions", "highest", 5).ranked[0]?.timestamp).toBe(2);
    // Asserted on reversed input too: a sort that merely preserved input order would pass
    // the line above and fail this one.
    expect(
      rankBuckets([...buckets].reverse(), "transactions", "highest", 5).ranked[0]?.timestamp,
    ).toBe(2);
  });

  it("ranks over EVERY bucket, not a recent slice — a year is 365 candidates", () => {
    // Ranking must happen before the display cap: the winner is planted at the oldest
    // position, where a cap keeping the newest 90 would have discarded it.
    const year = Array.from({ length: 365 }, (_, i) =>
      bucket({ timestamp: i + 1, transparentTxs: i === 0 ? 9_999 : 10 }),
    );
    const out = rankBuckets(year, "transactions", "highest", 3);
    expect(out.ranked[0]?.timestamp).toBe(1);
    expect(out.considered).toBe(365);
  });

  it("has nothing to rank, and says so, when every bucket is unmeasured", () => {
    const out = rankBuckets([bucket({ timestamp: 1 })], "difficulty", "highest", 5);
    expect(out.ranked).toEqual([]);
    expect(out.tiedAtTop).toBe(0);
    expect(out.considered).toBe(0);
    expect(out.unmeasured).toBe(1);
  });
});

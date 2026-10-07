import { describe, expect, it } from "vitest";
import { allocateRedactionBlocks } from "../redaction-bar";
import type { ShieldedPool } from "@/domain/pool";

// Real mainnet proportions: ironwood 78.8%, sapling 10.9%, orchard 9.8%, sprout 0.47% of the
// shielded set.
const POOLS: ShieldedPool[] = [
  { pool: "ironwood", balanceZat: 380_304_006_000_000 },
  { pool: "sapling", balanceZat: 52_496_937_395_056 },
  { pool: "orchard", balanceZat: 47_531_481_000_000 },
  { pool: "sprout", balanceZat: 2_262_126_786_698 },
];

describe("allocateRedactionBlocks", () => {
  it("allocates exactly the blocks it was given", () => {
    const out = allocateRedactionBlocks(POOLS, 34);
    expect(out.reduce((n, p) => n + p.blocks, 0)).toBe(34);
  });

  it("orders the segments largest first, so the bar reads as a ranking", () => {
    const out = allocateRedactionBlocks(POOLS, 34);
    expect(out.map((p) => p.pool)).toEqual(["ironwood", "sapling", "orchard", "sprout"]);
  });

  // Sprout is 0.47% of the shielded set and rounds to zero at any realistic block count. A
  // pool that holds something must never render identically to one that holds nothing.
  it("gives a pool holding something at least one block", () => {
    expect(allocateRedactionBlocks(POOLS, 34).find((p) => p.pool === "sprout")?.blocks).toBe(1);
  });

  it("takes that block from the largest pool, never from the total", () => {
    const out = allocateRedactionBlocks(POOLS, 34);
    expect(out.reduce((n, p) => n + p.blocks, 0)).toBe(34);
    expect(out[0]?.blocks).toBeLessThan(Math.round(0.788 * 34) + 1);
  });

  it("gives a pool holding nothing no blocks at all", () => {
    const out = allocateRedactionBlocks(
      [...POOLS.slice(0, 3), { pool: "sprout", balanceZat: 0 }],
      34,
    );
    expect(out.find((p) => p.pool === "sprout")?.blocks).toBe(0);
  });

  // Small block counts are where the floor-of-one step runs out of donor blocks: the largest
  // pool must never go negative, even when the total still adds up.
  describe("never goes negative or misorders at a small block count", () => {
    for (let shieldedBlocks = 1; shieldedBlocks <= 40; shieldedBlocks += 1) {
      it(`shieldedBlocks=${shieldedBlocks}`, () => {
        const out = allocateRedactionBlocks(POOLS, shieldedBlocks);
        for (const segment of out) {
          expect(segment.blocks, `${segment.pool} went negative`).toBeGreaterThanOrEqual(0);
        }
        expect(out.reduce((n, p) => n + p.blocks, 0)).toBe(shieldedBlocks);
        const largest = out[0]!.blocks;
        for (const segment of out) {
          expect(
            largest,
            `${segment.pool} (${segment.blocks}) outranked the largest pool (${largest})`,
          ).toBeGreaterThanOrEqual(segment.blocks);
        }
      });
    }
  });
});

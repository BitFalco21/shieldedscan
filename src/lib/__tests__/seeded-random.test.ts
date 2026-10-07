import { describe, expect, it } from "vitest";
import { seededRandom } from "../seeded-random";

/**
 * The generators the pulse texture and the halving scene were drawn with. The shared one must
 * reproduce them exactly, or both pictures would change.
 */
function pulseSeeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function halvingRng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const take = (next: () => number, n: number) => Array.from({ length: n }, () => next());

describe("seededRandom", () => {
  const SEEDS = [0, 1, 42, 2_166_136_261, 4_294_967_295, -7];

  it.each(SEEDS)("matches both generators it replaces, for seed %d", (seed) => {
    const ours = take(seededRandom(seed), 50);
    expect(ours).toEqual(take(pulseSeeded(seed), 50));
    expect(ours).toEqual(take(halvingRng(seed), 50));
  });

  it("repeats for a seed and stays inside [0, 1)", () => {
    const a = take(seededRandom(9), 200);
    expect(take(seededRandom(9), 200)).toEqual(a);
    expect(a.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(take(seededRandom(10), 5)).not.toEqual(a.slice(0, 5));
  });
});

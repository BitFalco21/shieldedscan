/**
 * A seeded pseudo-random generator (mulberry32), for decorative texture that must come out the
 * same on the server and the client: `Math.random` would differ between them and break
 * hydration. Never for anything secret; it is predictable by design.
 *
 * Returns a function yielding floats in [0, 1).
 */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

import type { PoolName, ShieldedPool } from "@/domain/pool";

export interface RedactionSegment {
  pool: PoolName;
  blocks: number;
}

/**
 * Split `shieldedBlocks` between the pools in proportion to what each holds.
 *
 * Largest remainder, then a floor of one block for any pool holding anything: Sprout is under
 * half a percent of the shielded set and rounds to zero at any block count that fits on a card.
 * The floor is paid for out of the largest pool, so the total is exactly the number asked for,
 * but only while that pool can afford it. Past that, the remaining pools stay at zero: a bar
 * too short to represent every pool must misrepresent nothing, and the largest pool must never
 * go negative or lose its rank.
 *
 * Segments come back largest-first (the same order the "pools" row below the bar uses), so
 * the bar reads as a ranking rather than an arbitrary sequence.
 */
export function allocateRedactionBlocks(
  pools: ShieldedPool[],
  shieldedBlocks: number,
): RedactionSegment[] {
  const ranked = [...pools].sort((a, b) => b.balanceZat - a.balanceZat);
  const total = ranked.reduce((sum, p) => sum + p.balanceZat, 0);
  if (total <= 0 || shieldedBlocks <= 0) {
    return ranked.map((p) => ({ pool: p.pool, blocks: 0 }));
  }

  // Each pool's exact fractional share, computed once and reused for both the floor and the
  // largest-remainder pass.
  const shares = ranked.map((p) => ({
    pool: p.pool,
    balanceZat: p.balanceZat,
    exact: (p.balanceZat / total) * shieldedBlocks,
  }));
  const out: RedactionSegment[] = shares.map((s) => ({
    pool: s.pool,
    blocks: Math.floor(s.exact),
  }));

  // Largest remainder for the blocks the floor left over. This step alone sums to exactly
  // `shieldedBlocks` and never goes negative. `byRemainder` is the same length as `out` (both
  // derived from `shares`), so the non-null assertions below state that invariant.
  let left = shieldedBlocks - out.reduce((sum, s) => sum + s.blocks, 0);
  const byRemainder = shares
    .map((s, i) => ({ i, rem: s.exact - Math.floor(s.exact) }))
    .sort((a, b) => b.rem - a.rem);
  for (let k = 0; left > 0; k += 1, left -= 1) {
    out[byRemainder[k % byRemainder.length]!.i]!.blocks += 1;
  }

  // Then the floor of one, funded only from the largest pool (`donor`, `out[0]`) and only
  // while it can give a block away and keep at least one. A second donor would just overdraw
  // a third pool's lead over a fourth. Needy pools are processed largest first, so when
  // funding runs out it is the smallest pools that are left at zero.
  const donor = out[0]!;
  for (let i = 1; i < out.length; i += 1) {
    const segment = out[i]!;
    if (segment.blocks > 0 || shares[i]!.balanceZat <= 0) continue;
    if (donor.blocks <= 1) break; // The one donor is spent; nothing left to fund with.
    donor.blocks -= 1;
    segment.blocks = 1;
  }
  return out;
}

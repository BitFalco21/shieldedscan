import type { MinerGroup, MiningOverview, MiningTrendPoint, MiningWindowKey } from "@/domain";
import { MINING_WINDOW_SECONDS } from "@/domain";
import { ADDR_MINER, ADDR_MINER_B, ADDR_MINER_C, TIP_HEIGHT, TIP_TIME } from "./ids";

/** Canopy-era miner share: 80% of the 3.125 ZEC subsidy, the era `TIP_HEIGHT` sits in. */
const MINER_REWARD_ZAT = 250_000_000;

/** Blocks per second on mainnet post-Blossom — 75s target. */
const BLOCKS_PER_SECOND = 1 / 75;

/**
 * The fixture chain's miners, as shares rather than counts, scaled to whichever window is
 * asked for.
 *
 * The shape follows a real sample of mainnet blocks: one dominant payout address naming
 * itself nowhere, one operator self-declaring in its coinbase, one stamping per-worker names
 * that identify a customer rather than a pool, and a thin tail.
 *
 * Only the three fixture payout addresses are used: they have address pages, so every row
 * links somewhere consistent with it.
 */
const MINER_SHARES: readonly {
  address: string | null;
  name: string | null;
  basis: MinerGroup["basis"];
  share: number;
  /** Fraction of this group's blocks whose coinbase names the operator. */
  selfDeclaredShare: number;
}[] = [
  { address: ADDR_MINER_B, name: null, basis: "unattributed", share: 0.4, selfDeclaredShare: 0 },
  {
    address: ADDR_MINER,
    name: "Foundry USA",
    basis: "self-declared",
    share: 0.32,
    selfDeclaredShare: 1,
  },
  { address: ADDR_MINER_C, name: null, basis: "unattributed", share: 0.27, selfDeclaredShare: 0 },
  // ZIP 213: the reward went into a shielded pool, so there is no payout address to group by.
  // Rare, and the whole reason `MinerGroup.address` is nullable.
  { address: null, name: null, basis: "unattributed", share: 0.01, selfDeclaredShare: 0 },
];

function minerGroups(blocks: number, spanSeconds: number): MinerGroup[] {
  return MINER_SHARES.map((m) => {
    const count = Math.max(1, Math.round(blocks * m.share));
    return {
      address: m.address,
      name: m.name,
      basis: m.basis,
      blocks: count,
      selfDeclaredBlocks: Math.round(count * m.selfDeclaredShare),
      rewardZat: count * MINER_REWARD_ZAT,
      // Null: per-miner fee totals are unknown in this fixture, and the page must render the
      // absence rather than a zero.
      feeZat: null,
      avgIntervalSeconds: count < 2 ? null : spanSeconds / count,
    };
  });
}

/** Difficulty wobbling around 207.63M — exact header values on the real chain, so no noise
 * that a reader could mistake for a trend. Thirty points, whatever the window. */
function trend(blocks: number, spanSeconds: number): MiningTrendPoint[] {
  const points = 30;
  const step = spanSeconds / points;
  return Array.from({ length: points }, (_, i) => ({
    timestamp: Math.round(TIP_TIME - spanSeconds + i * step),
    height: Math.round(TIP_HEIGHT - blocks + (i * blocks) / points),
    difficulty: Math.round(207_630_000 * (1 + 0.06 * Math.sin(i / 3.1) + 0.02 * Math.cos(i / 1.7))),
  }));
}

export function getMiningOverview(key: MiningWindowKey): MiningOverview {
  const spanSeconds = MINING_WINDOW_SECONDS[key];
  const blocks = Math.round(spanSeconds * BLOCKS_PER_SECOND);
  const groups = minerGroups(blocks, spanSeconds);
  const counted = groups.reduce((sum, g) => sum + g.blocks, 0);

  return {
    window: {
      key,
      fromHeight: TIP_HEIGHT - counted + 1,
      toHeight: TIP_HEIGHT,
      blocks: counted,
      spanSeconds,
      avgDifficulty: 207_630_000,
      avgTxCount: 5.2,
      // Unknown, not zero — see `MinerGroup.feeZat`.
      avgFeeZat: null,
      // Unknown here; the UI falls back to the documented estimate and labels it as one.
      solutionsPerSecond: null,
    },
    groups,
    trend: trend(counted, spanSeconds),
    // Nearly every sampled mainnet coinbase carries the Zebra mark. That measures node
    // implementation concentration, which is all the zebra emoji legitimately measures.
    software: {
      zebra: counted - Math.round(counted * 0.04),
      unidentified: Math.round(counted * 0.04),
    },
  };
}

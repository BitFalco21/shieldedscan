import { DAY_SECONDS } from "./time";

/**
 * Mining: who produced the blocks, and what the network cost to produce them.
 *
 * Zcash publishes no miner identity. A coinbase carries two things that look like one:
 *
 *  - the payout address, which is a fact — grouping blocks by it is arithmetic;
 *  - the coinbase tag, a string the miner chose to write. A name there is a published,
 *    self-declared claim, not proof of who owns an address.
 *
 * A self-declared name is a stronger claim than one taken from an external list, so every
 * name carries its {@link MinerAttributionBasis}. An address that names itself nowhere stays
 * unnamed; names are never guessed.
 */

/** How a miner's displayed name was arrived at. Rendered beside the name, never hidden. */
export type MinerAttributionBasis =
  /** The operator wrote this name into its own coinbase. Verifiable on-chain. */
  | "self-declared"
  /** An off-chain mapping names this payout address. A claim we are repeating. */
  | "external"
  /** Nothing names it. The group is identified by its payout address alone. */
  | "unattributed";

/**
 * The zebra emoji Zebra-family nodes stamp into the coinbase by default.
 *
 * This identifies node software, not a miner. Most sampled blocks carry it, many with
 * nothing else; treating it as a signature would invent a "Zebra pool" holding the plurality
 * of hashrate. Report it only as implementation diversity, via {@link minerNodeSoftware}.
 */
export const ZEBRA_COINBASE_MARK = "🦓";

/**
 * Coinbase substrings by which an operator names itself.
 *
 * Every entry records a block height where the string was observed on mainnet; nothing is
 * added without one. A wrong name on a hashrate chart is a false claim about a real company.
 *
 * Matching is a case-insensitive substring test, not a parse. The tag is attacker-controlled
 * (sanitised at the parse boundary) and a miner may write a competitor's name into it, which
 * is why the basis is always shown and this is never presented as proof.
 */
export const MINER_SIGNATURES: readonly { needle: string; name: string; observedAt: number }[] = [
  { needle: "Foundry Zcash Pool", name: "Foundry USA", observedAt: 3_430_141 },
  { needle: "/NiceHash/", name: "NiceHash", observedAt: 3_430_127 },
];

/**
 * The operator that named itself in this coinbase tag, or null.
 *
 * Returns null for tags like `"🦓Mined by duan8626aTpn%"`: the trailing name varies per block
 * on one payout address, so it is a worker on some pool, not the pool itself.
 */
export function selfDeclaredMiner(coinbaseTag: string | null): string | null {
  if (coinbaseTag === null) return null;
  const haystack = coinbaseTag.toLowerCase();
  const hit = MINER_SIGNATURES.find((s) => haystack.includes(s.needle.toLowerCase()));
  return hit?.name ?? null;
}

/**
 * The node implementation that built this coinbase, where it identifies itself.
 *
 * Null means the tag names no implementation, not that the miner ran something else.
 */
export function minerNodeSoftware(coinbaseTag: string | null): "zebra" | null {
  return coinbaseTag !== null && coinbaseTag.includes(ZEBRA_COINBASE_MARK) ? "zebra" : null;
}

/**
 * One miner's share of a window, grouped by payout address.
 *
 * Two addresses belonging to one operator are two rows: merging them would be address
 * clustering, which this explorer does not do. Every concentration figure is therefore a
 * lower bound — see {@link topMinerSharePct}.
 */
export interface MinerGroup {
  /**
   * Payout address, or null when the reward was paid into a shielded pool. A shielded
   * coinbase is a real answer, and the null forces the UI to say so.
   */
  address: string | null;
  /** Display name, or null when nothing names this miner. Never guessed. */
  name: string | null;
  basis: MinerAttributionBasis;
  blocks: number;
  /** Blocks in this group whose coinbase carried the self-declaring tag. */
  selfDeclaredBlocks: number;
  /**
   * What this miner was paid across the group, zatoshis — its own coinbase outputs only.
   * Funding-stream outputs belong to someone else and would inflate earnings.
   */
  rewardZat: number;
  /**
   * Fees this miner collected, or null when any of its blocks has an underivable fee.
   * A partial sum is never presented as a total.
   */
  feeZat: number | null;
  /**
   * Mean seconds between this group's blocks: window span divided by block count, so it is
   * comparable across miners of different size. Null below two blocks.
   */
  avgIntervalSeconds: number | null;
}

/** Windows the page offers. */
export type MiningWindowKey = "24h" | "3d" | "7d" | "30d" | "90d" | "1y";

export const MINING_WINDOWS: readonly MiningWindowKey[] = ["24h", "3d", "7d", "30d", "90d", "1y"];

export const MINING_WINDOW_SECONDS: Readonly<Record<MiningWindowKey, number>> = {
  "24h": DAY_SECONDS,
  "3d": 3 * DAY_SECONDS,
  "7d": 7 * DAY_SECONDS,
  "30d": 30 * DAY_SECONDS,
  "90d": 90 * DAY_SECONDS,
  "1y": 365 * DAY_SECONDS,
};

/**
 * Parse a window from a URL. Anything unrecognised means the default, so a hand-edited URL
 * never reaches SQL.
 */
export function parseMiningWindow(raw: string | undefined): MiningWindowKey {
  return MINING_WINDOWS.find((w) => w === raw) ?? "7d";
}

/** Network-level facts over a window. Every field is measured, none is modelled. */
export interface MiningWindow {
  key: MiningWindowKey;
  fromHeight: number;
  toHeight: number;
  /** Blocks actually counted. Never assumed from the window length. */
  blocks: number;
  /** Seconds between the first and last block counted. */
  spanSeconds: number;
  /** Mean difficulty across the window, straight from the block headers. Exact. */
  avgDifficulty: number;
  /** Mean non-coinbase transactions per block. */
  avgTxCount: number;
  /** Mean fee paid per block, or null when unknown for any block in the window. */
  avgFeeZat: number | null;
  /**
   * Network solution rate, solutions per second, as the node reports it (`getnetworksolps`).
   * Null when not read; {@link windowSolutionRate} then falls back to a labelled estimate.
   *
   * Equihash produces solutions, not hashes: an H/s label on this quantity is a category error.
   */
  solutionsPerSecond: number | null;
}

/** Mean seconds per block over the window. Null below two blocks. */
export function avgBlockSeconds(window: MiningWindow): number | null {
  if (window.blocks < 2) return null;
  return window.spanSeconds / (window.blocks - 1);
}

/**
 * Expected Equihash solutions per block at difficulty 1, i.e. `2^256 / powLimit`.
 *
 * Mainnet's `powLimit` is `0007ffff…ff` (13 leading zero bits), so the ratio is `2^13`.
 * Difficulty is `powLimit / target` and the expected solutions per block are
 * `2^256 / target`; their product gives the constant. Derived from chain parameters, it
 * agrees with the node's `getnetworksolps` to within a few percent.
 */
export const SOLUTIONS_PER_DIFFICULTY = 8192;

/**
 * Estimated network solution rate, solutions per second.
 *
 * Solve times are a Poisson process, so any rate from a finite window is a sample and must be
 * shown with its window. Null when the block time is unknown or non-positive, rather than
 * dividing into `Infinity`.
 */
export function estimateSolutionsPerSecond(
  difficulty: number,
  blockSeconds: number | null,
): number | null {
  if (blockSeconds === null || blockSeconds <= 0 || !Number.isFinite(difficulty)) return null;
  return (SOLUTIONS_PER_DIFFICULTY * difficulty) / blockSeconds;
}

/**
 * The window's solution rate and whether it was measured or estimated, so the page can say
 * which.
 */
export function windowSolutionRate(
  window: MiningWindow,
): { solps: number; basis: "node" | "estimated" } | null {
  if (window.solutionsPerSecond !== null) {
    return { solps: window.solutionsPerSecond, basis: "node" };
  }
  const estimate = estimateSolutionsPerSecond(window.avgDifficulty, avgBlockSeconds(window));
  return estimate === null ? null : { solps: estimate, basis: "estimated" };
}

/**
 * A group's share of the window, as a percentage.
 *
 * The denominator is passed in rather than summed from the groups, so a folded "other" row
 * is neither double-counted nor dropped. Render the counts beside it.
 */
export function minerSharePct(blocks: number, totalBlocks: number): number {
  return totalBlocks === 0 ? 0 : (blocks / totalBlocks) * 100;
}

/**
 * Combined share of the `n` largest payout addresses — the page's concentration figure.
 *
 * A lower bound: one operator with several payout addresses appears as several miners. The
 * opposite error is impossible, since two operators cannot share one address unknowingly.
 */
export function topMinerSharePct(
  groups: readonly MinerGroup[],
  totalBlocks: number,
  n = 5,
): number {
  const top = [...groups].sort((a, b) => b.blocks - a.blocks).slice(0, n);
  return minerSharePct(
    top.reduce((sum, g) => sum + g.blocks, 0),
    totalBlocks,
  );
}

/** Share of the window's blocks whose reward was paid into a shielded pool (ZIP 213). */
export function shieldedCoinbaseSharePct(
  groups: readonly MinerGroup[],
  totalBlocks: number,
): number {
  const shielded = groups.filter((g) => g.address === null).reduce((sum, g) => sum + g.blocks, 0);
  return minerSharePct(shielded, totalBlocks);
}

/**
 * Share of the window's blocks attributable to a named operator at all, published so the
 * unnamed remainder is stated as a measurement.
 */
export function attributedSharePct(groups: readonly MinerGroup[], totalBlocks: number): number {
  const named = groups.filter((g) => g.name !== null).reduce((sum, g) => sum + g.blocks, 0);
  return minerSharePct(named, totalBlocks);
}

/** The folded tail of a ranking: real blocks, deliberately not itemised. */
export interface FoldedMiners {
  /** Distinct payout addresses folded in, so the row is not mistaken for one miner. */
  groups: number;
  blocks: number;
  rewardZat: number;
}

/**
 * Keep the largest `keep` miners and fold the rest into one tail row.
 *
 * The tail is folded, never dropped: dropping it would shrink the denominator and inflate
 * every share above it.
 */
export function foldMinerGroups(
  groups: readonly MinerGroup[],
  keep = 10,
): { shown: MinerGroup[]; folded: FoldedMiners | null } {
  const ranked = [...groups].sort((a, b) => b.blocks - a.blocks);
  if (ranked.length <= keep) return { shown: ranked, folded: null };

  const tail = ranked.slice(keep);
  return {
    shown: ranked.slice(0, keep),
    folded: {
      groups: tail.length,
      blocks: tail.reduce((sum, g) => sum + g.blocks, 0),
      rewardZat: tail.reduce((sum, g) => sum + g.rewardZat, 0),
    },
  };
}

/** One point on the difficulty trend — an exact header value, not an estimate. */
export interface MiningTrendPoint {
  timestamp: number;
  height: number;
  difficulty: number;
}

/**
 * Which node implementations built the window's blocks, by coinbase mark. `unidentified` is
 * never folded into a named implementation: a node that stamps nothing is not evidence.
 */
export interface MiningSoftwareMix {
  zebra: number;
  unidentified: number;
}

/** Everything `/mining` renders for one window. One source call, no per-row work. */
export interface MiningOverview {
  window: MiningWindow;
  /** Every group in the window, unranked and unfolded — the UI folds for display. */
  groups: MinerGroup[];
  trend: MiningTrendPoint[];
  software: MiningSoftwareMix;
}

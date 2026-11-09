import { UNATTRIBUTED_GROUP } from "./miners";
import { MINING_POOLS } from "./mining-pools";

/**
 * How old a block already is, by its own header timestamp, when this explorer's follower first
 * stores it: `block.received_at − block.timestamp`, per UTC day and mining pool.
 *
 * Not a clock-skew measurement. The figure adds up the miner's timestamp lag (a miner stamps a
 * template and grinds on it without rolling the time forward), the network's propagation to our
 * node, and our own 5-second poll and store latency, minus any error between the two clocks. Only
 * the first term differs by pool, which is why the comparison is by pool.
 *
 * A negative age is a miner's clock ahead of ours and is kept as measured, never clamped. A block
 * stored more than `ARRIVAL_LATE_SECONDS` after its header time is our own outage (a node swap, a
 * follower restart): it is left out of every percentile and counted in `late`. A block with no
 * stamp (written by the backfiller, or before recording began) is in `blocks` only.
 */

/** Past this many seconds a block was stored late by us, not mined late: `server/pulse-ribbons.ts`. */
export const ARRIVAL_LATE_SECONDS = 600;

/** A group's percentiles need at least this many measured blocks in the span, else null. */
export const ARRIVAL_MIN_BLOCKS = 10;

/** The group for every block in the span, whoever mined it. */
export const ARRIVAL_ALL_GROUP = "all";

/** The trailing windows summarised whole: the last N UTC days, today included. */
export const BLOCK_ARRIVAL_WINDOWS = ["7d", "30d", "90d"] as const;
export type BlockArrivalWindowKey = (typeof BLOCK_ARRIVAL_WINDOWS)[number];

export const BLOCK_ARRIVAL_WINDOW_DAYS: Readonly<Record<BlockArrivalWindowKey, number>> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** One group over one span: a day or a window. */
export interface BlockArrivalCell {
  /** `all`, a reviewed mining pool id, or `unattributed` (every block no reviewed label names). */
  group: string;
  /** Every block the group mined in the span, stamped or not. */
  blocks: number;
  /** Stamped and stored within `ARRIVAL_LATE_SECONDS`: the blocks the percentiles are over. */
  measured: number;
  /** Stamped, but stored past `ARRIVAL_LATE_SECONDS`: our outage, left out. */
  late: number;
  /** Nearest-rank median age in whole seconds; null below `ARRIVAL_MIN_BLOCKS` measured. */
  p50Seconds: number | null;
  /** Nearest-rank 90th percentile in whole seconds; null below `ARRIVAL_MIN_BLOCKS` measured. */
  p90Seconds: number | null;
}

export interface BlockArrivalDay {
  /** `YYYY-MM-DD`, UTC, by header timestamp. */
  day: string;
  /** True for today, which is still running. */
  partial: boolean;
  /** `all` first, then pools by measured blocks, then `unattributed`. */
  groups: BlockArrivalCell[];
}

export interface BlockArrivalWindow {
  window: BlockArrivalWindowKey;
  /** First and last UTC day covered, inclusive; the last is today. */
  fromDay: string;
  toDay: string;
  groups: BlockArrivalCell[];
}

export interface BlockArrivalSeries {
  /** The first UTC day with a stamped block; null before any. Nothing earlier exists. */
  recordingSince: string | null;
  lateSeconds: number;
  minBlocks: number;
  /** Oldest first, from `recordingSince`. */
  days: BlockArrivalDay[];
  windows: BlockArrivalWindow[];
  asOf: number;
}

/** Every group a day can carry besides `all`, in a fixed order: each reviewed pool, then the rest. */
export const BLOCK_ARRIVAL_GROUPS: readonly string[] = [
  ...Object.keys(MINING_POOLS),
  UNATTRIBUTED_GROUP,
];

/** Blocks with no stamp of ours: before recording, or written by the backfiller. */
export function arrivalUnstamped(cell: BlockArrivalCell): number {
  return cell.blocks - cell.measured - cell.late;
}

/**
 * The nearest-rank percentile of sorted values: the smallest value with at least `p` of the
 * values at or below it — Postgres's `percentile_disc`, so an age is always one a block had.
 */
export function nearestRank(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.min(i, sorted.length - 1)]!;
}

/**
 * A cell from each block's age, null where the block carries no stamp. The same rule the
 * tracker's SQL applies: late and unstamped blocks out of the percentiles, too few measured, null.
 */
export function arrivalCell(group: string, ages: readonly (number | null)[]): BlockArrivalCell {
  const stamped = ages.filter((a): a is number => a !== null);
  const kept = stamped.filter((a) => a <= ARRIVAL_LATE_SECONDS).sort((a, b) => a - b);
  const enough = kept.length >= ARRIVAL_MIN_BLOCKS;
  return {
    group,
    blocks: ages.length,
    measured: kept.length,
    late: stamped.length - kept.length,
    p50Seconds: enough ? nearestRank(kept, 0.5) : null,
    p90Seconds: enough ? nearestRank(kept, 0.9) : null,
  };
}

/** A group's display name: the pool's own, or the two groups that are not pools. */
export function arrivalGroupName(group: string): string {
  if (group === ARRIVAL_ALL_GROUP) return "All blocks";
  if (group === UNATTRIBUTED_GROUP) return "Unattributed";
  return MINING_POOLS[group as keyof typeof MINING_POOLS]?.name ?? group;
}

/** `all` first, then by measured blocks (most first), `unattributed` last, ties by id. */
export function sortArrivalCells(cells: readonly BlockArrivalCell[]): BlockArrivalCell[] {
  const rank = (g: string) => (g === ARRIVAL_ALL_GROUP ? 0 : g === UNATTRIBUTED_GROUP ? 2 : 1);
  return [...cells].sort(
    (a, b) =>
      rank(a.group) - rank(b.group) || b.measured - a.measured || a.group.localeCompare(b.group),
  );
}

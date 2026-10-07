import type { PulseBlock, PulseBlockPools, PulseEnd, PulseEvent } from "@/domain";
import { PULSE_INDEXED_LATE_SECONDS } from "@/domain";

/**
 * when a movement is drawn, and what is drawn when there are too many of them.
 *
 * Pure: blocks in, decisions out. Every rule the transport depends on lives here rather than
 * inside the rAF loop, so "which blocks are due at this instant" and "does this block collapse"
 * can be checked without a clock.
 */

/**
 * How many events one block may draw individually before the picture states sums instead. At
 * three hundred marks a pulse is a smear. The consensus maximum is around 2,450, so this is
 * reachable on a real block.
 */
export const PULSE_COLLAPSE_EVENTS = 300;

/** Above this replay speed a block's individual movements smear into each other. */
export const PULSE_COLLAPSE_SPEED = 600;

/** How many blocks one animation frame may fire, so a scrub cannot flood the stage. */
export const PULSE_MAX_BLOCKS_PER_FRAME = 6;

/**
 * The instant a block is placed on the transport, unix seconds.
 *
 * Our follower's arrival stamp is the honest clock for "when did this reach us" (the one the
 * heartbeat measures), except when it and the header time disagree by more than {@link
 * PULSE_INDEXED_LATE_SECONDS}: then the stamp measures our own backfill, and a replay placed at
 * it would bunch an hour of history into the minute we stored it. Such a block is placed at
 * header time, and the transport says which clock it is reading.
 */
export function pulsePlacementSeconds(block: PulseBlock): number {
  const { receivedAt, timestamp } = block.pools;
  if (receivedAt === null) return timestamp;
  if (block.indexedLate === true) return timestamp;
  if (receivedAt - timestamp > PULSE_INDEXED_LATE_SECONDS) return timestamp;
  return receivedAt;
}

/** True when any block on screen was stored long after it was mined. */
export function anyIndexedLate(blocks: readonly PulseBlock[]): boolean {
  return blocks.some((b) => b.indexedLate === true);
}

/**
 * The blocks a replay should fire at this instant, oldest first.
 *
 * Bounded per call: a scrub can move the clock across an hour in one frame, and firing every
 * block in it would spawn thousands of marks nobody sees. The unplayed remainder is simply
 * fired on the next frames, which is what a fast-forward looks like.
 */
export function blocksDue(
  blocks: readonly PulseBlock[],
  simSeconds: number,
  played: ReadonlySet<string>,
  max: number = PULSE_MAX_BLOCKS_PER_FRAME,
): PulseBlock[] {
  return blocks
    .filter((b) => !played.has(b.pools.hash) && pulsePlacementSeconds(b) <= simSeconds)
    .sort((a, b) => a.pools.height - b.pools.height)
    .slice(0, max);
}

/**
 * The six closes the boxes should read at a replayed instant.
 *
 * The newest block at or before the clock — never the tip, and never a balance from one row
 * beside a height from another. Null when the clock sits before every block we hold, which the
 * caller draws as the live stocks rather than inventing a past.
 */
export function poolsAtSim(
  blocks: readonly PulseBlock[],
  simSeconds: number,
): PulseBlockPools | null {
  let best: PulseBlockPools | null = null;
  for (const block of blocks) {
    if (pulsePlacementSeconds(block) > simSeconds) continue;
    if (best === null || block.pools.height > best.height) best = block.pools;
  }
  return best;
}

/** One edge's worth of a block, when the block is drawn as sums rather than as movements. */
export interface PulseCollapsedEdge {
  key: string;
  from: PulseEnd;
  to: PulseEnd;
  /** Gross zatoshi along this edge in this block. */
  totalZat: number;
  /** How many transactions the sum covers, so the mark can say what it stands for. */
  count: number;
  height: number | null;
}

/**
 * A busy block as sums — and as counts for the two kinds of movement that cannot be summed. A
 * fully shielded movement has no amount by design and a hub has no direction to file its amount
 * under, so both are counted rather than dropped; dropping them would draw a busy block as a
 * small one.
 */
export interface PulseCollapsedBlock {
  edges: PulseCollapsedEdge[];
  /** Fully shielded movements, per pool. */
  veils: { pool: PulseEnd; count: number }[];
  /** Movements whose direction the chain did not settle. */
  hubs: number;
  height: number | null;
}

/**
 * Does this block draw its movements, or their sums?
 *
 * Two independent reasons, and both are about legibility rather than cost: a block with three
 * hundred movements cannot show them, and a replay at ×600 gives each one a few milliseconds.
 */
export function shouldCollapse(speedMultiplier: number, eventCount: number): boolean {
  return speedMultiplier >= PULSE_COLLAPSE_SPEED || eventCount >= PULSE_COLLAPSE_EVENTS;
}

/**
 * A block's movements as per-edge sums, plus the counts for what no edge can carry.
 *
 * Legs with no published amount are counted and contribute nothing to the total, so a
 * collapsed edge's count can legitimately exceed what its sum accounts for — the same
 * distinction a coverage denominator draws everywhere else on this site.
 */
export function collapseBlockEvents(block: PulseBlock): PulseCollapsedBlock {
  const totals = new Map<string, PulseCollapsedEdge>();
  const veils = new Map<PulseEnd, number>();
  let hubs = 0;
  for (const event of block.events) {
    if (event.shape === "veil") {
      const pool = event.legs[0]?.to ?? event.legs[0]?.from;
      if (pool !== undefined) veils.set(pool, (veils.get(pool) ?? 0) + 1);
      continue;
    }
    // A hub's legs do not pair, so summing them along an edge would state the direction the
    // chain refused to settle. Counted instead of either summed or dropped.
    if (event.shape === "hub") {
      hubs += 1;
      continue;
    }
    for (const leg of event.legs) {
      const key = `${leg.from}>${leg.to}`;
      const held = totals.get(key);
      totals.set(key, {
        key,
        from: leg.from,
        to: leg.to,
        totalZat: (held?.totalZat ?? 0) + Math.abs(leg.amountZat ?? 0),
        count: (held?.count ?? 0) + 1,
        height: event.height,
      });
    }
  }
  return {
    edges: [...totals.values()].sort((a, b) => b.totalZat - a.totalZat),
    veils: [...veils.entries()].map(([pool, count]) => ({ pool, count })),
    hubs,
    height: block.pools.height,
  };
}

/**
 * The crossings a replay clock has reached, oldest first.
 *
 * Separate from {@link blocksDue} because a crossing no block recorded is placed at venue
 * time and has no height to order by: a venue saying a crossing completed is not the chain
 * saying which block carried it.
 */
export function swapsDue(
  swaps: readonly PulseEvent[],
  simSeconds: number,
  played: ReadonlySet<string>,
  max: number = PULSE_MAX_BLOCKS_PER_FRAME,
): PulseEvent[] {
  return swaps
    .filter((s) => !played.has(s.id) && s.at <= simSeconds)
    .sort((a, b) => a.at - b.at)
    .slice(0, max);
}

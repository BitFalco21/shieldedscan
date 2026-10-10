/**
 * The series behind the chart library's second set of charts, shared by the private routes that
 * serve them and the pages that draw them. Each mirrors a public `/v1` figure's definition, so a
 * chart and the endpoint it names cannot disagree about what they count.
 */

import type { ZcashAddressKind } from "./address";
import { BLOCK_TARGET_SECONDS, BLOSSOM_HEIGHT, PRE_BLOSSOM_TARGET_SECONDS } from "./halving";

/**
 * Each pool's note commitment tree size at the day's last block, as the node reports it: every
 * note ever created in the pool, spent or not. A level, not a flow: never summed across days, and
 * never across pools either, since a spend hides only among its own pool's notes. Null before a
 * pool activated. Sprout's size is not reported by the node, so it has no field.
 */
export interface NoteTreeDayPoint {
  timestamp: number;
  saplingNotes: number | null;
  orchardNotes: number | null;
  ironwoodNotes: number | null;
}

/**
 * One UTC day of transparent activity, as `/v1/analytics/transparent` defines it. Every field is
 * null on a day the backfill has not reached: a gap, never a quiet day.
 */
export interface TransparentDayPoint {
  timestamp: number;
  /** Distinct addresses that sent or received that day. Never added across days. */
  activeAddresses: number | null;
}

/**
 * One month of block production by payout address, as `/v1/analytics/miners` counts it: the
 * largest transparent payout addresses, each address on its own, against every block in the month.
 */
export interface MinerShareMonth {
  timestamp: number;
  /** Every block in the month: the denominator, shielded-coinbase and unrecorded blocks included. */
  blocks: number;
  /** Days of the month the mining index has computed: fewer than the month holds is partial. */
  days: number;
  top1Blocks: number;
  top3Blocks: number;
  top10Blocks: number;
  /** Blocks whose coinbase paid into a shielded pool (ZIP 213): their miner cannot be named. */
  shieldedBlocks: number;
}

/** Reorganisations one node observed, per ISO week, from when it began observing. */
export interface ReorgWeekSeries {
  /** Unix seconds observation began. Null before the first observation: no weeks then. */
  observingSince: number | null;
  weeks: { timestamp: number; reorgs: number; deepest: number }[];
}

/** ZEC arriving from one source chain in one month, through the public swap venues indexed. */
export interface ChainInflowPoint {
  timestamp: number;
  chain: string;
  inZat: number;
}

/** ZEC leaving for one destination chain in one month, through the public swap venues indexed. */
export interface ChainOutflowPoint {
  timestamp: number;
  chain: string;
  outZat: number;
}

/** ZEC through one swap venue in one month: the two directions as separate figures, never netted. */
export interface VenueMonthPoint {
  timestamp: number;
  protocol: string;
  inZat: number;
  outZat: number;
}

/**
 * ZEC arriving in one month at one kind of Zcash address. A unified address is shielded-capable
 * only: it may carry a transparent receiver, and which receiver a payout used is not public.
 * Null is a transfer whose venue published no Zcash address: the shielded-capable share leaves it
 * out of both terms, as `/v1/crosschain/destinations` does.
 */
export interface InflowKindMonthPoint {
  timestamp: number;
  kind: ZcashAddressKind | null;
  transfers: number;
  zat: number;
}

/**
 * Every value pool's balance at one complete UTC day's last block. A shielded pool is null before
 * it existed and the lockbox before NU6 created it; a null is never a zero balance. A level, read
 * at the close: never summed across days.
 */
export interface SupplyDayPoint {
  timestamp: number;
  transparentZat: number | null;
  sproutZat: number | null;
  saplingZat: number | null;
  orchardZat: number | null;
  ironwoodZat: number | null;
  lockboxZat: number | null;
}

/**
 * Shielded ZEC and circulating ZEC at a close, from one block, so the share's two sides cannot
 * disagree. Circulating is every pool but the lockbox, as `circulatingZat` defines it. A pool that
 * did not exist yet holds nothing; null when the transparent or Sprout balance is unread.
 */
export function shieldedOfCirculating(
  p: SupplyDayPoint,
): { shieldedZat: number; circulatingZat: number } | null {
  if (p.transparentZat === null || p.sproutZat === null) return null;
  const shieldedZat =
    p.sproutZat + (p.saplingZat ?? 0) + (p.orchardZat ?? 0) + (p.ironwoodZat ?? 0);
  return { shieldedZat, circulatingZat: p.transparentZat + shieldedZat };
}

/**
 * `shieldedOfCirculating` over closes in time order. A null pool counts as empty only before it
 * first held a balance: one that has, then reads null, is an unread close, and that close gets
 * no split rather than a share that dips by a whole pool.
 */
export function shieldedSplits(
  points: readonly SupplyDayPoint[],
): ({ shieldedZat: number; circulatingZat: number } | null)[] {
  const pools = ["saplingZat", "orchardZat", "ironwoodZat"] as const;
  const existed = new Set<(typeof pools)[number]>();
  return points.map((p) => {
    const gap = pools.some((pool) => existed.has(pool) && p[pool] === null);
    for (const pool of pools) if (p[pool] !== null) existed.add(pool);
    return gap ? null : shieldedOfCirculating(p);
  });
}

/**
 * Blocks mined in one complete UTC day, with the day's top height so a reader (and the chart's
 * target line) can tell which side of Blossom the day fell on. The current day, still filling, is
 * never included: its count would read as a collapse that has not happened.
 */
export interface BlocksDayPoint {
  timestamp: number;
  blocks: number;
  topHeight: number;
}

/** Blocks per day the protocol aims for at a block-time target, in seconds. */
export const blocksPerDayAt = (targetSeconds: number) => 86_400 / targetSeconds;

/**
 * The day's target, from its heights rather than a calendar date: 576 blocks a day while the
 * target was 150 s, 1,152 once Blossom halved it to 75 s. Null on the activation day itself, whose
 * blocks fall under both targets: a single figure for it would be wrong either way.
 */
export function blocksTargetForDay(point: BlocksDayPoint): number | null {
  const first = point.topHeight - point.blocks + 1;
  if (point.topHeight < BLOSSOM_HEIGHT) return blocksPerDayAt(PRE_BLOSSOM_TARGET_SECONDS);
  if (first >= BLOSSOM_HEIGHT) return blocksPerDayAt(BLOCK_TARGET_SECONDS);
  return null;
}

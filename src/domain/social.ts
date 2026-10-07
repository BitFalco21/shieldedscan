import { isOneOf } from "./closed-set";
import {
  POOL_NAMES,
  shieldedShareOfCirculatingPct,
  totalShieldedZat,
  type ShieldedPool,
} from "./pool";
import type { ShieldingFlowPoint } from "./shielding-flow";
import { SWAP_DRYRUN_KIND, SWAP_KIND } from "./swap";
import {
  SHIELDING_DRYRUN_KIND,
  SHIELDING_KIND,
  UNSHIELDING_DRYRUN_KIND,
  UNSHIELDING_KIND,
} from "./boundary";

/**
 * One instant of the chain, as published on X.
 *
 * Every field is a term; nothing derived is carried. The card and the post text both call
 * the functions below, so they cannot disagree.
 *
 * Nullable fields come from pollers that can be cold or failing. `snapshotIsComplete` is the
 * gate: a snapshot missing anything the card prints yields no post, never a blank cell.
 */
export interface SocialSnapshot {
  /** When this was read. Printed on the card, since a live figure must be stamped. */
  readAtUnix: number;
  /** The tip when it was read, which makes the pool balances checkable. */
  readAtHeight: number;
  /** Calendar date in Europe/Paris. The ledger key: exactly one post per Paris day. */
  parisDay: string;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  /** All four shielded pools, live balances at `readAtHeight`. */
  pools: ShieldedPool[];
  /** Mined minus the NU6 lockbox: the denominator the share names. */
  circulatingSupplyZat: number | null;
  /** Gross shielded and unshielded over the trailing 24 hours. */
  flow24h: ShieldingFlowPoint | null;
  /** Daily closes, oldest first, for the sparkline. */
  recentCloses: { day: string; usd: number }[];
}

/**
 * A ledger row, generic over its figures because each post kind carries different facts.
 *
 * `eventKey` is the ledger's key column (`event_key`). It is a Paris calendar day only for
 * `kind: "daily"`; other kinds use their own key (a swap's is the venue's transfer id).
 */
export interface SocialPost<T> {
  eventKey: string;
  figures: T;
  tweetId: string | null;
}

/** Kept as the daily specialisation so existing call sites read unchanged. */
export type DailyPost = SocialPost<SocialSnapshot>;

/** The ledger kind for a real, once-per-Paris-day publish. Enforces exactly-once. */
export const DAILY_KIND = "daily";

/**
 * The ledger kind a dry run claims under, never `DAILY_KIND`. Its row is replaced on every
 * claim rather than reserved once, so dry runs never consume a real day. See
 * `SocialStore.claim`.
 */
export const DAILY_DRYRUN_KIND = "daily-dryrun";

/**
 * Every recognised ledger kind. The card route validates its `kind` segment against this set
 * before calling `readSocialPost`: the segment is attacker-supplied on a public route, so an
 * unknown value is a 404, never a query. Add a kind only once the route can render it.
 */
export const SOCIAL_POST_KINDS = [
  DAILY_KIND,
  DAILY_DRYRUN_KIND,
  SWAP_KIND,
  SWAP_DRYRUN_KIND,
  SHIELDING_KIND,
  SHIELDING_DRYRUN_KIND,
  UNSHIELDING_KIND,
  UNSHIELDING_DRYRUN_KIND,
] as const;

export type SocialPostKind = (typeof SOCIAL_POST_KINDS)[number];

export function isSocialPostKind(value: string): value is SocialPostKind {
  return isOneOf(SOCIAL_POST_KINDS, value);
}

/**
 * Every ledger kind that is a dry run: its row may be claimed any number of times (replaced,
 * not reserved) without consuming a real event. `SocialStore.claim` reads this list.
 */
export const DRYRUN_KINDS = [
  DAILY_DRYRUN_KIND,
  SWAP_DRYRUN_KIND,
  SHIELDING_DRYRUN_KIND,
  UNSHIELDING_DRYRUN_KIND,
] as const;

export function isDryRunKind(value: string): boolean {
  return isOneOf(DRYRUN_KINDS, value);
}

/** Two points is the minimum a line can be drawn through. */
const MIN_SPARKLINE_POINTS = 2;

export function snapshotShieldedZat(s: SocialSnapshot): number {
  return totalShieldedZat(s.pools);
}

export function snapshotSharePct(s: SocialSnapshot): number | null {
  if (s.circulatingSupplyZat === null) return null;
  return shieldedShareOfCirculatingPct(snapshotShieldedZat(s), s.circulatingSupplyZat);
}

/**
 * Does this snapshot carry every figure the card prints? An unattended publisher posts
 * nothing rather than a blank cell.
 */
export function snapshotIsComplete(s: SocialSnapshot): boolean {
  if (s.priceUsd === null || s.priceChange24hPct === null) return false;
  if (s.circulatingSupplyZat === null || s.flow24h === null) return false;
  if (s.recentCloses.length < MIN_SPARKLINE_POINTS) return false;
  // Every pool, not merely some: a missing pool silently understates the total and share.
  const present = new Set(s.pools.map((p) => p.pool));
  if (!POOL_NAMES.every((name) => present.has(name))) return false;
  // A zero shielded total is a broken read (or testnet), never a measurement. Refusing it
  // here keeps the card's per-pool share from dividing 0 by 0.
  return snapshotShieldedZat(s) > 0;
}

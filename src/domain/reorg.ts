/**
 * A chain reorganisation our node observed and rolled back.
 *
 * One node's record of its own tip churn since a stated date, not a census of the network.
 * The two hashes make each row verifiable: at `height` we held `orphanedHash`, the network
 * converged on `replacedBy`; the second is on chain and the first survives only here.
 */
export interface ReorgEvent {
  /** Storage id; the tiebreak half of the pagination cursor. */
  id: number;
  /** Unix seconds the follower detected the divergence. */
  detectedAt: number;
  /** Lowest height rolled back. */
  height: number;
  /** Blocks discarded. Depth 1 is routine on a proof-of-work chain. */
  depth: number;
  /** The hash we held. No longer in the chain — it must never be rendered as a link. */
  orphanedHash: string;
  /** The hash the network converged on; a live block page. */
  replacedBy: string;
}

export interface ReorgSummary {
  /** Reorgs observed since `observingSince`. */
  observedCount: number;
  /** The deepest observed, or null when none has been. */
  deepestDepth: number | null;
  /** Unix seconds observation began — records exist only from here forward. */
  observingSince: number;
}

/**
 * Orphaned blocks against canonical blocks over one span, as this explorer's node saw them.
 *
 * Both counts share one clock: an orphan is filed under the HEIGHT it competed for, and a height
 * belongs to the span holding its canonical block's header time. So a reorg detected seconds after
 * midnight for a block mined before it stays with that block's day, and the upgrade split is by
 * height, exactly. A depth-2 reorg is two orphans, at its two heights.
 */
export interface OrphanRateSpan {
  /** Blocks this node held and rolled back, at heights inside the span. */
  orphans: number;
  /** Canonical blocks in the span, counted only from when observation began. */
  blocks: number;
}

/** One UTC day of the series. */
export interface OrphanRateDay extends OrphanRateSpan {
  /** Unix seconds, the day's UTC midnight. */
  timestamp: number;
  /** Not a whole day of watching: today, still running, or the day observation began. */
  partial: boolean;
}

export type OrphanRateWindowKey = "24h" | "7d" | "30d" | "before-upgrade" | "since-upgrade";

export interface OrphanRateWindow extends OrphanRateSpan {
  key: OrphanRateWindowKey;
  /** Header times of the first and last canonical block counted; null when there were none. */
  firstBlockAt: number | null;
  lastBlockAt: number | null;
}

/** The observed orphan rate: daily, plus the trailing and before/since-upgrade windows. */
export interface OrphanRateSeries {
  /** Unix seconds observation began; nothing is counted before it. */
  observingSince: number;
  /** Unix seconds the series was read: "today" and the trailing windows end here. */
  asOf: number;
  /** The upgrade the before/since windows split at. Null where the network has none scheduled. */
  upgrade: { name: string; height: number; activatedAt: number | null } | null;
  /** Every UTC day of the last `ORPHAN_RATE_DAYS` that observation covers, oldest first. */
  days: OrphanRateDay[];
  /** In `ORPHAN_RATE_WINDOWS` order; the upgrade pair is absent when `upgrade` is null. */
  windows: OrphanRateWindow[];
}

/** Days the daily series reaches back, today included. */
export const ORPHAN_RATE_DAYS = 60;

export const ORPHAN_RATE_WINDOWS: readonly OrphanRateWindowKey[] = [
  "24h",
  "7d",
  "30d",
  "before-upgrade",
  "since-upgrade",
];

/** Orphans per hundred canonical blocks; null over no blocks, never 0. */
export function orphanRatePct(span: OrphanRateSpan): number | null {
  return span.blocks > 0 ? (100 * span.orphans) / span.blocks : null;
}

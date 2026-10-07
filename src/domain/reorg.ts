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

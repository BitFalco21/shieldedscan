/**
 * Gross ZEC crossing the privacy boundary in one month, both directions.
 *
 * Net flow alone hides volume (9,817 in and 9,814 out nets to 3.7), so both directions are
 * stored and the net is derived. Computed from each transaction's own value balances, since
 * pool totals can only yield the net; Sprout is included via its JoinSplit public values.
 */
export interface ShieldingFlowPoint {
  /** Unix seconds at the month start. */
  timestamp: number;
  /** Gross ZEC that entered the shielded set. */
  shieldedZat: number;
  /**
   * Gross ZEC that left it — a flow (the amount unshielded during the period), not a
   * transparent balance. Named to match the site's "Unshielding" vocabulary.
   *
   * Includes fees paid by fully shielded transactions, which do leave the shielded side; they
   * are tiny relative to real flow.
   */
  unshieldedZat: number;
}

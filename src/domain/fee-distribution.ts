import type { TxKind } from "./classify";

/**
 * What a transaction actually costs, by privacy kind.
 *
 * Answers "does privacy cost more?" from the chain. Over a trailing 90-day window the
 * fully shielded median fee has measured about half the transparent one (10,000 vs 20,000
 * zat): ZIP 317 prices logical actions, and a transparent transaction sweeping many small
 * UTXOs carries more of them than a two-action Orchard spend.
 *
 * Medians and quartiles lead because fee distributions are heavy-tailed: the largest single
 * fee is a genuine 987 ZEC mistake, which would move a mean but not a median.
 */

/** One privacy kind's fee statistics over a window. All zatoshi. */
export interface FeeKindStats {
  kind: Exclude<TxKind, "coinbase">;
  medianZat: number;
  /** The arithmetic mean, secondary to the median and always labelled, never "the" fee. */
  avgZat: number;
  p25Zat: number;
  p75Zat: number;
  /** The denominator. A percentile without its sample size is a claim, not a measurement. */
  txs: number;
}

/** One month's median fee per kind. `null` where that kind had no transactions that month. */
export interface FeeKindMonthPoint {
  /** Unix seconds at the month start. */
  timestamp: number;
  transparentZat: number | null;
  mixedZat: number | null;
  shieldedZat: number | null;
}

/** One end of the fee range, with the count that says whether a single record can be named. */
export interface FeeExtreme {
  feeZat: number;
  /**
   * How many share this exact fee. Both minima are zero with tens of thousands of ties, so
   * `id` names a record only when this is 1.
   */
  count: number;
  /** The txid, or the height as a string. Arbitrary, and so unusable, when count > 1. */
  id: string | null;
  height: number | null;
  /**
   * "Worth at the time", pre-formatted: the record valued at its own day's stored close, with
   * the day and price source inside the string so the caveat survives paraphrase. Never
   * today's value.
   *
   * Present only on a uniquely named record (`count` 1, `height` present) with a stored close;
   * optional so an older API still yields the range.
   */
  usdAtCloseText?: string | null;
}

/** The all-time fee range for transactions and for whole blocks, or null when unreadable. */
export interface FeeExtremes {
  transaction: FeeExtremeScope;
  block: FeeExtremeScope;
}

export interface FeeExtremeScope {
  lowest: FeeExtreme;
  highest: FeeExtreme;
  considered: number;
  /**
   * The smallest non-zero fee, with its own tie count; `lowest` is 0 with many ties and cannot
   * answer "the cheapest fee anyone paid". Optional on the wire and null while its matview is
   * unpopulated.
   */
  lowestNonZero?: FeeExtreme | null;
}

/**
 * The all-time range of TRANSPARENT transaction value.
 *
 * Every figure covers transparent value only: a fully shielded transaction has no public
 * amount, so this is never "the largest transaction on Zcash". Coinbase is excluded because
 * it creates value rather than moving it.
 *
 * Emitted only once the walk behind it covers the whole chain; a partial extremum may be the
 * wrong row (see `server/value-extremes.ts`).
 */
export interface ValueExtremes {
  lowest: FeeExtreme;
  highest: FeeExtreme;
  /** Transactions with a public amount at all. The denominator every figure here is over. */
  considered: number;
  /** The height the range covers. Equal to the chain tip less the reorg margin. */
  coveredThroughHeight: number;
}

export interface FeeDistribution {
  /** The recent window the headline stats cover, in days. */
  windowDays: number;
  /** Exactly one entry per kind that had any transactions in the window. */
  recent: FeeKindStats[];
  /** Monthly medians since genesis — the trend behind the headline. */
  monthly: FeeKindMonthPoint[];
  /**
   * The all-time fee range, or null when it could not be read. Optional on the wire so an
   * older API, or an unpopulated matview, costs the range and never the distribution.
   */
  extremes?: FeeExtremes | null;
  /**
   * The all-time TRANSPARENT value range, or null when it could not be read or the walk behind
   * it has not covered the whole chain. Optional on the wire for the same reason `extremes` is.
   */
  valueExtremes?: ValueExtremes | null;
}

/**
 * The headline comparison: shielded median as a share of transparent, or `null` when either
 * side is missing from the window. Never a fabricated ratio over an absent kind.
 */
export function shieldedVsTransparentPct(dist: FeeDistribution): number | null {
  const shielded = dist.recent.find((s) => s.kind === "shielded");
  const transparent = dist.recent.find((s) => s.kind === "transparent");
  if (!shielded || !transparent || transparent.medianZat <= 0) return null;
  return Math.round((shielded.medianZat / transparent.medianZat) * 100);
}

/**
 * Does a derived cross-rate agree with a real traded series?
 *
 * The gate in front of shipping a currency: the rate it implies is checked against a venue that
 * quotes the pair. Kraken quotes ZEC/EUR (`XZECZEUR`) and Binance ZEC/BTC (`ZECBTC`); most fiats
 * have no ZEC pair anywhere, and for those the weaker FX-leg check (`rateAgreement`) stands in.
 *
 * A release gate, not a per-boot one: it reaches third-party venues, and the API's start-up must
 * not depend on them.
 */

export interface CrossRateCheck {
  days: number;
  medianPct: number;
  p90Pct: number;
  maxPct: number;
}

/** Generous against the observed sub-1% agreement, strict against a wrong-way-up reciprocal. */
export const PASS_MEDIAN_PCT = 1;
export const PASS_MAX_PCT = 10;

const summarise = (errors: number[]): CrossRateCheck | null => {
  if (errors.length === 0) return null;
  errors.sort((a, b) => a - b);
  const at = (p: number): number =>
    errors[Math.min(errors.length - 1, Math.floor(errors.length * p))]!;
  return {
    days: errors.length,
    medianPct: at(0.5),
    p90Pct: at(0.9),
    maxPct: errors[errors.length - 1]!,
  };
};

/**
 * Percentage disagreement between `usdClose × rate` and a traded close, per shared day. Null when
 * no day is shared by all three series: an empty answer from a venue must never read as a pass.
 */
export function crossRateError(
  usdCloses: Map<string, number>,
  rates: Map<string, number>,
  traded: Map<string, number>,
): CrossRateCheck | null {
  const errors: number[] = [];
  for (const [day, usd] of usdCloses) {
    const rate = rates.get(day);
    const real = traded.get(day);
    if (rate === undefined || real === undefined || real <= 0) continue;
    errors.push((Math.abs(usd * rate - real) / real) * 100);
  }
  return summarise(errors);
}

export const passes = (check: CrossRateCheck | null): boolean =>
  check !== null && check.medianPct <= PASS_MEDIAN_PCT && check.maxPct <= PASS_MAX_PCT;

/**
 * Agreement between two vendors quoting the same USD→currency rate.
 *
 * The weaker check: it shows our rate is the rate, not that the cross-rate matches a traded ZEC
 * pair, which most fiats lack. A residual of a few tenths of a percent is expected: an ECB
 * reference rate is a ~16:00 CET fix and a vendor's close is a market close.
 */
export function rateAgreement(
  ecb: Map<string, number>,
  other: Map<string, number>,
): CrossRateCheck | null {
  const errors: number[] = [];
  for (const [day, mine] of ecb) {
    const theirs = other.get(day);
    if (theirs === undefined || theirs <= 0) continue;
    errors.push((Math.abs(mine - theirs) / theirs) * 100);
  }
  return summarise(errors);
}

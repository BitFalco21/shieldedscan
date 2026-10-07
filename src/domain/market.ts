/**
 * Market capitalisation, and comparing Zcash's against a larger asset's.
 *
 * These are the only figures on the site that come from neither the Zcash chain nor our own
 * measurement: market caps are a third party's aggregate over venues we do not observe, so the
 * page always attributes them.
 *
 * `MarketAsset` names an asset rather than a coin: the same shape would serve an equity.
 */

/**
 * One asset's market standing, as published upstream.
 *
 * Every field is the upstream's own figure. `marketCapUsd` is deliberately not recomputed as
 * `priceUsd * circulatingSupply`: the two differ by ~0.1% upstream, and substituting our
 * arithmetic would publish a number no source stands behind.
 */
export interface MarketAsset {
  /** The upstream's stable identifier, e.g. `"bitcoin"`. What `?vs=` names. */
  id: string;
  /** Uppercase ticker, e.g. `"BTC"`. Display only — ids are what anything keys on. */
  symbol: string;
  name: string;
  marketCapUsd: number;
  priceUsd: number;
  circulatingSupply: number;
  /** Upstream rank by market cap; null when it published none. */
  rank: number | null;
  /**
   * The upstream files this asset as a stablecoin. Carried per asset so the exclusion follows the
   * upstream's category rather than a hardcoded roster.
   */
  isStablecoin: boolean;
}

/**
 * Every asset we hold a figure for, plus Zcash, read at one moment.
 *
 * The whole set travels unfiltered so eligibility is decided here, and so a `?vs=` naming a real
 * but smaller asset can be answered with that fact rather than looking like a typo.
 */
export interface MarketSnapshot {
  /** Unix seconds the upstream figures were read. The page states it. */
  asOf: number;
  zec: MarketAsset;
  /** Every other asset, in no guaranteed order. */
  assets: MarketAsset[];
}

/**
 * Assets whose market cap is not a valuation, so "ZEC at X's market cap" is meaningless.
 *
 * Stablecoins are excluded via `isStablecoin`. This list holds only judgement calls no category
 * makes, and an id goes in only once it has actually been observed above Zcash:
 *
 * - `figure-heloc` — a tokenised portfolio of home-equity credit lines (observed at rank 9,
 *   priced ~$1.04); its "market cap" is a loan book.
 *
 * Exchange and DeFi tokens (e.g. LEO, RAIN) are freely traded at market prices and stay
 * eligible: excluding a real asset is as wrong as including a fake one.
 */
const NOT_A_VALUATION: ReadonlySet<string> = new Set(["figure-heloc"]);

/**
 * The comparison the page exists to state: Zcash at another asset's market cap.
 *
 * The multiple is the anchor and the implied price is derived from it. Dividing the
 * counterpart's cap by ZEC's circulating supply would give a slightly different answer (~0.09%
 * for Bitcoin) because upstream caps are not exactly price × supply. Both caps are printed, so a
 * reader dividing them must land on the multiple shown. Do not "simplify" this to the division.
 */
export interface MarketComparison {
  counterpart: MarketAsset;
  /** How many times Zcash's market cap the counterpart's is. */
  multiple: number;
  /** What one ZEC would be worth at that market cap, holding supply constant. */
  impliedPriceUsd: number;
}

/**
 * Compare Zcash against one asset, or null when the arithmetic has no answer (a zero or missing
 * Zcash market cap would yield an infinite multiple).
 */
export function compareToZec(zec: MarketAsset, counterpart: MarketAsset): MarketComparison | null {
  if (!(zec.marketCapUsd > 0) || !Number.isFinite(counterpart.marketCapUsd)) return null;
  const multiple = counterpart.marketCapUsd / zec.marketCapUsd;
  if (!Number.isFinite(multiple)) return null;
  return { counterpart, multiple, impliedPriceUsd: zec.priceUsd * multiple };
}

/**
 * Every comparison this page will offer, largest counterpart first.
 *
 * Built from `compareToZec` so the `/compare/all` table and each detail view state the same
 * multiple and implied price. A counterpart `compareToZec` refuses is dropped rather than shown
 * with an infinite figure; the table then renders empty and says so.
 */
export function compareToZecAll(snapshot: MarketSnapshot): MarketComparison[] {
  return eligibleAssets(snapshot)
    .map((asset) => compareToZec(snapshot.zec, asset))
    .filter((comparison): comparison is MarketComparison => comparison !== null);
}

/**
 * Zcash's market cap as a percentage of the counterpart's — the reciprocal of `multiple`. Drawn
 * as a share bar with both caps printed beside it; never a progress or forecast.
 */
export function zecShareOfCounterpartPct(comparison: MarketComparison): number {
  return 100 / comparison.multiple;
}

/**
 * The assets this page will offer, largest first: larger than Zcash, evaluated against the
 * snapshot, so the set follows the market without code changes.
 */
export function eligibleAssets(snapshot: MarketSnapshot): MarketAsset[] {
  return snapshot.assets
    .filter(
      (asset) =>
        asset.marketCapUsd > snapshot.zec.marketCapUsd &&
        !asset.isStablecoin &&
        !NOT_A_VALUATION.has(asset.id),
    )
    .sort((a, b) => b.marketCapUsd - a.marketCapUsd);
}

/**
 * What `?vs=` may look like: the upstream's lowercase hyphenated ids, length-bounded so a
 * hand-edited URL cannot carry an arbitrary string onto the page.
 */
const ASSET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Parse an untrusted `?vs=` value to an id, or null when it is not shaped like one. */
export function parseVsParam(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const id = raw.trim().toLowerCase();
  return ASSET_ID.test(id) ? id : null;
}

/**
 * The asset shown when the URL names none, so the landing page states a comparison instead of
 * an empty control.
 */
export const DEFAULT_VS_ASSET_ID = "bitcoin";

/**
 * What `/compare` resolved a request to.
 *
 * A union rather than `MarketComparison | null` because each miss is a different fact. A named
 * asset is never silently replaced by Bitcoin.
 */
export type ComparisonSelection =
  /** The asked-for asset, larger than Zcash, with the arithmetic. */
  | { kind: "comparison"; comparison: MarketComparison }
  /** A real asset we hold a figure for, no larger than Zcash. */
  | { kind: "smaller"; asset: MarketAsset }
  /**
   * Larger than Zcash but not offered (a stablecoin, or not a valuation). Distinct from
   * `smaller`, which would be false for e.g. Tether.
   */
  | { kind: "not-comparable"; asset: MarketAsset }
  /** No asset by that id at all. The requested id is echoed back, never rendered raw. */
  | { kind: "unknown"; requestedId: string }
  /**
   * Nothing can be compared: no eligible asset, or a Zcash market cap the arithmetic cannot
   * use. The page renders its unavailable state rather than a figure.
   */
  | { kind: "none" };

/**
 * Resolve a `?vs=` value against the snapshot.
 *
 * The fallback (Bitcoin, else the largest eligible asset) applies only when the URL named
 * nothing. A named id that cannot be honoured is reported as such, never substituted.
 */
export function resolveComparison(
  snapshot: MarketSnapshot,
  requestedId: string | null,
): ComparisonSelection {
  const eligible = eligibleAssets(snapshot);

  if (requestedId !== null) {
    const match = eligible.find((asset) => asset.id === requestedId);
    if (match !== undefined) {
      const comparison = compareToZec(snapshot.zec, match);
      return comparison === null ? { kind: "none" } : { kind: "comparison", comparison };
    }
    const held = snapshot.assets.find((asset) => asset.id === requestedId);
    if (held === undefined) return { kind: "unknown", requestedId };
    return held.marketCapUsd > snapshot.zec.marketCapUsd
      ? { kind: "not-comparable", asset: held }
      : { kind: "smaller", asset: held };
  }

  const fallback = eligible.find((asset) => asset.id === DEFAULT_VS_ASSET_ID) ?? eligible[0];
  if (fallback === undefined) return { kind: "none" };
  const comparison = compareToZec(snapshot.zec, fallback);
  return comparison === null ? { kind: "none" } : { kind: "comparison", comparison };
}

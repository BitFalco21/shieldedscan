import type { MarketAsset, MarketComparison, MarketSnapshot } from "@/domain";
import { brandMark, canonicalMarkTicker, type BrandMark } from "@/components/brand-marks";
import { formatMultiple, formatUsdCompact, formatUsdExact, formatUtc } from "@/lib/format";
import { siteUrl } from "@/lib/site";
import { OG_BRAND_COLORS } from "./og-brand-colors";

/** One side of the card: a real mark in its real colour, or the honest initial. */
export type CompareCardMark =
  { kind: "mark"; mark: BrandMark; color: string } | { kind: "letter"; letter: string };

export interface CompareCardSide {
  name: string;
  /** `BTC · RANK 1`, or the bare ticker when the upstream published no rank. */
  ticker: string;
  price: string;
  marketCap: string;
  mark: CompareCardMark;
}

export interface CompareCardFacts {
  zec: CompareCardSide;
  other: CompareCardSide;
  /** `156.22x` */
  multiple: string;
  /** `$76,387.74` */
  impliedPrice: string;
  /** `CoinGecko · 2026-08-12 14:20 UTC` — the card outlives the moment, so the moment travels. */
  source: string;
  /** The page this card belongs to, for the header. */
  url: string;
}

/**
 * Which mark a side draws. The real silhouette only where BOTH the path and its colour are
 * known: a path filled in a guessed colour is an inaccurate logo, which is worse than an
 * initial. The colour key is the canonical mark key, so an alias (BNB → BSC) resolves to the
 * colour the site's own `.brand-bsc` uses.
 */
export function compareCardMark(asset: MarketAsset): CompareCardMark {
  const key = canonicalMarkTicker(asset.symbol) ?? canonicalMarkTicker(asset.id);
  const mark = key === null ? null : brandMark(key);
  const color = key === null ? undefined : OG_BRAND_COLORS[key.toLowerCase()];
  if (mark !== null && color !== undefined) return { kind: "mark", mark, color };
  return { kind: "letter", letter: asset.symbol.slice(0, 1).toUpperCase() };
}

function side(asset: MarketAsset): CompareCardSide {
  return {
    name: asset.name,
    // No "#": it is outside the font subset's closed character set, and "RANK 1" reads as
    // well. The subset test enumerates these strings, so a stray glyph fails the build.
    ticker: asset.rank === null ? asset.symbol : `${asset.symbol} · RANK ${asset.rank}`,
    price: formatUsdExact(asset.priceUsd),
    marketCap: formatUsdCompact(asset.marketCapUsd),
    mark: compareCardMark(asset),
  };
}

/**
 * Everything the compare share card prints, decided here so it is unit-testable and so the
 * card and the page cannot disagree: both read `MarketComparison`, and the figures are the
 * same formatters the page uses.
 */
export function compareCardFacts(
  snapshot: MarketSnapshot,
  comparison: MarketComparison,
): CompareCardFacts {
  return {
    zec: side(snapshot.zec),
    other: side(comparison.counterpart),
    multiple: formatMultiple(comparison.multiple),
    impliedPrice: formatUsdExact(comparison.impliedPriceUsd),
    source: `CoinGecko · ${formatUtc(snapshot.asOf)}`,
    url: `${siteUrl.replace(/^https?:\/\//, "")}/compare`,
  };
}

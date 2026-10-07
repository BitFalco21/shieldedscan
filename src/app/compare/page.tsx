import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDataSource } from "@/data";
import { DEFAULT_VS_ASSET_ID, parseVsParam, resolveComparison } from "@/domain";
import { isTestnet } from "@/lib/network";
import { ComparePage } from "@/features/compare/ComparePage";
import { compareCardHref } from "@/features/compare/compareHref";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

/**
 * The card is per comparison, so the metadata is too: `og:image` points at
 * `/compare/card?vs=<asset>` and a pasted link previews as the two coins it compares, not as
 * the site's generic card. The default asset is named explicitly in the image URL even though
 * the PAGE URL omits it — one image URL shape for every asset.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ vs?: string }>;
}): Promise<Metadata> {
  const { vs } = await searchParams;
  const description = "What one ZEC would be worth at another asset's market capitalisation.";
  if (isTestnet) return { title: "Compare", description };
  const image = {
    url: compareCardHref(parseVsParam(vs) ?? DEFAULT_VS_ASSET_ID),
    width: 1200,
    height: 630,
    alt: "Zcash with the market cap of another asset",
  };
  return {
    title: "Compare",
    description,
    openGraph: { title: "Compare", description, images: [image] },
    twitter: { card: "summary_large_image", images: [image.url] },
  };
}

/**
 * `/compare` — Zcash's market cap against a larger asset's.
 *
 * Absent on testnet: TAZ has no market. The testnet API serves no market data either, so
 * neither guard is load-bearing alone.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ vs?: string }> }) {
  if (isTestnet) notFound();

  const { vs } = await searchParams;
  const snapshot = await getDataSource().getMarketSnapshot();
  const selection =
    snapshot === null ? ({ kind: "none" } as const) : resolveComparison(snapshot, parseVsParam(vs));

  return <ComparePage snapshot={snapshot} selection={selection} />;
}

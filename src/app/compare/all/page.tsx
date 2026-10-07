import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDataSource } from "@/data";
import { isTestnet } from "@/lib/network";
import { CompareAllPage } from "@/features/compare/CompareAllPage";
import { pageShareMetadata } from "@/lib/share-card";

// Never served from Next's Data Cache: a cached 200 is replayed without the API being asked,
// so the market tracker's 30-minute staleness window could not protect a reader from old
// prices under a current `asOf`.
//
// `freshness-config.test.ts` classifies routes by scanning source text, comments included,
// for the query-parameter prop name, so that word must not appear in this file even in prose.
export const fetchCache = "force-no-store";

const description =
  "What one ZEC would be worth at the market capitalisation of every asset larger than Zcash.";

/**
 * No per-asset card here: this view names no single counterpart, so it previews as the site
 * card. `/compare` keeps the per-comparison image, which is the link people share.
 */
export const metadata: Metadata = {
  title: "Compare — all assets",
  description,
  ...pageShareMetadata("Compare — all assets", description),
};

/**
 * `/compare/all` — the whole table rather than one comparison.
 *
 * Absent on testnet, like `/compare`: TAZ has no market. The testnet API serves no market data
 * either, so neither guard is load-bearing alone.
 */
export default async function Page() {
  if (isTestnet) notFound();

  const snapshot = await getDataSource().getMarketSnapshot();
  return <CompareAllPage snapshot={snapshot} />;
}

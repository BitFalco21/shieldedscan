import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPrerenderedDataSource } from "@/data";
import { FactCheckPage } from "@/features/fact-check/FactCheckPage";
import { isTestnet } from "@/lib/network";
import { pageShareMetadata } from "@/lib/share-card";
import { nullIfTransient } from "@/lib/transient-upstream";

/**
 * Prerendered with the site's standard 60-second window. Almost everything here is static
 * sourced prose; the live rows print the block or window they were read over, so a cached copy
 * is visibly dated rather than silently stale. No warm-cache slot is needed.
 */
export const revalidate = 60;

const TITLE = "Zcash, fact-checked";
const DESCRIPTION =
  "Common claims about Zcash — premine, hidden inflation, trusted setup, privacy, who runs it — each with a verdict, a short sourced answer and the live figures.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...pageShareMetadata(TITLE, DESCRIPTION),
};

/**
 * `/fact-check`. Mainnet-only: the live figures are mainnet's pools, and the claims are about
 * the network people argue about. The route can 404, so no `loading.tsx` may sit above it.
 */
export default async function Page() {
  if (isTestnet) notFound();

  const data = getPrerenderedDataSource();
  // Both reads are optional to the page: every answer is static and sourced, so a slow upstream
  // costs the live rows ("unavailable") and never the page or the build. A shape error still
  // throws — that is the version-skew tripwire, not a transient failure.
  const [supply, chain] = await Promise.all([
    nullIfTransient(() => data.getSupplyBreakdown()),
    nullIfTransient(() => data.getChainInfo()),
  ]);

  return <FactCheckPage supply={supply} chain={chain} />;
}

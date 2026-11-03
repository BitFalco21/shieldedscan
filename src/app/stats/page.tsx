import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCachedDataSource } from "@/data";
import { StatsPage } from "@/features/stats/StatsPage";
import { isTestnet } from "@/lib/network";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. This is the page most likely to be linked
 * from elsewhere, so the shared copy is the point, and nothing here misdates on a stale render: the
 * figures carry the block and the instant they were read at. A live layer polls on top.
 *
 * It reads no query parameter, so `freshness-config.test.ts` cannot discover it by scanning; the
 * classification is pinned by its own test instead. The word that scan greps for must not appear in
 * this file: the gate is a text scan, so even a comment would file this page under the wrong
 * contract.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ZEC price",
  description: "The live ZEC price, stamped with the block and the instant it was read at.",
};

export default async function Page() {
  // TAZ has no market, so the page is absent on testnet rather than empty. The API serves no
  // stats there either; both guards exist so neither alone is load-bearing.
  if (isTestnet) notFound();
  const data = getCachedDataSource();
  const [stats, series] = await Promise.all([data.getStats(), data.getPriceSeries()]);
  // No supply read: this face draws no shielded chart.
  return <StatsPage face="price" stats={stats} series={series} supply={[]} />;
}

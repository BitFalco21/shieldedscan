import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPrerenderedDataSource } from "@/data";
import { StatsPage } from "@/features/stats/StatsPage";
import { isTestnet } from "@/lib/network";

/**
 * Prerendered deliberately, unlike the dynamic list routes. This is the page most likely to
 * be linked from elsewhere, so the CDN copy is the point, and nothing here misdates on a stale
 * render: the figures carry the block and the instant they were read at, so staleness is
 * visible rather than hidden. A live layer polls on top.
 *
 * It reads no query parameter, so `freshness-config.test.ts` pins its classification
 * explicitly rather than discovering it. See the sibling route for the full reasoning.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Shielded supply",
  description: "How much ZEC is shielded, and what share of circulating supply that is.",
};

export default async function Page() {
  // TAZ has no market, so the page is absent on testnet rather than empty. The API serves no
  // stats there either; both guards exist so neither alone is load-bearing.
  if (isTestnet) notFound();
  // No price series read: this face draws the shielded history instead.
  const data = getPrerenderedDataSource();
  const [stats, supply] = await Promise.all([data.getStats(), data.getSupplySeries()]);
  return <StatsPage face="shielded" stats={stats} series={{}} supply={supply} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDataSource } from "@/data";
import { chartRangeDays, parseChartRange } from "@/domain";
import { isTestnet } from "@/lib/network";
import { CrossChainFlowsPage } from "@/features/crosschain/CrossChainFlowsPage";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Cross-Chain Flows",
  description:
    "Where ZEC goes when it leaves Zcash, and where it comes from — aggregated across public swap venues.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  // Not redundant with the layout's guard. On testnet this throws before the query params are
  // awaited, so Next prerenders the route as its 404 at build time, and a prerender runs the
  // page body even when an ancestor layout throws. Without it the testnet build would call
  // `getCrossChainFlows` against an API with no cross-chain data and fail.
  if (isTestnet) notFound();
  // Parsed, not trusted: the range set is closed, so a hand-edited `?range=` that names
  // nothing we know is a typo and resolves to ALL. The port speaks days, not range names.
  const range = parseChartRange((await searchParams).range);
  const summary = await getDataSource().getCrossChainFlows(chartRangeDays(range));
  return <CrossChainFlowsPage summary={summary} range={range} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDataSource } from "@/data";
import { chartRangeDays, parseChartRange } from "@/domain";
import { nowSeconds } from "@/lib/clock";
import { isTestnet } from "@/lib/network";
import { CrossChainProtocolsPage } from "@/features/crosschain/CrossChainProtocolsPage";

// Never served from Next’s fetch Data Cache: on a dynamic render a stale entry is returned and
// refreshed behind the response. The adapter holds its own one-minute memo instead, which no
// segment config can veto and which cannot outlive an idle period.
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Cross-Chain Protocols",
  description:
    "NEAR Intents, Maya Protocol and THORChain side by side — ZEC swaps, inbound and outbound, in ZEC and dollars at swap.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  // A second testnet guard, as on `flows/page.tsx`: the layout's guard does not stop a
  // build-time prerender from running this body.
  if (isTestnet) notFound();
  // Parsed, not trusted: the range set is closed, so an unknown `?range=` means ALL.
  const range = parseChartRange((await searchParams).range);
  const summary = await getDataSource().getCrossChainProtocols(chartRangeDays(range));
  return <CrossChainProtocolsPage summary={summary} range={range} now={nowSeconds()} />;
}

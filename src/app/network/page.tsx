import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DataUnavailable } from "@/components/DataUnavailable";
import { getPrerenderedDataSource } from "@/data";
import { TopologyPage } from "@/features/network/topology/TopologyPage";
import { isTestnet } from "@/lib/network";
import { readNetworkShell } from "./shell-data";
import { NetworkTabPage } from "./NetworkTabPage";
import { nullIfTransient } from "@/lib/transient-upstream";
import { networkShareMetadata } from "@/features/network/net-share";

/**
 * The landing tab of `/network`. Prerendered with a short revalidate: the crawl's own instant
 * is printed in the sparkline caption and every figure is a floor over the reachable window, so
 * nothing misdates on a stale render. It reads no query parameter, so `freshness-config.test.ts`
 * pins the classification by its own test (the word that scan greps for must not appear here).
 *
 * This route reads the hubs-only graph; the never-answered addresses are fetched after mount
 * through `/api/network/topology`, which keeps the prerendered HTML small.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Network topology",
  description:
    "Who told us about whom: the Zcash network's gossip graph as a sky — answering nodes as hubs, every advertised address hanging off the peers that advertised it.",
  ...networkShareMetadata("topology"),
};

export default async function Page() {
  if (isTestnet) notFound();
  const data = getPrerenderedDataSource();
  const [shell, hubs] = await Promise.all([
    readNetworkShell(data),
    nullIfTransient(() => data.getNetworkTopology("hubs")),
  ]);
  return (
    <NetworkTabPage shell={shell} tab="topology">
      {() =>
        hubs === null ? (
          <DataUnavailable what="The network's gossip graph" refreshesWithin="a minute" />
        ) : (
          <TopologyPage hubs={hubs} />
        )
      }
    </NetworkTabPage>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DataUnavailable } from "@/components/DataUnavailable";
import { getPrerenderedDataSource } from "@/data";
import { NodeMapExplorer } from "@/features/network/map/NodeMapExplorer";
import { isTestnet } from "@/lib/network";
import { readNetworkShell } from "../shell-data";
import { NetworkTabPage } from "../NetworkTabPage";
import { nullIfTransient } from "@/lib/transient-upstream";
import { networkShareMetadata } from "@/features/network/net-share";

/**
 * Prerendered with a short revalidate, like the other `/network` tabs. Nothing here misdates
 * on a stale render: the crawl's own instant is printed in the sparkline caption, and every
 * figure is a floor over the reachable window. No warmer slot: no figure changes per block.
 *
 * It reads no query parameter, so `freshness-config.test.ts` cannot discover it by scanning;
 * the classification is pinned by its own test. The word that scan greps for must not appear
 * in this file.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Node map",
  description:
    "Where the Zcash network's listening nodes are, what they run and how they answer, measured by this explorer's own crawler. Only nodes that accept connections can be counted.",
  ...networkShareMetadata("node map"),
};

export default async function Page() {
  // The crawler and the peers route run against the mainnet node only; the testnet API mounts
  // neither, so the page is absent there rather than empty.
  if (isTestnet) notFound();
  const data = getPrerenderedDataSource();
  const [shell, map] = await Promise.all([
    readNetworkShell(data),
    nullIfTransient(() => data.getNetworkMap()),
  ]);
  return (
    <NetworkTabPage shell={shell} tab="map">
      {({ summary }) =>
        map === null ? (
          <DataUnavailable what="The map of answering nodes" refreshesWithin="a minute" />
        ) : (
          <NodeMapExplorer map={map} summary={summary} />
        )
      }
    </NetworkTabPage>
  );
}

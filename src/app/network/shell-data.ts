import type { ExplorerDataSource } from "@/data";
import type { NetCrawlHistory, NetPeers, NetSummary } from "@/domain";
import { nullIfTransient } from "@/lib/transient-upstream";

export interface NetworkShellData {
  summary: NetSummary;
  crawls: NetCrawlHistory;
  peers: NetPeers | null;
}

/**
 * The three reads every `/network` tab makes for the shell above the tabs.
 *
 * `null` when the crawl data could not be read for a transient reason, so the route renders
 * `DataUnavailable` rather than failing the build. A shape error still
 * propagates: that is the version-skew tripwire, and it must stay loud. Our node's peers are
 * read separately and degrade on their own: a node we could not read is "not read" on the OURS
 * tile, never a reason to lose the page.
 */
export async function readNetworkShell(data: ExplorerDataSource): Promise<NetworkShellData | null> {
  // All three in one round trip.
  const [shell, peers] = await Promise.all([
    nullIfTransient(() => Promise.all([data.getNetworkSummary(), data.getNetworkCrawls()])),
    nullIfTransient(() => data.getNetworkPeers()),
  ]);
  if (shell === null) return null;
  const [summary, crawls] = shell;
  return { summary, crawls, peers };
}

import type { ReactNode } from "react";
import type { NetCrawlHistory, NetPeers, NetSummary } from "@/domain";
import { IndexMaturity } from "./IndexMaturity";
import { NetworkHeader } from "./NetworkHeader";
import { NetworkStats } from "./NetworkStats";
import { NetworkTabs, type NetworkTab } from "./NetworkTabs";

export interface NetworkShellProps {
  summary: NetSummary;
  crawls: NetCrawlHistory;
  peers: NetPeers | null;
  tab: NetworkTab;
  children: ReactNode;
}

/**
 * `/network` — what this explorer's own crawler can honestly say about the Zcash network.
 *
 * Everything above the tabs is the same on every tab's route: the sentence, the crawl history,
 * the maturity strip, the headline tiles. Below them each route renders its own tab. Every figure
 * derives from one server-side snapshot per read, and every count is a floor.
 */
export function NetworkShell({ summary, crawls, peers, tab, children }: NetworkShellProps) {
  return (
    <div className="grid min-w-0 gap-6">
      <NetworkHeader summary={summary} crawls={crawls} />
      <IndexMaturity history={crawls} known={summary.known} nowSeconds={summary.asOf} />
      <NetworkStats summary={summary} peers={peers} />
      <NetworkTabs current={tab} />
      <div className="min-w-0">{children}</div>
      <p className="mt-6 max-w-[90ch] border-t border-edge-faint pt-4 text-xs leading-relaxed text-ink-faint">
        <b className="font-normal text-ink-dim">How this is measured.</b> Our own crawler in Vienna
        performs the Zcash P2P handshake with every address the network has advertised to it
        {summary.crawls.intervalSeconds !== null
          ? `, about every ${Math.round(summary.crawls.intervalSeconds / 60)} minutes`
          : ""}
        . A location is GeoIP&apos;s claim about an address, and nothing on this page names a node.
      </p>
    </div>
  );
}

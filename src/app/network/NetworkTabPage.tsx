import type { ReactNode } from "react";
import { DataUnavailable } from "@/components/DataUnavailable";
import { NetworkShell } from "@/features/network/NetworkShell";
import type { NetworkTab } from "@/features/network/NetworkTabs";
import type { NetworkShellData } from "./shell-data";

export interface NetworkTabPageProps {
  /** The shared reads from `readNetworkShell`; null when the crawl data could not be read. */
  shell: NetworkShellData | null;
  tab: NetworkTab;
  /** The tab's own content, given the shell's data. */
  children: (shell: NetworkShellData) => ReactNode;
}

/**
 * One `/network` tab: the shell above the tabs, then the tab's own content. Without the crawl
 * data there is no shell to draw, so the whole page says so instead.
 */
export function NetworkTabPage({ shell, tab, children }: NetworkTabPageProps) {
  if (shell === null) {
    return <DataUnavailable what="The node map" refreshesWithin="a minute" />;
  }
  return (
    <NetworkShell summary={shell.summary} crawls={shell.crawls} peers={shell.peers} tab={tab}>
      {children(shell)}
    </NetworkShell>
  );
}

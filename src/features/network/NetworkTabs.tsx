import { Tabs, type TabItem } from "@/components/Tabs";

export type NetworkTab = "map" | "software" | "upgrade" | "topology" | "health" | "nodes";

export interface NetworkTabsProps {
  current: NetworkTab;
}

/** The sky is the landing tab; the map is one link along. */
const NETWORK_TABS: readonly TabItem<NetworkTab>[] = [
  { key: "topology", href: "/network", label: "topology" },
  { key: "map", href: "/network/map", label: "map" },
  { key: "software", href: "/network/software", label: "software" },
  { key: "upgrade", href: "/network/upgrade", label: "nu7" },
  { key: "health", href: "/network/health", label: "health" },
  { key: "nodes", href: "/network/nodes", label: "nodes" },
];

/**
 * The tab row. Links rather than buttons: a tab is a page, with its own URL, prerender and place
 * in the sitemap; only what happens inside a tab is client state. Uses the site's one tab look
 * (`Tabs`).
 */
export function NetworkTabs({ current }: NetworkTabsProps) {
  return <Tabs label="Network" className="mt-10" active={current} tabs={NETWORK_TABS} />;
}

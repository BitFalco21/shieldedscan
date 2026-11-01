import { Tabs, type TabItem } from "@/components/Tabs";

export type ShieldedView = "all" | "shielded";

/**
 * Links, not state: each view has a URL to share and its own prerender, and the row works with
 * scripting off. `?view=shielded` is served from its own route by the proxy (`src/proxy.ts`).
 */
const TABS: readonly TabItem<ShieldedView>[] = [
  { key: "all", href: "/shielded", label: "All pools" },
  { key: "shielded", href: "/shielded?view=shielded", label: "Shielded pools" },
];

export interface ShieldedViewTabsProps {
  active: ShieldedView;
}

export function ShieldedViewTabs({ active }: ShieldedViewTabsProps) {
  return <Tabs label="Pool views" tabs={TABS} active={active} className="mt-4" />;
}

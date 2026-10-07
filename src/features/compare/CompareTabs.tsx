import { Tabs } from "@/components/Tabs";

export interface CompareTabsProps {
  active: "comparison" | "all";
}

const TABS = [
  { key: "comparison" as const, href: "/compare", label: "comparison" },
  { key: "all" as const, href: "/compare/all", label: "all assets" },
];

/**
 * The two views of one question: Zcash against one asset, and against every asset above it.
 * Links to real routes rather than a client toggle, so each view has a shareable URL, its own
 * prerender and works without JavaScript.
 */
export function CompareTabs({ active }: CompareTabsProps) {
  return <Tabs label="Compare views" tabs={TABS} active={active} className="mb-4" />;
}

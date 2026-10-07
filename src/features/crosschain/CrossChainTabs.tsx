import { Tabs } from "@/components/Tabs";

export interface CrossChainTabsProps {
  active: "transfers" | "flows" | "protocols";
  /** Layout only — a margin. */
  className?: string;
}

const TABS = [
  { key: "transfers" as const, href: "/cross-chain", label: "transfers" },
  { key: "flows" as const, href: "/cross-chain/flows", label: "flows" },
  { key: "protocols" as const, href: "/cross-chain/protocols", label: "protocols" },
];

/**
 * Three views of the same data: the ledger, its shape, and who carried it. Links with distinct
 * routes rather than a client-side toggle, so each view is linkable and works without
 * JavaScript.
 */
export function CrossChainTabs({ active, className }: CrossChainTabsProps) {
  return <Tabs label="Cross-chain views" tabs={TABS} active={active} className={className} />;
}

import type { ReactNode } from "react";
import Link from "@/components/Link";

export interface TabItem<K extends string> {
  key: K;
  href: string;
  label: ReactNode;
}

export interface TabsProps<K extends string> {
  /** Accessible name for the row, e.g. "Cross-chain views". */
  label: string;
  tabs: readonly TabItem<K>[];
  /** The key of the tab whose page this is; it carries `aria-current="page"`. */
  active: K;
  /** Layout only — a margin. */
  className?: string;
}

/**
 * A row of tabs that are links: each view is a route of its own, with a URL to share and a
 * prerender, and the row works with scripting off. Only what happens inside a tab is state.
 *
 * One look for the whole site, in `.tabs` in `app/styles/components.css`.
 */
export function Tabs<K extends string>({ label, tabs, active, className = "" }: TabsProps<K>) {
  return (
    <nav
      aria-label={label}
      className={`tabs flex flex-wrap gap-2 border-b border-edge-faint ${className}`.trim()}
    >
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={tab.key === active ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

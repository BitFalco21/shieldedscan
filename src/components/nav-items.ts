/**
 * The site's navigation, in one place.
 *
 * Three surfaces render this — the desktop bar, the mobile menu, and the command palette — so
 * it lives in its own module rather than beside whichever renderer needed it first.
 *
 * Two levels, no more. A third would need hover intent, submenu positioning and an escape
 * hatch for touch, for a handful of destinations.
 */

import { isAgentEnabled } from "@/lib/agent";
import { isTestnet } from "@/lib/network";

export interface NavLeaf {
  href: string;
  label: string;
}

export interface NavGroup {
  label: string;
  /**
   * A group is a disclosure, not a link: there is no `/explore` page and inventing one to
   * make the parent clickable would add a route whose only content is the menu you already
   * have open.
   */
  children: NavLeaf[];
}

export type NavItem = NavLeaf | NavGroup;

export function isNavGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "home" },
  {
    label: "explore",
    children: [
      { href: "/txs", label: "txns" },
      // No cross-chain on testnet: no venue bridges testnet ZEC, and the route 404s there.
      ...(isTestnet ? [] : [{ href: "/cross-chain", label: "cross-chain txns" }]),
      { href: "/mempool", label: "mempool" },
      { href: "/blocks", label: "blocks" },
      { href: "/rich-list", label: "rich list" },
      { href: "/reorgs", label: "reorgs" },
      // No testnet guard: protocol documentation is network-independent and the route
      // answers on both deployments.
      { href: "/zips", label: "zips" },
      // No testnet guard: a project list is network-independent.
      { href: "/ecosystem", label: "ecosystem" },
    ],
  },
  {
    label: "analytics",
    children: [
      // `/stats` comes first: it is the page built to be linked from elsewhere. Mainnet-only
      // entries below are absent on testnet because their routes 404 there (TAZ has no market,
      // and the halving, crawler and tariff data are mainnet-only).
      ...(isTestnet ? [] : [{ href: "/stats", label: "stats" }]),
      // The stock-and-flow stage: pool balances, boundary flows and live movements.
      ...(isTestnet ? [] : [{ href: "/pulse", label: "pulse" }]),
      { href: "/charts", label: "charts" },
      { href: "/shielded", label: "shielded" },
      // `/mining` is deliberately absent: it stays reachable by direct URL but out of the nav.
      // `/analytics` is labelled by what it shows; under a parent called analytics the route
      // name would say nothing.
      { href: "/analytics", label: "network activity" },
      ...(isTestnet ? [] : [{ href: "/compare", label: "compare" }]),
      ...(isTestnet ? [] : [{ href: "/halving", label: "halving" }]),
      // A demonstration page: every pull draws a real Bitcoin key against the genesis address.
      ...(isTestnet ? [] : [{ href: "/satoshi", label: "satoshi" }]),
      // Common claims about Zcash, each with a verdict and a sourced answer.
      ...(isTestnet ? [] : [{ href: "/fact-check", label: "fact check" }]),
      // The electricity cost of one ZEC in every country, from a committed tariff dataset.
      ...(isTestnet ? [] : [{ href: "/mining-cost", label: "mining cost" }]),
      // The node map, from this explorer's own crawler. The crawler runs against the mainnet
      // node only, so the route 404s on testnet.
      ...(isTestnet ? [] : [{ href: "/network", label: "network" }]),
    ],
  },
  { href: "/api-docs", label: "api" },
  // Flag-gated because the page is: a nav entry pointing at a notFound() route is worse than
  // no entry. The route stays `/ai-agent` because links in the wild point at it.
  //
  // The space is non-breaking: at widths where the bar wraps, a breakable space would split
  // this label and add a third line to the bar.
  ...(isAgentEnabled ? [{ href: "/ai-agent", label: "ask\u00a0zeno" } as const] : []),
  // The onboarding guide from no ZEC to a first shielded transaction. Mainnet-only.
  ...(isTestnet ? [] : [{ href: "/learn", label: "learn" } as const]),
];

/**
 * Whether a route is the active one.
 *
 * `/` has to match exactly — every path starts with it — and everything else matches by
 * prefix so a detail page keeps its section highlighted. No two hrefs here are prefixes of
 * one another, so prefix matching cannot light up two entries at once.
 */
export function isActiveHref(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** A group is active when any of its children is. */
export function isActiveItem(item: NavItem, pathname: string): boolean {
  return isNavGroup(item)
    ? item.children.some((child) => isActiveHref(child.href, pathname))
    : isActiveHref(item.href, pathname);
}

/** A nav entry drawn as a shell command: a `> ` prompt, in accent when it is the current route. */
export function commandClass(active: boolean): string {
  return `before:content-['>_'] ${
    active
      ? "text-green before:text-green"
      : "text-ink-dim before:text-green-faint hover:text-green"
  }`;
}

/**
 * The Zcash ecosystem as this site lists it on `/ecosystem`: projects that build on, carry or
 * serve Zcash, grouped by what they do.
 *
 * Editorial data, reviewed by a person, never fetched at runtime. Candidates come from
 * `scripts/ecosystem/` (ZecHub's wiki, Zcash Community Grants, crates.io dependents, GitHub
 * topics), a discovery aid that writes `out/review.csv` for review; this file is what was
 * approved. Each entry's `source` says what the project is and how it was confirmed.
 *
 * Listing is not endorsement and implies no audit; the page says so.
 */

/** What a project does, as a reader would group it. One per project, never two. */
export type EcosystemCategory =
  | "wallet"
  | "exchange"
  | "payments"
  | "mining"
  | "infrastructure"
  | "explorer"
  | "developer"
  | "organisation"
  | "community";

export interface EcosystemCategoryMeta {
  id: EcosystemCategory;
  /** The label on the map and the list heading. */
  label: string;
  /** One line under the list heading. */
  blurb: string;
}

/** In the order the map walks round the circle and the list reads down the page. */
export const ECOSYSTEM_CATEGORIES: readonly EcosystemCategoryMeta[] = [
  { id: "wallet", label: "wallets", blurb: "Apps and devices that hold ZEC." },
  { id: "exchange", label: "exchanges & swaps", blurb: "Where ZEC is bought, sold and swapped." },
  { id: "payments", label: "payments", blurb: "Accept, tip and spend ZEC." },
  { id: "mining", label: "mining", blurb: "Pools that mine Zcash blocks." },
  {
    id: "infrastructure",
    label: "nodes & infrastructure",
    blurb: "Full nodes, indexers and light-client servers.",
  },
  {
    id: "explorer",
    label: "explorers & data",
    blurb: "Block explorers, dashboards and network data.",
  },
  { id: "developer", label: "developer tools", blurb: "Libraries, SDKs and specifications." },
  { id: "organisation", label: "organisations", blurb: "Teams that fund and build Zcash." },
  { id: "community", label: "community & media", blurb: "Forums, newsletters and local groups." },
];

export interface EcosystemEntry {
  /** Stable slug: the logo file name and the list anchor. */
  id: string;
  name: string;
  category: EcosystemCategory;
  /** The project's own site, or its repository when that is its home. */
  url: string;
  /** What the project is and how it was confirmed. No status words: they go stale. */
  source: string;
}

export { ECOSYSTEM_ENTRIES, ECOSYSTEM_UPDATED_ON } from "./ecosystem-entries";

/** The host a reader sees beside a name, without `www.` or a trailing slash. */
export function ecosystemHost(url: string): string {
  const u = new URL(url);
  const host = u.host.replace(/^www\./, "");
  const path = u.pathname.replace(/\/$/, "");
  return host === "github.com" || host === "codeberg.org" ? `${host}${path}` : host;
}

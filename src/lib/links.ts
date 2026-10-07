/**
 * Off-site destinations and the identity behind the site, in one place.
 *
 * The legal pages, the footer and the about page must agree about who publishes the site and
 * where to reach them, so each fact is one constant imported wherever it appears.
 */

/** The project's own account. */
export const X_PROJECT_URL = "https://x.com/shieldedscanxyz";
export const X_PROJECT_HANDLE = "@shieldedscanxyz";

/** The person who builds it. */
export const X_AUTHOR_URL = "https://x.com/0xfalcoo";
export const X_AUTHOR_HANDLE = "@0xfalcoo";

/**
 * The node this explorer reads the chain from: a consensus-compatible Zcash full node by
 * Sean Bowe and Dev Ojha, credited because every figure on the site comes from its RPC.
 */
export const ZAKURA_URL = "https://zakura.com/";

/** The Zcash Name System registry's site. */
export const ZNS_SITE_URL = "https://www.zcashnames.com";

/** The registry's explorer, filtered to one name. */
export function znsExplorerHref(name: string): string {
  return `${ZNS_SITE_URL}/explorer?search=${encodeURIComponent(name)}`;
}

/**
 * The data controller, in the GDPR sense, and the party the Terms bind.
 *
 * The operator is identified by handle only: no personal name and no country appear anywhere
 * on the site, and there is deliberately no country constant to reference.
 */
export const OPERATOR_NAME = "@0xfalcoo";

/** The date the legal pages last changed. Update it when their substance does, not their prose. */
export const LEGAL_LAST_UPDATED = "19 August 2026";

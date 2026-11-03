/**
 * The shared edge cache for server-rendered pages: how long Netlify's CDN may answer a route
 * without asking the function, and which query parameters make a different page.
 *
 * Emitted from `next.config.ts` so the headers ride the function's own response, which is what the
 * CDN stores. `src/proxy.ts` cannot do this: on Netlify it runs as an edge function in front of the
 * cache, so what it adds never reaches the stored copy. With `Netlify-CDN-Cache-Control` present,
 * `@netlify/plugin-nextjs` leaves both cache headers alone, so the browser and Cloudflare keep Next's
 * `private, no-store` and only Netlify's CDN shares a copy.
 *
 * The oldest copy a reader can get is `freshSeconds + staleSeconds` (the first visitor after a quiet
 * spell, who triggers the refresh). Each route's pair is chosen so that age is harmless for what the
 * page states. No `stale-if-error`: Netlify does not document it, and a directive we cannot rely on
 * would read as a guarantee.
 */

export interface EdgeCachePolicy {
  /** A `next.config.ts` `source` pattern. */
  source: string;
  /** Seconds the CDN answers with its copy without asking the function. */
  freshSeconds: number;
  /**
   * Seconds after that during which the CDN still answers with the old copy while one request
   * renders the new one behind it. 0 where a stale copy is never acceptable.
   */
  staleSeconds: number;
  /**
   * Every query parameter the page reads. The plugin's default cache key names only `_rsc` and
   * `__nextDataReq`, so a parameter missing here would serve one filter's page under another.
   */
  query: readonly string[];
}

const CURSOR = ["before", "after"] as const;
const DAY = 86_400;

export const EDGE_CACHE_POLICIES: readonly EdgeCachePolicy[] = [
  // The live feed polls `/api/live` on top of both lists, and every row carries its own block and
  // time, so a 35-second-old first paint is a list missing its newest rows, not a wrong one.
  { source: "/txs", freshSeconds: 5, staleSeconds: 30, query: ["kind", "pool", ...CURSOR] },
  { source: "/blocks", freshSeconds: 5, staleSeconds: 30, query: CURSOR },
  // The page prints the height its balances were read at.
  { source: "/rich-list", freshSeconds: 10, staleSeconds: 60, query: CURSOR },
  // Rolling windows of a day or more: half a minute moves no figure that matters.
  { source: "/mining", freshSeconds: 10, staleSeconds: 30, query: ["window"] },
  // No stale copies: these pages print no height, a balance a reader waits on must be current,
  // and a name page is a payment destination. Ten seconds absorbs a burst on one link.
  { source: "/address/:addr", freshSeconds: 10, staleSeconds: 0, query: ["name", ...CURSOR] },
  { source: "/name/:name", freshSeconds: 10, staleSeconds: 0, query: [] },
  // Third-party prices: the API refuses figures older than 30 minutes, and a copy must not
  // outlive that by much.
  { source: "/compare/all", freshSeconds: 60, staleSeconds: 300, query: [] },
  // The former ISR pages: each prints the block or instant it was read at, most with a live layer
  // on top, and they render on request so a build never reads the API. A day of stale window is
  // what ISR gave them (the plugin's is a year): a reader never waits on a render, and while the
  // API is down each request retries behind the last good copy, provided Netlify does not store
  // the failed render (undocumented: check `cache-status` on a deploy). Their figures can also be
  // up to a minute older than the render (`getCachedDataSource`).
  ...[
    "/",
    "/analytics",
    "/fact-check",
    "/halving",
    "/learn",
    "/mining-cost",
    "/network",
    "/network/health",
    "/network/map",
    "/network/software",
    "/network/upgrade",
    "/pulse",
    // The proxy serves `/shielded?view=shielded` from `/shielded/pools`; the two must agree.
    "/shielded",
    "/shielded/pools",
    "/stats",
    "/stats/shielded",
  ].map((source) => ({ source, freshSeconds: 60, staleSeconds: DAY, query: [] })),
  // Day- and month-grain series, and reference content with its `asOf` printed.
  { source: "/charts", freshSeconds: 300, staleSeconds: DAY, query: [] },
  { source: "/charts/:slug", freshSeconds: 3600, staleSeconds: DAY, query: [] },
  { source: "/zips", freshSeconds: 3600, staleSeconds: DAY, query: [] },
];

/** The CDN directive for one policy. `durable` shares one render across every edge node. */
export function edgeCacheControl(policy: EdgeCachePolicy): string {
  return [
    "public",
    `s-maxage=${policy.freshSeconds}`,
    ...(policy.staleSeconds > 0 ? [`stale-while-revalidate=${policy.staleSeconds}`] : []),
    "durable",
  ].join(", ");
}

export interface EdgeCacheHeader {
  key: string;
  value: string;
}

/**
 * The headers for one policy. `Netlify-Vary` is merged by the plugin with its own defaults (`_rsc`,
 * the router headers), so HTML and flight payloads never share an entry. `|` is Netlify's separator.
 */
export function edgeCacheHeaders(policy: EdgeCachePolicy): EdgeCacheHeader[] {
  return [
    { key: "Netlify-CDN-Cache-Control", value: edgeCacheControl(policy) },
    ...(policy.query.length > 0
      ? [{ key: "Netlify-Vary", value: `query=${policy.query.join("|")}` }]
      : []),
  ];
}

import { NextResponse } from "next/server";

/**
 * The CDN window for an endpoint a live page polls: five seconds, so the origin is asked at most
 * twelve times a minute per cache key however many readers poll. No `stale-while-revalidate`:
 * under it the request that triggers the refresh is the one served the stale copy.
 */
export const LIVE_POLL_CACHE_CONTROL = "public, s-maxage=5";

/**
 * A permanent redirect to the canonical spelling of a query, never cached. The Location is
 * relative, so the browser stays on the host it asked: behind the CDN, `request.url` can name
 * the deployment's internal address rather than the site's own domain.
 */
export function canonicalRedirect(pathAndQuery: string): NextResponse {
  return new NextResponse(null, {
    status: 308,
    headers: { Location: pathAndQuery, "Cache-Control": "no-store" },
  });
}

/** The answer of a mainnet-only endpoint on testnet, where the page it serves also 404s. */
export function testnetAbsent(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

import { NextResponse } from "next/server";

/**
 * The CDN window for an endpoint a live page polls: five seconds, so the origin is asked at most
 * twelve times a minute per cache key however many readers poll. No `stale-while-revalidate`:
 * under it the request that triggers the refresh is the one served the stale copy.
 */
export const LIVE_POLL_CACHE_CONTROL = "public, s-maxage=5";

/** The answer of a mainnet-only endpoint on testnet, where the page it serves also 404s. */
export function testnetAbsent(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

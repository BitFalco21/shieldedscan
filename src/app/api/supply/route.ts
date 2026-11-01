import { NextResponse } from "next/server";
import { getDataSource } from "@/data";
import { SUPPLY_LIVE_KIND } from "@/data/supply-payload";
import { LIVE_POLL_CACHE_CONTROL } from "@/app/_shared/route-responses";

/**
 * The all-pools view's live read: the value pools and the NSM balance at the node's tip.
 *
 * A first-party route handler because the bearer token must never exist client-side. Upstream it
 * is one `getblockchaininfo`, and with no parameters one CDN entry serves every reader, so the
 * node is asked at most twelve times a minute per CDN edge whatever the readership. It works on
 * testnet too, where `/shielded` is served. Nothing is stored.
 */

// A stale Data Cache entry would be served to every reader while the page claimed to be live.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(): Promise<NextResponse> {
  const supply = await getDataSource().getSupplyBreakdown();
  return NextResponse.json(
    // The kind is echoed and checked by the client, so a shared cache handing back another
    // route's body is a visible miss rather than a silent one.
    { kind: SUPPLY_LIVE_KIND, supply },
    { headers: { "Cache-Control": LIVE_POLL_CACHE_CONTROL } },
  );
}

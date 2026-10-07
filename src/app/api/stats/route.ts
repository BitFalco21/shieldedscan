import { NextResponse } from "next/server";
import { getDataSource } from "@/data";
import { isTestnet } from "@/lib/network";
import { LIVE_POLL_CACHE_CONTROL, testnetAbsent } from "@/app/_shared/route-responses";

/**
 * The `/stats` page's live scalars.
 *
 * A first-party route handler because the bearer token must never exist client-side.
 *
 * Separate from `/api/live`, which is keyed on list filters: this one carries scalars and takes
 * no parameters, so one cache entry serves every reader. The price series is not here; it ships
 * once with the page and does not move at this cadence.
 *
 * Nothing is stored, and the request carries no identifier.
 */

// A stale Data Cache entry would be served to every reader while the page claimed to be live.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(): Promise<NextResponse> {
  // Absent on testnet, where the page itself 404s and TAZ has no price.
  if (isTestnet) return testnetAbsent();

  const stats = await getDataSource().getStats();
  return NextResponse.json(stats, {
    // Five seconds against a ten-second venue poll.
    headers: { "Cache-Control": LIVE_POLL_CACHE_CONTROL },
  });
}

import { NextResponse } from "next/server";
import { getDataSource } from "@/data";
import { isTestnet } from "@/lib/network";
import { testnetAbsent } from "@/app/_shared/route-responses";
import { isTransientUpstream } from "@/lib/transient-upstream";

/**
 * The sky's second half: the never-answered addresses hanging off their advertisers,
 * `scope=all`. A first-party route handler rather than a browser call to the VPS API, for the
 * reason `/api/live` and `/api/stats` are: the bearer token never exists client-side.
 *
 * Fetched after mount by `SkyCanvas` so the tab's own HTML stays small (the payload is ~280 KB
 * raw, ~36 KB gzipped, and the tab is prerendered). No parameter at all, so one CDN entry
 * serves every reader; a minute matches the API's own snapshot and the tab's revalidate.
 *
 * Nothing here carries an address: the adapter asserts that on every payload before it
 * returns one, and this handler returns the adapter's object verbatim.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(): Promise<NextResponse> {
  // Absent on testnet, where the page itself 404s.
  if (isTestnet) return testnetAbsent();
  try {
    const topology = await getDataSource().getNetworkTopology("all");
    return NextResponse.json(topology, {
      headers: { "Cache-Control": "public, s-maxage=60" },
    });
  } catch (error) {
    if (!isTransientUpstream(error)) throw error;
    // An outage is stated, never cached and never an empty sky.
    return NextResponse.json(
      { error: "the network topology could not be read" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

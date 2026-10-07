import { NextResponse } from "next/server";
import { parsePulseWindowParams, PULSE_SETTLED_SECONDS, PULSE_WINDOW_PARAM_ERROR } from "@/domain";
import { getDataSource } from "@/data";
import { isTestnet } from "@/lib/network";
import { testnetAbsent } from "@/app/_shared/route-responses";

/**
 * One aligned hour of history, for `/pulse`'s replay transport.
 *
 * The window is validated here, before any round trip: a malformed hour is a 400, never a
 * nearest guess that would animate a different hour under this label. The response echoes the
 * window so the client can refuse a body from a cache keyed without these parameters.
 *
 * Nothing is stored, and the request carries no identifier: two integers on an hour boundary.
 */

// The upstream read must never come from Next's Data Cache. A recent hour is still within
// reorg reach and its answer can change; a cached one would go on animating blocks that no
// longer exist.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** A settled hour cannot change, so it is worth a real CDN window. */
const SETTLED_MAX_AGE = 3_600;
/** An hour still within reorg reach gets the live window instead. */
const LIVE_MAX_AGE = 5;

export async function GET(request: Request): Promise<NextResponse> {
  if (isTestnet) return testnetAbsent();

  const params = new URL(request.url).searchParams;
  const nowSeconds = Math.floor(Date.now() / 1000);
  // The domain parser, so a hand-edited URL is refused by exactly the rules the API applies.
  const window = parsePulseWindowParams(params.get("from"), params.get("to"), nowSeconds);
  if (window === null) {
    // The API's own sentence, from the domain: two doors refusing the same set must say the
    // same thing, or a developer concludes one of them is broken.
    return NextResponse.json({ error: PULSE_WINDOW_PARAM_ERROR }, { status: 400 });
  }
  // `7200`, `07200` and `7.2e3` parse alike; only the plain spelling the client sends is served,
  // so each hour has one CDN entry. Other spellings are redirected, uncached, before any read.
  const canonical = `?from=${window.fromSeconds}&to=${window.toSeconds}`;
  if (new URL(request.url).search !== canonical) {
    return NextResponse.redirect(new URL(`/api/pulse/window${canonical}`, request.url), {
      status: 308,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const payload = await getDataSource().getPulseWindow(window.fromSeconds, window.toSeconds);
  // Settled means past the reorg horizon AND indexed. The horizon here is wall-clock time, so
  // a lagging follower could make an unindexed hour look old; an hour with no blocks (a real
  // one carries ~48) is treated as not yet indexed. A partly indexed hour can still slip
  // through, costing one stale replay hour, never a wrong figure.
  const settled =
    window.toSeconds < nowSeconds - PULSE_SETTLED_SECONDS && payload.blocks.length > 0;

  return NextResponse.json(payload, {
    headers: {
      // No `stale-while-revalidate` in either branch: under SWR the request that triggers the
      // refresh is the one served the stale copy.
      "Cache-Control": `public, s-maxage=${settled ? SETTLED_MAX_AGE : LIVE_MAX_AGE}`,
      // Netlify's default cache key covers only `__nextDataReq` and `_rsc`, so every query
      // parameter that changes the answer must be named. `|` is the separator Netlify emits.
      "Netlify-Vary": "query=from|to",
    },
  });
}

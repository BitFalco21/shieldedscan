import { NextResponse } from "next/server";
import { getDataSource } from "@/data";
import { PULSE_LIVE_KIND } from "@/data/pulse-payload";
import { isTestnet } from "@/lib/network";
import { LIVE_POLL_CACHE_CONTROL, testnetAbsent } from "@/app/_shared/route-responses";

/**
 * The `/pulse` live read: the frame the boxes and the pulses are drawn from, plus the mempool
 * layer hovering at the edges.
 *
 * A first-party route handler because the bearer token must never exist client-side.
 *
 * The frame (changes per block) and the mempool (every few seconds) are separate upstream reads,
 * merged here so the page has one poll and the two layers cannot drift a poll apart.
 *
 * The pending read may fail without costing the frame: it degrades to `null`. `null` is not
 * `{count: 0}`, which would be a measurement that the mempool held nothing.
 *
 * No parameters, so one cache entry serves every reader. Nothing is stored.
 */

// A stale Data Cache entry would freeze the boxes while the page went on animating.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(): Promise<NextResponse> {
  // Absent on testnet, where the page itself 404s.
  if (isTestnet) return testnetAbsent();

  const data = getDataSource();
  const [frame, pending] = await Promise.all([
    data.getPulseFrame(),
    // Settled rather than awaited, so a mempool outage cannot reject the whole response. The
    // frame is deliberately NOT wrapped: with no frame there is nothing to draw, and that
    // belongs at the error boundary.
    data.getPulsePending().catch(() => null),
  ]);

  return NextResponse.json(
    {
      // Echoed and checked by the client, so a shared cache handing back some other route's
      // body is a visible miss rather than a silent one.
      kind: PULSE_LIVE_KIND,
      // Domain types verbatim, so a live movement renders through the same components as a
      // server-rendered one and cannot arrive missing a leg, a fee or a pool.
      frame,
      pending,
    },
    {
      // Five seconds against a 75-second block target.
      headers: { "Cache-Control": LIVE_POLL_CACHE_CONTROL },
    },
  );
}

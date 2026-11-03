import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCachedDataSource } from "@/data";
import { nowSeconds } from "@/lib/clock";
import { isTestnet } from "@/lib/network";
import { HalvingPage } from "@/features/halving/HalvingPage";
import { DataUnavailable } from "@/components/DataUnavailable";
import { nullIfTransient } from "@/lib/transient-upstream";
import type { HalvingSchedule } from "@/domain";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. The countdown is anchored to an estimated
 * date that moves by seconds per day, and the one per-block figure (the height it was read at) is
 * printed, so staleness is visible. This page is the most likely to be linked from elsewhere;
 * `netlify/functions/warm-cache.mjs` keeps it warm.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Zcash Halving Countdown",
  description:
    "Time and blocks until the next Zcash halving, what changes at it, and every halving so far.",
};

/**
 * `/halving` — the next Zcash halving, and every one before it.
 *
 * Mainnet-only for now: testnet has halvings too, but the heights here are mainnet consensus
 * constants. Enabling it needs one per-network constant, following
 * `IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK`.
 */
export default async function Page() {
  if (isTestnet) notFound();

  const data = getCachedDataSource();
  // A transient upstream failure degrades the page to "unavailable" rather than an error page.
  // Only transient failures are caught; a shape error still throws.
  // The price map is optional: an empty map drops the price column.
  const [schedule, dailyUsd]: [HalvingSchedule | null, Record<string, number>] = await Promise.all([
    nullIfTransient(() => data.getHalvingSchedule()),
    data.getDailyPriceMap().catch(() => ({})),
  ]);

  // Nothing is estimated in its place: a countdown from a fallback would be a confident wrong
  // date. ISR replaces this on the next successful revalidation.
  if (schedule === null) {
    return <DataUnavailable what="The halving schedule" refreshesWithin="a minute" />;
  }

  return <HalvingPage schedule={schedule} dailyUsd={dailyUsd} now={nowSeconds()} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCachedDataSource } from "@/data";
import { nowSeconds } from "@/lib/clock";
import { isTestnet } from "@/lib/network";
import { HalvingPage } from "@/features/halving/HalvingPage";
import { DataUnavailable } from "@/components/DataUnavailable";
import { nullIfTransient } from "@/lib/transient-upstream";
import type { HalvingSchedule, ShieldedSupplyPoint, SupplyBreakdown } from "@/domain";
import { issuanceSnapshot } from "@/features/issuance/issuance-snapshot";

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
  // The price map is optional: an empty map drops the price column. The supply reads are optional
  // too: without the daily closes the issuance section says it did not load.
  const [schedule, dailyUsd, closes, supply]: [
    HalvingSchedule | null,
    Record<string, number> | null,
    ShieldedSupplyPoint[] | null,
    SupplyBreakdown | null,
  ] = await Promise.all([
    nullIfTransient(() => data.getHalvingSchedule()),
    nullIfTransient(() => data.getDailyPriceMap()),
    nullIfTransient(() => data.getSupplySeries()),
    nullIfTransient(() => data.getSupplyBreakdown()),
  ]);

  // Nothing is estimated in its place: a countdown from a fallback would be a confident wrong
  // date. The next good render replaces this.
  if (schedule === null) {
    return <DataUnavailable what="The halving schedule" />;
  }

  const now = nowSeconds();
  return (
    <HalvingPage
      schedule={schedule}
      dailyUsd={dailyUsd ?? {}}
      now={now}
      issuance={closes ? issuanceSnapshot(closes, schedule, supply, now) : null}
    />
  );
}

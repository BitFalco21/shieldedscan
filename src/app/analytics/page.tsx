import type { Metadata } from "next";
import { getCachedDataSource } from "@/data";
import { DataUnavailable } from "@/components/DataUnavailable";
import { AnalyticsPage } from "@/features/analytics/AnalyticsPage";
import { nullIfTransient } from "@/lib/transient-upstream";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. Day- and month-grain series, each dated on
 * the page.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Analytics",
  description: "Zcash network activity: transaction mix, shielded share, fees and pool flows.",
};

/**
 * The series is a monthly aggregation over every block, the most expensive query on the
 * site. A slow upstream must not fail the whole page, so a transient failure renders
 * `DataUnavailable` and the next successful render replaces it. Never fall back to an empty
 * series: a chart with no points claims Zcash has no history. Only transient failures are
 * caught; a version-skew shape error still throws.
 */
export default async function Page() {
  // Only the fetches are guarded: React renders JSX later, so a try around it catches nothing.
  const data = getCachedDataSource();
  // Each optional read degrades on its own via `nullIfTransient`. The chain facts are cheap,
  // node-backed and required, so they stay unguarded. One round trip, because a render's
  // time is billed by the wall clock.
  const [series, chain, activity, fees24h, flow, feeDistribution, days, flowDays, feesDaily] =
    await Promise.all([
      nullIfTransient(() => data.getMonthlySeries()),
      data.getChainInfo(),
      nullIfTransient(() => data.getActivitySeries()),
      // `null` is ALSO the legitimate value when nothing in the window is measurable, so both
      // paths land on the same honest rendering rather than on a fabricated 0.
      nullIfTransient(() => data.getFees24h()),
      // `null` is "we could not read it" and renders the panel's own unavailable message; an
      // empty array would mean the chain has no months, which is a different claim.
      nullIfTransient(() => data.getShieldingFlow()),
      nullIfTransient(() => data.getFeeDistribution()),
      // The daily siblings behind the chart range toggles: a transient failure degrades that
      // chart's sub-ALL ranges, never the page.
      nullIfTransient(() => data.getDailySeries()),
      nullIfTransient(() => data.getShieldingFlowDaily()),
      nullIfTransient(() => data.getFeeKindsDaily()),
    ]);
  // An empty series is unavailable too, not a chain with no history: it would reduce to a
  // fabricated "TRANSACTIONS 0" (reachable whenever `chain_month_rollup` is unrefreshed).
  // Page-level, because every headline here is a reduction over this series.
  if (series === null || series.length === 0) {
    return (
      <div className="pt-10">
        <DataUnavailable what="The monthly activity series" refreshesWithin="the hour" />
      </div>
    );
  }
  return (
    <AnalyticsPage
      series={series}
      chain={chain}
      activity={activity}
      fees24h={fees24h}
      flow={flow}
      feeDistribution={feeDistribution}
      days={days}
      flowDays={flowDays}
      feesDaily={feesDaily}
    />
  );
}

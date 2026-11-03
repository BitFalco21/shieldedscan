import type { Metadata } from "next";
import { getCachedDataSource } from "@/data";
import { AllPoolsPage } from "@/features/shielded/AllPoolsPage";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. Warmed every two minutes, like the
 * shielded-pools view; the page prints the block it was read at and a live layer polls
 * `/api/supply` on top.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "All Pools",
  description:
    "Every ZEC of the 21M supply by pool: transparent, shielded, lockbox, NSM and unmined.",
};

/**
 * One node read: the value pools and the NSM balance at one height, which is all the view needs.
 * No fallback for an outage: without it there is no figure to show, and the error boundary says so.
 */
export default async function Page() {
  return <AllPoolsPage supply={await getCachedDataSource().getSupplyBreakdown()} />;
}

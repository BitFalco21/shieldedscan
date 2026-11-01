import type { Metadata } from "next";
import { getPrerenderedDataSource } from "@/data";
import { AllPoolsPage } from "@/features/shielded/AllPoolsPage";

/**
 * Prerendered at 60 s and warmed every two minutes, like the shielded-pools view; the page
 * prints the block it was read at and a live layer polls `/api/supply` on top. Declared
 * explicitly because Next takes the minimum window across the route, and the page reads through
 * `getPrerenderedDataSource`, whose tip window matches this.
 */
export const revalidate = 60;

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
  return <AllPoolsPage supply={await getPrerenderedDataSource().getSupplyBreakdown()} />;
}

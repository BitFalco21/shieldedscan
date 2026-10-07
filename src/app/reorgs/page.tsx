import type { Metadata } from "next";
import { getDataSource } from "@/data";
import { cursorNavHrefs } from "@/app/_shared/cursor-nav";
import { nowSeconds } from "@/lib/clock";
import { ReorgsPage } from "@/features/reorgs/ReorgsPage";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Reorgs",
  description: "Chain reorganisations our node observed — one node's view of tip churn.",
};

const PAGE_SIZE = 25;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string }>;
}) {
  const { before, after } = await searchParams;
  const data = getDataSource();
  const [{ items: events, nextCursor, prevCursor }, summary] = await Promise.all([
    data.listReorgEvents({ before, after, limit: PAGE_SIZE }),
    data.getReorgSummary(),
  ]);
  // Wall clock: `detectedAt` is the follower's clock, an off-chain event like a swap.
  return (
    <ReorgsPage
      events={events}
      summary={summary}
      now={nowSeconds()}
      {...cursorNavHrefs({ nextCursor, prevCursor }, (step) =>
        step ? `/reorgs?${step.name}=${encodeURIComponent(step.value)}` : "/reorgs",
      )}
    />
  );
}

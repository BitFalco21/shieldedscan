import type { Metadata } from "next";
import { getDataSource } from "@/data";
import { cursorNavHrefs } from "@/app/_shared/cursor-nav";
import { dailyUsdForRows } from "@/lib/format";
import { BlocksListPage } from "@/features/blocks/BlocksListPage";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Blocks",
  description: "Latest Zcash blocks with per-block shielded and transparent composition.",
};

const PAGE_SIZE = 25;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string }>;
}) {
  const { before, after } = await searchParams;
  const data = getDataSource();
  const [{ items: blocks, nextCursor, prevCursor }, chain, dailyUsd, fees24h] = await Promise.all([
    data.listBlocks({ before, after, limit: PAGE_SIZE }),
    data.getChainInfo(),
    // No price history, no dollar column — the ZEC figures stand alone.
    data.getDailyPriceMap().catch(() => ({}) as Record<string, number>),
    data.getFees24h().catch(() => null),
  ]);
  return (
    <BlocksListPage
      blocks={blocks}
      now={chain.lastBlockTimestamp}
      tipHeight={chain.height}
      dailyUsd={dailyUsdForRows(
        dailyUsd,
        blocks.map((b) => b.timestamp),
        chain.lastBlockTimestamp,
      )}
      priceUsd={chain.priceUsd}
      fees24h={fees24h}
      txCount24h={chain.txCount24h}
      pageSize={PAGE_SIZE}
      {...cursorNavHrefs({ nextCursor, prevCursor }, (step) =>
        step ? `/blocks?${step.name}=${encodeURIComponent(step.value)}` : "/blocks",
      )}
    />
  );
}

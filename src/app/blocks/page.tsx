import type { Metadata } from "next";
import { getDataSource } from "@/data";
import { cursorNavHrefs } from "@/app/_shared/cursor-nav";
import { dailyUsdForRows } from "@/lib/format";
import { BlocksListPage } from "@/features/blocks/BlocksListPage";
import { nullIfTransient } from "@/lib/transient-upstream";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Blocks",
  description: "Latest Zcash blocks with per-block shielded and transparent composition.",
};

const PAGE_SIZE = 25;

/** Every read is optional; the rows need the list and the tip, the cards their own figures. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string }>;
}) {
  const { before, after } = await searchParams;
  const data = getDataSource();
  const [page, chain, dailyUsd, fees24h] = await Promise.all([
    nullIfTransient(() => data.listBlocks({ before, after, limit: PAGE_SIZE })),
    nullIfTransient(() => data.getChainInfo()),
    // No price history, no dollar column — the ZEC figures stand alone.
    nullIfTransient(() => data.getDailyPriceMap()),
    nullIfTransient(() => data.getFees24h()),
  ]);
  const blocks = page !== null && chain !== null ? page.items : null;
  return (
    <BlocksListPage
      blocks={blocks}
      now={chain?.lastBlockTimestamp ?? null}
      tipHeight={chain?.height ?? null}
      dailyUsd={
        blocks === null || chain === null
          ? {}
          : dailyUsdForRows(
              dailyUsd ?? {},
              blocks.map((b) => b.timestamp),
              chain.lastBlockTimestamp,
            )
      }
      priceUsd={chain?.priceUsd ?? null}
      fees24h={fees24h}
      txCount24h={chain?.txCount24h ?? null}
      pageSize={PAGE_SIZE}
      {...cursorNavHrefs(
        blocks === null || page === null ? { nextCursor: null, prevCursor: null } : page,
        (step) => (step ? `/blocks?${step.name}=${encodeURIComponent(step.value)}` : "/blocks"),
      )}
    />
  );
}

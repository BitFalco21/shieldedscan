import { getCachedDataSource } from "@/data";
import { HomePage } from "@/features/home/HomePage";
import { isTestnet } from "@/lib/network";
import { nullIfTransient } from "@/lib/transient-upstream";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. The homepage's live panels poll
 * `/api/live` on top, so a reader is current within seconds whatever the HTML's age, and the warmer
 * refreshes it every two minutes.
 *
 * The chain facts head the page (height, price, supply); every other read is one card or panel
 * and degrades on its own.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  const data = getCachedDataSource();
  const [chain, pools, latestBlocks, latestTxs, transfers] = await Promise.all([
    data.getChainInfo(),
    nullIfTransient(() => data.getPools()),
    nullIfTransient(() => data.listLatestBlocks(8)),
    nullIfTransient(() => data.listLatestTransactions(8)),
    // Testnet never renders the cross-chain panel, so it never pays for the query either, and
    // the testnet API legitimately has no cross-chain store to answer from.
    isTestnet ? null : nullIfTransient(() => data.listCrossChainTransfers({ limit: 4 })),
  ]);
  return (
    <HomePage
      chain={chain}
      pools={pools}
      latestBlocks={latestBlocks}
      latestTxs={latestTxs}
      latestTransfers={isTestnet ? [] : (transfers?.items ?? null)}
    />
  );
}

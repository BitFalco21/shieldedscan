import { getCachedDataSource } from "@/data";
import { HomePage } from "@/features/home/HomePage";
import { isTestnet } from "@/lib/network";

/**
 * Rendered on request, never at build, so a deploy cannot depend on the API; the edge cache
 * (`lib/edge-cache.ts`) shares one render among readers. The homepage's live panels poll
 * `/api/live` on top, so a reader is current within seconds whatever the HTML's age, and the warmer
 * refreshes it every two minutes.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  const data = getCachedDataSource();
  // Testnet never renders the cross-chain panel, so it never pays for the query either, and
  // the testnet API legitimately has no cross-chain store to answer from.
  const transfersPromise = isTestnet ? null : data.listCrossChainTransfers({ limit: 4 });
  const [chain, pools, latestBlocks, latestTxs] = await Promise.all([
    data.getChainInfo(),
    data.getPools(),
    data.listLatestBlocks(8),
    data.listLatestTransactions(8),
  ]);
  return (
    <HomePage
      chain={chain}
      pools={pools}
      latestBlocks={latestBlocks}
      latestTxs={latestTxs}
      latestTransfers={transfersPromise === null ? [] : (await transfersPromise).items}
    />
  );
}

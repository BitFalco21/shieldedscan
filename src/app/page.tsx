import { getPrerenderedDataSource } from "@/data";
import { HomePage } from "@/features/home/HomePage";
import { isTestnet } from "@/lib/network";

/**
 * Prerendered at 60 s. The homepage's live panels poll `/api/live` on top, so a reader is
 * current within seconds whatever the HTML's age, and the warmer regenerates it every two
 * minutes. Declared explicitly because the build legend shows nothing for a window inferred
 * from fetches, and Next takes the minimum window across the route: the page reads through
 * `getPrerenderedDataSource`, whose tip window matches this.
 */
export const revalidate = 60;

export default async function Page() {
  const data = getPrerenderedDataSource();
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

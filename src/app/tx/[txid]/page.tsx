import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ZcashTxCrossings } from "@/domain";
import { getDataSource } from "@/data";
import type { ExplorerDataSource } from "@/data/source";
import { TxDetailPage } from "@/features/transactions/TxDetailPage";
import { nowSeconds } from "@/lib/clock";
import { shortHash, usdAtDay } from "@/lib/format";
import { isTestnet } from "@/lib/network";
import { isTransientUpstream } from "@/lib/transient-upstream";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ txid: string }>;
}): Promise<Metadata> {
  const { txid } = await params;
  return { title: `Transaction ${shortHash(txid, 8)}` };
}

export default async function Page({ params }: { params: Promise<{ txid: string }> }) {
  const { txid } = await params;
  const data = getDataSource();
  // All three reads at once: the chain facts and the swap lookup do not depend on whether the
  // transaction exists. A swap lookup for an absent transaction is simply discarded.
  const [tx, chain, crossings, dailyUsd] = await Promise.all([
    data.getTransaction(txid),
    data.getChainInfo(),
    swapLegs(data, txid),
    // No price history degrades to no dollar figures; the ZEC amounts stand alone.
    data.getDailyPriceMap().catch(() => ({}) as Record<string, number>),
  ]);
  if (!tx) notFound();
  // A pending transaction has no block time yet: it is valued as of now, at the current price.
  const now = nowSeconds();
  const at = tx.blockHeight === null ? now : tx.timestamp;
  return (
    <TxDetailPage
      tx={tx}
      tipHeight={chain.height}
      priceUsd={usdAtDay(at, dailyUsd, chain.priceUsd, now)}
      crossings={crossings}
    />
  );
}

const NONE: ZcashTxCrossings = { transfers: [], total: 0 };

/**
 * The crossings this transaction is the Zcash leg of. Testnet has no venues and its API
 * mounts no cross-chain routes, so it is not asked. A transient failure drops the strip and
 * keeps the page — the transaction is the page's subject, the strip an annotation — while any
 * other failure (a missing route, a wrong shape, an echo for another txid) still throws, so
 * version skew stays loud.
 *
 * A malformed id is not asked either: the route answers it with a 400, which is not transient,
 * and the page must render its designed not-found rather than an error.
 */
async function swapLegs(data: ExplorerDataSource, txid: string): Promise<ZcashTxCrossings> {
  if (isTestnet || !/^[0-9a-f]{64}$/i.test(txid)) return NONE;
  try {
    return await data.listCrossChainTransfersForZcashTx(txid);
  } catch (error) {
    if (!isTransientUpstream(error)) throw error;
    return NONE;
  }
}

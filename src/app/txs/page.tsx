import type { Metadata } from "next";
import type { Transaction, TxListFilter } from "@/domain";
import { parseTxListFilter } from "@/domain";
import { FilterNotAppliedError, getDataSource, type CursorPage, type CursorQuery } from "@/data";
import { cursorNavHrefs } from "@/app/_shared/cursor-nav";
import { dailyUsdForRows } from "@/lib/format";
import { TxsListPage } from "@/features/transactions/TxsListPage";
import { txsHref } from "@/features/transactions/txsHref";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Transactions",
  description: "Latest Zcash transactions — transparent, shielded, and mixed.",
};

const PAGE_SIZE = 25;

/**
 * The page's rows, or null when the API could not prove it applied the pool: an API older than
 * `?pool=` answers with every transaction, and those rows must not render under a pool label.
 * Any other failure propagates as it always has.
 */
async function listRows(
  query: CursorQuery,
  filter: TxListFilter,
): Promise<CursorPage<Transaction> | null> {
  try {
    return await getDataSource().listTransactions(query, filter.kind, filter.pool);
  } catch (error) {
    if (error instanceof FilterNotAppliedError) return null;
    throw error;
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string; kind?: string; pool?: string }>;
}) {
  const { before, after, kind: rawKind, pool: rawPool } = await searchParams;
  const filter = parseTxListFilter(rawKind, rawPool);
  const data = getDataSource();
  const [page, chain, counts, dailyUsd, fees24h] = await Promise.all([
    listRows({ before, after, limit: PAGE_SIZE }, filter),
    data.getChainInfo(),
    // The totals line degrades to absence — a headline count is never worth a dead page.
    data.getTxCounts().catch(() => null),
    // Same degradation: no price history, no dollar column — the ZEC figures stand alone.
    data.getDailyPriceMap().catch(() => ({}) as Record<string, number>),
    data.getFees24h().catch(() => null),
  ]);
  const txs = page?.items ?? [];
  return (
    <TxsListPage
      txs={txs}
      now={chain.lastBlockTimestamp}
      activeKind={filter.kind}
      activePool={filter.pool}
      poolUnavailable={page === null}
      totalForKind={counts?.[filter.kind] ?? null}
      dailyUsd={dailyUsdForRows(
        dailyUsd,
        txs.map((t) => t.timestamp),
        chain.lastBlockTimestamp,
      )}
      priceUsd={chain.priceUsd}
      counts={counts}
      fees24h={fees24h}
      txCount24h={chain.txCount24h}
      {...cursorNavHrefs(page ?? { nextCursor: null, prevCursor: null }, (step) =>
        txsHref(filter, step),
      )}
    />
  );
}

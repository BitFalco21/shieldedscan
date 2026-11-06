import type { Metadata } from "next";
import type { Transaction, TxListFilter } from "@/domain";
import { parseTxListFilter } from "@/domain";
import { FilterNotAppliedError, getDataSource, type CursorPage, type CursorQuery } from "@/data";
import { cursorNavHrefs } from "@/app/_shared/cursor-nav";
import { dailyUsdForRows } from "@/lib/format";
import { TxsListPage } from "@/features/transactions/TxsListPage";
import { txsHref } from "@/features/transactions/txsHref";
import { nullIfTransient } from "@/lib/transient-upstream";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Transactions",
  description: "Latest Zcash transactions — transparent, shielded, and mixed.",
};

const PAGE_SIZE = 25;

/**
 * The page's rows, or "unproven" when the API could not prove it applied the pool: an API older
 * than `?pool=` answers with every transaction, and those rows must not render under a pool
 * label. Any other failure propagates.
 */
async function listRows(
  query: CursorQuery,
  filter: TxListFilter,
): Promise<CursorPage<Transaction> | "unproven"> {
  try {
    return await getDataSource().listTransactions(query, filter.kind, filter.pool);
  } catch (error) {
    if (error instanceof FilterNotAppliedError) return "unproven";
    throw error;
  }
}

/**
 * Every read is optional: the rows need the list and the tip (their ages), the cards need the
 * tip and the counts, and each part that did not load says so on its own.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string; kind?: string; pool?: string }>;
}) {
  const { before, after, kind: rawKind, pool: rawPool } = await searchParams;
  const filter = parseTxListFilter(rawKind, rawPool);
  const data = getDataSource();
  const [listed, chain, counts, dailyUsd, fees24h] = await Promise.all([
    nullIfTransient(() => listRows({ before, after, limit: PAGE_SIZE }, filter)),
    nullIfTransient(() => data.getChainInfo()),
    nullIfTransient(() => data.getTxCounts()),
    // No price history, no dollar column — the ZEC figures stand alone.
    nullIfTransient(() => data.getDailyPriceMap()),
    nullIfTransient(() => data.getFees24h()),
  ]);
  const page = listed === "unproven" ? null : listed;
  const txs = page !== null && chain !== null ? page.items : null;
  return (
    <TxsListPage
      txs={txs}
      now={chain?.lastBlockTimestamp ?? null}
      activeKind={filter.kind}
      activePool={filter.pool}
      poolUnavailable={listed === "unproven"}
      totalForKind={counts?.[filter.kind] ?? null}
      dailyUsd={
        txs === null || chain === null
          ? {}
          : dailyUsdForRows(
              dailyUsd ?? {},
              txs.map((t) => t.timestamp),
              chain.lastBlockTimestamp,
            )
      }
      priceUsd={chain?.priceUsd ?? null}
      counts={counts}
      fees24h={fees24h}
      txCount24h={chain?.txCount24h ?? null}
      {...cursorNavHrefs(
        txs === null || page === null ? { nextCursor: null, prevCursor: null } : page,
        (step) => txsHref(filter, step),
      )}
    />
  );
}

import type { Metadata } from "next";
import type { TxKindFilter } from "@/domain";
import { parseTxKindFilter } from "@/domain";
import { getDataSource } from "@/data";
import { cursorNavHrefs, type CursorStep } from "@/app/_shared/cursor-nav";
import { dailyUsdForRows } from "@/lib/format";
import { TxsListPage } from "@/features/transactions/TxsListPage";

// Tip-sensitive: skip Next's fetch Data Cache (ARCHITECTURE.md, "Caching and freshness").
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Transactions",
  description: "Latest Zcash transactions — transparent, shielded, and mixed.",
};

const PAGE_SIZE = 25;

/**
 * `/txs` href carrying the active `kind` (omitted for "all") plus an optional
 * cursor param. Pagination links must preserve the active filter; the filter
 * chips themselves pass no cursor, which is what resets pagination on a filter
 * change.
 */
function txsHref(kind: TxKindFilter, cursor?: CursorStep): string {
  const params = new URLSearchParams();
  if (kind !== "all") params.set("kind", kind);
  if (cursor) params.set(cursor.name, cursor.value);
  const qs = params.toString();
  return qs ? `/txs?${qs}` : "/txs";
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; after?: string; kind?: string }>;
}) {
  const { before, after, kind: rawKind } = await searchParams;
  const kind = parseTxKindFilter(rawKind);
  const data = getDataSource();
  const [{ items: txs, nextCursor, prevCursor }, chain, counts, dailyUsd, fees24h] =
    await Promise.all([
      data.listTransactions({ before, after, limit: PAGE_SIZE }, kind),
      data.getChainInfo(),
      // The totals line degrades to absence — a headline count is never worth a dead page.
      data.getTxCounts().catch(() => null),
      // Same degradation: no price history, no dollar column — the ZEC figures stand alone.
      data.getDailyPriceMap().catch(() => ({}) as Record<string, number>),
      data.getFees24h().catch(() => null),
    ]);
  return (
    <TxsListPage
      txs={txs}
      now={chain.lastBlockTimestamp}
      activeKind={kind}
      totalForKind={counts?.[kind] ?? null}
      dailyUsd={dailyUsdForRows(
        dailyUsd,
        txs.map((t) => t.timestamp),
        chain.lastBlockTimestamp,
      )}
      priceUsd={chain.priceUsd}
      counts={counts}
      fees24h={fees24h}
      txCount24h={chain.txCount24h}
      {...cursorNavHrefs({ nextCursor, prevCursor }, (step) => txsHref(kind, step))}
    />
  );
}

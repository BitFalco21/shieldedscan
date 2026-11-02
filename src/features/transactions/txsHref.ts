import type { TxListFilter } from "@/domain";

/**
 * The `/txs` URL for a filter, optionally at a cursor. One builder for the chips, the pool chip's
 * remove link and every pagination link, so none of them can drop the filter.
 *
 * A filter link passes no cursor, which is what resets paging on a filter change. A pool and a
 * kind never combine (`parseTxListFilter`), so a pool URL carries no kind.
 */
export function txsHref(
  filter: TxListFilter,
  cursor?: { name: "before" | "after"; value: string },
): string {
  const params = new URLSearchParams();
  if (filter.pool !== null) params.set("pool", filter.pool);
  else if (filter.kind !== "all") params.set("kind", filter.kind);
  if (cursor) params.set(cursor.name, cursor.value);
  const qs = params.toString();
  return qs ? `/txs?${qs}` : "/txs";
}

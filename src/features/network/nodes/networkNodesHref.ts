import type { NetNodeFilters } from "@/domain";

/**
 * The one builder for every link on `/network/nodes`: chips, the hosting-network menu and all
 * four pagination controls. Every href carries the whole filter state with one field changed, so
 * changing one filter cannot clear the other.
 *
 * A null filter is omitted from the URL, so the unfiltered page has one URL and one cache key; a
 * filter change passes no cursor, which resets paging.
 */
export function networkNodesHref(
  filters: NetNodeFilters,
  cursor?: { name: "before" | "after"; value: string },
): string {
  const params = new URLSearchParams();
  if (filters.client !== null) params.set("client", filters.client);
  if (filters.asn !== null) params.set("asn", String(filters.asn));
  if (cursor) params.set(cursor.name, cursor.value);
  const qs = params.toString();
  return qs ? `/network/nodes?${qs}` : "/network/nodes";
}

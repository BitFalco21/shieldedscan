import {
  ECOSYSTEM_CATEGORIES,
  ecosystemHost,
  type EcosystemCategory,
  type EcosystemEntry,
} from "@/domain/ecosystem";

const CATEGORY_LABEL = new Map<EcosystemCategory, string>(
  ECOSYSTEM_CATEGORIES.map((c) => [c.id, c.label]),
);

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/**
 * The projects matching a query, best first: a name that starts with it, then a name that
 * contains it, then a match on the host or the category — so "wallet" finds "Wallets" entries
 * after the projects actually called something-Wallet. One matcher for the map's search bar
 * and the list's filter, so the two views cannot disagree about what a query finds.
 */
export function searchEntries(
  entries: readonly EcosystemEntry[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): EcosystemEntry[] {
  const q = fold(query);
  if (!q) return [];
  const ranked: { entry: EcosystemEntry; rank: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    const name = fold(entry.name);
    const rank = name.startsWith(q)
      ? 0
      : name.includes(q)
        ? 1
        : fold(ecosystemHost(entry.url)).includes(q)
          ? 2
          : fold(CATEGORY_LABEL.get(entry.category) ?? "").includes(q)
            ? 3
            : -1;
    if (rank >= 0) ranked.push({ entry, rank, order });
  });
  return ranked
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map((r) => r.entry);
}

export function categoryLabel(id: EcosystemCategory): string {
  return CATEGORY_LABEL.get(id) ?? id;
}

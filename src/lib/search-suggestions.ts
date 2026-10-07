import { classifySearchQuery, formatZnsName } from "@/domain";
import { formatCount, shortHash } from "./format";

/**
 * What a typed query could be, as clickable destinations.
 *
 * Derived entirely from `classifySearchQuery`: no network, no lookup. That is a privacy
 * decision first (checking existence would send every keystroke to the server), and it also
 * means suggestions are instant and work with the API down. A nonexistent identifier lands on
 * the designed not-found page.
 */
export interface SearchSuggestion {
  href: string;
  /** What kind of thing this would be. */
  label: string;
  /** The value itself, elided for display. */
  detail: string;
}

export function searchSuggestions(raw: string): SearchSuggestion[] {
  const query = classifySearchQuery(raw);
  switch (query.type) {
    case "height":
      return [
        {
          href: `/block/${query.height}`,
          label: "Block",
          detail: `#${formatCount(query.height)}`,
        },
      ];
    case "hash64":
      // One row whose label carries the ambiguity: 64 hex characters may be a txid or a block
      // hash. It links to /search, which resolves server-side; when /api/resolve answers
      // first, the confirmed row replaces this one in place.
      return [
        {
          href: `/search?q=${query.hash}`,
          label: "Transaction / block hash",
          detail: shortHash(query.hash, 10),
        },
      ];
    case "transparent-address":
      return [
        {
          href: `/address/${query.address}`,
          label: "Transparent address",
          detail: shortHash(query.address, 10),
        },
      ];
    case "shielded-address":
      return [
        {
          href: `/address/${query.address}`,
          label: "Shielded address",
          detail: shortHash(query.address, 10),
        },
      ];
    case "name":
      // Never shown on its own: almost any word is a well-formed name. It opens the resolver
      // gate; `useResolvedSuggestions` keeps the list empty until a registration is confirmed.
      return [
        {
          href: `/search?q=${encodeURIComponent(query.name)}`,
          label: "Zcash name",
          detail: formatZnsName(query.name),
        },
      ];
    default:
      // "empty" and "invalid" offer nothing to click; the hint beside the input says why.
      return [];
  }
}

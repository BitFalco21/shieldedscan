import { classifyZcashAddress } from "./address";
import { parseZnsName } from "./zns";

export type SearchQuery =
  | { type: "empty" }
  | { type: "height"; height: number }
  | { type: "hash64"; hash: string }
  | { type: "transparent-address"; address: string }
  | { type: "shielded-address"; address: string }
  /**
   * A Zcash Name System name (`zenith` or `zenith.zcash`, any case), normalised to the bare name
   * the registry resolves. `query` is the trimmed input, so a surface that does not resolve
   * names can answer as it does for an unrecognised string.
   *
   * Classified after heights, hashes and addresses, so an all-digit name reads as a height and
   * is unreachable by search. No name can read as a hash: names stop at 62 characters.
   */
  | { type: "name"; name: string; query: string }
  | { type: "invalid"; query: string };

/**
 * The one spelling of a search query that lookups are made under: trimmed, and a 64-hex value
 * lowercased. The dropdown asks for this form and the resolve route refuses any other, so a
 * query padded with spaces or with its hex case flipped cannot bypass the shared cache.
 */
export function canonicalSearchQuery(raw: string): string {
  const trimmed = raw.trim();
  return /^[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

export function classifySearchQuery(raw: string): SearchQuery {
  const q = raw.trim();
  if (q === "") return { type: "empty" };
  if (/^\d{1,10}$/.test(q)) return { type: "height", height: Number(q) };
  if (/^[0-9a-fA-F]{64}$/.test(q)) return { type: "hash64", hash: q.toLowerCase() };
  // Delegates to the shared address classifier so every surface agrees on what an address is.
  const kind = classifyZcashAddress(q);
  if (kind === "transparent") return { type: "transparent-address", address: q };
  if (kind !== null) return { type: "shielded-address", address: q };
  const name = parseZnsName(q);
  if (name !== null) return { type: "name", name, query: q };
  return { type: "invalid", query: q };
}

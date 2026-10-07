import { classifySearchQuery } from "@/domain";

/**
 * Whether a relative href naming an entity page carries an identifier this site can route.
 * Guards links in agent answers, where a model can fabricate an identifier; a dead link is a
 * false claim that the page exists.
 *
 * Deliberately narrow: it answers false only for `/tx`, `/block` and `/address`, and true for
 * every other page and every off-site href (which the sanitiser's host allowlist judges). A
 * broad "does this route exist" check would be a second copy of the router.
 *
 * Shape is judged by `classifySearchQuery`, the classifier shared with search, the palette and
 * `/api/resolve`, so there is one definition of a valid identifier. A 64-hex string is accepted
 * for both `/tx` and `/block`: it is ambiguous between a txid and a block hash, and `/search`
 * resolves that.
 */
export function entityHrefIsRoutable(href: string): boolean {
  const path = href.split(/[?#]/, 1)[0] ?? "";
  const match = /^\/(tx|block|address)\/(.+)$/.exec(path);
  if (match === null) return true;

  const route = match[1]!;
  // A path segment reaches us encoded; the classifier judges the value a reader would see.
  // A malformed escape (`%zz`) throws, and is not an identifier either way.
  let value: string;
  try {
    value = decodeURIComponent(match[2]!);
  } catch {
    return false;
  }
  // The identifier must be the whole segment. `classifySearchQuery` trims (right for typed
  // input), but nothing trims an href on its way to the data source, so `/block/%207%20` 404s.
  if (value !== value.trim()) return false;
  const kind = classifySearchQuery(value).type;
  if (route === "tx") return kind === "hash64";
  // A height and a hash are both legitimate ways to name a block. The height case goes through
  // the classifier rather than `Number()`, which accepts `-12`, `1e9` and ` 7 `.
  if (route === "block") return kind === "height" || kind === "hash64";
  return kind === "transparent-address" || kind === "shielded-address";
}

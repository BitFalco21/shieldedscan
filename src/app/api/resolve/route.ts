import { NextResponse } from "next/server";
import { canonicalSearchQuery, classifySearchQuery, formatZnsName } from "@/domain";
import { getDataSource } from "@/data";
import { shortHash } from "@/lib/format";
import { isTestnet } from "@/lib/network";

/**
 * Existence check for the search dropdown: a pasted identifier that is on chain shows a
 * confirmed, clickable result.
 *
 * A first-party route handler because the bearer token must never exist client-side. Nothing
 * is stored, and the client only calls it with a query that already classifies as a plausible
 * identifier, so keystroke noise never leaves the page.
 *
 * Misses return `found: []`, not an error, so the local shape suggestions remain and a
 * resolver outage degrades gracefully.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  // Only the canonical spelling is looked up (the dropdown sends nothing else). Any other
  // spelling would be a separate CDN entry costing a fresh lookup, so it is refused unread.
  if (q !== canonicalSearchQuery(q)) {
    return NextResponse.json(
      { q, found: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const query = classifySearchQuery(q);
  const data = getDataSource();
  const found: { href: string; label: string; detail: string }[] = [];

  try {
    if (query.type === "height") {
      const block = await data.getBlock(String(query.height));
      if (block) {
        found.push({
          href: `/block/${block.height}`,
          label: "Block — on chain",
          detail: `#${block.height.toLocaleString("en-US")}`,
        });
      }
    } else if (query.type === "hash64") {
      const [block, tx] = await Promise.all([
        data.getBlock(query.hash),
        data.getTransaction(query.hash),
      ]);
      if (block) {
        found.push({
          href: `/block/${block.hash}`,
          label: "Block — on chain",
          detail: shortHash(block.hash, 8),
        });
      }
      if (tx) {
        found.push({
          href: `/tx/${tx.txid}`,
          label: "Transaction — on chain",
          detail: shortHash(tx.txid, 8),
        });
      }
    } else if (query.type === "name" && !isTestnet) {
      // Only a confirmed, current registration becomes a row; a withheld lookup is a miss here,
      // because a dropdown has no room to explain staleness and must not offer an address.
      const hit = (await data.getZnsName(query.name))?.registrations[0];
      if (hit && hit.name === query.name) {
        found.push({
          href: `/name/${hit.name}`,
          label: `Name — ${formatZnsName(hit.name)}`,
          detail: shortHash(hit.address, 6),
        });
      }
    } else if (query.type === "transparent-address") {
      const info = await data.getAddress(query.address);
      if (info) {
        found.push({
          href: `/address/${query.address}`,
          label: "Address — on chain",
          detail: shortHash(query.address, 6),
        });
      }
    }
  } catch {
    // An upstream hiccup must not break typing; the shape suggestions still render.
  }

  return NextResponse.json(
    // `q` is echoed so the caller can discard an answer to a different question. It backs up
    // the cache key below, which is infrastructure configuration and can regress silently.
    { q, found },
    {
      headers: {
        // Identifiers are immutable once they exist; a short shared cache absorbs re-pastes.
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
        // Without this the shared cache is keyed on the path alone, and every query would be
        // answered with whichever one was cached first, a row any stranger could prime.
        // Netlify's default key covers only `__nextDataReq` and `_rsc`; `q` must be named.
        "Netlify-Vary": "query=q",
      },
    },
  );
}

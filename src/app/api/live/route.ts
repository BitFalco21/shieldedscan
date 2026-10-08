import { NextResponse } from "next/server";
import { parseDirectionFilter, parseTxKindFilter } from "@/domain";
import { getDataSource } from "@/data";
import { consistentTransactions } from "@/lib/live-feed";
import { isTestnet } from "@/lib/network";
import { canonicalRedirect, LIVE_POLL_CACHE_CONTROL } from "@/app/_shared/route-responses";

/**
 * The live feed's single upstream read, for `/`, `/blocks`, `/txs` and `/cross-chain`.
 *
 * A first-party route handler rather than a browser call to the API, because the bearer token
 * must never exist client-side. It also works on testnet, which serves no public `/v1`.
 *
 * One endpoint for four pages, keyed only on closed-set filters (`kind`, `direction`), so every
 * reader shares one CDN entry: origin cost is flat in visitor count and zero when nobody is
 * watching. Nothing is stored and the poll carries no identifier.
 */

// The upstream reads must never come from Next's Data Cache: a stale entry would be served to
// every reader while the page claimed to be live.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Newest rows per feed. Ten covers ~12 minutes of blocks and ~5 of transactions. */
const BLOCK_COUNT = 10;
const TX_COUNT = 10;
/**
 * Wider than the four rows `/cross-chain` renders, because the client applies the open-ended
 * venue, chain and value filters to what arrives, so a narrow filter matches only a few. Venues
 * are polled once a minute, so twenty far exceeds what can arrive between two polls.
 */
const TRANSFER_COUNT = 20;

export async function GET(request: Request): Promise<NextResponse> {
  // The domain parser, not a local guess: an unrecognised value degrades to "all" exactly as
  // the /txs page itself would degrade it, so a hand-edited URL can never reach further in.
  const params = new URL(request.url).searchParams;
  const kind = parseTxKindFilter(params.get("kind") ?? undefined);
  // Direction is applied server-side, unlike the other cross-chain filters: three values cost
  // at most three cache keys, and an inbound view then gets the newest inbound transfers rather
  // than whichever of the newest twenty happen to be inbound. Venue, chains and value are
  // open-ended and stay client-side, so the cache key stays bounded.
  const direction = parseDirectionFilter(params.get("direction") ?? undefined);
  // One URL per (kind, direction), in the order the client sends. Any other query (an unknown
  // value, an extra parameter) is redirected before any upstream read, and the redirect is never
  // cached, so a junk variant can neither cost a read nor stand in for the real entry.
  const canonical = `?kind=${encodeURIComponent(kind)}&direction=${encodeURIComponent(direction)}`;
  if (new URL(request.url).search !== canonical) {
    return canonicalRedirect(`/api/live${canonical}`);
  }
  const data = getDataSource();

  // Testnet has no cross-chain store and no /cross-chain routes, so it never pays the query.
  const transfersPromise = isTestnet
    ? null
    : data.listCrossChainTransfers(
        { limit: TRANSFER_COUNT },
        direction === "all" ? undefined : { direction },
      );

  const [chain, blocks, transactions] = await Promise.all([
    data.getChainInfo(),
    // `listBlocks`, not `listLatestBlocks`: the former is coalesced server-side and reads fees
    // from the index, while the latter fans out one `getblock` per row to the node, which a
    // polled endpoint must not do.
    data.listBlocks({ limit: BLOCK_COUNT }),
    data.listTransactions({ limit: TX_COUNT }, kind),
  ]);

  return NextResponse.json(
    {
      // The kind this response was narrowed to. The client discards a payload whose echo
      // differs or is missing: a cache key can regress silently, and an unfiltered list is
      // well-formed, so without the echo transparent rows could arrive under a SHIELDED chip.
      kind,
      // Echoed for the same reason `kind` is, and checked just as strictly by the client.
      direction,
      tip: {
        height: chain.height,
        hash: chain.bestBlockHash,
        // Relative ages tick against the wall clock, floored at this tip timestamp.
        lastBlockTimestamp: chain.lastBlockTimestamp,
      },
      // Domain types verbatim, so a live row renders through the same components as a
      // server-rendered one and cannot arrive missing a fee, a shield or a pool badge.
      blocks: blocks.items,
      // The blocks list is coalesced while transactions are read fresh, so a poll could carry
      // a block's transactions without the block. Such transactions are withheld until the
      // next poll, when both arrive together.
      transactions: consistentTransactions(
        transactions.items,
        blocks.items.length > 0 ? Math.max(...blocks.items.map((b) => b.height)) : null,
      ),
      transfers: transfersPromise === null ? [] : (await transfersPromise).items,
    },
    {
      headers: {
        // Five seconds against a 75-second block target; the client's chase polls mostly hit
        // this shared entry.
        "Cache-Control": LIVE_POLL_CACHE_CONTROL,
        // Netlify's default cache key covers only `__nextDataReq` and `_rsc`, so every query
        // parameter that changes the answer must be named here. The `|` separator is the
        // format Netlify itself emits.
        "Netlify-Vary": "query=kind|direction",
      },
    },
  );
}

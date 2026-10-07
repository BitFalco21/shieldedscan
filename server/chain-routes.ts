import { Hono } from "hono";
import { blockRowsReader, type BlockRowsReader } from "./block-list";
import type { ChainIndexStore } from "./chain-index-store";
import { classifySearchQuery, classifyZcashAddress, parseTxKindFilter } from "@/domain";
import type { NodeChainSource } from "./chain-source";
import type { PriceTracker, Stats24hTracker } from "./chain-stats";
import { clampPageSize } from "./page-size";

export interface ChainRouteExtras {
  // Structural, so a replica's readers of the primary's state (`live-state.ts`) fit as well.
  price?: Pick<PriceTracker, "current">;
  stats24h?: Pick<Stats24hTracker, "current">;
  /**
   * The Postgres-backed address history. Optional so the service boots with no database
   * (fixture/dev mode); without it the address-transactions route answers 503. There is no silent
   * fallback to the node path, which pulled the full txid list per view and could report an outage
   * as an empty address.
   */
  chainIndex?: ChainIndexStore;
  /** The block list; built from the node and `chainIndex` when absent, injected by tests. */
  blockRows?: BlockRowsReader;
}

/**
 * A whole number off the query string, or the fallback: `?limit=abc` and `?limit=1e999` both fall
 * back rather than reaching a query.
 */
const finiteInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

/**
 * A page size or item count: bounded, because it sets how much work one request costs. Bounded
 * here as well as in `NodeChainSource`, so a route pointed at a source that does not clamp is
 * still bounded.
 */
const sizeParam = (raw: string | undefined, fallback: number): number =>
  clampPageSize(finiteInt(raw, fallback));

/**
 * A page number: floored at 1 but not capped at `MAX_PAGE_SIZE`. An address with 2,000
 * transactions is 200 pages at a page size of 10, so a cap would make later pages unreachable. A
 * large page number is cheap: it slices past the end of an already-bounded list.
 */
const pageParam = (raw: string | undefined): number => Math.max(1, finiteInt(raw, 1));

/**
 * Chain read routes, as a mountable router (`app.route("/", chainRoutes(source))`).
 *
 * Every endpoint is one `ExplorerDataSource` method over HTTP, returning domain types verbatim,
 * which keeps the Next adapter a thin fetch-and-validate.
 *
 * Error contract, matching `src/data/source.ts`: a missing thing is 404, and a transient failure
 * is a rejection that surfaces as 500. An outage is never dressed up as missing data.
 */
export function chainRoutes(source: NodeChainSource, extras: ChainRouteExtras = {}): Hono {
  /**
   * The block list, from the chain index with the node topping up what the follower has not stored
   * yet (`block-list.ts`), behind a single-flight cache keyed on both the node's tip and the
   * index's, so a block reaching either is visible at once.
   */
  const blockRows =
    extras.blockRows ??
    blockRowsReader({ node: source, ...(extras.chainIndex ? { index: extras.chainIndex } : {}) });

  const app = new Hono();

  app.get("/chain/info", async (c) => {
    const [facts, pools, oldestHeight] = await Promise.all([
      source.getChainFacts(),
      source.getPools(),
      source.getOldestHeight(),
    ]);
    // A tracker that is cold or stale contributes null, never a substituted value.
    const price = extras.price?.current() ?? null;
    const stats = extras.stats24h?.current() ?? null;
    return c.json({
      ...facts,
      pools,
      oldestHeight,
      ...(price ? { priceUsd: price.usd, priceChange24hPct: price.change24hPct } : {}),
      ...(stats
        ? { txCount24h: stats.txCount24h, fullyShieldedPct24h: stats.fullyShieldedPct24h }
        : {}),
    });
  });

  app.get("/chain/supply", async (c) => c.json(await source.getSupplyBreakdown()));

  app.get("/chain/pools", async (c) => c.json(await source.getPools()));

  app.get("/chain/blocks", async (c) => {
    const { before, after, limit } = c.req.query();
    const page = await blockRows({
      before: before || undefined,
      after: after || undefined,
      limit: sizeParam(limit, 25),
    });
    return c.json({ items: page.items, nextCursor: page.nextCursor, prevCursor: page.prevCursor });
  });

  app.get("/chain/blocks/latest", async (c) =>
    c.json((await blockRows({ limit: sizeParam(c.req.query("count"), 10) })).items),
  );

  app.get("/chain/blocks/:idOrHeight", async (c) => {
    const block = await source.getBlock(c.req.param("idOrHeight"));
    if (!block) return c.json({ error: "not found" }, 404);
    return c.json(block);
  });

  /**
   * A block's transactions, keyset-paginated over `tx_block_idx`
   * (`ChainIndexStore.listBlockTransactions`): a block can hold thousands of transactions, so this
   * is a list of entities, never an unbounded array.
   */
  app.get("/chain/blocks/:idOrHeight/transactions", async (c) => {
    const block = await source.getBlock(c.req.param("idOrHeight"));
    if (!block) return c.json({ error: "not found" }, 404);
    const { before, after, limit } = c.req.query();
    const query = {
      // `sizeParam`, like every other list here: capped, and never negative.
      limit: sizeParam(limit, 25),
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    };
    if (extras.chainIndex) {
      return c.json(await extras.chainIndex.listBlockTransactions(block.height, query));
    }
    // No index: fall back to the node, but bounded to a first page with an honest null cursor.
    const all = await source.getBlockTransactions(block.height);
    return c.json({ items: all.slice(0, query.limit), nextCursor: null, prevCursor: null });
  });

  app.get("/chain/transactions", async (c) => {
    const { before, after, limit, kind } = c.req.query();
    const query = {
      before: before || undefined,
      after: after || undefined,
      limit: sizeParam(limit, 25),
    };
    // The domain parser: an unknown value degrades to "all", exactly as the /txs page would.
    const parsedKind = parseTxKindFilter(kind);
    // The index when it exists, the node walk when it does not (dev without a database). Unlike the
    // address route there is a fallback, because the walk is correct, merely capped at 60 blocks,
    // so a rare kind can come back short. The index has no cap.
    const page = extras.chainIndex
      ? await extras.chainIndex.listChainTransactions(parsedKind, query)
      : await source.listTransactions(query, parsedKind);
    return c.json({
      ...page,
      /*
       * The kind this response was narrowed to, echoed so the adapter can refuse a page it did not
       * ask for. An API that did not know `?kind=shielding` would degrade it to "all" and answer
       * with every transaction under a chip reading "MIXED · SHIELDING"; no shape check can catch
       * that, an echo can.
       *
       * Always emitted, including for "all", so the adapter can tell an API that understood and was
       * asked for nothing from one too old to have the key.
       */
      applied: { kind: parsedKind },
    });
  });

  app.get("/chain/transactions/latest", async (c) =>
    c.json(await source.listLatestTransactions(sizeParam(c.req.query("count"), 10))),
  );

  app.get("/chain/transactions/:txid", async (c) => {
    // Index first, node as the fallback. The node path resolves every input by fetching the
    // transaction that created it, which does not scale. The node still answers for mempool
    // transactions, which are not in the index, and is the only path carrying rawHex.
    const txid = c.req.param("txid");
    const tx =
      (extras.chainIndex ? await extras.chainIndex.getTransaction(txid) : undefined) ??
      (await source.getTransaction(txid));
    if (!tx) return c.json({ error: "not found" }, 404);
    return c.json(tx);
  });

  app.get("/chain/addresses/:address", async (c) => {
    const address = c.req.param("address");
    // A shielded address is answered from the classifier, never the node: there is nothing to look
    // up by design, and the node's transparent-only `getaddressbalance` rejects one with an error
    // whose wording varies by address family (some read as not-found, others as a 500). Same
    // authority `/v1/addresses/:addr` and `/chain/search` consult, returning the domain
    // `ShieldedAddress`.
    const kind = classifyZcashAddress(address);
    if (kind === "sapling" || kind === "unified") return c.json({ kind, address });
    const info = await source.getAddress(address);
    if (!info) return c.json({ error: "not found" }, 404);
    return c.json(info);
  });

  app.get("/chain/addresses/:address/transactions", async (c) => {
    // Keyset from the index (io_address_idx), never the node's full txid list.
    if (!extras.chainIndex) {
      return c.json({ error: "address history requires the chain index" }, 503);
    }
    const { before, after, limit } = c.req.query();
    return c.json(
      await extras.chainIndex.listTransactions(c.req.param("address"), {
        before: before || undefined,
        after: after || undefined,
        limit: sizeParam(limit, 25),
      }),
    );
  });

  app.get("/chain/mempool/stats", async (c) => c.json(await source.getMempoolStats()));

  app.get("/chain/mempool", async (c) =>
    c.json(
      await source.listMempool(
        pageParam(c.req.query("page")),
        sizeParam(c.req.query("pageSize"), 25),
      ),
    ),
  );

  /**
   * Search resolves a raw query to whatever it turns out to be.
   *
   * Classification is the domain's `classifySearchQuery`, so search accepts exactly what the pages
   * accept. A query that classifies but matches nothing returns 404 with its `kind`, so the UI can
   * render the not-found state for that kind.
   */
  app.get("/chain/search", async (c) => {
    const query = classifySearchQuery(c.req.query("q") ?? "");

    switch (query.type) {
      case "empty":
        return c.json({ type: "empty" }, 400);

      case "height": {
        const block = await source.getBlock(String(query.height));
        return block
          ? c.json({ type: "block", block })
          : c.json({ type: "notFound", queryType: query.type }, 404);
      }

      case "hash64": {
        // A 64-hex string is ambiguous on Zcash: block hash and txid share the shape. Both are
        // tried concurrently, block first in the result because a pasted block hash is the commoner
        // case.
        const [block, tx] = await Promise.all([
          source.getBlock(query.hash),
          source.getTransaction(query.hash),
        ]);
        if (block) return c.json({ type: "block", block });
        if (tx) return c.json({ type: "transaction", transaction: tx });
        return c.json({ type: "notFound", queryType: query.type }, 404);
      }

      case "transparent-address": {
        const info = await source.getAddress(query.address);
        return info
          ? c.json({ type: "address", address: info })
          : c.json({ type: "notFound", queryType: query.type }, 404);
      }

      case "shielded-address":
        // Never looked up: a shielded address has no public history by design, so the answer is an
        // explanation rather than an empty result. 200, because the question was well-formed.
        return c.json({ type: "shielded-address", address: query.address });

      case "invalid":
      // Names are resolved by `/chain/zns/*` and by the site's own search, never here: this
      // route answers a word exactly as it did before names were classified.
      case "name":
        return c.json({ type: "invalid", query: query.query }, 404);
    }
  });

  return app;
}

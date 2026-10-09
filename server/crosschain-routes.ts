import { Hono } from "hono";
import {
  parseChainFilter,
  parseCrossChainGroupBy,
  parseDirectionFilter,
  parseMinUsdFilter,
  parseMinZecFilter,
  parseProtocolFilter,
  parseUtcDayStart,
  parseWindowDays,
} from "@/domain";
import type { CrossChainStorePort } from "./crosschain-store";
import { clampPageSize } from "./page-size";

/** ZEC arriving per source chain per month: the chart library's inflow-by-chain series. */
export const INFLOW_BY_CHAIN_PATH = "/crosschain/inflow-by-chain";
/**
 * The private cross-chain surface: the transfer list, the aggregates and the lookups the frontend
 * and the agent read.
 *
 * A separate module so tests (including the agent's) can mount the real routes and check their
 * echoes of the applied narrowing, rather than serving canned payloads.
 *
 * Mounted only on mainnet: cross-chain is a mainnet-only dataset (no venue bridges testnet ZEC).
 */

/**
 * A ceiling, not an expectation: venues batch, so one Zcash transaction can settle many crossings;
 * 25 covers the widest observed while keeping the per-view read small. The exact `total` travels
 * beside the rows, so a capped answer says how much it left out.
 */
const MAX_LEGS_PER_TX = 25;

export function crosschainRoutes(store: CrossChainStorePort): Hono {
  const app = new Hono();

  /**
   * Every narrowing this surface accepts, parsed through the domain so an unrecognised value means
   * "all" rather than reaching SQL. One function, so the list and its count read the query the same
   * way.
   */
  const narrowingFromQuery = (q: Record<string, string>) => {
    const minUsdAtSwap = parseMinUsdFilter(q.min);
    const minZecZat = parseMinZecFilter(q.minZec);
    return {
      protocol: parseProtocolFilter(q.protocol || undefined),
      direction: parseDirectionFilter(q.direction || undefined),
      sourceChains: parseChainFilter(q.source),
      destinationChains: parseChainFilter(q.destination),
      // Direction-blind, and not expressible with the two above: they AND together, so naming one
      // chain on both would be the empty set rather than "that chain at either end".
      counterpartChains: parseChainFilter(q.chain),
      // Omitted rather than null, so `minUsdAtSwap !== undefined` is the single test for "a
      // threshold was asked for".
      ...(minUsdAtSwap === null ? {} : { minUsdAtSwap }),
      ...(minZecZat === null ? {} : { minZecZat }),
    };
  };

  app.get("/crosschain/transfers", async (c) => {
    const { before, after, limit } = c.req.query();
    const parsed = Number(limit);
    const filters = narrowingFromQuery(c.req.query());
    const page = await store.list(
      {
        before: before || undefined,
        after: after || undefined,
        limit: clampPageSize(parsed, 25),
      },
      filters,
    );
    return c.json({
      ...page,
      /*
       * What was actually applied, echoed back. A filter dropped somewhere between the UI and SQL
       * still returns a well-formed (unfiltered) list, so the adapter compares this echo with what
       * it asked for and refuses a mismatch.
       */
      applied: {
        sourceChains: filters.sourceChains,
        destinationChains: filters.destinationChains,
        // `null` rather than omitted: an absent key means "an API too old to know this filter",
        // which the adapter must refuse, while an explicit null means "asked for nothing".
        minUsdAtSwap: filters.minUsdAtSwap ?? null,
        minZecZat: filters.minZecZat ?? null,
      },
    });
  });

  app.get("/crosschain/transfers-count", async (c) => {
    return c.json({ total: await store.countFiltered(narrowingFromQuery(c.req.query())) });
  });

  app.get("/crosschain/flows", async (c) => {
    const windowDays = parseWindowDays(c.req.query("days"));
    // `windowDays` comes back from the store, so it echoes what was applied rather than what was
    // asked.
    return c.json(await store.flows(windowDays));
  });

  /**
   * A narrowed slice of the crossings, totalled and grouped along one axis.
   *
   * `from`/`to` are UTC calendar days and the window is half-open (`from` inclusive, `to`
   * exclusive), so `from=2026-07-01&to=2026-08-01` is exactly July. An unparseable day is dropped
   * rather than rejected, like every filter here; the caller learns what survived from the echo,
   * which it must check.
   */
  app.get("/crosschain/aggregate", async (c) => {
    const q = c.req.query();
    const fromTimestamp = parseUtcDayStart(q.from);
    const toTimestamp = parseUtcDayStart(q.to);
    const filters = {
      ...narrowingFromQuery(q),
      ...(fromTimestamp === null ? {} : { fromTimestamp }),
      ...(toTimestamp === null ? {} : { toTimestamp }),
    };
    const groupBy = parseCrossChainGroupBy(q.groupBy);
    // `applied` comes back inside the aggregate, from the store, so it echoes what was applied. An
    // older API would ignore an unknown `?from=` and answer all-time, so a caller that asked for a
    // window and does not see it echoed must refuse the payload.
    return c.json(await store.aggregate(filters, groupBy));
  });

  app.get("/crosschain/volume", async (c) => c.json(await store.volume()));
  app.get("/crosschain/volume-series", async (c) => c.json(await store.volumeSeries()));
  app.get(INFLOW_BY_CHAIN_PATH, async (c) => c.json(await store.inflowByChain()));

  // The crossings a Zcash transaction is a leg of, for the `/tx` page's swap strip. Always 200 with
  // a list and its exact total (empty is the common answer), with the txid echoed so an adapter can
  // refuse an answer about another transaction. Malformed input is a 400, never an empty list.
  app.get("/crosschain/transfers/by-zcash-tx/:txid", async (c) => {
    const txid = c.req.param("txid").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(txid)) {
      return c.json({ error: "txid must be 64 hex characters" }, 400);
    }
    const { transfers, total } = await store.byZcashTxid(txid, MAX_LEGS_PER_TX);
    return c.json({ zcashTxid: txid, total, transfers });
  });

  app.get("/crosschain/transfers/:id", async (c) => {
    const transfer = await store.get(c.req.param("id"));
    // 404 means "no such transfer" and nothing else; a failure to reach a venue never surfaces as
    // 404.
    if (!transfer) return c.json({ error: "not found" }, 404);
    return c.json(transfer);
  });

  return app;
}

import { Hono, type Context } from "hono";
import {
  CROSSCHAIN_PROTOCOLS,
  isOneOf,
  parseUtcDayStart,
  type CrossChainDirection,
  type CrossChainNarrowing,
  type CrossChainProtocol,
} from "@/domain";
import type { CursorQuery } from "@/data/source";
import { Cached } from "../cached";
import type { CrossChainStorePort } from "../crosschain-store";
import {
  coreRouteErrors,
  cursorParams,
  errorBody,
  limitParam,
  rejectUnknownParams,
  setCache,
} from "./http";
import { ParamError } from "./params";
import { toDestinations, toFloorCoverage, toFlows, toTransfer } from "./map";

/** The venues' health, with whether each is configured here. */
export function venueHealthReader(
  store: CrossChainStorePort,
  enabledProtocols: Record<string, boolean>,
) {
  return async () => {
    // A venue is listed (in the domain's protocol list) only once it has ZEC volume to index;
    // `enabled: false` for an unindexed venue would describe our plumbing rather than ZEC's
    // cross-chain movement.
    const health = await store.health(CROSSCHAIN_PROTOCOLS, Math.floor(Date.now() / 1000));
    return health.map((v) => ({ ...v, enabled: enabledProtocols[v.protocol] ?? false }));
  };
}

export type VenueHealthReader = ReturnType<typeof venueHealthReader>;

const DIRECTIONS = ["in", "out"] as const satisfies readonly CrossChainDirection[];
const RANK_BY = ["zec", "usd"] as const;
const RANK_ORDER = ["largest", "smallest"] as const;

/** The cross-chain transfers, their ranking, per-chain flows and destination address kinds. */
export function v1CrossChainRoutes(
  store: CrossChainStorePort,
  venueHealth: VenueHealthReader,
): Hono {
  const app = new Hono();
  app.onError(coreRouteErrors);
  // The GROUP BY behind `/flows` runs at most once per ten minutes however many callers arrive.
  const flowsMemo = new Cached<Awaited<ReturnType<CrossChainStorePort["flows"]>>>(600_000);

  /**
   * Every narrowing the public transfer reads accept; a value it cannot read is a 400 naming it.
   * Shared by the list and the ranking so the two cannot read the same query differently.
   *
   * Unrecognised values are rejected rather than treated as "all", the opposite of the site's
   * own filters: on a public API a typo that silently widens the result set answers a question
   * the caller did not ask.
   */
  const narrowingParams = (c: Context): CrossChainNarrowing => {
    const { protocol, direction, chain, from, to, min, minZec } = c.req.query();
    if (protocol && !isOneOf(CROSSCHAIN_PROTOCOLS, protocol)) {
      throw new ParamError("invalid_parameter", `protocol: ${CROSSCHAIN_PROTOCOLS.join(" | ")}`);
    }
    if (direction && !isOneOf(DIRECTIONS, direction)) {
      throw new ParamError("invalid_parameter", "direction: in | out");
    }
    // One counterpart chain, matched at whichever end is not Zcash — `counterpartChains`
    // rather than the site's two directional filters, which AND together and would make
    // `chain=BTC` the empty set. Pair it with `direction` to ask about one side.
    const chains = chain ? [chain.toUpperCase()] : [];
    const window: CrossChainNarrowing = {};
    for (const [name, raw] of [
      ["from", from],
      ["to", to],
    ] as const) {
      if (!raw) continue;
      const seconds = parseUtcDayStart(raw);
      if (seconds === null) {
        throw new ParamError("invalid_parameter", `${name}: a UTC calendar day, as YYYY-MM-DD`);
      }
      // `to` is EXCLUSIVE, so `from=2026-07-01&to=2026-08-01` is exactly July and no instant
      // belongs to two windows. Documented at /api-docs, because a caller assuming an
      // inclusive edge would double-count every boundary.
      if (name === "from") window.fromTimestamp = seconds;
      else window.toTimestamp = seconds;
    }
    if (
      window.fromTimestamp !== undefined &&
      window.toTimestamp !== undefined &&
      window.toTimestamp <= window.fromTimestamp
    ) {
      throw new ParamError("invalid_parameter", "to must be after from");
    }
    if (min !== undefined) {
      const value = Number(min);
      if (!Number.isFinite(value) || value < 0) {
        throw new ParamError("invalid_parameter", "min: a USD amount, 0 or greater");
      }
      window.minUsdAtSwap = value;
    }
    if (minZec !== undefined) {
      const value = Number(minZec);
      // 21,000,000 ZEC is every coin that can ever exist; anything larger is not an amount and
      // would overflow the integer column it is compared against.
      if (!Number.isFinite(value) || value < 0 || value > 21_000_000) {
        throw new ParamError("invalid_parameter", "minZec: a ZEC amount from 0 to 21,000,000");
      }
      // Zatoshi, rounded: the column is an integer and the comparison must be too.
      window.minZecZat = Math.round(value * 1e8);
    }
    return {
      ...window,
      ...(protocol ? { protocol: protocol as CrossChainProtocol } : {}),
      ...(direction ? { direction: direction as CrossChainDirection } : {}),
      ...(chains.length > 0 ? { counterpartChains: chains } : {}),
    };
  };

  app.get("/v1/crosschain/transfers", async (c) => {
    rejectUnknownParams(c, [
      "limit",
      "cursor",
      "before",
      "after",
      "protocol",
      "direction",
      "chain",
      "from",
      "to",
      "min",
      "minZec",
    ]);

    const cursors = cursorParams(c);
    const { before, after } = cursors;
    const query: CursorQuery = {
      limit: limitParam(c.req.query("limit")),
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    };
    const filters = narrowingParams(c);

    const page = await store.list(query, filters);
    setCache(c, before || after ? "listCursored" : "listHead");
    return c.json({
      items: page.items.map(toTransfer),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
      coverage: toFloorCoverage(await venueHealth(), null, null),
    });
  });

  /**
   * The largest crossings under the same narrowing: a keyset list is ordered by time, so "the
   * biggest" may sit anywhere in it.
   *
   * Declared before `/transfers/:id`, because Hono matches in declaration order and `top` would
   * otherwise be read as a transfer id.
   *
   * Bounded rather than paginated: at most 25 rows, no cursor. A paginated ranking would be an
   * offset walk over a sorted table.
   */
  app.get("/v1/crosschain/transfers/top", async (c) => {
    rejectUnknownParams(c, [
      "limit",
      "by",
      "order",
      "protocol",
      "direction",
      "chain",
      "from",
      "to",
      "min",
      "minZec",
    ]);
    const by = c.req.query("by") ?? "zec";
    if (!isOneOf(RANK_BY, by)) throw new ParamError("invalid_parameter", "by: zec | usd");
    // Which end of the ranking. Defaults to `largest`.
    const order = c.req.query("order") ?? "largest";
    if (!isOneOf(RANK_ORDER, order)) {
      throw new ParamError("invalid_parameter", "order: largest | smallest");
    }
    const filters = narrowingParams(c);
    const limit = Math.min(Math.max(1, Math.floor(Number(c.req.query("limit") ?? 10) || 10)), 25);

    const items = await store.top(filters, by, limit, order);
    setCache(c, "aggregate");
    return c.json({
      by,
      // Echoed so a consumer can never describe the smallest crossings as the largest; an older
      // deployment omits the key, which tells a caller its `order` was ignored.
      order,
      /**
       * Always emitted, and true only for `by=usd`. Ranking on the venues' swap-time price narrows
       * the population to rows that carry one; an unpriced transfer cannot be ranked, and treating
       * its value as zero would place it last as though it were small.
       */
      basisExcludesUnpricedTransfers: by === "usd",
      items: items.map(toTransfer),
      coverage: toFloorCoverage(await venueHealth(), null, null),
    });
  });

  app.get("/v1/crosschain/transfers/:id", async (c) => {
    rejectUnknownParams(c, []);
    const transfer = await store.get(c.req.param("id"));
    if (transfer === undefined) {
      setCache(c, "rejection");
      return c.json(errorBody(c, "not_found", "no such transfer"), 404);
    }
    setCache(c, "listCursored");
    return c.json(toTransfer(transfer));
  });

  app.get("/v1/crosschain/flows", async (c) => {
    rejectUnknownParams(c, []);
    // The GROUP BY runs at most once per ten minutes no matter how many callers arrive.
    const summary = await flowsMemo.get(() => store.flows());
    setCache(c, "aggregate");
    return c.json(toFlows(summary, await venueHealth()));
  });

  app.get("/v1/crosschain/destinations", async (c) => {
    rejectUnknownParams(c, ["direction"]);
    const direction = c.req.query("direction") ?? "in";
    if (!isOneOf(DIRECTIONS, direction)) {
      throw new ParamError("invalid_parameter", "direction: in | out");
    }
    const buckets = await store.countByAddressKind(direction);
    setCache(c, "aggregate");
    return c.json(toDestinations(direction, buckets, await venueHealth()));
  });
  return app;
}

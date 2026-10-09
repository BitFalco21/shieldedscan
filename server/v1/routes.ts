import { Hono, type Context } from "hono";
import type { Pool } from "pg";
import type { CrossChainStorePort } from "../crosschain-store";
import { getReorgSummary, listReorgEvents } from "../reorg-routes";
import { loadMonthlySeries } from "../analytics-routes";
import { Cached } from "../cached";
import {
  loadLabelledBalances,
  loadRichListPage,
  loadRichListSummary,
  loadHalvingEvents,
  observedBlockIntervalSeconds,
  richListComputedHeight,
  richListStanding,
} from "../network-routes";
import {
  blockSummaryOf,
  classifySearchQuery,
  classifyZcashAddress,
  decodeUnifiedAddress,
  nextHalvingHeight,
  ADDRESS_LABELS,
  type AddressInfo,
  type Block,
  type MempoolStats,
  type SupplyBreakdown,
  type Transaction,
  type TransparentAddress,
  type UnifiedReceiver,
} from "@/domain";
import type {
  V1Address,
  V1ChainInfo,
  V1Fees,
  V1Halving,
  V1Labels,
  V1RichListPage,
  V1SearchResult,
  V1Status,
  V1UnifiedReceiver,
  V1Unknowns,
} from "./dto";
import {
  coreRouteErrors,
  cursorParams,
  errorBody,
  limitParam,
  rejectUnknownParams,
  setCache,
  upstreamDown,
  v1Middleware,
} from "./http";
import { lifetimeTxCount } from "../address-counts";
import { blockRowsReader, type BlockRowsReader } from "../block-list";
import type { RpcBlockSubsidy } from "../node-rpc";
import type { ChainIndexStore } from "../chain-index-store";
import { ByteBudget, RAW_HEX_BURST_BYTES, RAW_HEX_BYTES_PER_SECOND } from "./byte-budget";
import { ParamError, parseAtParam, parseDayWindow, parsePoolParam } from "./params";
import { v1ReferenceRoutes } from "./reference";
import { v1DescriptorRoutes } from "./descriptor";
import { v1PriceRoutes } from "./prices";
import { v1CrossChainRoutes, venueHealthReader } from "./crosschain";
import { encodeCursor } from "@/data/cursor";
import {
  toMempoolSummary,
  toMonthly,
  toReorgEvent,
  toReorgSummary,
  toSupply,
  toTransactionPrivacy,
  toCirculating,
  toHalving,
  toTransactionListItem,
  toBlock,
  toTransactionDetail,
  toRichListEntry,
  toRichListDistribution,
  toLabels,
} from "./map";

/**
 * The public, keyless /v1 surface.
 *
 * Listed in `server/public-paths.ts`, so the default-deny token gate lets it through by design.
 * Rate limiting lives in Caddy (path-scoped zones) plus the in-process single-flight memos here,
 * which still bound the node's load if the proxy is misconfigured.
 *
 * Every route is a thin parse → port-call → map → serialise. The contract lives in dto.ts and
 * the meeting point with the domain in map.ts.
 */

/** What /v1 needs from the node-backed source — a subset of NodeChainSource. */
export interface V1ChainPort {
  getChainFacts(): Promise<{
    height: number;
    bestBlockHash: string;
    lastBlockTimestamp: number;
    circulatingSupplyZat: number;
  }>;
  getSupplyBreakdown(): Promise<SupplyBreakdown>;
  getTransaction(txid: string): Promise<Transaction | undefined>;
  /**
   * The raw hex alone, with no input resolution: `undefined` for an unknown txid, `null` when the
   * node returned no hex. `getTransaction` resolves every input by fetching its source
   * transaction, which on a transaction with thousands of inputs holds gigabytes of JSON; the
   * index already holds the inputs, so the node is asked only for the bytes it alone has.
   */
  getRawTransactionHex?(txid: string): Promise<string | null | undefined>;
  getMempoolStats(): Promise<MempoolStats>;
  /** The tip's height and hash from one read — what the block list pages against. */
  getTip(): Promise<{ height: number; hash: string }>;
  /** The node's half of the block list: `top` down, one `getblock` each (`block-list.ts`). */
  blocksDescending(top: number, count: number): Promise<Block[]>;
  getBlock(idOrHeight: string): Promise<Block | undefined>;
  getBlockTransactions(height: number): Promise<Transaction[]>;
  getAddress(address: string): Promise<AddressInfo | undefined>;
  /**
   * Balance, received and sent without the transaction list (the count comes from the index).
   * The list is the node's unpaginated `getaddresstxids`, which for the busiest addresses takes
   * seconds and can exceed the RPC response limit. Optional: a source without it falls back to
   * `getAddress`.
   */
  getAddressBalance?(address: string): Promise<Omit<TransparentAddress, "txids"> | undefined>;
  /**
   * The node's own `getblocksubsidy`. The stream arrays are absent when no stream is active at
   * that height: before Canopy, and again once ZIP 214 revision 2's range ends at the halving.
   */
  getBlockSubsidy(height: number): Promise<RpcBlockSubsidy>;
}

export interface V1Extras {
  price?: { current(): { usd: number; change24hPct: number | null } | null };
  stats24h?: { current(): { txCount24h: number; fullyShieldedPct24h: number } | null };
}

/**
 * The live facts `/v1/status` and `/v1/chain` both publish, assembled once so the two cannot
 * drift. Nullable keys are always emitted, null when unmeasured and with an `unknowns` reason;
 * an omitted key behaves differently from an explicit null under a spread.
 */
function liveFacts(extras: V1Extras | undefined) {
  const price = extras?.price?.current() ?? null;
  const stats = extras?.stats24h?.current() ?? null;
  const unknowns: V1Unknowns = {};
  if (!price) {
    unknowns["priceUsd"] = "unmeasured";
    unknowns["priceChange24hPct"] = "unmeasured";
  } else if (price.change24hPct === null) {
    unknowns["priceChange24hPct"] = "unmeasured";
  }
  if (!stats) {
    unknowns["txCount24h"] = "unmeasured";
    unknowns["fullyShieldedPct24h"] = "unmeasured";
  }
  return {
    stats,
    unknowns,
    fields: {
      priceUsd: price?.usd ?? null,
      priceChange24hPct: price?.change24hPct ?? null,
      txCount24h: stats?.txCount24h ?? null,
    },
  };
}

export interface V1Deps {
  chain?: V1ChainPort;
  store: CrossChainStorePort;
  /** Postgres for reorgs + monthly series; absent means those endpoints answer 503. */
  pool?: Pool;
  extras?: V1Extras;
  /** Which venues are configured, for coverage objects. */
  enabledProtocols: Record<string, boolean>;
  /** The follower's poll cadence, stated in the reorg scope. */
  reorgPollSeconds?: number;
  /**
   * The chain index, for the transaction list. A node walk cannot back a public filtered list
   * (a page could hold fewer than `limit` items with a cursor still set), so absent → 503.
   */
  chainIndex?: ChainIndexStore;
  /**
   * Route groups published under `/v1` beside the core: the windowed analytics, the daily
   * series, the node map, mining terms and the address windows. Mounted inside this subtree so
   * its middleware and 404 apply; each names the endpoints it serves so the descriptor lists
   * exactly what is mounted.
   */
  extensions?: readonly V1Extension[];
  /** The `include=raw` byte budget; see `ByteBudget`. Injected by tests, defaulted otherwise. */
  rawHexBudget?: ByteBudget;
  /**
   * The block list, the same implementation `/chain/blocks` serves (`block-list.ts`). Built from
   * `chain` and `chainIndex` when absent; injected by tests.
   */
  blockRows?: BlockRowsReader;
}

export interface V1Extension {
  routes: Hono;
  /** Path templates as the descriptor lists them, e.g. `/v1/addresses/{address}/activity`. */
  endpoints: readonly string[];
}

const TXID_SHAPE = /^[0-9a-fA-F]{64}$/;
/** Swap legs one transaction may list — the transaction page's own bound. */
const MAX_SWAP_LEGS = 25;

/**
 * What `?kind=` accepts on `/v1/transactions`.
 *
 * A literal rather than `TX_KIND_FILTERS` from `domain/list.ts`: these strings are a published
 * contract, so a domain rename must never change what a caller may send. `v1-routes.test.ts`
 * pins that the two lists describe the same rows.
 *
 * `shielding` and `unshielding` are sub-cases of `mixed` (a transaction touching both a
 * transparent address and a shielded pool), narrowed by which way the value crossed, and are
 * served by `tx_direction_keyset_idx`.
 *
 * `all` is the default; it is accepted but not listed in the 400, which names the values that
 * narrow.
 */
const V1_TX_KINDS = [
  "all",
  "transparent",
  "shielded",
  "mixed",
  "shielding",
  "unshielding",
  "coinbase",
] as const;

type V1TxKindParam = (typeof V1_TX_KINDS)[number];

/** The 400's vocabulary, derived so it can never fall behind the list it describes. */
const V1_TX_KIND_LIST = V1_TX_KINDS.filter((kind) => kind !== "all").join(" | ");

/**
 * One unified-address receiver on the wire. Orchard has no standalone address form — a unified
 * address is its only encoding — so its `address` is null and says why, never raw bytes dressed
 * as an address (a string that fails when pasted into a wallet must not look like one).
 */
function toV1Receiver(r: UnifiedReceiver): V1UnifiedReceiver {
  switch (r.kind) {
    case "orchard":
      return {
        type: "orchard",
        address: null,
        note: "The Orchard-protocol receiver (ZIP 316). It has no standalone address form. Since NU6.3, new shielded value sent to it enters the Ironwood pool, not Orchard (ZIP 326).",
      };
    case "sapling":
      return { type: "sapling", address: r.address };
    case "p2pkh":
    case "p2sh":
      return { type: `transparent-${r.kind}`, address: r.address };
    default:
      return { type: "unknown", address: null, typecode: r.typecode };
  }
}

export function v1Routes(deps: V1Deps): Hono {
  const app = new Hono();
  const blockRows =
    deps.blockRows ??
    (deps.chain
      ? blockRowsReader({
          node: deps.chain,
          ...(deps.chainIndex ? { index: deps.chainIndex } : {}),
        })
      : null);
  // Both subsidies move once per ~2.5 years; 60s keeps the countdown fresh off one memo.
  const halvingMemo = new Cached<V1Halving>(60_000);
  for (const middleware of v1Middleware()) app.use("/v1/*", middleware);
  app.use("/v1", ...v1Middleware());

  const venueHealth = venueHealthReader(deps.store, deps.enabledProtocols);

  /**
   * Whether a txid names a transaction, the only thing search needs, so nothing is resolved.
   * Resolving inputs through the node costs thousands of calls on a wide transaction. The index
   * answers a confirmed transaction in one primary-key read; the node's raw-bytes call (which
   * resolves nothing) answers the mempool and anything newer than the index.
   */
  const transactionExists = async (chain: V1ChainPort, txid: string): Promise<boolean> => {
    if (deps.chainIndex && (await deps.chainIndex.txBlocks([txid])).has(txid)) return true;
    if (chain.getRawTransactionHex) return (await chain.getRawTransactionHex(txid)) !== undefined;
    return (await chain.getTransaction(txid)) !== undefined;
  };
  // One per app: every caller of `include=raw` draws on the same bytes.
  const rawHexBudget =
    deps.rawHexBudget ?? new ByteBudget(RAW_HEX_BURST_BYTES, RAW_HEX_BYTES_PER_SECOND);
  const noChainSource = (c: Context) =>
    c.json(errorBody(c, "upstream_unavailable", "no chain source"), 503);
  const noChainIndex = (c: Context) =>
    c.json(errorBody(c, "upstream_unavailable", "the chain index is not configured"), 503);
  const rawHexBusy = (c: Context, seconds: number) => {
    c.header("Retry-After", String(seconds));
    return c.json(
      errorBody(
        c,
        "upstream_unavailable",
        `busy: raw transaction bytes are shared by all callers (about 1 MB a second); retry in ${seconds} s, or ask without include=raw`,
      ),
      503,
    );
  };
  const mempoolMemo = new Cached<MempoolStats>(10_000);
  const monthlyMemo = new Cached<Awaited<ReturnType<typeof loadMonthlySeries>>>(600_000);

  app.route("/", v1DescriptorRoutes((deps.extensions ?? []).flatMap((e) => e.endpoints)));

  // ---------------------------------------------------------------------------- status

  app.get("/v1/status", async (c) => {
    rejectUnknownParams(c, []);
    if (!deps.chain) return upstreamDown(c, "the chain source");

    const facts = await deps.chain.getChainFacts();
    const { stats, unknowns, fields } = liveFacts(deps.extras);

    setCache(c, "tip");
    return c.json({
      ...facts,
      ...fields,
      fullyShieldedPct24h:
        stats === null
          ? null
          : {
              pct: stats.fullyShieldedPct24h,
              numerator: Math.round((stats.fullyShieldedPct24h / 100) * stats.txCount24h),
              denominator: stats.txCount24h,
            },
      crosschain: {
        venues: (await venueHealth()).map(({ protocol, enabled, live }) => ({
          protocol,
          enabled,
          live,
        })),
      },
      ...(Object.keys(unknowns).length ? { unknowns } : {}),
      asOf: Math.floor(Date.now() / 1000),
    } satisfies V1Status);
  });

  // ---------------------------------------------------------------------------- supply

  app.get("/v1/supply", async (c) => {
    rejectUnknownParams(c, []);
    if (!deps.chain) return upstreamDown(c, "the chain source");
    const breakdown = await deps.chain.getSupplyBreakdown();
    // Six value pools partition the supply; fewer reported means the node withheld some
    // and the partition cannot claim to sum.
    setCache(c, "tip");
    return c.json(toSupply(breakdown, breakdown.pools.length === 6));
  });

  // The aggregator feed: CoinGecko-style consumers want a bare decimal over plain text.
  // Circulating = mined minus the lockbox — mined-but-unspendable is not circulating, and
  // the JSON form names the exclusion so the choice is visible rather than implied.
  app.get("/v1/supply/circulating", async (c) => {
    rejectUnknownParams(c, ["format"]);
    if (!deps.chain) return upstreamDown(c, "the chain source");
    const breakdown = await deps.chain.getSupplyBreakdown();
    const body = toCirculating(breakdown);
    setCache(c, "tip");
    if (c.req.query("format") === "json") return c.json(body);
    return c.text(body.circulatingZec);
  });

  app.route("/", v1PriceRoutes(deps.pool));

  // ------------------------------------------------------------------------- network

  // ZIP-317 conventional fees are protocol convention, not a mempool estimate. The worked
  // migration example is a real mainnet transaction.
  app.get("/v1/network/fees", (c) => {
    rejectUnknownParams(c, []);
    setCache(c, "descriptor");
    return c.json({
      standard: "ZIP-317 conventional fee",
      marginalFeeZat: 5000,
      graceActions: 2,
      formula: "conventionalFeeZat = marginalFeeZat * max(graceActions, logicalActions)",
      logicalActions:
        "ceil(transparent input bytes / 150) or ceil(transparent output bytes / 34), whichever is larger, + 2 per Sprout joinsplit + max(Sapling spends, Sapling outputs) + Orchard actions + Ironwood actions",
      examples: [
        {
          description: "typical fully shielded transaction (2 actions)",
          logicalActions: 2,
          conventionalFeeZat: 10000,
        },
        {
          description:
            "observed Orchard-to-Ironwood turnstile migration, mainnet block 3,428,150 (4 Orchard + 2 Ironwood actions)",
          logicalActions: 6,
          conventionalFeeZat: 30000,
        },
      ],
      notes: [
        "wallets pay the conventional fee by default since ZIP-317; paying less risks eviction under mempool pressure",
        "Ironwood actions counting as logical actions is verified against the captured migration above: 6 x 5,000 = the 30,000 zat it actually paid",
      ],
      asOf: Math.floor(Date.now() / 1000),
    } satisfies V1Fees);
  });

  // Countdown is arithmetic off the tip; both subsidies come from the node's own
  // getblocksubsidy, never recomputed here (the schedule spans two halvings and Blossom's
  // block-time change). The next halving is derived from the tip, so it moves on once passed.
  app.get("/v1/network/halving", async (c) => {
    rejectUnknownParams(c, []);
    if (!deps.chain) return upstreamDown(c, "the chain source");
    const chain = deps.chain;
    const body = await halvingMemo.get(async () => {
      const facts = await chain.getChainFacts();
      const nextHeight = nextHalvingHeight(facts.height);
      const [current, next, interval, events] = await Promise.all([
        chain.getBlockSubsidy(facts.height),
        chain.getBlockSubsidy(nextHeight),
        // The observed block interval, shared with `/chain/network/halving` so the two
        // surfaces cannot publish different dates for the same event. Absent Postgres this
        // is 0 and the estimate falls back to the consensus target, as it always did.
        deps.pool ? observedBlockIntervalSeconds(deps.pool).catch(() => 0) : Promise.resolve(0),
        // The same list the page renders, from the same function — so the two surfaces
        // cannot disagree about when a halving happened. Without Postgres the events keep
        // their heights and subsidies and lose only their timestamps.
        loadHalvingEvents(chain, deps.pool, facts.height),
      ]);
      return toHalving(facts.height, nextHeight, current, next, interval, events);
    });
    setCache(c, "tip");
    return c.json(body);
  });

  // ----------------------------------------- chain, blocks, transactions and addresses

  app.get("/v1/chain", async (c) => {
    rejectUnknownParams(c, []);
    if (!deps.chain) return noChainSource(c);
    const facts = await deps.chain.getChainFacts();
    const { stats, unknowns, fields } = liveFacts(deps.extras);
    setCache(c, "tip");
    return c.json({
      ...facts,
      ...fields,
      // A bare number here where `/v1/status` publishes `{pct, numerator, denominator}`;
      // kept as is because it is a published shape.
      fullyShieldedPct24h: stats?.fullyShieldedPct24h ?? null,
      ...(Object.keys(unknowns).length ? { unknowns } : {}),
      asOf: Math.floor(Date.now() / 1000),
    } satisfies V1ChainInfo);
  });

  app.get("/v1/blocks", async (c) => {
    rejectUnknownParams(c, ["limit", "cursor", "before", "after", "at"]);
    const cursors = cursorParams(c);
    /*
     * `at` turns a time into a starting point: the page opens at the newest block at or before
     * that instant and walks back. It resolves to a cursor and reuses the list, since a caller
     * cannot build the opaque cursor itself.
     */
    const atRaw = c.req.query("at");
    let atTs: number | null = null;
    if (atRaw !== undefined) {
      if (cursors.before || cursors.after) {
        throw new ParamError("invalid_parameter", "at cannot be combined with a cursor");
      }
      atTs = parseAtParam(atRaw);
      if (atTs === null) {
        throw new ParamError(
          "invalid_parameter",
          "at: YYYY-MM-DD (the end of that UTC day), YYYY-MM-DDTHH:MM:SSZ, or unix seconds",
        );
      }
    }
    if (!deps.chain || !blockRows) {
      return noChainSource(c);
    }
    let { before } = cursors;
    const { after } = cursors;
    let atHeight: number | null = null;
    if (atTs !== null) {
      if (!deps.chainIndex) {
        return noChainIndex(c);
      }
      atHeight = await deps.chainIndex.heightAtOrBefore(atTs);
      if (atHeight === null) {
        setCache(c, "listCursored");
        return c.json({
          items: [],
          nextCursor: null,
          prevCursor: null,
          at: { time: atTs, height: null },
          asOf: Math.floor(Date.now() / 1000),
        });
      }
      before = encodeCursor(atHeight + 1, String(atHeight + 1));
    }
    const query = {
      limit: limitParam(c.req.query("limit")),
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    };
    /*
     * The site's block list (`block-list.ts`): rows from the index, with the node answering the
     * newest blocks the follower has not stored yet and any page the index cannot state exactly.
     * Only the index states a block's fee.
     */
    const page = await blockRows(query);
    const fees = page.feesStated ? "stated" : "omitted";
    setCache(c, before || after ? "listCursored" : "listHead");
    return c.json({
      items: page.items.map((row) => toBlock(row, fees)),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
      ...(atTs !== null ? { at: { time: atTs, height: atHeight } } : {}),
      asOf: Math.floor(Date.now() / 1000),
    });
  });

  app.get("/v1/blocks/:id", async (c) => {
    rejectUnknownParams(c, []);
    if (!deps.chain) return noChainSource(c);
    const block = await deps.chain.getBlock(c.req.param("id"));
    if (!block) return c.json(errorBody(c, "not_found", "no such block"), 404);
    setCache(c, "aggregate");
    return c.json({
      ...toBlock(blockSummaryOf(block), "stated"),
      asOf: Math.floor(Date.now() / 1000),
    });
  });

  app.get("/v1/blocks/:id/transactions", async (c) => {
    rejectUnknownParams(c, ["limit", "cursor", "before", "after", "pool"]);
    const pool = parsePoolParam(c.req.query("pool"));
    if (!deps.chain) return noChainSource(c);
    if (!deps.chainIndex) {
      return noChainIndex(c);
    }
    // Resolve hash-or-height through getBlock so both forms work; the index pages by height.
    const block = await deps.chain.getBlock(c.req.param("id"));
    if (!block) return c.json(errorBody(c, "not_found", "no such block"), 404);
    const cursors = cursorParams(c);
    const { before, after } = cursors;
    const page = await deps.chainIndex.listBlockTransactions(
      block.height,
      {
        limit: limitParam(c.req.query("limit")),
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
      },
      pool ? { pool } : {},
    );
    setCache(c, "aggregate");
    return c.json({
      items: page.items.map(toTransactionListItem),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
      asOf: Math.floor(Date.now() / 1000),
    });
  });

  app.get("/v1/transactions/:txid", async (c) => {
    rejectUnknownParams(c, ["include", "inputsFrom", "outputsFrom"]);
    if (!deps.chain) return noChainSource(c);
    const include = c.req.query("include");
    if (include !== undefined && include !== "raw") {
      throw new ParamError("invalid_parameter", "include: raw");
    }
    const txid = c.req.param("txid");
    /*
     * The index first: it holds every input already resolved, so a confirmed transaction is one
     * indexed query, and for `include=raw` the node is asked only for the hex (which resolves
     * nothing). The node's full walk is the fallback for a mempool transaction and for a chain
     * source without `getRawTransactionHex`. Beside it, the swaps this transaction is the Zcash leg
     * of: a store that cannot answer costs that field, not the page.
     */
    const [indexed, crossings] = await Promise.all([
      deps.chainIndex ? deps.chainIndex.getTransaction(txid) : undefined,
      TXID_SHAPE.test(txid)
        ? Promise.resolve()
            .then(() => deps.store.byZcashTxid(txid.toLowerCase(), MAX_SWAP_LEGS))
            .catch(() => null)
        : null,
    ]);
    let tx = indexed;
    if (indexed && include === "raw") {
      // The hex is exactly twice the size the index stores, so its bytes are reserved before the
      // node is asked for them: a spent budget costs the node nothing.
      const wait = rawHexBudget.reserve(indexed.sizeBytes * 2);
      if (wait > 0) return rawHexBusy(c, wait);
      const hex = deps.chain.getRawTransactionHex
        ? await deps.chain.getRawTransactionHex(txid)
        : undefined;
      tx = hex === undefined ? undefined : { ...indexed, rawHex: hex };
    }
    if (!tx) {
      tx = await deps.chain.getTransaction(txid);
      // The node path (a mempool transaction): the size is known only once the node has answered.
      if (tx && include === "raw" && tx.rawHex) {
        const wait = rawHexBudget.reserve(tx.rawHex.length);
        if (wait > 0) return rawHexBusy(c, wait);
      }
    }
    if (!tx) return c.json(errorBody(c, "not_found", "no such transaction"), 404);
    setCache(c, "aggregate");
    /*
     * Ordinal offsets into one immutable transaction, the single place this API uses an offset.
     * It is exact: a confirmed transaction's input at ordinal 1,000 is the same input on every
     * request, so nothing can shift beneath it the way rows in a chain-ordered list can.
     */
    const offset = (raw: string | undefined): number | undefined => {
      if (raw === undefined) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
    };
    return c.json(
      toTransactionDetail(
        tx,
        include === "raw",
        {
          inputsFrom: offset(c.req.query("inputsFrom")),
          outputsFrom: offset(c.req.query("outputsFrom")),
        },
        crossings,
      ),
    );
  });

  app.get("/v1/addresses/:addr", async (c) => {
    rejectUnknownParams(c, []);
    const addr = c.req.param("addr");
    const cls = classifyZcashAddress(addr);
    if (cls === "sapling" || cls === "unified") {
      // 200, deliberately: the address is real and this is the true answer about it. No
      // balance key at all — a null would still imply a balance exists to look up.
      setCache(c, "descriptor");
      const note =
        "This is a shielded address. Its balance and history are encrypted on-chain — " +
        "not hidden by this API, but by the protocol. There is nothing to look up, " +
        "and no viewing-key facility exists here by design.";
      if (cls === "sapling") {
        return c.json({
          kind: cls,
          address: addr,
          note,
          asOf: Math.floor(Date.now() / 1000),
        } satisfies V1Address);
      }
      /*
       * A unified address's receivers are public by construction (they are the address string),
       * decoded by the same ZIP 316 implementation the address page uses. Which receiver a payment
       * used stays private. An address that does not decode gets null, never a partial list.
       */
      const decoded = decodeUnifiedAddress(addr);
      const unknowns: V1Unknowns = {};
      const receivers = decoded?.receivers.map((r, i) => {
        const out = toV1Receiver(r);
        if (out.address === null) unknowns[`receivers.${i}.address`] = "nonexistent";
        return out;
      });
      if (!decoded) unknowns.receivers = "indeterminate";
      return c.json({
        kind: cls,
        address: addr,
        network: decoded?.network ?? null,
        receivers: receivers ?? null,
        receiversNote:
          "Which receiver a payment used is not public. A sender's wallet picks one; nothing on-chain says which.",
        note,
        ...(Object.keys(unknowns).length > 0 ? { unknowns } : {}),
        asOf: Math.floor(Date.now() / 1000),
      } satisfies V1Address);
    }
    if (!deps.chain) return noChainSource(c);
    const info = deps.chain.getAddressBalance
      ? await deps.chain.getAddressBalance(addr)
      : await deps.chain.getAddress(addr);
    if (!info || info.kind !== "transparent") {
      return c.json(errorBody(c, "not_found", "no such address"), 404);
    }
    /*
     * The rich-list standing rides alongside the balance and its absence never fails the lookup:
     * without Postgres the address still answers, with these figures null and a reason beside them.
     */
    const [standing, extent, txCount] = await Promise.all([
      deps.pool ? richListStanding(deps.pool, info.address).catch(() => null) : null,
      // When the address first and last appears on-chain: two index probes. Inside a promise
      // chain, so any failure costs the two fields and never the lookup.
      deps.chainIndex
        ? Promise.resolve()
            .then(() => deps.chainIndex!.addressActivityExtent(info.address))
            .catch(() => null)
        : null,
      // The transaction count for EVERY address, emptied ones included, exact through the newest
      // block — the one reader `/activity` and `/extremes` share (`address-counts.ts`).
      deps.pool ? lifetimeTxCount(deps.pool, info.address).catch(() => null) : null,
    ]);
    const unknowns: V1Unknowns = {};
    // Absent means the index could not say — not yet indexed, or unreachable — never "never".
    if (extent?.first == null) unknowns.firstSeen = "unmeasured";
    if (extent?.last == null) unknowns.lastSeen = "unmeasured";
    if (standing === null) {
      // We could not read the list. NOT `nonexistent`, which would state that this address
      // holds nothing — an outage of ours dressed as a fact about the chain.
      unknowns.rank = "unmeasured";
    } else if (standing.rank === null) {
      // No row means a zero balance, and a zero-balance address is deleted from the list by
      // construction — so it is genuinely on no rich list. That is an answer.
      unknowns.rank = standing.onList ? "unmeasured" : "nonexistent";
    }
    if (txCount === null) unknowns.txCount = "unmeasured";
    setCache(c, "tip");
    return c.json({
      kind: "transparent",
      address: info.address,
      balanceZat: info.balanceZat,
      totalReceivedZat: info.totalReceivedZat,
      totalSentZat: info.totalSentZat,
      // Nullable keys are always emitted: an absent key and an explicit null behave oppositely
      // under a spread.
      rank: standing?.rank ?? null,
      txCount,
      // 0 means the rich list has never been refreshed here; that is not a height.
      rankAsOfHeight: standing && standing.computedHeight > 0 ? standing.computedHeight : null,
      firstSeen: extent?.first ?? null,
      lastSeen: extent?.last ?? null,
      ...(Object.keys(unknowns).length > 0 ? { unknowns } : {}),
      asOf: Math.floor(Date.now() / 1000),
    } satisfies V1Address);
  });

  app.get("/v1/addresses/:addr/transactions", async (c) => {
    rejectUnknownParams(c, ["limit", "cursor", "before", "after"]);
    if (!deps.chainIndex) {
      return noChainIndex(c);
    }
    const cursors = cursorParams(c);
    const { before, after } = cursors;
    const page = await deps.chainIndex.listTransactions(c.req.param("addr"), {
      limit: limitParam(c.req.query("limit")),
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    });
    setCache(c, before || after ? "listCursored" : "listHead");
    return c.json({
      items: page.items.map(toTransactionListItem),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
      asOf: Math.floor(Date.now() / 1000),
    });
  });

  // ------------------------------------------------------------------------- rich list

  /**
   * The transparent rich list: every address holding ZEC, largest first.
   *
   * Mounted at `/v1/rich-list` rather than under `/v1/addresses/`, which already carries the
   * `:addr` parameter route; a contract whose resolution depends on registration order is a trap.
   *
   * The keyset lives in `loadRichListPage`, shared with the private route the site renders.
   */
  app.get("/v1/rich-list", async (c) => {
    rejectUnknownParams(c, ["limit", "cursor", "before", "after"]);
    if (!deps.pool) return upstreamDown(c, "the rich list");
    const cursors = cursorParams(c);
    const { before, after } = cursors;
    // The height the balances cover travels with the page: a caller has no other way to
    // learn it, and stamping the tip on hour-old figures would date them to a height they
    // were never computed at.
    const [page, height] = await Promise.all([
      loadRichListPage(deps.pool, {
        limit: limitParam(c.req.query("limit")),
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
      }),
      richListComputedHeight(deps.pool),
    ]);
    // `aggregate` rather than a list class: this view is rebuilt hourly, so it is neither
    // tip-coupled nor immutable, and claiming either would be a lie about freshness.
    setCache(c, "aggregate");
    return c.json({
      items: page.items.map(toRichListEntry),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
      height,
      asOf: Math.floor(Date.now() / 1000),
    } satisfies V1RichListPage);
  });

  /** How transparent value is spread across addresses: bands, top-holder shares, totals. */
  app.get("/v1/rich-list/distribution", async (c) => {
    rejectUnknownParams(c, []);
    if (!deps.pool) return upstreamDown(c, "the rich list");
    setCache(c, "aggregate");
    return c.json(toRichListDistribution(await loadRichListSummary(deps.pool)));
  });

  /**
   * Every address this explorer names, with whose claim each name is, its current balance and its
   * rank. No parameters: the set is the label table, 45 rows, one indexed read. The names leave
   * this API only here, beside their source and a notice that travels on every response.
   */
  app.get("/v1/labels", async (c) => {
    rejectUnknownParams(c, []);
    if (!deps.pool) return upstreamDown(c, "the labelled-address balances");
    const balances = await loadLabelledBalances(deps.pool, Object.keys(ADDRESS_LABELS));
    // `aggregate`: the balances move with the chain and the ranks hourly, so neither tip-coupled
    // nor immutable.
    setCache(c, "aggregate");
    return c.json(
      toLabels(balances, ADDRESS_LABELS, Math.floor(Date.now() / 1000)) satisfies V1Labels,
    );
  });

  app.get("/v1/search", async (c) => {
    rejectUnknownParams(c, ["q"]);
    const q = c.req.query("q") ?? "";
    const query = classifySearchQuery(q);
    if (query.type === "empty") throw new ParamError("invalid_parameter", "q required");
    if (!deps.chain) return noChainSource(c);
    const asOf = Math.floor(Date.now() / 1000);
    const answer = (resolvesTo: V1SearchResult["resolvesTo"]): V1SearchResult => ({
      query: q,
      resolvesTo,
      asOf,
    });
    // Identifiers only — the resolved object lives at its own endpoint. Same classifier the
    // site's own search uses, so the two can never disagree about what a txid looks like.
    if (query.type === "height") {
      const block = await deps.chain.getBlock(String(query.height));
      setCache(c, "aggregate");
      return c.json(
        answer(block ? { type: "block", height: block.height, hash: block.hash } : null),
      );
    }
    if (query.type === "hash64") {
      const [block, txFound] = await Promise.all([
        deps.chain.getBlock(query.hash),
        transactionExists(deps.chain, query.hash),
      ]);
      setCache(c, "aggregate");
      if (block) return c.json(answer({ type: "block", height: block.height, hash: block.hash }));
      if (txFound) return c.json(answer({ type: "transaction", txid: query.hash }));
      return c.json(answer(null));
    }
    if (query.type === "transparent-address" || query.type === "shielded-address") {
      setCache(c, "aggregate");
      return c.json(
        answer({
          type: "address",
          address: query.address,
          kind: classifyZcashAddress(query.address),
        }),
      );
    }
    setCache(c, "aggregate");
    return c.json(answer(null));
  });

  app.get("/v1/transactions", async (c) => {
    rejectUnknownParams(c, ["limit", "cursor", "before", "after", "kind", "pool", "from", "to"]);
    const kind = c.req.query("kind") ?? "all";
    // Rejected, not widened: everywhere else on this site an unknown filter value degrades
    // to "all", but on a public API a typo silently widening the result set is worse.
    if (!(V1_TX_KINDS as readonly string[]).includes(kind)) {
      throw new ParamError("invalid_parameter", `kind: ${V1_TX_KIND_LIST}`);
    }
    /*
     * The pool a transaction used, and a window of UTC days. Each pool has a partial index this
     * filter seeks.
     */
    const pool = parsePoolParam(c.req.query("pool"));
    if (pool && kind === "transparent") {
      // A question the model forbids, so a 400 rather than a page that can only ever be empty.
      throw new ParamError("invalid_parameter", "a transparent transaction uses no shielded pool");
    }
    const window = parseDayWindow(c.req.query("from"), c.req.query("to"));
    const cursors = cursorParams(c);
    if (!deps.chainIndex) {
      return noChainIndex(c);
    }
    const { before, after } = cursors;
    const page = await deps.chainIndex.listChainTransactions(
      kind as V1TxKindParam,
      {
        limit: limitParam(c.req.query("limit")),
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
      },
      { ...(pool ? { pool } : {}), ...window },
    );
    setCache(c, before || after ? "listCursored" : "listHead");
    // No total, like every keyset page on this API.
    return c.json({
      items: page.items.map(toTransactionListItem),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
      // What was applied, so a caller can see its narrowing survived — an unfiltered list is
      // a well-formed list, which is the one failure a filter cannot reveal by itself.
      filters: {
        kind,
        pool: pool ?? null,
        from: c.req.query("from") || null,
        to: c.req.query("to") || null,
      },
      asOf: Math.floor(Date.now() / 1000),
    });
  });

  app.get("/v1/transactions/:txid/privacy", async (c) => {
    rejectUnknownParams(c, []);
    if (!deps.chain) return upstreamDown(c, "the chain source");

    const txid = c.req.param("txid");
    if (!TXID_SHAPE.test(txid)) {
      throw new ParamError(
        "invalid_parameter",
        "a txid is 64 hexadecimal characters",
        "descriptor",
      );
    }
    /*
     * Index first, the node only for a mempool transaction: resolving every input through the
     * node holds all source transactions in memory at once, which a wide transaction turns into an
     * out-of-memory crash on a keyless URL.
     */
    const lower = txid.toLowerCase();
    const tx =
      (deps.chainIndex ? await deps.chainIndex.getTransaction(lower) : undefined) ??
      (await deps.chain.getTransaction(lower));
    if (tx === undefined) {
      setCache(c, "rejection");
      return c.json(errorBody(c, "not_found", "no such transaction on this chain"), 404);
    }
    setCache(c, tx.blockHeight === null ? "mempool" : "reorgable");
    return c.json(toTransactionPrivacy(tx));
  });

  app.route("/", v1CrossChainRoutes(deps.store, venueHealth));

  // ---------------------------------------------------------------------------- reorgs

  app.get("/v1/reorgs", async (c) => {
    rejectUnknownParams(c, ["limit", "cursor", "before", "after"]);
    if (!deps.pool) return upstreamDown(c, "the reorg log");
    const cursors = cursorParams(c);
    const { before, after } = cursors;
    const page = await listReorgEvents(deps.pool, {
      limit: limitParam(c.req.query("limit")),
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    });
    setCache(c, before || after ? "listCursored" : "listHead");
    return c.json({
      items: page.items.map(toReorgEvent),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
    });
  });

  app.get("/v1/reorgs/summary", async (c) => {
    rejectUnknownParams(c, []);
    if (!deps.pool) return upstreamDown(c, "the reorg log");
    const summary = await getReorgSummary(deps.pool);
    setCache(c, "aggregate");
    return c.json(toReorgSummary(summary, deps.reorgPollSeconds ?? 5));
  });

  // --------------------------------------------------------------------------- mempool

  app.get("/v1/mempool/summary", async (c) => {
    rejectUnknownParams(c, []);
    if (!deps.chain) return upstreamDown(c, "the chain source");
    // Up to 100 getrawtransaction calls behind this — the memo makes that cost per
    // 10-second window, not per caller.
    const stats = await mempoolMemo.get(() => deps.chain!.getMempoolStats());
    setCache(c, "mempool");
    return c.json(toMempoolSummary(stats));
  });

  // ------------------------------------------------------------------------- analytics

  app.get("/v1/analytics/monthly", async (c) => {
    rejectUnknownParams(c, ["from", "to"]);
    if (!deps.pool) return upstreamDown(c, "the analytics rollup");

    const parseTs = (raw: string | undefined): number | undefined => {
      if (raw === undefined) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : Number.NaN;
    };
    const from = parseTs(c.req.query("from"));
    const to = parseTs(c.req.query("to"));
    if (Number.isNaN(from) || Number.isNaN(to)) {
      throw new ParamError("invalid_parameter", "from/to are unix seconds (non-negative integers)");
    }

    // ~120 points for a decade: the memo holds the WHOLE series and the range is applied
    // in memory, so a thousand distinct ranges still cost one query per ten minutes.
    const series = await monthlyMemo.get(() => loadMonthlySeries(deps.pool!));
    setCache(c, "aggregate");
    return c.json(toMonthly(series, from, to));
  });

  // What is true about Zcash, for an assistant trained before it: committed text.
  app.route("/", v1ReferenceRoutes());
  for (const extension of deps.extensions ?? []) app.route("/", extension.routes);

  // ------------------------------------------------------------------- v1-scoped errors

  app.notFound((c) =>
    c.json(errorBody(c, "not_found", "no such endpoint — GET /v1 lists what exists"), 404),
  );
  app.onError(coreRouteErrors);

  return app;
}

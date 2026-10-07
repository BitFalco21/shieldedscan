import type { Hono } from "hono";
import type { ChainIndexStore } from "../chain-index-store";
import { chainRoutes } from "../chain-routes";
import type { CrossChainStorePort } from "../crosschain-store";
import { KrakenTracker } from "../kraken";
import { LIVE_STATE_PATH, liveStateRoutes } from "../live-state";
import { miningRoutes } from "../mining-routes";
import { miningTermsRoutes } from "../mining-terms-routes";
import { netmapRoutes } from "../netmap-routes";
import type { createNetmapReader } from "../netmap/snapshot";
import { networkPeersRoutes } from "../network-peers-routes";
import { networkRoutes } from "../network-routes";
import { createPool } from "../pg-pool";
import { PulseMempoolTracker } from "../pulse-mempool";
import { pulseRoutes } from "../pulse-routes";
import { statsRoutes } from "../stats-routes";
import { DATABASE_URL, IS_PRIMARY, IS_TESTNET, NODE_RPC_URL, USE_POSTGRES } from "./config";
import type { LiveSources } from "./live";

/**
 * Mount the route groups that read the node, in this order. Each that also reads Postgres beyond
 * the index takes a small pool of its own, so its queries never hold a connection the request path
 * needs.
 */
export function mountNodeRoutes(
  app: Hono,
  deps: {
    live: LiveSources;
    chainIndex: ChainIndexStore | undefined;
    store: CrossChainStorePort;
    netmapReader: ReturnType<typeof createNetmapReader> | undefined;
    log: (message: string) => void;
  },
): void {
  const { live, chainIndex, store, netmapReader, log } = deps;
  const { rpc, chainSource, price, stats24h } = live;

  app.route("/", chainRoutes(chainSource, { price, stats24h, chainIndex }));
  log(`chain routes mounted against ${NODE_RPC_URL}`);
  // What a replica reads from this process: the two figures only its memory holds.
  if (IS_PRIMARY) {
    app.route("/", liveStateRoutes({ price, stats24h }));
    log(`live state mounted at ${LIVE_STATE_PATH} for replicas`);
  }
  // The halving schedule: the node for every subsidy, Postgres for past halving dates and the
  // observed block interval every estimated date derives from. Falls back to the consensus target
  // without Postgres.
  app.route("/", networkRoutes(chainSource, USE_POSTGRES ? DATABASE_URL : undefined));
  log("network routes mounted (halving schedule)");
  // The node map, from the crawler's own tables (`schema-net.sql`, written by the separate crawler
  // container). Postgres only, and every route publishes derived facts only, never a full node
  // address. Answers 503 until the crawler has created its tables.
  if (USE_POSTGRES) {
    app.route("/", netmapRoutes(DATABASE_URL, netmapReader));
    log("netmap routes mounted (node map)");
  }
  // "Peers on our node": the one /network figure not from the crawl, from this node's own
  // getpeerinfo, reduced to counts. Needs the node, not Postgres.
  app.route("/", networkPeersRoutes({ rpc }));
  log("network peers route mounted");
  // `/mining-cost`'s chain terms: tip difficulty and `getnetworksolps` from the node, the subsidy
  // from the node's schedule, the block interval from the index, the price from the tracker (null
  // on testnet).
  app.route(
    "/",
    miningTermsRoutes({
      chain: chainSource,
      pool: USE_POSTGRES ? createPool(DATABASE_URL, { max: 1 }) : null,
      price: price ?? null,
    }),
  );
  log("mining terms route mounted");
  // `/mining`'s overview, from the block table's miner columns: an aggregate over a year of blocks.
  if (USE_POSTGRES) {
    app.route(
      "/",
      miningRoutes({
        pool: createPool(DATABASE_URL, { max: 2, statement_timeout: 30_000 }),
        solpsOver: (blocks, height) => rpc.getNetworkSolpsOver(blocks, height),
      }),
    );
    log("mining overview route mounted");
  }

  // The rest are mainnet-only (TAZ has no market, and `/pulse`'s cross-chain half has no testnet
  // counterpart) and primary-only, because their trackers poll.
  if (!IS_PRIMARY || IS_TESTNET) return;

  /*
   * The `/stats` page's two reads. Its own tracker rather than a share of the live price: it polls
   * a venue every ten seconds for a traded price and candle history, a different source, cadence
   * and quantity from `/chain/info`'s aggregate.
   */
  const kraken = new KrakenTracker(log);
  kraken.start();
  app.route(
    "/",
    statsRoutes({
      source: chainSource,
      kraken,
      pool: USE_POSTGRES ? createPool(DATABASE_URL, { max: 2 }) : null,
    }),
  );
  log("stats routes mounted");

  /*
   * `/pulse`'s four reads. Requires the index as well as the node (the boxes, events and ledger
   * rows come from Postgres), so it mounts only when both are configured. Its mempool tracker polls
   * on its own five-second cadence, so a page poll costs a memory read.
   */
  if (chainIndex && USE_POSTGRES) {
    const pulseMempool = new PulseMempoolTracker({
      ids: () => rpc.getRawMempool(),
      transaction: (txid) => chainSource.getTransaction(txid),
      log,
    });
    pulseMempool.start();
    app.route(
      "/",
      pulseRoutes({
        index: chainIndex,
        pool: createPool(DATABASE_URL, { max: 2, statement_timeout: 30_000 }),
        store,
        source: chainSource,
        mempool: pulseMempool,
      }),
    );
    log("pulse routes mounted");
  }
}

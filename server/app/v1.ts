import type { Hono } from "hono";
import type { Pool } from "pg";
import { IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK } from "../analytics-routes";
import type { NodeChainSource } from "../chain-source";
import type { ChainIndexStore } from "../chain-index-store";
import type { CrossChainStorePort } from "../crosschain-store";
import { FOLLOW_IDLE_MS } from "../follow";
import { PostgresFxRates } from "../fx-rates";
import type { createNetmapReader } from "../netmap/snapshot";
import { createPool } from "../pg-pool";
import { V1_ADDRESS_WINDOW_PATHS, v1AddressWindowRoutes } from "../v1/address-windows";
import { V1_SERIES_PATHS, v1SeriesRoutes } from "../v1/analytics-series";
import { V1_MINERS_PATH, v1MinersRoutes } from "../v1/miners";
import { V1_MINING_PATH, v1MiningRoutes } from "../v1/mining";
import { V1_NODES_PATHS, v1NodesRoutes } from "../v1/network-nodes";
import { type V1Extension, v1Routes } from "../v1/routes";
import { V1_TRANSPARENT_PATH, v1TransparentRoutes } from "../v1/transparent-series";
import { PostgresAnalyticsData } from "../v1/windowed/data";
import { WINDOWED_ANALYTICS_PATHS, windowedAnalyticsRoutes } from "../v1/windowed/routes";
import {
  AGENT_ENABLED,
  DATABASE_URL,
  INTENTS_JWT,
  IS_TESTNET,
  MIDGARD_VENUES,
  NETWORK,
  PUBLIC_API_ENABLED,
  USE_POSTGRES,
} from "./config";
import type { LivePrice, LiveStats24h } from "./live";

/** What the `/v1` sub-app reads from the rest of the process. */
export interface V1AppDeps {
  store: CrossChainStorePort;
  publicChainSource: NodeChainSource | undefined;
  publicChainIndex: ChainIndexStore | undefined;
  price: LivePrice | undefined;
  stats24h: LiveStats24h | undefined;
  netmapReader: ReturnType<typeof createNetmapReader> | undefined;
  log: (message: string) => void;
}

/**
 * The windowed analytics on the public `/v1`. Mainnet and Postgres only.
 *
 * Its own pool, so public traffic can never take a connection the site or ingestion need. The cost
 * bound is the admission gate in `windowedAnalyticsRoutes`, not the pool size: at most two uncached
 * window queries run at once, a few wait briefly, the rest get a 503 with Retry-After before
 * touching the database, and cached answers are always served. Caddy's `v1_analytics` zone is the
 * per-address half.
 */
function publicAnalytics(deps: V1AppDeps): Hono | undefined {
  if (!(PUBLIC_API_ENABLED && USE_POSTGRES && !IS_TESTNET)) return undefined;
  // Sized for the admitted requests' own parallel sub-queries: the cost bound is the admission
  // gate, not this pool, because rationing connections would make each request starve waiting for
  // its own second connection.
  const pool = createPool(DATABASE_URL, {
    max: 8,
    statement_timeout: 20_000,
    connectionTimeoutMillis: 15_000,
  });
  const fx = new PostgresFxRates(pool, deps.log);
  fx.start();
  return windowedAnalyticsRoutes({
    data: new PostgresAnalyticsData(pool, deps.store, fx),
    log: deps.log,
  });
}

/**
 * The route groups published under `/v1` beyond its core. Each that reads Postgres beyond a memo
 * has its own small pool, so no public crowd can hold a connection the site or the follower needs.
 */
function v1Extensions(
  deps: V1AppDeps,
  analytics: Hono | undefined,
  v1Pool: Pool | undefined,
): V1Extension[] {
  const out: V1Extension[] = [];
  if (analytics) {
    out.push({ routes: analytics, endpoints: Object.values(WINDOWED_ANALYTICS_PATHS) });
  }
  /*
   * Memo-backed daily series: one query per series per ten minutes, single-flight, so their cost is
   * set by the memo, not by traffic. On a pool of their own with a 30 s bound rather than the /v1
   * pool's 5 s, because every memo refresh is a cold run and some take longer than 5 s cold.
   */
  const seriesPool = v1Pool
    ? createPool(DATABASE_URL, {
        max: 3,
        statement_timeout: 30_000,
        connectionTimeoutMillis: 15_000,
      })
    : undefined;
  if (seriesPool) {
    out.push({
      routes: v1SeriesRoutes({
        pool: seriesPool,
        ironwoodActivationHeight: IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK[NETWORK],
      }),
      endpoints: V1_SERIES_PATHS,
    });
  }
  // Transparent volume and active addresses: memo-backed like the series, from the tables the
  // primary's transparent tracker keeps (a replica reads them and computes nothing).
  if (seriesPool && !IS_TESTNET) {
    out.push({
      routes: v1TransparentRoutes({ pool: seriesPool }),
      endpoints: [V1_TRANSPARENT_PATH],
    });
  }
  // The crawler is mainnet-only; the node list reads the snapshot the /network page reads.
  if (deps.netmapReader && !IS_TESTNET) {
    out.push({ routes: v1NodesRoutes(deps.netmapReader), endpoints: V1_NODES_PATHS });
  }
  if (deps.publicChainSource) {
    out.push({
      routes: v1MiningRoutes({
        chain: deps.publicChainSource,
        pool: v1Pool ?? null,
        price: deps.price ?? null,
      }),
      endpoints: [V1_MINING_PATH],
    });
  }
  // The address walks are the costliest public reads: two connections of their own, 20 s
  // statements, and a caller waits at most 5 s for a connection before a 503.
  if (PUBLIC_API_ENABLED && USE_POSTGRES && !IS_TESTNET) {
    out.push({
      routes: v1AddressWindowRoutes({
        pool: createPool(DATABASE_URL, {
          max: 2,
          statement_timeout: 20_000,
          connectionTimeoutMillis: 5_000,
        }),
      }),
      endpoints: V1_ADDRESS_WINDOW_PATHS,
    });
  }
  // Who mined a window, from the per-day table the primary's tracker keeps: a sum over day rows,
  // but every distinct window is a query, so two connections of its own. Mounted for the agent too,
  // which reads it in-process; a replica computes nothing.
  if ((PUBLIC_API_ENABLED || AGENT_ENABLED) && USE_POSTGRES && !IS_TESTNET) {
    out.push({
      routes: v1MinersRoutes({
        pool: createPool(DATABASE_URL, {
          max: 2,
          statement_timeout: 10_000,
          connectionTimeoutMillis: 5_000,
        }),
      }),
      endpoints: [V1_MINERS_PATH],
    });
  }
  return out;
}

/**
 * The `/v1` sub-app, or undefined when neither the public API nor the agent needs it. Its routes
 * declare their full `/v1/...` paths, so it mounts at `/`.
 */
export function createV1App(deps: V1AppDeps): Hono | undefined {
  if (!(PUBLIC_API_ENABLED || AGENT_ENABLED)) return undefined;
  const analytics = publicAnalytics(deps);
  // Its own small pool with a statement timeout: a public query must never pin a core, and the
  // private routes' pools must never be starved by public traffic.
  const v1Pool = USE_POSTGRES
    ? createPool(DATABASE_URL, { max: 4, statement_timeout: 5_000 })
    : undefined;
  const { publicChainSource, publicChainIndex, price, stats24h } = deps;
  return v1Routes({
    ...(publicChainSource ? { chain: publicChainSource } : {}),
    store: deps.store,
    ...(v1Pool ? { pool: v1Pool } : {}),
    extras: {
      ...(price ? { price } : {}),
      ...(stats24h ? { stats24h } : {}),
    },
    enabledProtocols: {
      maya: "maya" in MIDGARD_VENUES,
      thorchain: "thorchain" in MIDGARD_VENUES,
      "near-intents": Boolean(INTENTS_JWT),
    },
    reorgPollSeconds: FOLLOW_IDLE_MS / 1000,
    ...(publicChainIndex ? { chainIndex: publicChainIndex } : {}),
    extensions: v1Extensions(deps, analytics, v1Pool),
  });
}

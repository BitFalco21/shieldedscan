import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { analyticsRoutes } from "./analytics-routes";
import { claimPrimary } from "./api-role";
import { bearerAuth } from "./auth";
import { crosschainRoutes } from "./crosschain-routes";
import { defillamaRoutes } from "./defillama-routes";
import { log } from "./entrypoint";
import { RemoteLiveState, primaryProxyRoutes } from "./live-state";
import { MarketCapTracker } from "./market-caps";
import { MARKET_ASSETS_PATH, marketRoutes } from "./market-routes";
import { mcpRoutes } from "./mcp";
import { createNetmapReader } from "./netmap/snapshot";
import { createPool } from "./pg-pool";
import { isPublicPath } from "./public-paths";
import { RateLimiter } from "./rate-limit";
import { reorgRoutes } from "./reorg-routes";
import { socialRoutes } from "./social-routes";
import { V1_VERSION } from "./v1/descriptor";
import { backfillUntilComplete } from "./venue-backfill";
import { ALL_PROTOCOLS, type IngestDeps, startPolling } from "./venue-poll";
import { INTENTS_MIN_INTERVAL_MS } from "./venues";
import { ZipIndexTracker } from "./zips";
import { ZIP_INDEX_PATH, zipsRoutes } from "./zips-routes";
import { ZNS_MAINNET_ADMIN_PUBKEY, ZNS_MAINNET_UIVK, ZNS_MAINNET_URL, ZnsTracker } from "./zns";
import { znsRoutes } from "./zns-routes";
import { mountAgent } from "./app/agent";
import {
  AGENT_ENABLED,
  DATABASE_URL,
  INTENTS_JWT,
  IS_PRIMARY,
  IS_TESTNET,
  MIDGARD_VENUES,
  NETWORK,
  NODE_RPC_URL,
  PORT,
  PUBLIC_API_ENABLED,
  ROLE,
  TOKEN,
  USE_POSTGRES,
} from "./app/config";
import { startChainTrackers } from "./app/jobs";
import { createLiveSources } from "./app/live";
import { mountNodeRoutes } from "./app/node-routes";
import { createChainIndexStores, createCrossChainStore } from "./app/stores";
import { createV1App } from "./app/v1";

/**
 * The read-only explorer API.
 *
 * Its endpoints are `ExplorerDataSource` methods over HTTP, returning domain types verbatim, so the
 * Next adapter stays a thin fetch-and-validate and storage can change without touching anything
 * above `data/`. The public `/v1` surface speaks its own wire types instead.
 *
 * This process holds the NEAR Intents JWT and the shared Postgres pools. It is the only public
 * surface on the host; the node's RPC port and Postgres are never published.
 *
 * Configuration is read and checked in `app/config.ts`. This file builds the shared sources, then
 * mounts every route group in order: the bearer gate first, because Hono applies middleware only
 * to routes registered after it.
 */

// A second primary on one database is refused at boot (`api-role.ts`).
if (IS_PRIMARY && USE_POSTGRES) {
  await claimPrimary(createPool(DATABASE_URL, { max: 1 }), log);
}
log(
  ROLE.role === "primary"
    ? "role: primary — runs the background jobs"
    : `role: replica — no background jobs; live state read from ${ROLE.primaryUrl}`,
);

const store = await createCrossChainStore(log);

/**
 * One node-map snapshot reader for the whole process: the private `/chain/network/*` routes the
 * `/network` page reads and the public `/v1/nodes*` both derive from it, so the two cannot
 * disagree about a row and the snapshot is rebuilt once per window, not once per surface.
 */
const netmapReader = USE_POSTGRES ? createNetmapReader(DATABASE_URL) : undefined;

const ingestDeps: IngestDeps = {
  store,
  midgardVenues: MIDGARD_VENUES,
  intentsJwt: INTENTS_JWT,
  intentsLimiter: new RateLimiter(INTENTS_MIN_INTERVAL_MS),
  now: () => Date.now(),
  log,
};

/**
 * The bearer check, constant-time. Caddy also fronts this service; checking here as well means a
 * misconfigured proxy cannot expose the data routes.
 */
const auth = bearerAuth(TOKEN);

const app = new Hono();

/**
 * Default-deny: the token is required unless a path is listed in `server/public-paths.ts` (with
 * the reason for each entry), so forgetting to allowlist a new public prefix answers 401 rather
 * than silently publishing a private one.
 */
app.use("*", async (c: Context, next: Next) => {
  const pathname = new URL(c.req.url).pathname;
  if (isPublicPath(pathname)) return next();
  return auth.requireToken(c, next);
});

/**
 * How a replica reaches the primary: in-network, with this service's own bearer header. The
 * primary holds the same token, so no new credential exists.
 */
const primaryLink =
  ROLE.role === "replica" ? { url: ROLE.primaryUrl, authorization: auth.header() } : undefined;
/** The primary's live price and 24-hour counts, polled; `live-state.ts`. */
const remoteLiveState = primaryLink ? new RemoteLiveState({ ...primaryLink, log }) : undefined;
remoteLiveState?.start();

const { chainIndex, publicChainIndex } = createChainIndexStores();
/** The node clients and live figures; absent without `NODE_RPC_URL`. */
const live = NODE_RPC_URL
  ? createLiveSources({
      nodeRpcUrl: NODE_RPC_URL,
      isTestnet: IS_TESTNET,
      chainIndex,
      publicChainIndex,
      remoteLiveState,
      coingeckoApiKey: process.env.COINGECKO_API_KEY,
      log,
    })
  : undefined;

// The analytics series come from the rollup tables, so they need Postgres, not the node.
if (USE_POSTGRES) {
  // A getter, read per cache fill, because the price tracker warms after boot and ages out. Null on
  // testnet.
  app.route(
    "/",
    analyticsRoutes(DATABASE_URL, NETWORK, {
      spotUsd: () => live?.price?.current()?.usd ?? null,
    }),
  );
  log("analytics routes mounted against the rollup table");
  // The observed-reorg log the follower writes. Postgres, not the node: Zakura has no getchaintips,
  // and only the follower witnessed what it rolled back.
  app.route("/", reorgRoutes(DATABASE_URL));
  log("reorg routes mounted against the audit log");

  // The daily-post snapshot and its ledger, on a tiny pool of their own so a slow write cannot hold
  // connections the read path needs. Primary only: the X poster calls the primary, and these routes
  // write its ledger. The price is null before the tracker's first poll and on testnet; a null must
  // reach the snapshot rather than becoming a zero, since a missing figure there means no post.
  if (IS_PRIMARY) {
    const socialPool = createPool(DATABASE_URL, { max: 2 });
    app.route(
      "/",
      socialRoutes({
        pool: socialPool,
        price: () => {
          const quote = live?.price?.current() ?? null;
          return { usd: quote?.usd ?? null, change24hPct: quote?.change24hPct ?? null };
        },
      }),
    );
    log("social routes mounted against the ledger");
  }
}

/**
 * Wrapped-ZEC liquidity pools on other chains, read from DeFiLlama. Needs neither Postgres nor the
 * node, only outbound HTTPS, so it mounts unconditionally under the guarded `/chain/*` prefix. Its
 * figures come from a third party and cannot be checked against the chain, which is why the
 * provenance is in the path and the payload.
 */
app.route("/", defillamaRoutes());
log("defillama wrapped-ZEC pool route mounted (third-party figures, 30-minute cache)");

/**
 * Market capitalisations for `/compare`. Mainnet only: TAZ has no market, so a testnet deployment
 * must not hold mainnet money data (the page is absent from the testnet frontend too). Independent
 * of `NODE_RPC_URL`, so a node outage does not take the page down.
 */
if (IS_PRIMARY && !IS_TESTNET) {
  const marketCaps = new MarketCapTracker(
    log,
    // Its own tiny pool: a slow third-party write must not hold connections the request path needs.
    USE_POSTGRES ? createPool(DATABASE_URL, { max: 2 }) : undefined,
    process.env.COINGECKO_API_KEY,
  );
  marketCaps.start();
  app.route("/", marketRoutes(marketCaps));
  log("market-cap routes mounted");
} else if (primaryLink && !IS_TESTNET) {
  // The poller is the primary's; a replica answers with the primary's snapshot, read when asked.
  app.route("/", primaryProxyRoutes([MARKET_ASSETS_PATH], primaryLink));
  log("market-cap route mounted (the primary's, proxied)");
}

// The ZIP index is protocol documentation, so both networks' APIs serve it (unlike the market
// tracker above).
if (IS_PRIMARY) {
  const zipIndex = new ZipIndexTracker({
    githubApiBase: (process.env.ZIPS_GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, ""),
    rawBase: (process.env.ZIPS_RAW_URL ?? "https://raw.githubusercontent.com").replace(/\/$/, ""),
    log,
    now: Date.now,
    fetch: globalThis.fetch,
  });
  zipIndex.start();
  app.route("/", zipsRoutes(zipIndex));
  log("zip-index routes mounted");
} else if (primaryLink) {
  app.route("/", primaryProxyRoutes([ZIP_INDEX_PATH], primaryLink));
  log("zip-index route mounted (the primary's, proxied)");
}

/**
 * The Zcash Name System registry (zcashnames.com), for name search and the unified-address name
 * chip. Mainnet only: its names point at mainnet addresses. It needs the chain index, because a
 * name is published only once its transaction is found there; without Postgres it does not start.
 * The pins are configuration, so a key rotation is an env change, but they default to known values:
 * a missing variable must never mean "trust whatever the server says". Primary only: the tracker
 * polls the registry.
 */
if (IS_PRIMARY && !IS_TESTNET && chainIndex) {
  const zns = new ZnsTracker({
    url: (process.env.ZNS_URL ?? ZNS_MAINNET_URL).replace(/\/$/, ""),
    pinnedUivk: process.env.ZNS_UIVK ?? ZNS_MAINNET_UIVK,
    pinnedAdminPubkey: process.env.ZNS_ADMIN_PUBKEY ?? ZNS_MAINNET_ADMIN_PUBKEY,
    txBlocks: (txids) => chainIndex.txBlocks(txids),
    tipHeight: () => chainIndex.tipHeight(),
    fetch: globalThis.fetch,
    now: Date.now,
    log,
  });
  zns.start();
  app.route("/", znsRoutes(zns));
  log("zns name routes mounted");
}

// Chain reads from the node. Without NODE_RPC_URL these routes are not mounted at all.
if (live) {
  mountNodeRoutes(app, { live, chainIndex, store, netmapReader, log });
} else {
  log("NODE_RPC_URL unset — chain routes not mounted, those pages stay on fixtures");
}

// The primary's day-grained chain trackers (`app/jobs.ts`). Mainnet only.
if (IS_PRIMARY && USE_POSTGRES && NODE_RPC_URL && !IS_TESTNET) {
  startChainTrackers(DATABASE_URL, NODE_RPC_URL, log);
}

/**
 * The public, keyless `/v1` surface, mounted only when PUBLIC_API_ENABLED=1. `/v1` is on the
 * public-paths allowlist, so the default-deny gate lets it through by design. The sub-app is also
 * built for the agent, which dispatches to it in-process.
 */
const v1App = createV1App({
  store,
  publicChainSource: live?.publicChainSource,
  publicChainIndex,
  price: live?.price,
  stats24h: live?.stats24h,
  netmapReader,
  log,
});

if (v1App && PUBLIC_API_ENABLED) {
  // NOTE the "/" mount: the routes declare their own full /v1/... paths.
  app.route("/", v1App);
  // The public MCP server: tools generated from the /api-docs catalogue, all dispatched in-process
  // to the app just mounted. Mainnet only, like the public /v1.
  if (!IS_TESTNET) {
    app.route("/", mcpRoutes({ v1: v1App, version: V1_VERSION }));
    log("PUBLIC /mcp mounted — stateless, keyless, tools generated from the /v1 catalogue");
  }
  log("PUBLIC /v1 mounted — keyless by design; rate limiting is Caddy's job plus in-process memos");
} else {
  log("PUBLIC_API_ENABLED unset — /v1 not mounted");
}

if (AGENT_ENABLED && v1App) {
  mountAgent(app, { v1App, auth, log });
} else if (AGENT_ENABLED) {
  log("AGENT_ENABLED set but /v1 sub-app unavailable — /agent not mounted");
}

/**
 * OAuth discovery answers 404, meaning "this server needs no login". Behind the token gate these
 * paths would answer 401, and an MCP client probing `/.well-known/oauth-protected-resource` could
 * read that as "OAuth required" and refuse to connect to a keyless server.
 */
app.all("/.well-known/*", (c) => c.json({ error: "not_found" }, 404));

/**
 * Unauthenticated so the container healthcheck can reach it, and therefore thin: `lastError` holds
 * upstream messages and is returned only to a caller holding the bearer token.
 *
 * Always 200, even when a venue is dormant: a red healthcheck would restart a healthy container.
 */
app.get("/health", async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const authorised = auth.isAuthorized(c);
  const venues = (await store.health(ALL_PROTOCOLS, now)).map((v) => ({
    ...v,
    // Derived from configuration: a venue with no base URL is disabled, which is different from
    // "failing".
    enabled: v.protocol === "near-intents" ? Boolean(INTENTS_JWT) : v.protocol in MIDGARD_VENUES,
    ...(authorised ? {} : { lastError: undefined }),
  }));
  return c.json({
    ok: true,
    transfers: await store.count(),
    persistent: USE_POSTGRES,
    venues,
    asOf: now,
  });
});

/*
 * The /crosschain surface is mainnet-only: no venue bridges testnet ZEC, so there is nothing it
 * could honestly answer on testnet.
 */
if (!IS_TESTNET) app.route("/", crosschainRoutes(store));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  log(`api listening on :${info.port}`);
});

// Backfill and head polling share one Intents rate limiter, so they queue against each other
// instead of racing for the same per-key budget. The backfill checkpoints every page and skips
// itself once complete, so it is a no-op on restart.
void (async () => {
  // Poll first so the head is live immediately; the historical walk fills in behind it. Primary
  // only: a venue key's rate limit is per key, so a second poller holding it would fail most calls.
  const stop = IS_PRIMARY ? startPolling(ingestDeps) : () => undefined;
  if (IS_PRIMARY) void backfillUntilComplete(ingestDeps);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      log(`${signal} received, shutting down`);
      stop();
      void store.close().finally(() => process.exit(0));
    });
  }
})();

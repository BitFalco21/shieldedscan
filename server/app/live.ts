import { NodeChainSource } from "../chain-source";
import type { ChainIndexStore } from "../chain-index-store";
import { PriceTracker, Stats24hTracker } from "../chain-stats";
import type { RemoteLiveState } from "../live-state";
import { HttpNodeRpc } from "../node-rpc";

/**
 * The node clients and the live figures read from them: the API's view of the chain tip.
 *
 * Built once at boot, before any route mounts, so every route group is handed the sources it
 * reads rather than reaching for a binding assigned later.
 */

/**
 * The site's own node reads (token-gated `/chain/*`). Wider than the public pools because page
 * renders depend on it, but still bounded: visitor-driven lookups reach it through the frontend,
 * and an unbounded client let a few expensive requests crowd out every other read.
 */
const PRIMARY_NODE_RPC_MAX_IN_FLIGHT = 24;
const PRIMARY_NODE_RPC_MAX_WAIT_MS = 10_000;

/**
 * The public surface's own node clients: `/v1`, the MCP server and the agent dispatch here, never
 * through the site's source. Capped at eight concurrent calls in all, so a keyless crowd can
 * neither overload the node the follower depends on nor slow the site's pages, and split into two
 * pools of four: a 100-row block page is a hundred `getblock`s, so single reads use one pool and
 * block pages the other, and pages wait only behind pages.
 */
const PUBLIC_NODE_RPC_MAX_IN_FLIGHT = 4;
const PUBLIC_NODE_PAGE_RPC_MAX_IN_FLIGHT = 4;
const PUBLIC_NODE_RPC_MAX_WAIT_MS = 5_000;
/**
 * Most block reads waiting for a page slot before a page is refused whole, rather than queued to
 * time out call by call. At the measured drain rate, 200 queued calls wait under two seconds on
 * four slots, inside the 5 s wait, so an admitted page completes; four slots also let one caller
 * page cold history at the block list's own limit without being refused.
 */
const PUBLIC_NODE_PAGE_RPC_MAX_QUEUED = 200;

/** Structural, so a replica's reader of the primary's figures fits where the tracker does. */
export type LivePrice = Pick<PriceTracker, "current">;
export type LiveStats24h = Pick<Stats24hTracker, "current">;

export interface LiveSources {
  /** The site's node client, for the routes that call an RPC directly. */
  rpc: HttpNodeRpc;
  /** The site's chain source. */
  chainSource: NodeChainSource;
  /** The public surface's chain source, on its own bounded clients and index store. */
  publicChainSource: NodeChainSource;
  /** The live ZEC price; absent on testnet, where TAZ has no market. */
  price: LivePrice | undefined;
  /** The trailing 24-hour counts. */
  stats24h: LiveStats24h;
}

export function createLiveSources(deps: {
  nodeRpcUrl: string;
  isTestnet: boolean;
  chainIndex: ChainIndexStore | undefined;
  publicChainIndex: ChainIndexStore | undefined;
  /** A replica's reader of the primary's figures; absent on the primary, which tracks them. */
  remoteLiveState: RemoteLiveState | undefined;
  coingeckoApiKey: string | undefined;
  log: (message: string) => void;
}): LiveSources {
  const { nodeRpcUrl, chainIndex, publicChainIndex } = deps;
  const rpc = new HttpNodeRpc(nodeRpcUrl, {
    limits: {
      maxInFlight: PRIMARY_NODE_RPC_MAX_IN_FLIGHT,
      maxWaitMs: PRIMARY_NODE_RPC_MAX_WAIT_MS,
    },
  });

  // Neither tracker serves anything until warm and fresh, so a stale number is never rendered as
  // live. A testnet API serves no price at all (TAZ has no market); the frontend guards this too.
  let price: LivePrice | undefined;
  let stats24h: LiveStats24h;
  if (deps.remoteLiveState) {
    if (!deps.isTestnet) price = deps.remoteLiveState.price;
    stats24h = deps.remoteLiveState.stats24h;
  } else {
    if (!deps.isTestnet) {
      const tracker = new PriceTracker(deps.log, deps.coingeckoApiKey);
      tracker.start();
      price = tracker;
    }
    const counts = new Stats24hTracker(rpc, deps.log);
    counts.start();
    stats24h = counts;
  }

  // The index answers block fee totals, so block detail does not resolve inputs on the node; see
  // the constructor's doc.
  const chainSource = new NodeChainSource(
    rpc,
    chainIndex ? { blockFees: (h) => chainIndex.blockFees(h) } : {},
  );
  const publicChainSource = new NodeChainSource(
    new HttpNodeRpc(nodeRpcUrl, {
      limits: {
        maxInFlight: PUBLIC_NODE_RPC_MAX_IN_FLIGHT,
        maxWaitMs: PUBLIC_NODE_RPC_MAX_WAIT_MS,
      },
    }),
    publicChainIndex ? { blockFees: (h) => publicChainIndex.blockFees(h) } : {},
    {
      rpc: new HttpNodeRpc(nodeRpcUrl, {
        limits: {
          maxInFlight: PUBLIC_NODE_PAGE_RPC_MAX_IN_FLIGHT,
          maxWaitMs: PUBLIC_NODE_RPC_MAX_WAIT_MS,
          maxQueued: PUBLIC_NODE_PAGE_RPC_MAX_QUEUED,
        },
      }),
    },
  );
  return { rpc, chainSource, publicChainSource, price, stats24h };
}

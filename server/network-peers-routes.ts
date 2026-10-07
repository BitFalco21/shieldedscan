import { Hono } from "hono";
import type { NetPeers } from "@/domain";
import { Cached } from "./cached";
import type { RpcPeerInfo } from "./node-rpc";

/**
 * `GET /chain/network/peers` — how many peers our own node holds, from its `getpeerinfo`.
 *
 * Published with `basis: "ours"` so the page never folds it into a crawled count: the crawler
 * counts nodes that accept inbound connections, while this counts every connection one node holds,
 * mostly inbound ones the crawler cannot see. Peers are reduced to four numbers before
 * serialisation; a peer's address never leaves the box.
 */

export const NETWORK_PEERS_PATH = "/chain/network/peers";
const CACHE_MS = 30_000;

export interface NetworkPeersDeps {
  rpc: { getPeerInfo(): Promise<RpcPeerInfo[]> };
}

export function summarisePeers(peers: RpcPeerInfo[], now: number): NetPeers {
  const inbound = peers.filter((p) => p.inbound === true).length;
  const pings = peers
    .map((p) => p.pingtime)
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t >= 0)
    .map((t) => Math.round(t * 1000))
    .sort((a, b) => a - b);
  const medianPingMs =
    pings.length === 0
      ? null
      : pings.length % 2 === 1
        ? pings[pings.length >> 1]!
        : Math.round((pings[pings.length / 2 - 1]! + pings[pings.length / 2]!) / 2);
  return {
    basis: "ours",
    count: peers.length,
    inbound,
    outbound: peers.length - inbound,
    medianPingMs,
    asOf: now,
  };
}

export function networkPeersRoutes(deps: NetworkPeersDeps): Hono {
  const app = new Hono();
  const peers = new Cached<NetPeers>(CACHE_MS);
  app.get(NETWORK_PEERS_PATH, async (c) => {
    try {
      return c.json(
        await peers.get(async () =>
          summarisePeers(await deps.rpc.getPeerInfo(), Math.floor(Date.now() / 1000)),
        ),
      );
    } catch {
      // A cold or unreachable node is a 503, never a count of zero: `{count: 0}` is a claim.
      return c.json({ error: "peer count unavailable" }, 503);
    }
  });
  return app;
}

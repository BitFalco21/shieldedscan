import { Hono } from "hono";
import { parseAsnFilter, parseNetClientFilter, type NetTopologyScope } from "@/domain";
import {
  deriveCrawls,
  deriveHealth,
  deriveMap,
  deriveNodesPage,
  deriveReleases,
  deriveSummary,
  deriveTopology,
} from "./netmap/derive";
import { createNetmapReader, type NetmapReader, type NetmapSnapshot } from "./netmap/snapshot";

export { anonId, subnet24 } from "./netmap/ids";

/**
 * The node-map read surface, `/chain/network/*`, built from the crawler's tables
 * (`schema-net.sql`, written by the separate crawler container).
 *
 * Publishes derived facts only. The database holds full node addresses (needed to re-crawl and
 * track uptime), but no response carries one: country, city, ASN, 1-degree cells, `/24` cluster
 * labels and hashed ids are what leave the box. `netmap-routes.test.ts` asserts this over every
 * route, including IPv6 and onion hosts.
 *
 * Every count is a floor, since a crawler only sees listening nodes, and every percentage ships
 * with its numerator and denominator. A crawler-relative ping is labelled as a measurement from
 * our vantage point. Every route derives from one 30-second snapshot (`netmap/snapshot.ts`), so
 * no two routes can disagree about the same row.
 *
 * Mounted under the token-gated `/chain/*` prefix, like `network-routes`.
 */

export const NETMAP_PATHS = {
  summary: "/chain/network/summary",
  map: "/chain/network/map",
  topology: "/chain/network/topology",
  health: "/chain/network/health",
  nodes: "/chain/network/nodes",
  crawls: "/chain/network/crawls",
  releases: "/chain/network/releases",
} as const;

const UNAVAILABLE = { error: "network map unavailable" } as const;

export function netmapRoutes(connection?: string, reader?: NetmapReader): Hono {
  const store = reader ?? createNetmapReader(connection);
  const app = new Hono();

  const serve = (
    path: string,
    derive: (snap: NetmapSnapshot, query: (name: string) => string | undefined) => unknown,
  ) => {
    app.get(path, async (c) => {
      try {
        return c.json(derive(await store.read(), (name) => c.req.query(name)));
      } catch {
        return c.json(UNAVAILABLE, 503);
      }
    });
  };

  serve(NETMAP_PATHS.summary, (snap) => deriveSummary(snap));
  // One payload for every lens: which stat colours the map is client state, not a query.
  serve(NETMAP_PATHS.map, (snap) => deriveMap(snap));
  serve(NETMAP_PATHS.topology, (snap, query) => {
    const scope: NetTopologyScope = query("scope") === "all" ? "all" : "hubs";
    return deriveTopology(snap, scope);
  });
  serve(NETMAP_PATHS.health, (snap) => deriveHealth(snap));
  serve(NETMAP_PATHS.nodes, (snap, query) => {
    const rawLimit = Number(query("limit") ?? 25);
    return deriveNodesPage(
      snap,
      { client: parseNetClientFilter(query("client")), asn: parseAsnFilter(query("asn")) },
      {
        before: query("before"),
        after: query("after"),
        limit: Number.isFinite(rawLimit) ? rawLimit : 25,
      },
    );
  });
  serve(NETMAP_PATHS.crawls, (snap) => deriveCrawls(snap));
  serve(NETMAP_PATHS.releases, (snap) => deriveReleases(snap));

  return app;
}

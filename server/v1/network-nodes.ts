import { Hono } from "hono";
import { parseAsnFilter, parseNetClientFilter } from "@/domain";
import { deriveHealth, deriveMap, deriveNodesPage, deriveSummary } from "../netmap/derive";
import type { NetmapReader } from "../netmap/snapshot";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";
import { ParamError, rejectUnknown } from "./params";
import { cursorParams, limitParam, routeGroupErrors, setCache } from "./http";

/**
 * The node map on `/v1`: what the `/network` page shows about the Zcash network's listening
 * nodes, from this explorer's own crawler, as explicit wire shapes over the same 30-second
 * snapshot the page reads, so the API and the page cannot disagree about one row.
 *
 * Deliberately left out:
 *  - Per-client "answer rate" and the "answered every crawl" headline. They mostly measure our
 *    crawler's access (it shares an address with our own node, and Zebra-family nodes accept one
 *    connection per address), not node quality. A node's raw `crawlsAnswered` stays on the list,
 *    named for exactly what it counts.
 *  - The latency histogram: a round trip from one vantage point describes the path from our
 *    crawler, not a node. A node's own `pingMs` stays on the list, labelled crawler-relative.
 *  - Any address. The database holds full IPs; nothing here carries one (the netmap derive layer
 *    publishes country, city, network operator, 1° cells, `/24` labels and one-way ids only).
 *
 * Every count is a lower bound: a crawler sees nodes that accept connections, never the ones
 * behind a router. That travels in `coverage`.
 */

export const V1_NODES_PATHS = [
  "/v1/nodes",
  "/v1/nodes/list",
  "/v1/nodes/geography",
  "/v1/nodes/concentration",
] as const;

const COVERAGE = {
  status: "floor" as const,
  notes: [
    "Counts only nodes that accept incoming connections; nodes behind a router cannot be crawled, so the real network is larger.",
  ],
};

export function v1NodesRoutes(reader: NetmapReader): Hono {
  const app = new Hono();
  app.onError(routeGroupErrors("the node map could not be read just now; retry shortly"));

  app.get("/v1/nodes", async (c) => {
    rejectUnknown(c.req.query(), []);
    const s = deriveSummary(await reader.read());
    setCache(c, "nodes");
    return c.json({
      coverage: COVERAGE,
      source: { name: "ShieldedScan", url: `${SITE}/network` },
      data: {
        answeringWindowSeconds: s.windowSeconds,
        answering: s.reachable,
        knownAddresses: s.known,
        everAnswered: s.everReachable,
        neverAnswered: s.neverAnswered,
        ipv6: { known: s.ipv6Known, answering: s.ipv6Reachable },
        torKnown: s.torKnown,
        countries: s.countries,
        networkOperators: s.asns,
        clients: s.clients.map((k) => ({
          client: k.client,
          share: { pct: k.pct, numerator: k.numerator, denominator: k.denominator },
        })),
        versions: s.versions.map((v) => ({ client: v.client, version: v.version, nodes: v.count })),
        protocolVersions: s.protocolVersions.map((p) => ({
          protocolVersion: p.protocolVersion,
          nodes: p.count,
        })),
        crawls: {
          count: s.crawls.count,
          firstStartedAt: s.crawls.firstStartedAt,
          lastFinishedAt: s.crawls.lastFinishedAt,
          intervalSeconds: s.crawls.intervalSeconds,
        },
      },
      notes: [
        "A node is answering when it completed a handshake with our crawler within answeringWindowSeconds.",
        "A user agent is the node's own claim about its software and is not verified.",
      ],
      asOf: s.asOf,
    });
  });

  app.get("/v1/nodes/list", async (c) => {
    const q = c.req.query();
    rejectUnknown(q, ["client", "asn", "limit", "cursor", "before", "after"]);
    // Strict where the private route coerces: a filter that fails to parse is a 400, never a
    // silently unfiltered list. A well-formed client we have never seen is KEPT and yields an
    // honest empty page — the client set is open.
    const client = q.client === undefined ? null : parseNetClientFilter(q.client);
    if (q.client !== undefined && client === null) {
      throw new ParamError(
        "invalid_parameter",
        "client must be a user-agent family such as Zebra, Zakura or zcashd",
      );
    }
    const asn = q.asn === undefined ? null : parseAsnFilter(q.asn);
    if (q.asn !== undefined && asn === null) {
      throw new ParamError("invalid_parameter", "asn must be a positive autonomous system number");
    }
    const cursors = cursorParams(c);
    const page = deriveNodesPage(
      await reader.read(),
      { client, asn },
      { ...cursors, limit: limitParam(q.limit) },
    );
    setCache(c, "nodes");
    return c.json({
      coverage: COVERAGE,
      source: { name: "ShieldedScan", url: `${SITE}/network/nodes` },
      applied: { client: page.applied.client, asn: page.applied.asn },
      order: "crawls answered as a share of crawls attempted, highest first; ties by id",
      items: page.items.map((n) => ({
        id: n.id,
        client: n.client,
        version: n.version,
        protocolVersion: n.protocolVersion,
        network: n.network,
        country: n.country,
        city: n.city,
        asn: n.asn,
        networkOperator: n.asnOrg,
        pingMs: n.pingMs,
        crawlsAnswered: { answered: n.reached, attempted: n.attempted },
        firstSeen: n.firstSeen,
        lastAnswered: n.lastReachable,
      })),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
      notes: [
        "id is a one-way hash; no address is published.",
        "pingMs is a handshake round trip from our crawler in Vienna — a fact about that path, not about the node.",
        "crawlsAnswered mostly reflects whether the node accepted OUR crawler's connection (many nodes accept one connection per address, and ours is shared with our own node); it is not a reliability score.",
        "country, city and network operator are GeoIP's claim about the address, not a measurement.",
      ],
      asOf: Math.floor(Date.now() / 1000),
    });
  });

  app.get("/v1/nodes/geography", async (c) => {
    rejectUnknown(c.req.query(), []);
    const m = deriveMap(await reader.read());
    setCache(c, "nodes");
    return c.json({
      coverage: COVERAGE,
      source: { name: "ShieldedScan", url: `${SITE}/network/map` },
      data: {
        countries: m.countries.map((k) => ({ country: k.country, nodes: k.count })),
        unplaced: m.unplaced,
        cellDegrees: m.cellDegrees,
        cells: m.cells.map((cell) => ({
          lat: cell.lat,
          lon: cell.lon,
          nodes: cell.nodes,
          country: cell.country,
          city: cell.city,
          clients: cell.clients.map((k) => ({ client: k.client, nodes: k.count })),
        })),
        notAnswering: {
          total: m.ghostTotal,
          cells: m.ghostCells.map((g) => ({ lat: g.lat, lon: g.lon, addresses: g.count })),
        },
      },
      notes: [
        "A location is GeoIP's claim about an address, never a measurement; a node GeoIP could not place is counted in unplaced and drawn nowhere.",
        "notAnswering counts advertised addresses that did not complete a handshake within the answering window.",
      ],
      asOf: m.asOf,
    });
  });

  app.get("/v1/nodes/concentration", async (c) => {
    rejectUnknown(c.req.query(), []);
    const h = deriveHealth(await reader.read());
    const share = (s: { pct: number; numerator: number; denominator: number }) => ({
      pct: s.pct,
      numerator: s.numerator,
      denominator: s.denominator,
    });
    setCache(c, "nodes");
    return c.json({
      coverage: COVERAGE,
      source: { name: "ShieldedScan", url: `${SITE}/network/health` },
      data: {
        topNetworkOperators: h.concentration.topAsns.map((a) => ({
          asn: a.asn,
          networkOperator: a.org,
          share: share(a),
        })),
        topThreeOperators: share(h.concentration.top3),
        clusteredSubnets: h.clusteredSubnets.map((s) => ({ subnet: s.subnet, nodes: s.count })),
      },
      notes: [
        "Grouped by autonomous system, never clustered into operators: two networks run by one company count separately, so real concentration can only be higher.",
        "A subnet is a /24, written a.b.c.x; the last octet is never published.",
      ],
      asOf: h.asOf,
    });
  });

  return app;
}

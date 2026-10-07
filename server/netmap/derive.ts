import {
  NET_LATENCY_BUCKETS,
  NET_UNIDENTIFIED_CLIENT,
  NET_UPTIME_BUCKETS,
  bucketNodesToCells,
  cellCentre,
  classifyProbeFailure,
  histogram,
  reliabilityBps,
  share,
  type NetCrawlHistory,
  type NetGhost,
  type NetHealth,
  type NetHub,
  type NetMap,
  type NetNodeFilters,
  type NetNodePage,
  type NetNodeRow,
  type NetPeerNetwork,
  type NetProbeFailure,
  type NetReleaseDay,
  type NetReleases,
  type NetSummary,
  type NetTopology,
  type NetTopologyScope,
} from "@/domain";
import { cursorSlice, encodeCursor } from "@/data/cursor";
import { classifyUserAgent } from "../p2p/user-agent";
import { anonId, subnet24 } from "./ids";
import {
  BEHIND_TIP_BLOCKS,
  classifyReleaseGroups,
  rawReleaseGroups,
  type RawReleaseGroup,
} from "./releases";
import {
  CRAWL_HISTORY_LIMIT,
  REACHABLE_WINDOW_SEC,
  type GhostNodeRow,
  type LiveNodeRow,
  type NetmapSnapshot,
} from "./snapshot";

/**
 * Pure derivations from one snapshot to the wire types in `domain/netmap.ts`. No I/O, no
 * clock beyond `snapshot.at`, and the load-bearing property: no `host` ever leaves a function
 * here except through `anonId` or `subnet24`. `netmap-routes.test.ts` asserts that over every
 * route on real rows, including IPv6 and onion hosts.
 */

/** ~1 degree of latitude is ~111 km: the display grain GeoIP data actually supports. */
export const CELL_DEGREES = 1;
/** The sky's caps: the most-advertised ghosts are kept, and every cut is COUNTED in the payload. */
export const MAX_GHOSTS = 4_000;
export const MAX_GHOST_EDGES = 40_000;
export const MAX_NODES_PAGE = 100;

const GEOIP_NOTE = "GeoIP-derived; a location is a database's claim, not a measurement";
const TOPOLOGY_NOTE = "gossip graph: addresses peers advertised, NOT live connections";
const CONCENTRATION_NOTE = "grouped by ASN, never clustered into entities: a floor";

const clientOf = (row: { user_agent: string | null }) =>
  classifyUserAgent(row.user_agent).client ?? NET_UNIDENTIFIED_CLIENT;
const versionOf = (row: { user_agent: string | null }) => classifyUserAgent(row.user_agent).version;
const netOf = (network: string): NetPeerNetwork =>
  network === "ipv6" ? "ipv6" : network === "torv3" ? "torv3" : "ipv4";
const key = (host: string, port: number) => `${host}:${port}`;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function isTor(row: { network: string; tor_exit: boolean }): boolean {
  return row.network === "torv3" || row.tor_exit;
}

function countBy<T>(items: T[], keyOf: (item: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = keyOf(item);
    if (k === null) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function deriveCrawls(snap: NetmapSnapshot): NetCrawlHistory {
  return {
    crawls: snap.crawls.map((c) => ({
      startedAt: c.started_at,
      finishedAt: c.finished_at,
      attempted: c.attempted,
      reachable: c.reachable,
      newNodes: c.new_nodes,
    })),
    total: snap.crawlsTotal,
    firstStartedAt: snap.firstCrawlStartedAt,
    truncated: snap.crawls.length < snap.crawlsTotal || snap.crawlsTotal > CRAWL_HISTORY_LIMIT,
  };
}

export function deriveSummary(snap: NetmapSnapshot): NetSummary {
  const live = snap.live;
  const total = live.length;
  const byClient = new Map<string, { count: number; reached: number; attempted: number }>();
  const versions = new Map<string, { client: string; version: string; count: number }>();
  const protocols = new Map<number, number>();
  for (const n of live) {
    const client = clientOf(n);
    const entry = byClient.get(client) ?? { count: 0, reached: 0, attempted: 0 };
    entry.count += 1;
    entry.reached += n.reached;
    entry.attempted += n.attempted;
    byClient.set(client, entry);
    const version = versionOf(n);
    if (classifyUserAgent(n.user_agent).client && version) {
      const k = `${client} ${version}`;
      const v = versions.get(k) ?? { client, version, count: 0 };
      v.count += 1;
      versions.set(k, v);
    }
    if (n.protocol_version !== null) {
      protocols.set(n.protocol_version, (protocols.get(n.protocol_version) ?? 0) + 1);
    }
  }
  const pings = live.map((n) => n.ping_ms).filter((p): p is number => p !== null);
  const everReachable = total + snap.ghosts.filter((g) => g.last_reachable !== null).length;
  const known = total + snap.ghosts.length;
  const ipv6Known =
    live.filter((n) => n.network === "ipv6").length +
    snap.ghosts.filter((g) => g.network === "ipv6").length;
  const crawls = snap.crawls;
  const first = snap.firstCrawlStartedAt;
  const last = crawls.length > 0 ? crawls[crawls.length - 1]!.finished_at : null;
  const intervalSeconds =
    first !== null && last !== null && snap.crawlsTotal >= 2
      ? Math.round((last - first) / (snap.crawlsTotal - 1))
      : null;
  return {
    basis: "floor",
    reachable: total,
    windowSeconds: REACHABLE_WINDOW_SEC,
    known,
    everReachable,
    neverAnswered: known - everReachable,
    ipv6Known,
    ipv6Reachable: live.filter((n) => n.network === "ipv6").length,
    torKnown: live.filter(isTor).length + snap.ghosts.filter(isTor).length,
    countries: new Set(live.map((n) => n.country).filter((c) => c !== null)).size,
    asns: new Set(live.map((n) => n.asn).filter((a) => a !== null)).size,
    answeredEveryCrawl: share(
      live.filter((n) => n.attempted > 0 && n.reached === n.attempted).length,
      total,
    ),
    medianPingMs: median(pings),
    avgPingMs:
      pings.length === 0 ? null : Math.round(pings.reduce((s, p) => s + p, 0) / pings.length),
    pingBasis: "crawler-relative (Vienna)",
    clients: [...byClient.entries()]
      .map(([client, e]) => ({
        client,
        ...share(e.count, total),
        answerRate: share(e.reached, e.attempted),
      }))
      .sort((a, b) => b.numerator - a.numerator || a.client.localeCompare(b.client)),
    versions: [...versions.values()].sort(
      (a, b) =>
        b.count - a.count || a.client.localeCompare(b.client) || a.version.localeCompare(b.version),
    ),
    protocolVersions: [...protocols.entries()]
      .map(([protocolVersion, count]) => ({ protocolVersion, count }))
      .sort((a, b) => b.count - a.count || b.protocolVersion - a.protocolVersion),
    crawls: {
      count: snap.crawlsTotal,
      firstStartedAt: first,
      lastFinishedAt: last,
      intervalSeconds,
    },
    asOf: snap.at,
  };
}

export function deriveMap(snap: NetmapSnapshot): NetMap {
  const cells = bucketNodesToCells(
    snap.live.map((n) => ({
      lat: n.lat,
      lon: n.lon,
      city: n.city,
      country: n.country,
      client: clientOf(n),
      asn: n.asn,
      asnOrg: n.asn_org,
      pingMs: n.ping_ms,
      reached: n.reached,
      attempted: n.attempted,
    })),
    CELL_DEGREES,
  );
  const ghostCells = new Map<string, { lat: number; lon: number; count: number }>();
  for (const g of snap.ghosts) {
    if (g.lat === null || g.lon === null) continue;
    const lat = cellCentre(g.lat, CELL_DEGREES);
    const lon = cellCentre(g.lon, CELL_DEGREES);
    const k = `${lat}:${lon}`;
    const cell = ghostCells.get(k) ?? { lat, lon, count: 0 };
    cell.count += 1;
    ghostCells.set(k, cell);
  }
  const UNPLACED = "\u0000";
  const countries = countBy(snap.live, (n) => n.country ?? UNPLACED);
  return {
    basis: "floor",
    note: GEOIP_NOTE,
    cellDegrees: CELL_DEGREES,
    cells,
    ghostCells: [...ghostCells.values()],
    ghostTotal: snap.ghosts.length,
    unplaced: snap.live.filter((n) => n.lat === null || n.lon === null).length,
    countries: [...countries.entries()]
      .map(([c, count]) => ({ country: c === UNPLACED ? null : c, count }))
      .sort((a, b) => b.count - a.count || (a.country ?? "").localeCompare(b.country ?? "")),
    asOf: snap.at,
  };
}

/** Hub order: client by count desc, then country, then id, so a drawing does not reshuffle. */
function orderedHubs(snap: NetmapSnapshot): LiveNodeRow[] {
  const clientCounts = countBy(snap.live, clientOf);
  return [...snap.live].sort((a, b) => {
    const ca = clientOf(a);
    const cb = clientOf(b);
    const diff = (clientCounts.get(cb) ?? 0) - (clientCounts.get(ca) ?? 0);
    if (diff !== 0) return diff;
    if (ca !== cb) return ca.localeCompare(cb);
    const country = (a.country ?? "").localeCompare(b.country ?? "");
    if (country !== 0) return country;
    return anonId(a.host, a.port).localeCompare(anonId(b.host, b.port));
  });
}

/**
 * Trims advertiser lists round-robin to fit `MAX_GHOST_EDGES`: the largest cutoff such that
 * summing `min(len, cutoff)` stays under the cap, never below one advertiser per ghost.
 */
function edgeCutoff(lengths: number[]): number {
  const total = lengths.reduce((s, l) => s + l, 0);
  if (total <= MAX_GHOST_EDGES) return Infinity;
  let cutoff = 1;
  for (;;) {
    const next = lengths.reduce((s, l) => s + Math.min(l, cutoff + 1), 0);
    if (next > MAX_GHOST_EDGES) return cutoff;
    cutoff += 1;
  }
}

export function deriveTopology(snap: NetmapSnapshot, scope: NetTopologyScope): NetTopology {
  const hubsRows = orderedHubs(snap);
  const index = new Map<string, number>();
  hubsRows.forEach((n, i) => index.set(key(n.host, n.port), i));
  const outDeg = new Map<number, number>();
  const inDeg = new Map<number, number>();
  const hubEdges: Array<[number, number]> = [];
  const ghostAdvertisers = new Map<string, number[]>();
  for (const l of snap.links) {
    const from = index.get(key(l.from_host, l.from_port));
    if (from === undefined) continue;
    outDeg.set(from, (outDeg.get(from) ?? 0) + 1);
    const to = index.get(key(l.to_host, l.to_port));
    if (to !== undefined) {
      hubEdges.push([from, to]);
      inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
    } else {
      const k = key(l.to_host, l.to_port);
      const list = ghostAdvertisers.get(k) ?? [];
      list.push(from);
      ghostAdvertisers.set(k, list);
    }
  }
  const hubs: NetHub[] = hubsRows.map((n, i) => ({
    id: anonId(n.host, n.port),
    client: clientOf(n),
    version: versionOf(n),
    country: n.country,
    asnOrg: n.asn_org,
    outDeg: outDeg.get(i) ?? 0,
    inDeg: inDeg.get(i) ?? 0,
  }));
  const base: NetTopology = {
    note: TOPOLOGY_NOTE,
    scope,
    hubs,
    hubEdges,
    edgesTotal: snap.links.length,
    asOf: snap.at,
  };
  if (scope !== "all") return base;

  const ghostRows = new Map<string, GhostNodeRow>();
  for (const g of snap.ghosts) ghostRows.set(key(g.host, g.port), g);
  // Most-advertised first: a lone advertisement is the least informative point to keep.
  const candidates = [...ghostAdvertisers.entries()]
    .filter(([k]) => ghostRows.has(k))
    .map(([k, by]) => [k, [...new Set(by)].sort((a, b) => a - b)] as [string, number[]])
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const kept = candidates.slice(0, MAX_GHOSTS);
  const cutoff = edgeCutoff(kept.map(([, by]) => by.length));
  const ghosts: NetGhost[] = kept.map(([k, by]) => {
    const g = ghostRows.get(k)!;
    return {
      id: anonId(g.host, g.port),
      network: netOf(g.network),
      torExit: g.tor_exit,
      country: g.country,
      failure: g.last_attempt === null ? null : classifyProbeFailure(g.last_error),
      by: by.slice(0, cutoff),
    };
  });
  return {
    ...base,
    ghosts,
    ghostsTotal: candidates.length,
    ghostEdgesDrawn: ghosts.reduce((s, g) => s + g.by.length, 0),
  };
}

export function deriveHealth(snap: NetmapSnapshot): NetHealth {
  const live = snap.live;
  const total = live.length;
  const latency = histogram(
    NET_LATENCY_BUCKETS,
    live.map((n) => n.ping_ms).filter((p): p is number => p !== null),
  );
  const uptime = histogram(
    NET_UPTIME_BUCKETS,
    live.filter((n) => n.attempted > 0).map((n) => n.reached / n.attempted),
  );
  const asns = new Map<string, { asn: number | null; org: string; count: number }>();
  for (const n of live) {
    if (n.asn_org === null && n.asn === null) continue;
    const k = `${n.asn ?? "null"}|${n.asn_org ?? ""}`;
    const e = asns.get(k) ?? { asn: n.asn, org: n.asn_org ?? `AS${n.asn}`, count: 0 };
    e.count += 1;
    asns.set(k, e);
  }
  const topAsns = [...asns.values()]
    .sort((a, b) => b.count - a.count || a.org.localeCompare(b.org))
    .map((e) => ({ asn: e.asn, org: e.org, ...share(e.count, total) }));
  const subnets = countBy(live, (n) => subnet24(n.host));
  const failures = new Map<NetProbeFailure, number>();
  for (const g of snap.ghosts) {
    if (g.last_attempt === null || g.last_reachable !== null) continue;
    const f = classifyProbeFailure(g.last_error);
    if (f === null) continue;
    failures.set(f, (failures.get(f) ?? 0) + 1);
  }
  const summary = deriveSummary(snap);
  return {
    basis: "floor",
    pingBasis: "crawler-relative (Vienna)",
    latency,
    uptime,
    concentration: {
      note: CONCENTRATION_NOTE,
      topAsns: topAsns.slice(0, 8),
      top3: share(
        topAsns.slice(0, 3).reduce((s, a) => s + a.numerator, 0),
        total,
      ),
    },
    clusteredSubnets: [...subnets.entries()]
      .filter(([, count]) => count > 1)
      .map(([subnet, count]) => ({ subnet, count }))
      .sort((a, b) => b.count - a.count || a.subnet.localeCompare(b.subnet))
      .slice(0, 12),
    facts: {
      known: summary.known,
      everReachable: summary.everReachable,
      neverAnswered: summary.neverAnswered,
      torKnown: summary.torKnown,
      ipv6Known: summary.ipv6Known,
      ipv6Reachable: summary.ipv6Reachable,
      failures: [...failures.entries()]
        .map(([failure, count]) => ({ failure, count }))
        .sort((a, b) => b.count - a.count),
      crawls: snap.crawlsTotal,
    },
    asOf: snap.at,
  };
}

function toNodeRow(n: LiveNodeRow): NetNodeRow {
  return {
    id: anonId(n.host, n.port),
    client: clientOf(n),
    version: versionOf(n),
    protocolVersion: n.protocol_version,
    network: netOf(n.network),
    country: n.country,
    city: n.city,
    asn: n.asn,
    asnOrg: n.asn_org,
    pingMs: n.ping_ms,
    reached: n.reached,
    attempted: n.attempted,
    firstSeen: n.first_seen,
    lastReachable: n.last_reachable,
  };
}

const uptimeBps = reliabilityBps;

/**
 * The nodes list: filter before the slice, sort `(uptimeBps DESC, id DESC)`, which is the
 * ordering `cursorSlice` implements, and echo what was applied. In memory because the set is
 * bounded by the number of listening Zcash nodes (~60 to 300); past a few thousand this would move
 * to SQL with the same predicate, and the tie test in `netmap-routes.test.ts` covers either.
 */
export function deriveNodesPage(
  snap: NetmapSnapshot,
  filters: NetNodeFilters,
  query: { before?: string; after?: string; limit: number },
): NetNodePage {
  const rows = snap.live
    .map(toNodeRow)
    .filter((r) => filters.client === null || r.client === filters.client)
    .filter((r) => filters.asn === null || r.asn === filters.asn)
    .sort((a, b) => uptimeBps(b) - uptimeBps(a) || b.id.localeCompare(a.id));
  const page = cursorSlice(rows, (r) => ({ sortKey: uptimeBps(r), id: r.id }), {
    ...query,
    limit: Math.min(Math.max(1, query.limit), MAX_NODES_PAGE),
  });
  return {
    items: page.items,
    nextCursor: page.nextCursor,
    prevCursor: page.prevCursor,
    applied: filters,
    total: rows.length,
    denominator: snap.live.length,
  };
}

/** The cursor a row would mint, exported so a test can straddle a tie deliberately. */
export function nodeCursor(row: NetNodeRow): string {
  return encodeCursor(uptimeBps(row), row.id);
}

/**
 * The releases answering nodes run: today's groups from the snapshot's own live rows (so they
 * sum to the same `reachable` every other tab prints), and the crawler's daily record beneath
 * them. No upgrade verdict is drawn here — see `NetReleases`.
 */
export function deriveReleases(snap: NetmapSnapshot): NetReleases {
  const groups = classifyReleaseGroups(rawReleaseGroups(snap.live, snap.recentBlocks));
  const byDay = new Map<string, RawReleaseGroup[]>();
  for (const r of snap.releaseDays) {
    const list = byDay.get(r.day) ?? [];
    list.push({
      userAgent: r.user_agent === "" ? null : r.user_agent,
      protocolVersion: r.protocol_version < 0 ? null : r.protocol_version,
      nodes: r.nodes,
      behindTip: r.behind_tip,
      tipUnknown: r.tip_unknown,
    });
    byDay.set(r.day, list);
  }
  const history: NetReleaseDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, raw]) => ({ day, groups: classifyReleaseGroups(raw) }));
  return {
    basis: "floor",
    windowSeconds: REACHABLE_WINDOW_SEC,
    answering: snap.live.length,
    behindTipBlocks: BEHIND_TIP_BLOCKS,
    groups,
    history,
    asOf: snap.at,
  };
}

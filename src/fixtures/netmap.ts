import {
  NET_LATENCY_BUCKETS,
  NET_UPTIME_BUCKETS,
  bucketNodesToCells,
  cellCentre,
  histogram,
  reliabilityBps,
  share,
  type NetCrawl,
  type NetCrawlHistory,
  type NetGhost,
  type NetHealth,
  type NetHub,
  type NetMap,
  type NetNodeFilters,
  type NetNodePage,
  type NetNodeRow,
  type NetPeers,
  type NetProbeFailure,
  type NetReleaseDay,
  type NetReleaseGroup,
  type NetReleases,
  type NetSummary,
  type NetTopology,
  type NetTopologyScope,
} from "@/domain";
import { cursorSlice } from "@/data/cursor";
import { TIP_TIME } from "./ids";

/**
 * The node map, for the fixture build.
 *
 * Shaped like the crawler's real data (Zebra, Zakura and a few zcashd nodes; a handful of
 * hosting providers and countries; a large ghost cell) at a size that exercises every
 * control: forty hubs so `/network/nodes` has two pages at 25, with more than 25 tied at
 * perfect reliability so the keyset's tiebreak straddles a page boundary; a client with no
 * version string; a node GeoIP could not place; ghosts of every failure class, never-dialled
 * IPv6 and Tor exits; and a crawl history including a restart's zeros.
 *
 * No address anywhere: ids are hashes of labels. Every derived figure (cells, histograms,
 * shares, the keyset) goes through the same domain helpers the server uses.
 */

const CELL_DEGREES = 1;
const REACHABLE_WINDOW_SEC = 24 * 60 * 60;
const FIRST_CRAWL_AT = TIP_TIME - 7 * 3600;

/** A 32-bit FNV-1a mixed to 12 hex characters: a stable, address-free id for a label. */
function hash12(label: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < label.length; i += 1) {
    h1 = Math.imul(h1 ^ label.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ label.charCodeAt(i), 0x811c9dc5) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 12);
}

interface FixtureHub extends NetNodeRow {
  lat: number | null;
  lon: number | null;
}

interface Place {
  country: string;
  city: string | null;
  lat: number;
  lon: number;
}

const PLACES: Record<string, Place> = {
  nyc: { country: "United States", city: "New York", lat: 40.7, lon: -74.0 },
  clifton: { country: "United States", city: "Clifton", lat: 40.86, lon: -74.16 },
  sf: { country: "United States", city: "San Francisco", lat: 37.77, lon: -122.42 },
  santaclara: { country: "United States", city: "Santa Clara", lat: 37.35, lon: -121.95 },
  dallas: { country: "United States", city: "Dallas", lat: 32.78, lon: -96.8 },
  ashburn: { country: "United States", city: "Ashburn", lat: 39.04, lon: -77.49 },
  frankfurt: { country: "Germany", city: "Frankfurt am Main", lat: 50.11, lon: 8.68 },
  nuremberg: { country: "Germany", city: "Nuremberg", lat: 49.45, lon: 11.08 },
  falkenstein: { country: "Germany", city: "Falkenstein", lat: 50.48, lon: 12.37 },
  tokyo: { country: "Japan", city: "Tokyo", lat: 35.69, lon: 139.69 },
  helsinki: { country: "Finland", city: "Helsinki", lat: 60.17, lon: 24.94 },
  singapore: { country: "Singapore", city: "Singapore", lat: 1.35, lon: 103.82 },
  toronto: { country: "Canada", city: "Toronto", lat: 43.65, lon: -79.38 },
  amsterdam: { country: "The Netherlands", city: "Amsterdam", lat: 52.37, lon: 4.9 },
  kyiv: { country: "Ukraine", city: "Kyiv", lat: 50.45, lon: 30.52 },
  bengaluru: { country: "India", city: "Bengaluru", lat: 12.97, lon: 77.59 },
  paris: { country: "France", city: "Paris", lat: 48.86, lon: 2.35 },
  hongkong: { country: "Hong Kong", city: "Hong Kong", lat: 22.32, lon: 114.17 },
  slough: { country: "United Kingdom", city: "Slough", lat: 51.51, lon: -0.59 },
  muscat: { country: "Oman", city: "Muscat", lat: 23.59, lon: 58.41 },
};

const ASNS: Record<string, { asn: number; org: string }> = {
  do: { asn: 14061, org: "DigitalOcean, LLC" },
  hetzner: { asn: 24940, org: "Hetzner Online GmbH" },
  google: { asn: 396982, org: "Google LLC" },
  netcup: { asn: 197540, org: "netcup GmbH" },
  akamai: { asn: 63949, org: "Akamai Connected Cloud" },
  att: { asn: 7018, org: "AT&T Enterprises, LLC" },
  ionos: { asn: 8560, org: "IONOS SE" },
  ovh: { asn: 16276, org: "OVH SAS" },
  kddi: { asn: 2516, org: "KDDI CORPORATION" },
  omantel: { asn: 28885, org: "Oman Telecommunications Company" },
};

/** [client, version, place, asn, reached, attempted, ping, protocol] */
type Spec = [
  string,
  string | null,
  keyof typeof PLACES | null,
  keyof typeof ASNS,
  number,
  number,
  number | null,
  number | null,
];

// 40 hubs. 28 tie at 100% — deliberately more than one page — so paging has to tiebreak on id.
const SPECS: Spec[] = [
  ["Zebra", "6.3.0", "nyc", "do", 55, 55, 73, 170160],
  ["Zebra", "6.3.0", "clifton", "do", 54, 54, 268, 170160],
  ["Zebra", "6.3.0", "frankfurt", "hetzner", 55, 55, 39, 170160],
  ["Zebra", "6.3.0", "nuremberg", "hetzner", 53, 53, 28, 170160],
  ["Zebra", "6.3.0", "ashburn", "google", 54, 54, 112, 170160],
  ["Zebra", "6.3.0", "tokyo", "kddi", 52, 52, 302, 170160],
  ["Zebra", "6.3.0", "helsinki", "hetzner", 55, 55, 45, 170160],
  ["Zebra", "7.0.0-rc.0", "singapore", "do", 53, 53, 541, 170180],
  ["Zebra", "7.0.0-rc.0", "amsterdam", "do", 55, 55, 57, 170180],
  ["Zebra", "6.2.3", "sf", "google", 54, 54, 259, 170160],
  ["Zebra", "6.2.3", "dallas", "att", 52, 52, 283, 170160],
  ["Zebra", "6.2.3", "falkenstein", "hetzner", 55, 55, 30, 170160],
  ["Zebra", "6.2.3", "toronto", "ovh", 53, 53, 120, 170160],
  ["Zebra", "6.2.3", "paris", "ovh", 54, 54, 35, 170160],
  ["Zebra", "6.2.3", "kyiv", "hetzner", 50, 55, 61, 170160],
  ["Zebra", "6.2.0", "nyc", "do", 48, 55, 86, 170150],
  ["Zebra", "6.2.0", "hongkong", "akamai", 33, 55, 419, 170150],
  ["Zebra", "6.2.0", "santaclara", "do", 30, 55, 476, 170150],
  ["Zebra", "6.2.0", "bengaluru", "do", 23, 55, 559, 170150],
  ["Zebra", "5.1.0", "dallas", "att", 7, 55, 2983, 170140],
  ["Zebra", "5.1.0", "muscat", "omantel", 4, 54, 1274, 170140],
  ["Zakura", "1.6.0", "slough", "do", 55, 55, 73, 170190],
  ["Zakura", "1.6.0", "nyc", "do", 54, 54, 896, 170190],
  ["Zakura", "1.6.0", "amsterdam", "do", 55, 55, 57, 170190],
  ["Zakura", "1.6.0", "singapore", "do", 53, 53, 541, 170190],
  ["Zakura", "1.6.0", "frankfurt", "do", 54, 54, 39, 170190],
  ["Zakura", "1.5.0", "nuremberg", "hetzner", 53, 53, 28, 170190],
  ["Zakura", "1.5.0", "clifton", "do", 53, 53, 267, 170190],
  ["Zakura", "1.5.0", "santaclara", "do", 52, 52, 491, 170190],
  ["Zakura", "1.4.1", "bengaluru", "do", 54, 54, 559, 170160],
  ["Zakura", "1.5.1", "clifton", "do", 54, 54, 268, 170190],
  ["Zakura", "1.5.1", "helsinki", "hetzner", 55, 55, 45, 170190],
  ["Zakura", "1.2.0", "sf", "akamai", 53, 53, 388, 170160],
  ["Zakura", null, "ashburn", "google", 51, 55, 108, 170160],
  ["zcashd", "6.12.1", "falkenstein", "hetzner", 54, 54, 23, 170140],
  ["zcashd", "6.12.1", "tokyo", "kddi", 49, 55, 300, 170140],
  ["zcashd", "6.11.0", "kyiv", "hetzner", 20, 55, 65, 170140],
  ["Unidentified", null, null, "netcup", 54, 54, 31, 170160],
  ["Unidentified", null, "nuremberg", "netcup", 12, 55, 29, null],
  ["Unidentified", null, "paris", "ionos", 3, 55, 2035, 170150],
];

const HUBS: FixtureHub[] = SPECS.map(
  ([client, version, placeKey, asnKey, reached, attempted, ping, pv], i) => {
    const place = placeKey ? PLACES[placeKey]! : null;
    const asn = ASNS[asnKey]!;
    return {
      id: hash12(`fixture-hub-${i}`),
      client,
      version,
      protocolVersion: pv,
      network: "ipv4",
      country: place?.country ?? null,
      city: place?.city ?? null,
      asn: asn.asn,
      asnOrg: asn.org,
      pingMs: ping,
      reached,
      attempted,
      // Older nodes first saw at the first crawl, newcomers spread over the day.
      firstSeen: FIRST_CRAWL_AT + (i % 5 === 4 ? (i + 1) * 600 : 0),
      lastReachable: TIP_TIME - (i % 7) * 240,
      lat: place?.lat ?? null,
      lon: place?.lon ?? null,
    };
  },
);

interface FixtureGhost extends NetGhost {
  lat: number | null;
  lon: number | null;
}

/** Deterministic PRNG (mulberry32), so the set never shifts between builds. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GHOST_PLACES: Array<[Place | null, number]> = [
  [{ country: "United States", city: null, lat: 40.5, lon: -74.5 }, 90],
  [PLACES.frankfurt!, 30],
  [PLACES.ashburn!, 25],
  [PLACES.sf!, 20],
  [PLACES.singapore!, 15],
  [PLACES.tokyo!, 15],
  [PLACES.amsterdam!, 12],
  [PLACES.helsinki!, 10],
  [{ country: "Brazil", city: "São Paulo", lat: -23.55, lon: -46.63 }, 10],
  [{ country: "Australia", city: "Sydney", lat: -33.87, lon: 151.21 }, 8],
  [{ country: "South Africa", city: "Johannesburg", lat: -26.2, lon: 28.04 }, 5],
  [{ country: "Russia", city: "Moscow", lat: 55.76, lon: 37.62 }, 8],
  [PLACES.kyiv!, 6],
  [PLACES.paris!, 10],
  [PLACES.toronto!, 8],
  [null, 28], // GeoIP placed nothing
];

const GHOSTS: FixtureGhost[] = (() => {
  const rnd = mulberry32(0x5eed);
  const failures: NetProbeFailure[] = [
    "timeout",
    "timeout",
    "timeout",
    "refused",
    "refused",
    "unreachable",
    "closed",
    "reset",
  ];
  const out: FixtureGhost[] = [];
  let n = 0;
  for (const [place, count] of GHOST_PLACES) {
    for (let i = 0; i < count; i += 1) {
      const roll = rnd();
      const isV6 = roll < 0.1;
      const isTor = !isV6 && roll < 0.22;
      // Well-known addresses are advertised by many hubs; most are known to one or two.
      const advertisers = rnd() < 0.15 ? 6 + Math.floor(rnd() * 20) : 1 + Math.floor(rnd() * 3);
      const by = [
        ...new Set(Array.from({ length: advertisers }, () => Math.floor(rnd() * HUBS.length))),
      ].sort((a, b) => a - b);
      out.push({
        id: hash12(`fixture-ghost-${n}`),
        network: isV6 ? "ipv6" : "ipv4",
        torExit: isTor,
        country: place?.country ?? null,
        failure: isV6 ? null : failures[Math.floor(rnd() * failures.length)]!,
        by,
        lat: place ? place.lat + (rnd() - 0.5) * 0.6 : null,
        lon: place ? place.lon + (rnd() - 0.5) * 0.6 : null,
      });
      n += 1;
    }
  }
  return out;
})();

/** The first day's shape: seeds, a restart storm's zeros, then a plateau. */
const REACHABLE_PER_CRAWL = [
  8, 0, 0, 0, 0, 8, 0, 8, 24, 33, 35, 33, 36, 37, 39, 37, 36, 36, 37, 36, 37, 39, 36, 37, 34, 36,
  37, 37, 37, 38, 38, 37, 38, 39, 43, 42, 38, 36, 41, 41, 40, 37, 39, 39, 41, 38, 43, 41, 40, 38,
  35, 41, 40, 38, 40, 35, 33, 35, 35, 33, 37,
];
const NEW_PER_CRAWL = [
  0, 0, 0, 0, 0, 0, 0, 480, 222, 31, 24, 44, 102, 36, 15, 37, 25, 8, 7, 6, 10, 25, 6, 2, 32, 3, 15,
  25, 3, 24, 12, 11, 13, 5, 8, 9, 6, 12, 15, 3, 11, 1, 19, 10, 12, 20, 4, 2, 10, 4, 8, 2, 20, 13, 5,
  10, 1, 5, 5, 16, 1,
];

const CRAWLS: NetCrawl[] = REACHABLE_PER_CRAWL.map((reachable, i) => {
  const startedAt = FIRST_CRAWL_AT + i * 420;
  return {
    startedAt,
    finishedAt: startedAt + 240,
    attempted: 37 + NEW_PER_CRAWL.slice(0, i + 1).reduce((s, n) => s + n, 0),
    reachable,
    newNodes: NEW_PER_CRAWL[i]!,
  };
});

const KNOWN = HUBS.length + GHOSTS.length;

/** What leaves for the wire: the coordinates stay here, a placed hub is a cell, never a point. */
function nodeRowOnWire(h: FixtureHub): NetNodeRow {
  return {
    id: h.id,
    client: h.client,
    version: h.version,
    protocolVersion: h.protocolVersion,
    network: h.network,
    country: h.country,
    city: h.city,
    asn: h.asn,
    asnOrg: h.asnOrg,
    pingMs: h.pingMs,
    reached: h.reached,
    attempted: h.attempted,
    firstSeen: h.firstSeen,
    lastReachable: h.lastReachable,
  };
}

function ghostOnWire(g: FixtureGhost): NetGhost {
  return {
    id: g.id,
    network: g.network,
    torExit: g.torExit,
    country: g.country,
    failure: g.failure,
    by: g.by,
  };
}

export function getNetworkCrawls(): NetCrawlHistory {
  return {
    crawls: CRAWLS,
    total: CRAWLS.length + 3, // three unfinished cycles at the storm
    firstStartedAt: FIRST_CRAWL_AT,
    truncated: true,
  };
}

export function getNetworkSummary(): NetSummary {
  const total = HUBS.length;
  const clients = new Map<string, { count: number; reached: number; attempted: number }>();
  const versions = new Map<string, { client: string; version: string; count: number }>();
  const protocols = new Map<number, number>();
  for (const h of HUBS) {
    const e = clients.get(h.client) ?? { count: 0, reached: 0, attempted: 0 };
    e.count += 1;
    e.reached += h.reached;
    e.attempted += h.attempted;
    clients.set(h.client, e);
    if (h.version && h.client !== "Unidentified") {
      const k = `${h.client} ${h.version}`;
      const v = versions.get(k) ?? { client: h.client, version: h.version, count: 0 };
      v.count += 1;
      versions.set(k, v);
    }
    if (h.protocolVersion !== null) {
      protocols.set(h.protocolVersion, (protocols.get(h.protocolVersion) ?? 0) + 1);
    }
  }
  const pings = HUBS.map((h) => h.pingMs)
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);
  const last = CRAWLS[CRAWLS.length - 1]!;
  return {
    basis: "floor",
    reachable: total,
    windowSeconds: REACHABLE_WINDOW_SEC,
    known: KNOWN,
    everReachable: total + 12,
    neverAnswered: KNOWN - total - 12,
    ipv6Known: GHOSTS.filter((g) => g.network === "ipv6").length,
    ipv6Reachable: 0,
    torKnown: GHOSTS.filter((g) => g.torExit).length,
    countries: new Set(HUBS.map((h) => h.country).filter((c) => c !== null)).size,
    asns: new Set(HUBS.map((h) => h.asn)).size,
    answeredEveryCrawl: share(HUBS.filter((h) => h.reached === h.attempted).length, total),
    medianPingMs: pings[pings.length >> 1] ?? null,
    avgPingMs: Math.round(pings.reduce((s, p) => s + p, 0) / pings.length),
    pingBasis: "crawler-relative (Vienna)",
    clients: [...clients.entries()]
      .map(([client, e]) => ({
        client,
        ...share(e.count, total),
        answerRate: share(e.reached, e.attempted),
      }))
      .sort((a, b) => b.numerator - a.numerator || a.client.localeCompare(b.client)),
    versions: [...versions.values()].sort(
      (a, b) => b.count - a.count || a.client.localeCompare(b.client),
    ),
    protocolVersions: [...protocols.entries()]
      .map(([protocolVersion, count]) => ({ protocolVersion, count }))
      .sort((a, b) => b.count - a.count),
    crawls: {
      count: CRAWLS.length + 3,
      firstStartedAt: FIRST_CRAWL_AT,
      lastFinishedAt: last.finishedAt,
      intervalSeconds: 420,
    },
    asOf: TIP_TIME,
  };
}

export function getNetworkMap(): NetMap {
  const cells = bucketNodesToCells(
    HUBS.map((h) => ({
      lat: h.lat,
      lon: h.lon,
      city: h.city,
      country: h.country,
      client: h.client,
      asn: h.asn,
      asnOrg: h.asnOrg,
      pingMs: h.pingMs,
      reached: h.reached,
      attempted: h.attempted,
    })),
    CELL_DEGREES,
  );
  const ghostCells = new Map<string, { lat: number; lon: number; count: number }>();
  for (const g of GHOSTS) {
    if (g.lat === null || g.lon === null) continue;
    const lat = cellCentre(g.lat, CELL_DEGREES);
    const lon = cellCentre(g.lon, CELL_DEGREES);
    const k = `${lat}:${lon}`;
    const c = ghostCells.get(k) ?? { lat, lon, count: 0 };
    c.count += 1;
    ghostCells.set(k, c);
  }
  const countries = new Map<string | null, number>();
  for (const h of HUBS) countries.set(h.country, (countries.get(h.country) ?? 0) + 1);
  return {
    basis: "floor",
    note: "GeoIP-derived; a location is a database's claim, not a measurement",
    cellDegrees: CELL_DEGREES,
    cells,
    ghostCells: [...ghostCells.values()],
    ghostTotal: GHOSTS.length,
    unplaced: HUBS.filter((h) => h.lat === null).length,
    countries: [...countries.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count || (a.country ?? "").localeCompare(b.country ?? "")),
    asOf: TIP_TIME,
  };
}

/** Hub→hub gossip: every hub advertises the next three, the first two advertise everyone. */
const HUB_EDGES: Array<[number, number]> = (() => {
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < HUBS.length; i += 1) {
    for (let d = 1; d <= 3; d += 1) edges.push([i, (i + d) % HUBS.length]);
    if (i < 2)
      for (let j = 0; j < HUBS.length; j += 1) if (j !== i && j > i + 3) edges.push([i, j]);
  }
  return edges;
})();

export function getNetworkTopology(scope: NetTopologyScope): NetTopology {
  const outDeg = new Map<number, number>();
  const inDeg = new Map<number, number>();
  for (const [a, b] of HUB_EDGES) {
    outDeg.set(a, (outDeg.get(a) ?? 0) + 1);
    inDeg.set(b, (inDeg.get(b) ?? 0) + 1);
  }
  for (const g of GHOSTS) for (const a of g.by) outDeg.set(a, (outDeg.get(a) ?? 0) + 1);
  const hubs: NetHub[] = HUBS.map((h, i) => ({
    id: h.id,
    client: h.client,
    version: h.version,
    country: h.country,
    asnOrg: h.asnOrg,
    outDeg: outDeg.get(i) ?? 0,
    inDeg: inDeg.get(i) ?? 0,
  }));
  const ghostEdges = GHOSTS.reduce((s, g) => s + g.by.length, 0);
  const base: NetTopology = {
    note: "gossip graph: addresses peers advertised, NOT live connections",
    scope,
    hubs,
    hubEdges: HUB_EDGES,
    edgesTotal: HUB_EDGES.length + ghostEdges,
    asOf: TIP_TIME,
  };
  if (scope !== "all") return base;
  return {
    ...base,
    ghosts: GHOSTS.map(ghostOnWire),
    ghostsTotal: GHOSTS.length,
    ghostEdgesDrawn: ghostEdges,
  };
}

export function getNetworkHealth(): NetHealth {
  const total = HUBS.length;
  const asns = new Map<number, { org: string; count: number }>();
  for (const h of HUBS) {
    const e = asns.get(h.asn!) ?? { org: h.asnOrg!, count: 0 };
    e.count += 1;
    asns.set(h.asn!, e);
  }
  const topAsns = [...asns.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].org.localeCompare(b[1].org))
    .map(([asn, e]) => ({ asn, org: e.org, ...share(e.count, total) }));
  const failures = new Map<NetProbeFailure, number>();
  for (const g of GHOSTS)
    if (g.failure) failures.set(g.failure, (failures.get(g.failure) ?? 0) + 1);
  const summary = getNetworkSummary();
  return {
    basis: "floor",
    pingBasis: "crawler-relative (Vienna)",
    latency: histogram(
      NET_LATENCY_BUCKETS,
      HUBS.map((h) => h.pingMs).filter((p): p is number => p !== null),
    ),
    uptime: histogram(
      NET_UPTIME_BUCKETS,
      HUBS.map((h) => h.reached / h.attempted),
    ),
    concentration: {
      note: "grouped by ASN, never clustered into entities: a floor",
      topAsns: topAsns.slice(0, 8),
      top3: share(
        topAsns.slice(0, 3).reduce((s, a) => s + a.numerator, 0),
        total,
      ),
    },
    // Two hubs share one /24 in the fixture, labelled and never addressed.
    clusteredSubnets: [{ subnet: "10.0.7.x", count: 2 }],
    facts: {
      known: summary.known,
      everReachable: summary.everReachable,
      neverAnswered: summary.neverAnswered,
      torKnown: summary.torKnown,
      ipv6Known: summary.ipv6Known,
      ipv6Reachable: 0,
      failures: [...failures.entries()]
        .map(([failure, count]) => ({ failure, count }))
        .sort((a, b) => b.count - a.count),
      crawls: summary.crawls.count,
    },
    asOf: TIP_TIME,
  };
}

export function listNetworkNodes(
  query: { before?: string; after?: string; limit: number },
  filters: NetNodeFilters,
): NetNodePage {
  const rows: NetNodeRow[] = HUBS.map(nodeRowOnWire)
    .filter((r) => filters.client === null || r.client === filters.client)
    .filter((r) => filters.asn === null || r.asn === filters.asn)
    .sort((a, b) => reliabilityBps(b) - reliabilityBps(a) || b.id.localeCompare(a.id));
  const page = cursorSlice(rows, (r) => ({ sortKey: reliabilityBps(r), id: r.id }), query);
  return { ...page, applied: filters, total: rows.length, denominator: HUBS.length };
}

export function getNetworkPeers(): NetPeers {
  return {
    basis: "ours",
    count: 325,
    inbound: 300,
    outbound: 25,
    medianPingMs: 143,
    asOf: TIP_TIME,
  };
}

/**
 * Blocks each hub trailed our tip by at its last answer, by hub index; absent means level.
 * Null means unknown (no height declared). The two Zebra 5.1.0 nodes and the zcashd 6.11.0 one
 * sit far behind, so the tab's "behind the tip" figure is exercised by every fixture build; the
 * versionless Zakura and one unidentified node declared no height.
 */
const TIP_LAG: Record<number, number | null> = {
  19: 4_200,
  20: 18_000,
  33: null,
  36: 950,
  38: null,
};
const BEHIND_TIP_BLOCKS = 10;

/** A hub's lag: level unless listed, and a listed null stays null — unknown is not level. */
const tipLagOf = (i: number): number | null => (i in TIP_LAG ? (TIP_LAG[i] ?? null) : 0);

function releaseGroups(
  hubs: readonly FixtureHub[],
  lagOf: (i: number) => number | null,
): NetReleaseGroup[] {
  const groups = new Map<string, NetReleaseGroup>();
  hubs.forEach((h, i) => {
    const version = h.client === "Unidentified" ? null : h.version;
    const k = JSON.stringify([h.client, version, h.protocolVersion]);
    const g = groups.get(k) ?? {
      client: h.client,
      version,
      protocolVersion: h.protocolVersion,
      nodes: 0,
      behindTip: 0,
      tipUnknown: 0,
    };
    g.nodes += 1;
    const lag = lagOf(i);
    if (lag === null) g.tipUnknown += 1;
    else if (lag > BEHIND_TIP_BLOCKS) g.behindTip += 1;
    groups.set(k, g);
  });
  return [...groups.values()].sort((a, b) => b.nodes - a.nodes || a.client.localeCompare(b.client));
}

/**
 * Fourteen recorded days, oldest first. Going back in time, Zakura nodes move off 1.6.0 onto
 * 1.4.1 — so the trend line climbs toward today, which is the shape an upgrade takes — and the
 * last day equals today's groups, the way the crawler's final write of a day is its record.
 */
function releaseHistory(): NetReleaseDay[] {
  const today = new Date(TIP_TIME * 1000);
  const days: NetReleaseDay[] = [];
  for (let back = 13; back >= 0; back -= 1) {
    const date = new Date(today.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    const moved = Math.min(8, Math.ceil(back * 0.7));
    let left = moved;
    const hubs = HUBS.map((h) => {
      if (left > 0 && h.client === "Zakura" && h.protocolVersion === 170_190) {
        left -= 1;
        return { ...h, version: "1.4.1", protocolVersion: 170_160 };
      }
      return h;
    });
    days.push({ day: date, groups: releaseGroups(hubs, (i) => tipLagOf(i)) });
  }
  return days;
}

export function getNetworkReleases(): NetReleases {
  return {
    basis: "floor",
    windowSeconds: REACHABLE_WINDOW_SEC,
    answering: HUBS.length,
    behindTipBlocks: BEHIND_TIP_BLOCKS,
    groups: releaseGroups(HUBS, (i) => tipLagOf(i)),
    history: releaseHistory(),
    asOf: TIP_TIME,
  };
}

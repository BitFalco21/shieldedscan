import { DAY_SECONDS } from "./time";

/**
 * The node map — what this explorer's own P2P crawler can say about the Zcash network.
 *
 * The wire shapes `/chain/network/*` serves (the API speaks domain types), plus the small
 * derivations the server and the fixtures share so a cell, bucket or maturity verdict is
 * computed one way.
 *
 * Three rules hold throughout:
 * - Every count is a floor. A crawler sees listening nodes only; a node accepting no inbound
 *   connection is invisible. `basis: "floor"` travels in the payload.
 * - No address on the wire. The database holds full IPs (needed to re-crawl); the wire carries
 *   country, city, network operator, 1° cells, `/24` labels and 12-hex one-way ids — nothing
 *   reversible.
 * - A percentage names its denominator (`NetShare`), and a location is GeoIP's claim about an
 *   address, never a measurement of a node.
 */

/** A share that always travels with what it was computed from. */
export interface NetShare {
  pct: number;
  numerator: number;
  denominator: number;
}

/** Self-reported client name after the server's user-agent classification; an OPEN set. */
export type NetClient = string;

/** The three clients that carry a mark; anything else renders as neutral ink. */
export const NET_KNOWN_CLIENTS = ["Zebra", "Zakura", "zcashd"] as const;

/** The label a node with no user agent gets — the server's own vocabulary, restated once. */
export const NET_UNIDENTIFIED_CLIENT = "Unidentified";

export type NetPeerNetwork = "ipv4" | "ipv6" | "torv3";

/**
 * Why the LAST probe of a never-answering address failed, as a closed set. The crawler stores
 * the raw socket message (`net_node.last_error`); the wire carries only the class, because a
 * raw `error.message` is a string a peer's network path partly chooses.
 */
export const NET_PROBE_FAILURES = [
  "timeout",
  "refused",
  "unreachable",
  "closed",
  "reset",
  "other",
] as const;
export type NetProbeFailure = (typeof NET_PROBE_FAILURES)[number];

/**
 * Maps the crawler's stored `last_error` onto the closed set. `null` in means never dialled
 * (e.g. onion addresses) and stays `null` out: "never tried" and "tried and failed" differ.
 *
 * Matches the strings `server/p2p/crawl.ts` writes: its own "timed out" and "handshake
 * incomplete" (accepted, then closed with zero bytes), and Node's socket errors, which carry
 * the errno code.
 */
export function classifyProbeFailure(raw: string | null | undefined): NetProbeFailure | null {
  if (raw === null || raw === undefined) return null;
  if (/timed out/i.test(raw)) return "timeout";
  if (/ECONNREFUSED/.test(raw)) return "refused";
  if (/ENETUNREACH|EHOSTUNREACH/.test(raw)) return "unreachable";
  if (/handshake incomplete/i.test(raw)) return "closed";
  if (/ECONNRESET|EPIPE/.test(raw)) return "reset";
  return "other";
}

/** One finished crawl cycle. */
export interface NetCrawl {
  startedAt: number;
  finishedAt: number;
  attempted: number;
  reachable: number;
  newNodes: number;
}

export interface NetCrawlHistory {
  /** Oldest first, capped by the route; `truncated` says when the cap bit. */
  crawls: NetCrawl[];
  /** Every finished crawl ever — the true count the window is cut from. */
  total: number;
  /** Null before the first finished crawl. */
  firstStartedAt: number | null;
  truncated: boolean;
}

export interface NetClientShare extends NetShare {
  client: NetClient;
  /** Handshakes completed over handshakes attempted, over this client's live nodes. */
  answerRate: NetShare;
}

export interface NetSummary {
  basis: "floor";
  /** Nodes that answered a handshake within `windowSeconds` of the read. */
  reachable: number;
  windowSeconds: number;
  /** Every address the network has ever advertised to us. */
  known: number;
  everReachable: number;
  neverAnswered: number;
  ipv6Known: number;
  ipv6Reachable: number;
  /** Onion addresses plus clearnet Tor exit relays. */
  torKnown: number;
  countries: number;
  asns: number;
  /** Nodes that answered EVERY crawl since we first saw them, over `reachable`. */
  answeredEveryCrawl: NetShare;
  medianPingMs: number | null;
  avgPingMs: number | null;
  pingBasis: "crawler-relative (Vienna)";
  clients: NetClientShare[];
  versions: Array<{ client: NetClient; version: string; count: number }>;
  protocolVersions: Array<{ protocolVersion: number; count: number }>;
  crawls: {
    count: number;
    firstStartedAt: number | null;
    lastFinishedAt: number | null;
    intervalSeconds: number | null;
  };
  asOf: number;
}

export interface NetMapCell {
  /** Cell centre on a `cellDegrees` grid. */
  lat: number;
  lon: number;
  nodes: number;
  /** Modal values over the cell's nodes; null when no node in the cell has one. */
  city: string | null;
  country: string | null;
  clients: Array<{ client: NetClient; count: number }>;
  asns: Array<{ asn: number | null; org: string | null; count: number }>;
  medianPingMs: number | null;
  /** Σ reached / Σ attempted over the cell's nodes; null when nothing was probed. */
  uptime: NetShare | null;
}

export interface NetMap {
  basis: "floor";
  note: string;
  cellDegrees: number;
  cells: NetMapCell[];
  /** Advertised-but-never-answered addresses, bucketed the same way. */
  ghostCells: Array<{ lat: number; lon: number; count: number }>;
  /** Every never-answered address, placed or not — the legend's figure. */
  ghostTotal: number;
  /** Reachable nodes GeoIP could not place. */
  unplaced: number;
  countries: Array<{ country: string | null; count: number }>;
  asOf: number;
}

export type NetTopologyScope = "hubs" | "all";

export interface NetHub {
  /** One-way id, 12 hex. */
  id: string;
  client: NetClient;
  version: string | null;
  country: string | null;
  asnOrg: string | null;
  /** Addresses it advertised to us, all of them. */
  outDeg: number;
  /** Answering peers that advertised IT. */
  inDeg: number;
}

export interface NetGhost {
  id: string;
  network: NetPeerNetwork;
  torExit: boolean;
  country: string | null;
  failure: NetProbeFailure | null;
  /** Indices into `hubs` — the advertisers. This IS the edge list. */
  by: number[];
}

export interface NetTopology {
  note: string;
  scope: NetTopologyScope;
  hubs: NetHub[];
  /** Hub index → hub index. */
  hubEdges: Array<[number, number]>;
  /** Every advertisement from a hub, before any cap. */
  edgesTotal: number;
  ghosts?: NetGhost[];
  ghostsTotal?: number;
  ghostEdgesDrawn?: number;
  asOf: number;
}

export interface NetHistogramBucket {
  label: string;
  from: number;
  /** Null on the open-ended last bucket. */
  to: number | null;
  count: number;
}

export interface NetHistogram {
  buckets: NetHistogramBucket[];
  denominator: number;
}

export interface NetHealth {
  basis: "floor";
  pingBasis: "crawler-relative (Vienna)";
  latency: NetHistogram;
  uptime: NetHistogram;
  concentration: {
    note: string;
    topAsns: Array<{ asn: number | null; org: string } & NetShare>;
    top3: NetShare;
  };
  clusteredSubnets: Array<{ subnet: string; count: number }>;
  facts: {
    known: number;
    everReachable: number;
    neverAnswered: number;
    torKnown: number;
    ipv6Known: number;
    ipv6Reachable: number;
    failures: Array<{ failure: NetProbeFailure; count: number }>;
    crawls: number;
  };
  asOf: number;
}

export interface NetNodeRow {
  id: string;
  client: NetClient;
  version: string | null;
  protocolVersion: number | null;
  network: NetPeerNetwork;
  country: string | null;
  city: string | null;
  asn: number | null;
  asnOrg: string | null;
  pingMs: number | null;
  reached: number;
  attempted: number;
  firstSeen: number;
  lastReachable: number;
}

export interface NetNodeFilters {
  client: NetClient | null;
  asn: number | null;
}

/** A keyset page of nodes. Restates the cursor fields rather than importing `data/`. */
export interface NetNodePage {
  items: NetNodeRow[];
  nextCursor: string | null;
  prevCursor: string | null;
  /** Echoed: the filters the route actually applied. */
  applied: NetNodeFilters;
  /** Rows matching the filter, before the slice. */
  total: number;
  /** Every reachable node, so a filtered count reads "N of M". */
  denominator: number;
}

/**
 * Answering nodes of one (client, release, declared protocol version), with how many were
 * behind our tip when they last answered. The release and the protocol version are what the
 * node SAID; the lag is the one thing measured — its declared height against what our own
 * follower had stored at that instant.
 */
export interface NetReleaseGroup {
  client: NetClient;
  /** Null when the node declared no parseable version. */
  version: string | null;
  /** Null when the node declared none. */
  protocolVersion: number | null;
  nodes: number;
  /** Nodes more than `behindTipBlocks` blocks behind us at their last answer. */
  behindTip: number;
  /** Nodes whose lag cannot be stated: no height declared, or an instant our records miss. */
  tipUnknown: number;
}

/** One UTC day of the crawler's daily record, as it stood at the day's last crawl. */
export interface NetReleaseDay {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  groups: NetReleaseGroup[];
}

/**
 * The releases answering nodes run, now and as recorded each day. Carries no verdict about any
 * network upgrade: which releases are ready is a committed table on the page side
 * (`domain/network-upgrade.ts`), so adding one is a frontend change, not an API deploy.
 */
export interface NetReleases {
  basis: "floor";
  windowSeconds: number;
  /** Every node that answered in the window; the groups sum to it. */
  answering: number;
  /** The lag past which a node counts as behind. */
  behindTipBlocks: number;
  groups: NetReleaseGroup[];
  /** Oldest first. Starts the day the crawler began recording, never earlier. */
  history: NetReleaseDay[];
  asOf: number;
}

/** From our own node's `getpeerinfo`; never folded into a crawl figure. */
export interface NetPeers {
  basis: "ours";
  count: number;
  inbound: number;
  outbound: number;
  medianPingMs: number | null;
  asOf: number;
}

/**
 * A client filter guards a shape, not a closed list: the client set is open, so a well-formed
 * unknown name is kept and yields an honest empty page. Malformed means all.
 */
export function parseNetClientFilter(raw: string | undefined | null): NetClient | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return /^[A-Za-z0-9._ -]{1,32}$/.test(trimmed) ? trimmed : null;
}

/** An autonomous system number: digits only, else all. */
export function parseAsnFilter(raw: string | undefined | null): number | null {
  if (typeof raw !== "string" || !/^\d{1,10}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Reliability tiers, shared by the map lens legend and the server's histogram. */
export const NET_UPTIME_BUCKETS: ReadonlyArray<{ label: string; from: number; to: number | null }> =
  [
    { label: "< 10%", from: 0, to: 0.1 },
    { label: "10 – 50%", from: 0.1, to: 0.5 },
    { label: "50 – 90%", from: 0.5, to: 0.9 },
    { label: "90 – 99%", from: 0.9, to: 0.99 },
    { label: "every crawl", from: 0.99, to: null },
  ];

/** Latency tiers in milliseconds, crawler-relative. */
export const NET_LATENCY_BUCKETS: ReadonlyArray<{
  label: string;
  from: number;
  to: number | null;
}> = [
  { label: "< 50 ms", from: 0, to: 50 },
  { label: "50 – 100", from: 50, to: 100 },
  { label: "100 – 300", from: 100, to: 300 },
  { label: "300 – 1000", from: 300, to: 1000 },
  { label: "over 1 s", from: 1000, to: null },
];

/** Index of the bucket a value falls in: `[from, to)`, the last bucket open-ended. */
export function bucketIndex(
  buckets: ReadonlyArray<{ from: number; to: number | null }>,
  value: number,
): number {
  for (let i = 0; i < buckets.length; i += 1) {
    const b = buckets[i]!;
    if (value >= b.from && (b.to === null || value < b.to)) return i;
  }
  return value < buckets[0]!.from ? 0 : buckets.length - 1;
}

export function share(numerator: number, denominator: number): NetShare {
  return { pct: denominator === 0 ? 0 : (numerator / denominator) * 100, numerator, denominator };
}

/**
 * Reliability in basis points, the nodes list's sort key: `round(10000 * reached / attempted)`.
 * A node never probed returns -1 so it sorts below every probed one and is never ranked as
 * perfect. Shared by the server's keyset and the fixtures.
 */
export function reliabilityBps(row: { reached: number; attempted: number }): number {
  return row.attempted === 0 ? -1 : Math.round((10_000 * row.reached) / row.attempted);
}

/** The map lens colour tier for a reliability share: 1 = ≥ 90%, 2 = 50–90%, 3 = under 50%. */
export function uptimeTier(uptime: NetShare | null): 1 | 2 | 3 | null {
  if (uptime === null || uptime.denominator === 0) return null;
  const f = uptime.numerator / uptime.denominator;
  return f >= 0.9 ? 1 : f >= 0.5 ? 2 : 3;
}

/**
 * Newest-first semver-ish ordering for the release ladder. Pre-release suffixes sort below
 * the release they precede ("1.0.0-rc2" < "1.0.0"); unparseable strings sort last, by text.
 */
export function compareVersionsDesc(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
    return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) return a.localeCompare(b);
  if (!pa) return 1;
  if (!pb) return -1;
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pb.nums[i]! - pa.nums[i]!;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return -1;
  if (pb.pre === null) return 1;
  return pb.pre.localeCompare(pa.pre);
}

/** The facts a node contributes to a map cell; the server reads them off a row, fixtures off a fixture. */
export interface NetCellInput {
  lat: number | null;
  lon: number | null;
  city: string | null;
  country: string | null;
  client: NetClient;
  asn: number | null;
  asnOrg: string | null;
  pingMs: number | null;
  reached: number;
  attempted: number;
}

function mode<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A cell centre on the grid: `floor(v / step) * step + step / 2`. */
export function cellCentre(value: number, cellDegrees: number): number {
  return Math.floor(value / cellDegrees) * cellDegrees + cellDegrees / 2;
}

/**
 * Buckets nodes into `cellDegrees` cells with every lens stat; shared by the API and the
 * fixtures. Nodes with no coordinates are not placed: the caller counts them as `unplaced`.
 */
export function bucketNodesToCells(nodes: NetCellInput[], cellDegrees: number): NetMapCell[] {
  const cells = new Map<string, NetCellInput[]>();
  for (const n of nodes) {
    if (n.lat === null || n.lon === null) continue;
    const lat = cellCentre(n.lat, cellDegrees);
    const lon = cellCentre(n.lon, cellDegrees);
    const key = `${lat}:${lon}`;
    const list = cells.get(key) ?? [];
    list.push(n);
    cells.set(key, list);
  }
  return [...cells.entries()].map(([key, members]) => {
    const [lat, lon] = key.split(":").map(Number) as [number, number];
    const clientCounts = new Map<string, number>();
    const asnCounts = new Map<string, { asn: number | null; org: string | null; count: number }>();
    let reached = 0;
    let attempted = 0;
    for (const m of members) {
      clientCounts.set(m.client, (clientCounts.get(m.client) ?? 0) + 1);
      const asnKey = `${m.asn ?? "null"}|${m.asnOrg ?? ""}`;
      const entry = asnCounts.get(asnKey) ?? { asn: m.asn, org: m.asnOrg, count: 0 };
      entry.count += 1;
      asnCounts.set(asnKey, entry);
      reached += m.reached;
      attempted += m.attempted;
    }
    return {
      lat,
      lon,
      nodes: members.length,
      city: mode(members.map((m) => m.city).filter((c): c is string => c !== null)),
      country: mode(members.map((m) => m.country).filter((c): c is string => c !== null)),
      clients: [...clientCounts.entries()]
        .map(([client, count]) => ({ client, count }))
        .sort((a, b) => b.count - a.count || a.client.localeCompare(b.client)),
      asns: [...asnCounts.values()].sort(
        (a, b) => b.count - a.count || (a.org ?? "").localeCompare(b.org ?? ""),
      ),
      medianPingMs: median(members.map((m) => m.pingMs).filter((p): p is number => p !== null)),
      uptime: attempted === 0 ? null : share(reached, attempted),
    };
  });
}

/** A histogram over values through a shared bucket table; `denominator` is the values counted. */
export function histogram(
  buckets: ReadonlyArray<{ label: string; from: number; to: number | null }>,
  values: number[],
): NetHistogram {
  const counts = buckets.map(() => 0);
  for (const v of values) counts[bucketIndex(buckets, v)]! += 1;
  return {
    buckets: buckets.map((b, i) => ({ label: b.label, from: b.from, to: b.to, count: counts[i]! })),
    denominator: values.length,
  };
}

/** How far discovery is from settling: the convergence rule the page prints. */
export interface NetIndexMaturity {
  daysWatched: number;
  /** New addresses per day over the trailing 24 h, as a share of `known`; null under 3 crawls. */
  newPerDayShare: NetShare | null;
  /** 7 days watched AND under 10% of the known set new per day. */
  settled: boolean;
  dayGoal: 7;
}

export const NET_MATURITY_DAY_GOAL = 7;
export const NET_MATURITY_MAX_NEW_SHARE = 0.1;

/**
 * Derived rather than served so the fixture and live pages agree on what "settled" means. The
 * rate uses the last 24 h of crawls (or all of them, when younger), scaled to a day, so a young
 * index can state a rate immediately.
 */
export function indexMaturity(
  history: NetCrawlHistory,
  known: number,
  nowSeconds: number,
): NetIndexMaturity {
  const first = history.firstStartedAt;
  const daysWatched = first === null ? 0 : Math.max(0, (nowSeconds - first) / DAY_SECONDS);
  const recent = history.crawls.filter((c) => c.finishedAt >= nowSeconds - DAY_SECONDS);
  let newPerDayShare: NetShare | null = null;
  if (recent.length >= 3 && known > 0) {
    const spanSeconds = Math.max(recent[recent.length - 1]!.finishedAt - recent[0]!.startedAt, 1);
    const newInSpan = recent.reduce((s, c) => s + c.newNodes, 0);
    const perDay = Math.round((newInSpan / spanSeconds) * DAY_SECONDS);
    newPerDayShare = share(perDay, known);
  }
  const settled =
    daysWatched >= NET_MATURITY_DAY_GOAL &&
    newPerDayShare !== null &&
    newPerDayShare.numerator / newPerDayShare.denominator < NET_MATURITY_MAX_NEW_SHARE;
  return { daysWatched, newPerDayShare, settled, dayGoal: NET_MATURITY_DAY_GOAL };
}

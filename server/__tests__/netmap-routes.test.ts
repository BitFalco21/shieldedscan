import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type {
  NetCrawlHistory,
  NetHealth,
  NetMap,
  NetNodePage,
  NetReleases,
  NetSummary,
  NetTopology,
} from "@/domain";
import { anonId, netmapRoutes, subnet24 } from "../netmap-routes";
import { nodeCursor } from "../netmap/derive";
import { REACHABLE_WINDOW_SEC } from "../netmap/snapshot";

describe("derived-only helpers", () => {
  it("subnet24 keeps the /24 prefix and drops the host octet", () => {
    expect(subnet24("192.42.116.44")).toBe("192.42.116.x");
    expect(subnet24("2001:db8::1")).toBeNull(); // IPv6 has no /24 cluster label
  });

  it("anonId is stable, salted and irreversible-looking (no address bytes)", () => {
    const id = anonId("192.42.116.44", 8233);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(id).not.toContain("192");
    expect(anonId("192.42.116.44", 8233)).toBe(id); // stable across calls
    expect(anonId("192.42.116.45", 8233)).not.toBe(id); // distinct addresses differ
  });
});

/**
 * Needs a real database, so it skips unless TEST_DATABASE_URL is set. It applies
 * `schema-net.sql`, seeds nodes with real-shaped addresses (IPv4, IPv6 and an onion), probes,
 * gossip and crawls, and asserts on every route variant that no response contains a full
 * address: the database stores addresses, the API publishes only derived forms.
 *
 *   docker run -d --name pgnet -e POSTGRES_PASSWORD=test -e POSTGRES_DB=explorer \
 *     -p 55432:5432 postgres:17
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/netmap-routes.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

// Its own database: parallel suites against one server clobber a shared database.
const TEST_DB = "netmap_routes_test";
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

describeDb("netmap routes publish no full address", () => {
  const dbUrl = DATABASE_URL ? withDatabase(DATABASE_URL, TEST_DB) : "";
  let pool: Pool;
  let app: ReturnType<typeof netmapRoutes>;
  const now = Math.floor(Date.now() / 1000);
  // Three answering nodes: two Zebra in one /24 with different reliability, one Zakura with
  // no user-agent version. Three ghosts: an IPv6 never dialled, a Tor exit refused, an IPv4
  // that timed out. One node that answered a day ago and has since gone quiet.
  const HUB_A = "192.42.116.44";
  const HUB_B = "192.42.116.45";
  const HUB_C = "203.0.113.9";
  const GHOST_V6 = "2001:db8:85a3::8a2e:370:7334";
  const GHOST_TOR = "185.220.101.5";
  const GHOST_TIMEOUT = "198.51.100.23";
  const QUIET = "192.0.2.200";
  const ONION = "vww6ybal4bd7szmgncyruucpgfkqahzddi37ktceo3ah7ngmcopnpyyd.onion";
  const SECRETS = [HUB_A, HUB_B, HUB_C, GHOST_V6, GHOST_TOR, GHOST_TIMEOUT, QUIET, ONION];

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: dbUrl });
    app = netmapRoutes(dbUrl);
    const schema = readFileSync(join(process.cwd(), "server", "schema-net.sql"), "utf8");
    await pool.query(schema);
    // Outside the answering window by an hour, derived from it so the seed cannot sit on the edge.
    const lapsed = now - REACHABLE_WINDOW_SEC - 3_600;
    await pool.query(
      `INSERT INTO net_node
         (host, port, network, first_seen, last_seen, last_attempt, last_reachable, user_agent,
          protocol_version, ping_ms, country, city, lat, lon, asn, asn_org, tor_exit, last_error)
       VALUES
         ($1, 8233, 'ipv4', $9, $9, $9, $9, '/Zebra:6.3.0/', 170160, 12, 'Germany', 'Berlin',
          52.5, 13.4, 24940, 'Hetzner Online GmbH', false, NULL),
         ($2, 8233, 'ipv4', $9, $9, $9, $9, '/Zebra:6.2.3/', 170150, 34, 'Germany', 'Berlin',
          52.5, 13.4, 24940, 'Hetzner Online GmbH', false, NULL),
         ($3, 8233, 'ipv4', $9, $9, $9, $9, '/Zakura/', 170160, 400, 'United States', NULL,
          NULL, NULL, 14061, 'DigitalOcean, LLC', false, NULL),
         ($4, 8233, 'ipv6', $9, $9, NULL, NULL, NULL, NULL, NULL, 'Finland', 'Helsinki',
          60.2, 24.9, NULL, NULL, false, NULL),
         ($5, 8233, 'ipv4', $9, $9, $9, NULL, NULL, NULL, NULL, 'Germany', 'Frankfurt',
          50.1, 8.7, 24940, 'Hetzner Online GmbH', true, 'connect ECONNREFUSED ${GHOST_TOR}:8233'),
         ($6, 8233, 'ipv4', $9, $9, $9, NULL, NULL, NULL, NULL, 'Japan', 'Tokyo',
          35.7, 139.7, 2516, 'KDDI', false, 'timed out'),
         ($7, 8233, 'ipv4', $10, $10, $10, $10, '/Zebra:6.2.3/', 170150, 90, 'Canada', NULL,
          45.5, -73.6, 577, 'Bell Canada', false, NULL),
         ($8, 8233, 'torv3', $9, $9, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, false, NULL)`,
      [HUB_A, HUB_B, HUB_C, GHOST_V6, GHOST_TOR, GHOST_TIMEOUT, QUIET, ONION, now, lapsed],
    );
    // The tip a declared height is held against: our follower's blocks, stamped on arrival.
    // A is level with us at its last answer, B is 110 blocks behind, C declared no height.
    await pool.query(`CREATE TABLE block (height INTEGER PRIMARY KEY, received_at BIGINT)`);
    await pool.query(
      `INSERT INTO block (height, received_at)
       SELECT h, $1::bigint - (1010 - h) * 75 FROM generate_series(1000, 1010) AS h`,
      [now - 30],
    );
    await pool.query(`UPDATE net_node SET best_height = 1010 WHERE host = $1`, [HUB_A]);
    await pool.query(`UPDATE net_node SET best_height = 900 WHERE host = $1`, [HUB_B]);
    // Two recorded days, the raw user agent kept and '' / -1 standing for "none declared".
    await pool.query(
      `INSERT INTO net_release_day
         (day, user_agent, protocol_version, nodes, behind_tip, tip_unknown)
       VALUES ('2026-10-01', '/Zebra:6.3.0/', 170160, 2, 0, 0),
              ('2026-10-01', '', -1, 1, 0, 1),
              ('2026-10-02', '/Zebra:6.3.0/', 170160, 1, 0, 0),
              ('2026-10-02', '/Zebra:6.3.0/ ', 170160, 1, 1, 0)`,
    );
    // Gossip: A advertised B, C and every ghost; B advertised A and the onion; C advertised A.
    const links: Array<[string, string]> = [
      [HUB_A, HUB_B],
      [HUB_A, HUB_C],
      [HUB_A, GHOST_V6],
      [HUB_A, GHOST_TOR],
      [HUB_A, GHOST_TIMEOUT],
      [HUB_B, HUB_A],
      [HUB_B, ONION],
      [HUB_B, GHOST_TIMEOUT],
      [HUB_C, HUB_A],
      [QUIET, HUB_A],
    ];
    for (const [from, to] of links) {
      await pool.query(
        `INSERT INTO net_link (from_host, from_port, to_host, to_port, last_advertised)
         VALUES ($1, 8233, $2, 8233, $3)`,
        [from, to, now],
      );
    }
    // Four crawls; A answered every one, B half of them, C three of four.
    for (let i = 0; i < 4; i += 1) {
      const startedAt = now - (4 - i) * 600;
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO net_crawl (started_at, finished_at, attempted, reachable, new_nodes)
         VALUES ($1, $2, 8, 3, $3) RETURNING id`,
        [startedAt, startedAt + 240, i === 0 ? 8 : 0],
      );
      const crawlId = rows[0]!.id;
      const probes: Array<[string, boolean, number | null]> = [
        [HUB_A, true, 12],
        [HUB_B, i % 2 === 0, i % 2 === 0 ? 34 : null],
        [HUB_C, i !== 1, i !== 1 ? 400 : null],
        [GHOST_TOR, false, null],
        [GHOST_TIMEOUT, false, null],
      ];
      for (const [host, ok, ping] of probes) {
        await pool.query(
          `INSERT INTO net_probe (crawl_id, host, port, at, ok, ping_ms)
           VALUES ($1, $2, 8233, $3, $4, $5)`,
          [crawlId, host, startedAt + 10, ok, ping],
        );
      }
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  const routes = [
    "/chain/network/summary",
    "/chain/network/map",
    "/chain/network/topology",
    "/chain/network/topology?scope=all",
    "/chain/network/health",
    "/chain/network/nodes",
    "/chain/network/nodes?client=Zebra&asn=24940",
    "/chain/network/nodes?limit=1",
    "/chain/network/crawls",
    "/chain/network/releases",
  ];

  it.each(routes)("%s returns 200 and never leaks an address", async (path) => {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    // Belt and braces: nothing IPv4-shaped at all (subnet labels are three octets and an x).
    expect(body).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });

  it("summary states the floor, the known set, the per-client split and answer rates", async () => {
    const body = (await (await app.request("/chain/network/summary")).json()) as NetSummary;
    expect(body.basis).toBe("floor");
    expect(body.reachable).toBe(3);
    expect(body.known).toBe(8);
    expect(body.everReachable).toBe(4); // the quiet node answered once
    expect(body.neverAnswered).toBe(4);
    expect(body.ipv6Known).toBe(1);
    expect(body.torKnown).toBe(2); // one exit relay, one onion
    expect(body.answeredEveryCrawl).toEqual({ pct: (1 / 3) * 100, numerator: 1, denominator: 3 });
    const zebra = body.clients.find((c) => c.client === "Zebra");
    expect(zebra).toMatchObject({ numerator: 2, denominator: 3 });
    // A answered 4 of 4, B 2 of 4: 6 of 8 attempted handshakes with a Zebra node completed.
    expect(zebra?.answerRate).toEqual({ pct: 75, numerator: 6, denominator: 8 });
    expect(body.versions).toContainEqual({ client: "Zebra", version: "6.3.0", count: 1 });
    // A user agent with no version contributes to the client split and not to the ladder.
    expect(body.versions.some((v) => v.client === "Zakura")).toBe(false);
    expect(body.protocolVersions).toEqual([
      { protocolVersion: 170160, count: 2 },
      { protocolVersion: 170150, count: 1 },
    ]);
    expect(body.crawls.count).toBe(4);
    expect(body.crawls.intervalSeconds).toBe(680); // (last finished - first started) / 3
  });

  it("map buckets the two Berlin nodes into one cell carrying every lens stat, and the ghosts", async () => {
    const body = (await (await app.request("/chain/network/map")).json()) as NetMap;
    expect(body.cells).toHaveLength(1); // the Zakura node has no coordinates
    expect(body.unplaced).toBe(1);
    const cell = body.cells[0]!;
    expect(cell).toMatchObject({
      lat: 52.5,
      lon: 13.5,
      nodes: 2,
      city: "Berlin",
      country: "Germany",
    });
    expect(cell.clients).toEqual([{ client: "Zebra", count: 2 }]);
    expect(cell.medianPingMs).toBe(23);
    expect(cell.uptime).toEqual({ pct: 75, numerator: 6, denominator: 8 });
    // Ghost cells: Helsinki, Frankfurt, Tokyo and the quiet Canadian node; the onion is unplaced.
    expect(body.ghostCells).toHaveLength(4);
    expect(body.ghostTotal).toBe(5);
    expect(body.countries[0]).toEqual({ country: "Germany", count: 2 });
    expect((body as unknown as { by?: string }).by).toBeUndefined(); // the lens left the wire
  });

  it("topology speaks in indices; scope=all adds the ghosts, their failures and the caps", async () => {
    const hubs = (await (await app.request("/chain/network/topology")).json()) as NetTopology;
    expect(hubs.scope).toBe("hubs");
    expect(hubs.hubs).toHaveLength(3);
    expect(hubs.hubs.every((h) => /^[0-9a-f]{12}$/.test(h.id))).toBe(true);
    expect(hubs.ghosts).toBeUndefined();
    const a = hubs.hubs.findIndex((h) => h.id === anonId(HUB_A, 8233));
    const b = hubs.hubs.findIndex((h) => h.id === anonId(HUB_B, 8233));
    const c = hubs.hubs.findIndex((h) => h.id === anonId(HUB_C, 8233));
    expect(hubs.hubEdges).toEqual(
      expect.arrayContaining([
        [a, b],
        [a, c],
        [b, a],
        [c, a],
      ]),
    );
    expect(hubs.hubEdges).toHaveLength(4); // the quiet node's advertisement is not a hub edge
    expect(hubs.hubs[a]).toMatchObject({ outDeg: 5, inDeg: 2, client: "Zebra", version: "6.3.0" });
    expect(hubs.edgesTotal).toBe(9);

    const all = (await (
      await app.request("/chain/network/topology?scope=all")
    ).json()) as NetTopology;
    expect(all.scope).toBe("all");
    expect(all.ghostsTotal).toBe(4); // v6, tor exit, timeout, onion; the quiet node is a ghost too but advertised by nobody
    expect(all.ghostEdgesDrawn).toBe(5);
    const timeout = all.ghosts!.find((g) => g.id === anonId(GHOST_TIMEOUT, 8233));
    expect(timeout).toMatchObject({ network: "ipv4", torExit: false, failure: "timeout" });
    expect(timeout!.by.sort()).toEqual([a, b].sort());
    expect(all.ghosts!.find((g) => g.id === anonId(GHOST_TOR, 8233))).toMatchObject({
      torExit: true,
      failure: "refused",
    });
    // Never dialled is null, not a failure class.
    expect(all.ghosts!.find((g) => g.id === anonId(GHOST_V6, 8233))).toMatchObject({
      network: "ipv6",
      failure: null,
    });
    expect(all.ghosts!.find((g) => g.id === anonId(ONION, 8233))).toMatchObject({
      network: "torv3",
      failure: null,
    });
  });

  it("releases group the answering nodes, measure each one's lag and classify the history alike", async () => {
    const body = (await (await app.request("/chain/network/releases")).json()) as NetReleases;
    expect(body.basis).toBe("floor");
    expect(body.answering).toBe(3);
    expect(body.groups.reduce((s, g) => s + g.nodes, 0)).toBe(body.answering);
    expect(body.behindTipBlocks).toBe(10);
    expect(body.groups).toContainEqual({
      client: "Zebra",
      version: "6.3.0",
      protocolVersion: 170160,
      nodes: 1,
      behindTip: 0,
      tipUnknown: 0,
    });
    expect(body.groups).toContainEqual({
      client: "Zebra",
      version: "6.2.3",
      protocolVersion: 170150,
      nodes: 1,
      behindTip: 1,
      tipUnknown: 0,
    });
    expect(body.groups).toContainEqual({
      client: "Zakura",
      version: null,
      protocolVersion: 170160,
      nodes: 1,
      behindTip: 0,
      tipUnknown: 1,
    });
    expect(body.history.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-02"]);
    // '' and -1 come back as "none declared", never as a client named "" or protocol -1.
    expect(body.history[0]!.groups).toContainEqual({
      client: "Unidentified",
      version: null,
      protocolVersion: null,
      nodes: 1,
      behindTip: 0,
      tipUnknown: 1,
    });
    // Two spellings of one release merge into one group, as they do on the live row.
    expect(body.history[1]!.groups).toEqual([
      {
        client: "Zebra",
        version: "6.3.0",
        protocolVersion: 170160,
        nodes: 2,
        behindTip: 1,
        tipUnknown: 0,
      },
    ]);
  });

  it("health carries histograms with denominators, ASN shares, the /24 label and the facts", async () => {
    const body = (await (await app.request("/chain/network/health")).json()) as NetHealth;
    expect(body.uptime.denominator).toBe(3);
    expect(body.uptime.buckets.reduce((s, b) => s + b.count, 0)).toBe(3);
    expect(body.uptime.buckets.map((b) => b.count)).toEqual([0, 0, 2, 0, 1]); // 50%, 75%, 100%
    expect(body.latency.denominator).toBe(3);
    expect(body.concentration.topAsns[0]).toMatchObject({
      asn: 24940,
      org: "Hetzner Online GmbH",
      numerator: 2,
      denominator: 3,
    });
    expect(body.concentration.top3).toEqual({ pct: 100, numerator: 3, denominator: 3 });
    expect(body.clusteredSubnets).toEqual([{ subnet: "192.42.116.x", count: 2 }]);
    expect(body.facts).toMatchObject({
      known: 8,
      everReachable: 4,
      neverAnswered: 4,
      torKnown: 2,
      ipv6Known: 1,
      ipv6Reachable: 0,
      crawls: 4,
    });
    expect(body.facts.failures).toEqual([
      { failure: "refused", count: 1 },
      { failure: "timeout", count: 1 },
    ]);
  });

  it("nodes: filters apply BEFORE the slice and are echoed; a well-formed unknown is an honest empty page", async () => {
    const all = (await (await app.request("/chain/network/nodes")).json()) as NetNodePage;
    expect(all.items).toHaveLength(3);
    expect(all.total).toBe(3);
    expect(all.denominator).toBe(3);
    expect(all.applied).toEqual({ client: null, asn: null });
    // Most reliable first: A (100%), then C (75%), then B (50%).
    expect(all.items.map((r) => r.id)).toEqual([
      anonId(HUB_A, 8233),
      anonId(HUB_C, 8233),
      anonId(HUB_B, 8233),
    ]);
    expect(all.items[2]).toMatchObject({ reached: 2, attempted: 4, city: "Berlin" });

    const zebra = (await (
      await app.request("/chain/network/nodes?client=Zebra&asn=24940")
    ).json()) as NetNodePage;
    expect(zebra.applied).toEqual({ client: "Zebra", asn: 24940 });
    expect(zebra.total).toBe(2);
    expect(zebra.denominator).toBe(3);
    expect(zebra.items.every((r) => r.client === "Zebra" && r.asn === 24940)).toBe(true);

    const none = (await (
      await app.request("/chain/network/nodes?client=Nope")
    ).json()) as NetNodePage;
    expect(none.applied.client).toBe("Nope");
    expect(none.items).toEqual([]);
    expect(none.total).toBe(0);

    const junk = (await (await app.request("/chain/network/nodes?asn=abc")).json()) as NetNodePage;
    expect(junk.applied.asn).toBeNull();
    expect(junk.total).toBe(3);
  });

  it("nodes: paging across a reliability TIE neither repeats nor skips a row", async () => {
    // Make B as reliable as A so two rows tie at 100% and the page boundary falls between them.
    await pool.query(`UPDATE net_probe SET ok = true, ping_ms = 34 WHERE host = $1`, [HUB_B]);
    const fresh = netmapRoutes(dbUrl); // its own 30 s cache, so the update is visible
    const first = (await (
      await fresh.request("/chain/network/nodes?limit=1")
    ).json()) as NetNodePage;
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await fresh.request(`/chain/network/nodes?limit=1&before=${first.nextCursor}`)
    ).json()) as NetNodePage;
    const third = (await (
      await fresh.request(`/chain/network/nodes?limit=1&before=${second.nextCursor}`)
    ).json()) as NetNodePage;
    const ids = [...first.items, ...second.items, ...third.items].map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.sort()).toEqual(
      [anonId(HUB_A, 8233), anonId(HUB_B, 8233), anonId(HUB_C, 8233)].sort(),
    );
    // The cursor a row mints carries its reliability in basis points and its id, nothing else.
    expect(nodeCursor(first.items[0]!)).toBe(first.nextCursor);
    expect(third.nextCursor).toBeNull();
    await pool.query(
      `UPDATE net_probe SET ok = (crawl_id % 2 = 1), ping_ms = NULL WHERE host = $1`,
      [HUB_B],
    );
  });

  it("crawls come oldest first with the true total beside them", async () => {
    const body = (await (await app.request("/chain/network/crawls")).json()) as NetCrawlHistory;
    expect(body.crawls).toHaveLength(4);
    expect(body.total).toBe(4);
    expect(body.truncated).toBe(false);
    expect(body.crawls[0]!.newNodes).toBe(8);
    expect(body.crawls[0]!.startedAt).toBeLessThan(body.crawls[3]!.startedAt);
    expect(body.firstStartedAt).toBe(body.crawls[0]!.startedAt);
  });
});

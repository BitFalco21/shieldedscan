import { describe, expect, it } from "vitest";
import { fixtureDataSource } from "../fixture-source";
import { indexMaturity, reliabilityBps } from "@/domain";
import { TIP_TIME } from "@/fixtures/ids";

/**
 * What the node-map fixtures must be able to express, and the one thing they must never
 * contain.
 *
 * Not a test of the figures but of the cases the page renders: a keyset page boundary inside
 * a run of tied reliabilities (distinct sort keys would pass a broken tiebreak), a client
 * with no version, a node GeoIP could not place, ghosts of every failure class, a ghost never
 * dialled, and a capped crawl history that says so. And the invariant: no string shaped like
 * an address, on any route.
 */

const IPV4 = /\b\d{1,3}(\.\d{1,3}){3}\b/;
const IPV6 = /\b[0-9a-f]{1,4}(:[0-9a-f]{1,4}){2,7}\b/i;
const ONION = /\.onion\b/i;

const summary = await fixtureDataSource.getNetworkSummary();
const map = await fixtureDataSource.getNetworkMap();
const hubsOnly = await fixtureDataSource.getNetworkTopology("hubs");
const sky = await fixtureDataSource.getNetworkTopology("all");
const health = await fixtureDataSource.getNetworkHealth();
const crawls = await fixtureDataSource.getNetworkCrawls();
const peers = await fixtureDataSource.getNetworkPeers();
const everyNode = await fixtureDataSource.listNetworkNodes(
  { limit: 100 },
  { client: null, asn: null },
);

describe("the node-map fixtures carry no address", () => {
  it("serialises every payload without an IPv4, IPv6 or onion literal", () => {
    for (const payload of [summary, map, hubsOnly, sky, health, crawls, peers, everyNode]) {
      const body = JSON.stringify(payload);
      expect(body).not.toMatch(IPV4);
      expect(body).not.toMatch(IPV6);
      expect(body).not.toMatch(ONION);
    }
  });

  it("labels a shared /24 with an x, never a fourth octet", () => {
    expect(health.clusteredSubnets.length).toBeGreaterThan(0);
    for (const s of health.clusteredSubnets)
      expect(s.subnet).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.x$/);
  });
});

describe("the nodes list", () => {
  it("holds two pages at 25, with MORE than a page tied at perfect reliability", () => {
    // The id tiebreak only matters on a tie, and only a tie straddling a page boundary can
    // catch a single-column seek.
    expect(everyNode.total).toBe(40);
    expect(everyNode.denominator).toBe(40);
    const perfect = everyNode.items.filter((r) => reliabilityBps(r) === 10_000);
    expect(perfect.length).toBeGreaterThan(25);
  });

  it("pages forward and back with no duplicated or skipped row", async () => {
    const first = await fixtureDataSource.listNetworkNodes(
      { limit: 25 },
      { client: null, asn: null },
    );
    expect(first.items).toHaveLength(25);
    expect(first.prevCursor).toBeNull();
    expect(first.nextCursor).not.toBeNull();
    const second = await fixtureDataSource.listNetworkNodes(
      { limit: 25, before: first.nextCursor! },
      { client: null, asn: null },
    );
    expect(second.items).toHaveLength(15);
    expect(second.nextCursor).toBeNull();
    const walked = [...first.items, ...second.items].map((r) => r.id);
    expect(new Set(walked).size).toBe(40);
    expect(walked).toEqual(everyNode.items.map((r) => r.id));
    const back = await fixtureDataSource.listNetworkNodes(
      { limit: 25, after: second.prevCursor! },
      { client: null, asn: null },
    );
    expect(back.items.map((r) => r.id)).toEqual(first.items.map((r) => r.id));
  });

  it("applies a client filter before the slice and echoes it", async () => {
    const zebra = await fixtureDataSource.listNetworkNodes(
      { limit: 25 },
      { client: "Zebra", asn: null },
    );
    expect(zebra.applied).toEqual({ client: "Zebra", asn: null });
    expect(zebra.items.every((r) => r.client === "Zebra")).toBe(true);
    expect(zebra.total).toBe(21);
    expect(zebra.denominator).toBe(40);
  });

  it("a well-formed client nobody runs yields an honest empty page, echoed", async () => {
    const page = await fixtureDataSource.listNetworkNodes(
      { limit: 25 },
      { client: "Zippy", asn: null },
    );
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.applied.client).toBe("Zippy");
  });

  it("applies a hosting-network filter", async () => {
    const page = await fixtureDataSource.listNetworkNodes(
      { limit: 100 },
      { client: null, asn: 14061 },
    );
    expect(page.total).toBeGreaterThan(0);
    expect(page.items.every((r) => r.asn === 14061)).toBe(true);
    expect(page.applied.asn).toBe(14061);
  });

  it("expresses a client with no version and a node with no place", () => {
    expect(everyNode.items.some((r) => r.client === "Zakura" && r.version === null)).toBe(true);
    expect(everyNode.items.some((r) => r.country === null)).toBe(true);
  });
});

describe("the map", () => {
  it("places every reachable node in a cell or counts it as unplaced — never invents one", () => {
    const placed = map.cells.reduce((s, c) => s + c.nodes, 0);
    expect(placed + map.unplaced).toBe(summary.reachable);
    expect(map.unplaced).toBe(1);
  });

  it("carries the never-answered population separately, with its unplaced remainder", () => {
    const placedGhosts = map.ghostCells.reduce((s, c) => s + c.count, 0);
    expect(map.ghostTotal).toBe(300);
    expect(placedGhosts).toBeLessThan(map.ghostTotal);
    expect(map.ghostCells.some((c) => c.count >= 50)).toBe(true);
  });
});

describe("the topology", () => {
  it("echoes the scope, and carries ghosts only when asked for all", () => {
    expect(hubsOnly.scope).toBe("hubs");
    expect(hubsOnly.ghosts).toBeUndefined();
    expect(sky.scope).toBe("all");
    expect(sky.ghosts).toHaveLength(300);
    expect(sky.ghostsTotal).toBe(300);
  });

  it("every ghost hangs off hubs that exist, and the drawn-edge count is exact", () => {
    for (const g of sky.ghosts!) {
      expect(g.by.length).toBeGreaterThan(0);
      for (const i of g.by) expect(i).toBeLessThan(sky.hubs.length);
    }
    const drawn = sky.ghosts!.reduce((s, g) => s + g.by.length, 0);
    expect(sky.ghostEdgesDrawn).toBe(drawn);
    expect(sky.edgesTotal).toBe(sky.hubEdges.length + drawn);
  });

  it("a never-dialled IPv6 address has no failure; a dialled IPv4 one has one", () => {
    // "never tried" and "tried and failed" are different facts about OUR vantage point.
    const v6 = sky.ghosts!.filter((g) => g.network === "ipv6");
    const v4 = sky.ghosts!.filter((g) => g.network === "ipv4");
    expect(v6.length).toBeGreaterThan(0);
    expect(v6.every((g) => g.failure === null)).toBe(true);
    expect(v4.every((g) => g.failure !== null)).toBe(true);
    expect(new Set(v4.map((g) => g.failure)).size).toBeGreaterThanOrEqual(5);
    expect(sky.ghosts!.some((g) => g.torExit)).toBe(true);
  });
});

describe("the health and summary figures", () => {
  it("every histogram and share is over the reachable set", () => {
    expect(health.latency.denominator).toBe(summary.reachable);
    expect(health.uptime.denominator).toBe(summary.reachable);
    expect(health.concentration.top3.denominator).toBe(summary.reachable);
    expect(summary.clients.reduce((s, c) => s + c.numerator, 0)).toBe(summary.reachable);
  });

  it("names the failure classes of the never-answered set", () => {
    expect(health.facts.failures.map((f) => f.failure)).toContain("timeout");
    expect(health.facts.neverAnswered).toBe(summary.neverAnswered);
  });

  it("the crawl history is oldest first, capped, and says so", () => {
    expect(crawls.crawls).toHaveLength(61);
    expect(crawls.truncated).toBe(true);
    expect(crawls.total).toBeGreaterThan(crawls.crawls.length);
    const starts = crawls.crawls.map((c) => c.startedAt);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("reads as a young index — watched under a day, discovery still fast", () => {
    // The fixture has a young crawl history, so a preview build shows the maturity strip
    // unsettled; the settled state is pinned in the domain test.
    const m = indexMaturity(crawls, summary.known, TIP_TIME);
    expect(m.settled).toBe(false);
    expect(m.daysWatched).toBeLessThan(1);
    expect(m.newPerDayShare).not.toBeNull();
  });

  it("our node's peers are marked as ours and are not a crawl figure", () => {
    expect(peers?.basis).toBe("ours");
    expect(peers?.count).toBe((peers?.inbound ?? 0) + (peers?.outbound ?? 0));
    expect(peers?.count).not.toBe(summary.reachable);
  });
});

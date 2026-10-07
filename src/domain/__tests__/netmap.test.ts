import { describe, expect, it } from "vitest";
import {
  NET_LATENCY_BUCKETS,
  NET_UPTIME_BUCKETS,
  bucketIndex,
  bucketNodesToCells,
  classifyProbeFailure,
  compareVersionsDesc,
  histogram,
  indexMaturity,
  parseAsnFilter,
  parseNetClientFilter,
  share,
  uptimeTier,
  type NetCellInput,
  type NetCrawlHistory,
} from "../netmap";

describe("classifyProbeFailure", () => {
  it("maps the crawler's own sentences and Node's socket errors onto the closed set", () => {
    // The strings server/p2p/crawl.ts actually writes, from the deploy-day failure split.
    expect(classifyProbeFailure("timed out")).toBe("timeout");
    expect(classifyProbeFailure("connect ECONNREFUSED 1.2.3.4:8233")).toBe("refused");
    expect(classifyProbeFailure("connect ENETUNREACH 2001:db8::1:8233")).toBe("unreachable");
    expect(classifyProbeFailure("connect EHOSTUNREACH 1.2.3.4:8233")).toBe("unreachable");
    expect(classifyProbeFailure("handshake incomplete")).toBe("closed");
    expect(classifyProbeFailure("read ECONNRESET")).toBe("reset");
    expect(classifyProbeFailure("something new")).toBe("other");
  });
  it("keeps never-dialled as null — a different fact from tried-and-failed", () => {
    expect(classifyProbeFailure(null)).toBeNull();
    expect(classifyProbeFailure(undefined)).toBeNull();
  });
});

describe("filters", () => {
  it("keeps a well-formed unknown client (an honest empty page) and drops garbage", () => {
    expect(parseNetClientFilter("Zebra")).toBe("Zebra");
    expect(parseNetClientFilter("Some Node 2")).toBe("Some Node 2");
    expect(parseNetClientFilter("<script>")).toBeNull();
    expect(parseNetClientFilter("")).toBeNull();
    expect(parseNetClientFilter(undefined)).toBeNull();
    expect(parseNetClientFilter("x".repeat(33))).toBeNull();
  });
  it("an ASN is digits or it is all", () => {
    expect(parseAsnFilter("24940")).toBe(24940);
    expect(parseAsnFilter("abc")).toBeNull();
    expect(parseAsnFilter("0")).toBeNull();
    expect(parseAsnFilter("-5")).toBeNull();
    expect(parseAsnFilter(undefined)).toBeNull();
  });
});

describe("tiers and buckets", () => {
  it("uptime tiers split at 90 and 50, null when nothing was probed", () => {
    expect(uptimeTier(share(9, 10))).toBe(1);
    expect(uptimeTier(share(89, 100))).toBe(2);
    expect(uptimeTier(share(4, 10))).toBe(3);
    expect(uptimeTier(null)).toBeNull();
    expect(uptimeTier(share(0, 0))).toBeNull();
  });
  it("bucket edges are half-open, the last bucket open-ended", () => {
    expect(bucketIndex(NET_LATENCY_BUCKETS, 0)).toBe(0);
    expect(bucketIndex(NET_LATENCY_BUCKETS, 50)).toBe(1);
    expect(bucketIndex(NET_LATENCY_BUCKETS, 999.9)).toBe(3);
    expect(bucketIndex(NET_LATENCY_BUCKETS, 1000)).toBe(4);
    expect(bucketIndex(NET_LATENCY_BUCKETS, 50_000)).toBe(4);
    expect(bucketIndex(NET_UPTIME_BUCKETS, 1)).toBe(4);
    expect(bucketIndex(NET_UPTIME_BUCKETS, 0.9)).toBe(3);
  });
  it("a histogram's counts sum to its denominator", () => {
    const h = histogram(NET_LATENCY_BUCKETS, [1, 60, 250, 900, 2000, 2000]);
    expect(h.denominator).toBe(6);
    expect(h.buckets.reduce((s, b) => s + b.count, 0)).toBe(6);
    expect(h.buckets.map((b) => b.count)).toEqual([1, 1, 1, 1, 2]);
  });
});

describe("compareVersionsDesc", () => {
  it("orders newest first, pre-releases below their release, garbage last", () => {
    const sorted = ["6.2.3", "1.0.0-rc2", "6.3.0", "1.0.0", "weird", "1.0.0-rc4"].sort(
      compareVersionsDesc,
    );
    expect(sorted).toEqual(["6.3.0", "6.2.3", "1.0.0", "1.0.0-rc4", "1.0.0-rc2", "weird"]);
  });
});

describe("bucketNodesToCells", () => {
  const node = (over: Partial<NetCellInput>): NetCellInput => ({
    lat: 52.5,
    lon: 13.4,
    city: "Berlin",
    country: "Germany",
    client: "Zebra",
    asn: 24940,
    asnOrg: "Hetzner",
    pingMs: 30,
    reached: 10,
    attempted: 10,
    ...over,
  });
  it("puts two nodes in one 1° cell with the cell's own stats", () => {
    const cells = bucketNodesToCells(
      [node({}), node({ lat: 52.9, lon: 13.1, client: "Zakura", pingMs: 50, reached: 5 })],
      1,
    );
    expect(cells).toHaveLength(1);
    const cell = cells[0]!;
    expect(cell.lat).toBe(52.5);
    expect(cell.lon).toBe(13.5);
    expect(cell.nodes).toBe(2);
    expect(cell.city).toBe("Berlin");
    expect(cell.clients).toEqual([
      { client: "Zakura", count: 1 },
      { client: "Zebra", count: 1 },
    ]);
    expect(cell.medianPingMs).toBe(40);
    expect(cell.uptime).toEqual({ pct: 75, numerator: 15, denominator: 20 });
  });
  it("never places a node without coordinates and never fabricates a probe share", () => {
    const cells = bucketNodesToCells(
      [node({ lat: null, lon: null }), node({ attempted: 0, reached: 0, pingMs: null })],
      1,
    );
    expect(cells).toHaveLength(1);
    expect(cells[0]!.uptime).toBeNull();
    expect(cells[0]!.medianPingMs).toBeNull();
  });
});

describe("indexMaturity", () => {
  const crawl = (t: number, newNodes: number) => ({
    startedAt: t,
    finishedAt: t + 240,
    attempted: 100,
    reachable: 40,
    newNodes,
  });
  it("states no rate under three crawls and is never settled on day one", () => {
    const history: NetCrawlHistory = {
      crawls: [crawl(1_000, 5), crawl(1_600, 3)],
      total: 2,
      firstStartedAt: 1_000,
      truncated: false,
    };
    const m = indexMaturity(history, 100, 2_000);
    expect(m.newPerDayShare).toBeNull();
    expect(m.settled).toBe(false);
    expect(m.daysWatched).toBeCloseTo(1_000 / 86_400);
  });
  it("is maturing at 7 hours with most of the set new per day, settled at 9 days under 10%", () => {
    const start = 1_788_697_919;
    const young: NetCrawlHistory = {
      crawls: Array.from({ length: 60 }, (_, i) => crawl(start + i * 420, 12)),
      total: 60,
      firstStartedAt: start,
      truncated: false,
    };
    const y = indexMaturity(young, 1_500, start + 7 * 3_600);
    expect(y.settled).toBe(false);
    expect(y.newPerDayShare!.numerator).toBeGreaterThan(1_500 * 0.5);
    const oldStart = start - 9 * 86_400;
    const settled: NetCrawlHistory = {
      crawls: Array.from({ length: 1_000 }, (_, i) => crawl(start - 86_400 + i * 86, 0)).map(
        (c, i) => (i % 25 === 0 ? { ...c, newNodes: 1 } : c),
      ),
      total: 1_296,
      firstStartedAt: oldStart,
      truncated: true,
    };
    const s = indexMaturity(settled, 20_000, start);
    expect(s.daysWatched).toBeCloseTo(9, 3);
    expect(s.newPerDayShare!.numerator / s.newPerDayShare!.denominator).toBeLessThan(0.1);
    expect(s.settled).toBe(true);
  });
  it("seven days alone is not settled while discovery still runs hot", () => {
    const start = 1_788_697_919;
    const history: NetCrawlHistory = {
      crawls: Array.from({ length: 300 }, (_, i) => crawl(start + 6 * 86_400 + i * 288, 20)),
      total: 2_400,
      firstStartedAt: start,
      truncated: true,
    };
    const m = indexMaturity(history, 5_000, start + 7 * 86_400 + 1);
    expect(m.daysWatched).toBeGreaterThanOrEqual(7);
    expect(m.settled).toBe(false);
  });
});

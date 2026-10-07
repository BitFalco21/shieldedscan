import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { AddressActivityWindow } from "../address-activity";
import type { AddressValueExtremes } from "../address-extremes";
import type { LiveNodeRow, NetmapReader, NetmapSnapshot } from "../netmap/snapshot";
import { v1AddressWindowRoutes } from "../v1/address-windows";
import { V1_MINING_PATH, v1MiningRoutes } from "../v1/mining";
import { v1NodesRoutes } from "../v1/network-nodes";

/**
 * The third batch on `/v1`: the node map, mining terms and per-address windows. Each against a
 * stub, so the HTTP contract — strictness, the envelope, what is withheld — is pinned without a
 * database; the reads behind them are the existing, separately-tested functions.
 */

const NOW = 1_791_100_000;
const T_ADDR = "t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU";

function snapshot(): NetmapSnapshot {
  // Cast rather than annotated: the `nu7-readiness` branch adds `best_height` to the row, and a
  // fixture carrying it must typecheck on both sides of that merge.
  const live = (host: string, network: string, ua: string, over = {}): LiveNodeRow =>
    ({
      host,
      best_height: 3_505_000,
      port: 8233,
      network,
      user_agent: ua,
      protocol_version: 170_140,
      ping_ms: 40,
      first_seen: NOW - 86_400 * 20,
      last_reachable: NOW - 60,
      country: "DE",
      city: "Falkenstein",
      lat: 50.5,
      lon: 12.4,
      asn: 24940,
      asn_org: "Hetzner Online GmbH",
      tor_exit: false,
      reached: 10,
      attempted: 40,
      ...over,
    }) as LiveNodeRow;
  return {
    at: NOW,
    live: [
      live("203.0.113.7", "ipv4", "/Zebra:2.5.0/"),
      live("2001:db8::17", "ipv6", "/Zakura:1.5.0/", { asn: 16276, asn_org: "OVH SAS" }),
      live(
        "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx.onion",
        "torv3",
        "/MagicBean:6.2.0/",
        {
          country: null,
          city: null,
          lat: null,
          lon: null,
          asn: null,
          asn_org: null,
        },
      ),
    ],
    ghosts: [
      {
        host: "198.51.100.9",
        port: 8233,
        network: "ipv4",
        tor_exit: false,
        country: "US",
        lat: 40.7,
        lon: -74,
        last_error: "connect ETIMEDOUT",
        last_attempt: NOW - 300,
        last_reachable: null,
      },
    ],
    links: [{ from_host: "203.0.113.7", from_port: 8233, to_host: "198.51.100.9", to_port: 8233 }],
    crawls: [
      { started_at: NOW - 900, finished_at: NOW - 600, attempted: 4, reachable: 3, new_nodes: 0 },
    ],
    crawlsTotal: 1,
    firstCrawlStartedAt: NOW - 900,
    // Fields the `nu7-readiness` branch adds; harmless here, required there.
    recentBlocks: [],
    releaseDays: [],
  } as NetmapSnapshot;
}

const reader: NetmapReader = { read: async () => snapshot(), close: async () => {} };
const HOSTS = ["203.0.113.7", "2001:db8::17", "198.51.100.9", ".onion"];

describe("/v1/nodes*", () => {
  it("never carries an address, on any route", async () => {
    const app = v1NodesRoutes(reader);
    for (const path of [
      "/v1/nodes",
      "/v1/nodes/list",
      "/v1/nodes/geography",
      "/v1/nodes/concentration",
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      const text = await res.text();
      for (const host of HOSTS) expect(text, `${path} leaked ${host}`).not.toContain(host);
    }
  });

  it("withholds the figures that measure our crawler rather than the nodes", async () => {
    const app = v1NodesRoutes(reader);
    const text = [
      await (await app.request("/v1/nodes")).text(),
      await (await app.request("/v1/nodes/concentration")).text(),
      await (await app.request("/v1/nodes/geography")).text(),
    ].join("\n");
    // Per-client answer rates, "answered every crawl", uptime and the latency histogram mostly
    // measure our own crawler, so they are withheld from the public surface.
    for (const key of ["answerRate", "answeredEveryCrawl", "uptime", "latency", "medianPingMs"]) {
      expect(text, key).not.toContain(key);
    }
  });

  it("states counts as a lower bound, with the counts the page shows", async () => {
    const body = await (await v1NodesRoutes(reader).request("/v1/nodes")).json();
    expect(body.coverage.status).toBe("floor");
    expect(body.data.answering).toBe(3);
    expect(body.data.ipv6.answering).toBe(1);
    expect(body.data.clients.length).toBeGreaterThan(0);
  });

  it("lists nodes with what each figure counts, and is strict about its filters", async () => {
    const app = v1NodesRoutes(reader);
    const list = await (await app.request("/v1/nodes/list?limit=2")).json();
    expect(list.items).toHaveLength(2);
    expect(list.items[0].crawlsAnswered).toEqual({ answered: 10, attempted: 40 });
    expect(list.nextCursor).not.toBeNull();
    // No total on a keyset page: the summary carries the counts.
    expect(list).not.toHaveProperty("total");
    const next = await (
      await app.request(`/v1/nodes/list?limit=2&cursor=${list.nextCursor}`)
    ).json();
    expect(next.items).toHaveLength(1);
    expect((await app.request("/v1/nodes/list?asn=hetzner")).status).toBe(400);
    expect((await app.request("/v1/nodes/list?client=%3Cscript%3E")).status).toBe(400);
    // A well-formed client nobody runs is an honest empty page, not an error.
    const none = await (await app.request("/v1/nodes/list?client=NoSuchClient")).json();
    expect(none.items).toEqual([]);
    expect((await app.request("/v1/nodes?x=1")).status).toBe(400);
  });

  it("answers 503 when the snapshot cannot be read, never an empty network", async () => {
    const broken: NetmapReader = {
      read: async () => {
        throw new Error("relation net_node does not exist");
      },
      close: async () => {},
    };
    const res = await v1NodesRoutes(broken).request("/v1/nodes");
    expect(res.status).toBe(503);
  });
});

describe(V1_MINING_PATH, () => {
  it("states the rate in solutions per second with its basis, and memoises the node reads", async () => {
    let reads = 0;
    const app = v1MiningRoutes({
      chain: {
        getChainFacts: async () => (reads++, { height: 3_505_000, bestBlockHash: "00ab" }),
        getDifficultyByHash: async () => 250_000_000,
        getNetworkSolps: async () => 23_000_000_000,
        getBlockSubsidy: async () => ({ miner: 1.25 }),
      },
      pool: null,
      price: null,
    });
    const body = await (await app.request(V1_MINING_PATH)).json();
    expect(body.data.networkSolutionRate).toEqual({ solPerSecond: 23_000_000_000, basis: "node" });
    expect(body.data.minerSubsidy).toEqual({ zat: 125_000_000, zec: "1.25000000" });
    expect(body.data.priceUsd).toBeNull();
    expect(body.unknowns["data.priceUsd"]).toBe("unmeasured");
    await app.request(V1_MINING_PATH);
    expect(reads).toBe(1);
  });
});

describe("/v1/addresses/{address}/activity and /extremes", () => {
  const window: AddressActivityWindow = {
    address: T_ADDR,
    fromHeight: 3_400_000,
    toHeight: 3_430_000,
    txCount: 12,
    receivedZat: 500_000_000,
    sentZat: 200_000_000,
    netZat: 300_000_000,
    firstHeight: 3_400_100,
    lastHeight: 3_429_000,
    complete: false,
    coversFromHeight: 3_410_000,
    lifetimeTxCount: 900,
  };
  const ext: AddressValueExtremes = {
    address: T_ADDR,
    txCount: 900,
    considered: 900,
    complete: true,
    fromHeight: 1_000_000,
    largestReceived: {
      netChangeZat: 5e9,
      count: 1,
      txid: "aa".repeat(32),
      blockHeight: 2_000_000,
      publicValueZat: 6e9,
    },
    largestSent: {
      netChangeZat: -1e9,
      count: 2,
      txid: null,
      blockHeight: null,
      publicValueZat: null,
    },
  };

  function routes() {
    const calls = { activity: 0, extremes: 0 };
    const app = v1AddressWindowRoutes({
      pool: {} as Pool,
      now: () => NOW * 1000,
      activity: async () => (calls.activity++, window),
      extremes: async () => (calls.extremes++, ext),
    });
    return { app, calls };
  }

  it("says when the walk's cap bit, and caches a closed window", async () => {
    const { app, calls } = routes();
    const path = `/v1/addresses/${T_ADDR}/activity?from=2026-07-01&to=2026-08-01`;
    const body = await (await app.request(path)).json();
    expect(body.coverage.status).toBe("partial");
    expect(body.coverage.notes[0]).toMatch(/3410000/);
    expect(body.data.net).toEqual({ zat: 300_000_000, zec: "3.00000000" });
    expect(body.data.lifetimeTransactions).toBe(900);
    await app.request(path);
    expect(calls.activity).toBe(1);
  });

  it("refuses a shielded address by name, and requires both ends of the window", async () => {
    const { app } = routes();
    const shielded = await app.request(
      "/v1/addresses/zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly/activity?from=2026-07-01&to=2026-08-01",
    );
    expect(shielded.status).toBe(400);
    expect((await shielded.json()).error.message).toMatch(/encrypted on-chain/);
    expect((await app.request(`/v1/addresses/${T_ADDR}/activity?from=2026-07-01`)).status).toBe(
      400,
    );
    expect((await app.request("/v1/addresses/garbage/extremes")).status).toBe(400);
  });

  /**
   * An emptied address read before the all-address count has caught up has no lifetime count. That
   * is our gap, not an absence of history, so the reason is `unmeasured`, never `nonexistent`.
   */
  it("labels a missing lifetime count unmeasured on both routes, never nonexistent", async () => {
    const app = v1AddressWindowRoutes({
      pool: {} as Pool,
      now: () => NOW * 1000,
      activity: async () => ({ ...window, lifetimeTxCount: null }),
      extremes: async () => ({ ...ext, txCount: null }),
    });
    const activity = await (
      await app.request(`/v1/addresses/${T_ADDR}/activity?from=2026-07-01&to=2026-08-01`)
    ).json();
    expect(activity.data.lifetimeTransactions).toBeNull();
    expect(activity.unknowns["data.lifetimeTransactions"]).toBe("unmeasured");
    const extremes = await (await app.request(`/v1/addresses/${T_ADDR}/extremes`)).json();
    expect(extremes.data.lifetimeTransactions).toBeNull();
    expect(extremes.unknowns["data.lifetimeTransactions"]).toBe("unmeasured");
  });

  it("names an extreme only when it is unique", async () => {
    const { app } = routes();
    const body = await (await app.request(`/v1/addresses/${T_ADDR}/extremes`)).json();
    expect(body.data.largestReceived.txid).toBe("aa".repeat(32));
    expect(body.data.largestSent.ties).toBe(2);
    expect(body.data.largestSent.txid).toBeNull();
    expect(body.coverage.status).toBe("complete");
  });
});

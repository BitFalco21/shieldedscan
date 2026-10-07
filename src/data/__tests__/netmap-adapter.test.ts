import { afterEach, describe, expect, it, vi } from "vitest";
import { resetApiBreaker } from "../api-request";
import { createChainApiSource } from "../chain-api-source";
import { fixtureDataSource } from "../fixture-source";
import { assertNoAddressLiterals } from "../shape-guards";

/**
 * The seven node-map reads at the adapter boundary: which statuses mean "not read", which
 * reject, whether a malformed payload fails loudly — and two checks no shape can make. The
 * topology must echo the scope it drew, and the nodes page the filter it applied. Plus one
 * check unrelated to version skew: no string shaped like an address may pass this boundary.
 *
 * The valid bodies are the fixtures' own payloads, which satisfy the same guards as the live
 * API.
 */

const config = { baseUrl: "https://api.example", token: "tkn" };

function stub(routes: Record<string, { status?: number; body: unknown }>) {
  return vi.fn().mockImplementation((url: string) => {
    for (const [needle, routed] of Object.entries(routes)) {
      if (String(url).includes(needle)) {
        const status = routed.status ?? 200;
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.resolve(routed.body),
        } as unknown as Response);
      }
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "not found" }),
    } as unknown as Response);
  });
}

function urlOf(fetchMock: ReturnType<typeof vi.fn>, needle: string): string {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes(needle));
  if (!call) throw new Error(`no fetch call matched ${needle}`);
  return String(call[0]);
}

const summary = await fixtureDataSource.getNetworkSummary();
const map = await fixtureDataSource.getNetworkMap();
const hubs = await fixtureDataSource.getNetworkTopology("hubs");
const sky = await fixtureDataSource.getNetworkTopology("all");
const health = await fixtureDataSource.getNetworkHealth();
const crawls = await fixtureDataSource.getNetworkCrawls();
const peers = await fixtureDataSource.getNetworkPeers();
const page = await fixtureDataSource.listNetworkNodes({ limit: 25 }, { client: null, asn: null });

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiBreaker();
});

describe("the node-map reads", () => {
  it("return the fixture-shaped payloads unchanged", async () => {
    const fetchMock = stub({
      "/chain/network/summary": { body: summary },
      "/chain/network/map": { body: map },
      "/chain/network/health": { body: health },
      "/chain/network/crawls": { body: crawls },
      "/chain/network/peers": { body: peers },
    });
    vi.stubGlobal("fetch", fetchMock);
    const source = createChainApiSource(config);
    expect(await source.getNetworkSummary()).toEqual(summary);
    expect(await source.getNetworkMap()).toEqual(map);
    expect(await source.getNetworkHealth()).toEqual(health);
    expect(await source.getNetworkCrawls()).toEqual(crawls);
    expect(await source.getNetworkPeers()).toEqual(peers);
  });

  it("reject a payload of the wrong shape rather than rendering blanks", async () => {
    vi.stubGlobal(
      "fetch",
      stub({ "/chain/network/summary": { body: { ...summary, reachable: "many" } } }),
    );
    const source = createChainApiSource(config);
    await expect(source.getNetworkSummary()).rejects.toThrow(/unrecognised network summary/);
  });
});

describe("the topology scope echo", () => {
  it("asks for ?scope=all only when the sky is wanted", async () => {
    const fetchMock = stub({
      "topology?scope=all": { body: sky },
      "/chain/network/topology": { body: hubs },
    });
    vi.stubGlobal("fetch", fetchMock);
    const source = createChainApiSource(config);
    expect((await source.getNetworkTopology("hubs")).ghosts).toBeUndefined();
    expect((await source.getNetworkTopology("all")).ghosts).toHaveLength(300);
    expect(urlOf(fetchMock, "/chain/network/topology")).not.toContain("scope");
  });

  it("refuses a hubs-only graph answered to a request for all", async () => {
    // An API that ignores the parameter draws a sky missing every never-answered address — a
    // well-formed graph, which is why the echo exists.
    vi.stubGlobal("fetch", stub({ "/chain/network/topology": { body: hubs } }));
    const source = createChainApiSource(config);
    await expect(source.getNetworkTopology("all")).rejects.toThrow(/hubs topology for a all/);
  });
});

describe("the nodes page", () => {
  it("omits a null filter from the URL and sends a set one", async () => {
    const zebra = await fixtureDataSource.listNetworkNodes(
      { limit: 25 },
      { client: "Zebra", asn: null },
    );
    const fetchMock = stub({
      "client=Zebra": { body: zebra },
      "/chain/network/nodes": { body: page },
    });
    vi.stubGlobal("fetch", fetchMock);
    const source = createChainApiSource(config);
    await source.listNetworkNodes({ limit: 25 }, { client: null, asn: null });
    const unfiltered = urlOf(fetchMock, "/chain/network/nodes");
    expect(unfiltered).toContain("limit=25");
    expect(unfiltered).not.toContain("client");
    expect(unfiltered).not.toContain("asn");
    const filtered = await source.listNetworkNodes(
      { limit: 25, before: "c1" },
      { client: "Zebra", asn: null },
    );
    expect(filtered.applied.client).toBe("Zebra");
    expect(urlOf(fetchMock, "client=Zebra")).toContain("before=c1");
  });

  it("refuses a page whose echoed filter differs from the one sent", async () => {
    // A dropped filter would render every node under a chip naming one client.
    vi.stubGlobal("fetch", stub({ "/chain/network/nodes": { body: page } }));
    const source = createChainApiSource(config);
    await expect(
      source.listNetworkNodes({ limit: 25 }, { client: "Zebra", asn: null }),
    ).rejects.toThrow(/different node filter/);
  });

  it("refuses a page with no echo at all — absence is what an older API sends", async () => {
    const noEcho: Record<string, unknown> = { ...page };
    delete noEcho.applied;
    vi.stubGlobal("fetch", stub({ "/chain/network/nodes": { body: noEcho } }));
    const source = createChainApiSource(config);
    await expect(
      source.listNetworkNodes({ limit: 25 }, { client: null, asn: null }),
    ).rejects.toThrow(/unrecognised network nodes/);
  });
});

describe("our node's peers", () => {
  it("resolves 503 to null — an unread node is never a count of zero", async () => {
    vi.stubGlobal(
      "fetch",
      stub({ "/chain/network/peers": { status: 503, body: { error: "peer count unavailable" } } }),
    );
    const source = createChainApiSource(config);
    expect(await source.getNetworkPeers()).toBeNull();
  });

  it("throws on 404, so a missing route stays loud", async () => {
    vi.stubGlobal("fetch", stub({}));
    const source = createChainApiSource(config);
    await expect(source.getNetworkPeers()).rejects.toThrow(/404/);
  });
});

describe("no address crosses the boundary", () => {
  it("throws on an IPv4 literal wherever it appears", async () => {
    const leaked = { ...map, cells: [{ ...map.cells[0]!, city: "203.0.113.9" }] };
    vi.stubGlobal("fetch", stub({ "/chain/network/map": { body: leaked } }));
    const source = createChainApiSource(config);
    await expect(source.getNetworkMap()).rejects.toThrow(
      /address-shaped string at \$\.cells\[0\]\.city/,
    );
  });

  it("throws on an IPv6 or onion literal", async () => {
    const v6 = { ...health, clusteredSubnets: [{ subnet: "2001:db8::7", count: 2 }] };
    vi.stubGlobal("fetch", stub({ "/chain/network/health": { body: v6 } }));
    await expect(createChainApiSource(config).getNetworkHealth()).rejects.toThrow(/address-shaped/);
    vi.unstubAllGlobals();
    const onion = { ...sky, hubs: [{ ...sky.hubs[0]!, asnOrg: "abcdefghijklmnop.onion" }] };
    vi.stubGlobal("fetch", stub({ "/chain/network/topology": { body: onion } }));
    await expect(createChainApiSource(config).getNetworkTopology("hubs")).rejects.toThrow(
      /address-shaped/,
    );
  });

  it("recognises every IPv6 spelling and no clock reading", () => {
    for (const bad of ["2001:db8::7", "[2001:db8::7]:8233", "fe80::1", "2a01:4f8:c010:1234::1"]) {
      expect(() => assertNoAddressLiterals({ org: `peer ${bad} seen` })).toThrow(/\$\.org/);
    }
    for (const fine of ["12:30:45", "seen at 12:30", "Hetzner Online GmbH", "a1b2c3d4e5f6"]) {
      expect(() => assertNoAddressLiterals({ org: fine })).not.toThrow();
    }
  });

  it("lets a version string and a /24 label through", () => {
    // The two strings on these payloads that could look like an address and are not: a
    // four-part version is skipped by key; "a.b.c.x" has three numeric octets, so the IPv4
    // shape does not match it.
    expect(() =>
      assertNoAddressLiterals(
        { version: "1.2.3.4", subnet: "10.0.7.x", org: "Hetzner Online GmbH" },
        { skipKeys: ["version"] },
      ),
    ).not.toThrow();
    expect(() => assertNoAddressLiterals({ subnet: "10.0.7.4" })).toThrow(/\$\.subnet/);
  });
});

const releases = await fixtureDataSource.getNetworkReleases();

describe("the releases read", () => {
  it("returns the fixture payload unchanged, history included", async () => {
    vi.stubGlobal("fetch", stub({ "/chain/network/releases": { body: releases } }));
    const source = createChainApiSource(config);
    expect(await source.getNetworkReleases()).toEqual(releases);
    expect(releases.history.length).toBeGreaterThan(1);
  });

  it("refuses groups that do not sum to the answering count", async () => {
    const short = { ...releases, answering: releases.answering + 1 };
    vi.stubGlobal("fetch", stub({ "/chain/network/releases": { body: short } }));
    await expect(createChainApiSource(config).getNetworkReleases()).rejects.toThrow(
      /unrecognised network releases shape/,
    );
  });

  it("refuses a client name shaped like an address (versions are exempt by design)", async () => {
    const leaky = {
      ...releases,
      groups: releases.groups.map((g, i) => (i === 0 ? { ...g, client: "203.0.113.7" } : g)),
    };
    vi.stubGlobal("fetch", stub({ "/chain/network/releases": { body: leaky } }));
    await expect(createChainApiSource(config).getNetworkReleases()).rejects.toThrow(
      /address-shaped/,
    );
  });
});

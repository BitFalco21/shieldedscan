import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  MessageReader,
  NETWORK_MAGIC,
  buildVersion,
  encodeMessage,
  writeCompactSize,
} from "../p2p/codec";
import {
  addrToIdentity,
  crawlOnce,
  isRoutableHost,
  probePeer,
  type ProbeResult,
} from "../p2p/crawl";
import { classifyUserAgent } from "../p2p/user-agent";
import type { CrawlTotals, NodeIdentity, ProbeOutcome } from "../p2p/net-store";

const MAGIC = NETWORK_MAGIC.mainnet;

/**
 * A loopback peer speaking the real wire protocol through the same codec, so `probePeer`'s whole
 * exchange (version, verack, sendaddrv2, getaddr, ping mid-gossip, addr) runs over an actual TCP
 * socket.
 */
function loopbackPeer(behaviour: {
  userAgent?: string;
  answerGetaddr?: Buffer[];
  pingMidGossip?: boolean;
  silent?: boolean;
}): Promise<{ port: number; close: () => Promise<void>; pongs: Buffer[] }> {
  const pongs: Buffer[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    if (behaviour.silent) return; // accept and say nothing — a timeout, not a refusal
    const reader = new MessageReader(MAGIC);
    socket.on("data", (chunk) => {
      for (const message of reader.push(chunk)) {
        if (message.command === "version") {
          socket.write(
            encodeMessage(
              MAGIC,
              "version",
              buildVersion({
                protocolVersion: 170_160,
                services: 1n,
                timestampSec: Math.floor(Date.now() / 1000),
                nonce: Buffer.alloc(8, 9),
                userAgent: behaviour.userAgent ?? "/Zebra:6.3.0/",
                startHeight: 3_500_000,
              }),
            ),
          );
          socket.write(encodeMessage(MAGIC, "verack", Buffer.alloc(0)));
        }
        if (message.command === "getaddr") {
          if (behaviour.pingMidGossip) {
            socket.write(encodeMessage(MAGIC, "ping", Buffer.from("0102030405060708", "hex")));
          }
          for (const payload of behaviour.answerGetaddr ?? []) {
            socket.write(encodeMessage(MAGIC, "addr", payload));
          }
        }
        if (message.command === "pong") pongs.push(Buffer.from(message.payload));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        pongs,
        close: () =>
          new Promise((done) => {
            // A silent peer holds a half-open socket that server.close() would wait on.
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

function addrPayload(entries: Array<{ ipHex: string; port: number }>): Buffer {
  const rows = entries.map(({ ipHex, port }) => {
    const b = Buffer.alloc(30);
    b.writeUInt32LE(1_757_000_000, 0);
    b.writeBigUInt64LE(1n, 4);
    Buffer.from(ipHex, "hex").copy(b, 12);
    b.writeUInt16BE(port, 28);
    return b;
  });
  return Buffer.concat([writeCompactSize(entries.length), ...rows]);
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

describe("probePeer over a real socket", () => {
  it("handshakes, answers ping, harvests gossip and reports the peer's claims", async () => {
    const peer = await loopbackPeer({
      userAgent: "/Zakura:1.2.0/",
      pingMidGossip: true,
      answerGetaddr: [
        addrPayload([
          { ipHex: "00000000000000000000ffff08080808", port: 8233 },
          { ipHex: "00000000000000000000ffff01010101", port: 8233 },
        ]),
      ],
    });
    cleanups.push(peer.close);
    const result = await probePeer({ host: "127.0.0.1", port: peer.port, network: "ipv4" }, MAGIC, {
      timeoutMs: 4_000,
      gossipLingerMs: 150,
    });
    expect(result.ok).toBe(true);
    expect(result.version?.userAgent).toBe("/Zakura:1.2.0/");
    expect(result.version?.startHeight).toBe(3_500_000);
    expect(result.pingMs).toBeGreaterThanOrEqual(0);
    expect(result.advertised.map((a) => a.host)).toEqual(["8.8.8.8", "1.1.1.1"]);
    // The mid-gossip ping was answered with its own nonce — peers drop us otherwise.
    expect(peer.pongs.map((p) => p.toString("hex"))).toEqual(["0102030405060708"]);
  });

  it("reports a refused connection as unreachable, never as an exception", async () => {
    // Bind then close, so the port is known-dead.
    const peer = await loopbackPeer({ silent: true });
    await peer.close();
    const result = await probePeer({ host: "127.0.0.1", port: peer.port, network: "ipv4" }, MAGIC, {
      timeoutMs: 2_000,
    });
    expect(result.ok).toBe(false);
    expect(result.version).toBeNull();
    expect(result.pingMs).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("times out a peer that accepts and says nothing", async () => {
    const peer = await loopbackPeer({ silent: true });
    cleanups.push(peer.close);
    const result = await probePeer({ host: "127.0.0.1", port: peer.port, network: "ipv4" }, MAGIC, {
      timeoutMs: 300,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("crawlOnce", () => {
  interface FakeStoreState {
    probes: Array<{ crawlId: number; node: NodeIdentity; outcome: ProbeOutcome }>;
    seen: Array<{ entries: NodeIdentity[]; advertisedBy?: { host: string; port: number } }>;
    finished: CrawlTotals | null;
    releaseDays: number;
  }

  function fakeStore(dialable: NodeIdentity[]): FakeStoreState & {
    store: Parameters<typeof crawlOnce>[0]["store"];
  } {
    const state: FakeStoreState = { probes: [], seen: [], finished: null, releaseDays: 0 };
    return {
      ...state,
      store: {
        dialableNodes: async () => dialable,
        beginCrawl: async () => 7,
        finishCrawl: async (_id, totals) => {
          state.finished = totals;
        },
        recordSeen: async (_at, entries, advertisedBy) => {
          state.seen.push(advertisedBy ? { entries, advertisedBy } : { entries });
          return entries.length;
        },
        recordProbe: async (crawlId, node, _at, outcome) => {
          state.probes.push({ crawlId, node, outcome });
        },
        enrichPending: async () => 0,
        recordReleaseDay: async () => {
          state.releaseDays += 1;
          return 0;
        },
      },
      get probes() {
        return state.probes;
      },
      get seen() {
        return state.seen;
      },
      get finished() {
        return state.finished;
      },
      get releaseDays() {
        return state.releaseDays;
      },
    };
  }

  const nodeAt = (n: number): NodeIdentity => ({
    host: `203.0.113.${n}`,
    port: 8233,
    network: "ipv4",
  });

  it("bounds concurrency — measured by peak in-flight, never by reading the constant", async () => {
    const targets = Array.from({ length: 20 }, (_, i) => nodeAt(i + 1));
    const fake = fakeStore(targets);
    let inFlight = 0;
    let peak = 0;
    const totals = await crawlOnce({
      store: fake.store,
      resolveSeeds: async () => [],
      probe: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { ok: false, pingMs: null, version: null, advertised: [], error: "x" };
      },
      now: () => 1_757_000_000_000,
      log: () => {},
      concurrency: 4,
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(totals.attempted).toBe(20);
    expect(totals.reachable).toBe(0);
  });

  it("records the day's release line after every cycle, after the cycle is closed", async () => {
    const fake = fakeStore([nodeAt(1)]);
    await crawlOnce({
      store: fake.store,
      resolveSeeds: async () => [],
      probe: async () => ({ ok: false, pingMs: null, version: null, advertised: [], error: "x" }),
      now: () => 1_757_000_000_000,
      log: () => {},
    });
    expect(fake.finished).not.toBeNull();
    expect(fake.releaseDays).toBe(1);
  });

  it("logs a failed release record and still completes the cycle", async () => {
    const fake = fakeStore([nodeAt(1)]);
    const lines: string[] = [];
    const totals = await crawlOnce({
      store: {
        ...fake.store,
        recordReleaseDay: async () => {
          throw new Error("relation net_release_day is gone");
        },
      },
      resolveSeeds: async () => [],
      probe: async () => ({ ok: false, pingMs: null, version: null, advertised: [], error: "x" }),
      now: () => 1_757_000_000_000,
      log: (line) => lines.push(line),
    });
    expect(totals.attempted).toBe(1);
    expect(lines.some((l) => l.startsWith("release record FAILED"))).toBe(true);
  });

  it("records gossip with the advertiser as the edge, filtered to routable hosts", async () => {
    const target = nodeAt(1);
    const fake = fakeStore([target]);
    const probe = async (): Promise<ProbeResult> => ({
      ok: true,
      pingMs: 12,
      version: {
        protocolVersion: 170_160,
        services: 1n,
        timestampSec: 1,
        userAgent: "/Zebra:6.3.0/",
        startHeight: 1,
      },
      advertised: [
        { timestampSec: 1, services: 1n, network: "ipv4", host: "8.8.8.8", port: 8233 },
        { timestampSec: 1, services: 1n, network: "ipv4", host: "192.168.1.7", port: 8233 },
        { timestampSec: 1, services: 1n, network: "ipv4", host: "9.9.9.9", port: 0 },
        // Zebra's ephemeral-port gossip: the host is real, the port is not, so it is normalised to
        // the default and never recorded as-is.
        { timestampSec: 1, services: 1n, network: "ipv4", host: "1.1.1.1", port: 50198 },
      ],
      error: null,
    });
    await crawlOnce({
      store: fake.store,
      resolveSeeds: async () => [],
      probe,
      now: () => 1_757_000_000_000,
      log: () => {},
    });
    const gossip = fake.seen.find((s) => s.advertisedBy);
    expect(gossip?.advertisedBy).toEqual({ host: target.host, port: target.port, network: "ipv4" });
    expect(gossip?.entries.map((e) => `${e.host}:${e.port}`)).toEqual([
      "8.8.8.8:8233",
      "1.1.1.1:8233",
    ]);
  });

  it("a seeder outage does not cost the cycle", async () => {
    const fake = fakeStore([nodeAt(1)]);
    const totals = await crawlOnce({
      store: fake.store,
      resolveSeeds: async () => {
        throw new Error("dns down");
      },
      probe: async () => ({ ok: false, pingMs: null, version: null, advertised: [], error: "x" }),
      now: () => 1_757_000_000_000,
      log: () => {},
    });
    expect(totals.attempted).toBe(1);
    expect(fake.finished).toEqual(totals);
  });
});

describe("isRoutableHost", () => {
  it("keeps public space and refuses private, loopback, CGNAT, multicast and link-local", () => {
    const routable: Array<[string, "ipv4" | "ipv6" | "torv3"]> = [
      ["8.8.8.8", "ipv4"],
      ["100.128.0.1", "ipv4"],
      ["2a01:4f8::1", "ipv6"],
      ["a".repeat(56) + ".onion", "torv3"],
    ];
    const not: Array<[string, "ipv4" | "ipv6" | "torv3"]> = [
      ["10.0.0.1", "ipv4"],
      ["127.0.0.1", "ipv4"],
      ["172.20.1.1", "ipv4"],
      ["192.168.0.1", "ipv4"],
      ["100.64.0.1", "ipv4"],
      ["169.254.0.1", "ipv4"],
      ["224.0.0.1", "ipv4"],
      ["0.1.2.3", "ipv4"],
      ["::1", "ipv6"],
      ["fe80::1", "ipv6"],
      ["fd00::1", "ipv6"],
      ["not-an-onion.onion", "torv3"],
    ];
    for (const [host, network] of routable) expect(isRoutableHost(host, network), host).toBe(true);
    for (const [host, network] of not) expect(isRoutableHost(host, network), host).toBe(false);
  });
});

describe("classifyUserAgent", () => {
  it("maps wire names to the names readers know, and keeps unknown names verbatim", () => {
    expect(classifyUserAgent("/Zebra:6.3.0/")).toEqual({ client: "Zebra", version: "6.3.0" });
    expect(classifyUserAgent("/MagicBean:6.2.0/")).toEqual({ client: "zcashd", version: "6.2.0" });
    expect(classifyUserAgent("/Zakura:1.2.0-modified/")).toEqual({
      client: "Zakura",
      version: "1.2.0-modified",
    });
    expect(classifyUserAgent("/zcash-seeder:1.6.1/")).toEqual({
      client: "Seeder",
      version: "1.6.1",
    });
    // Stacked agents: the OUTERMOST software is last, per BIP 14.
    expect(classifyUserAgent("/MagicBean:6.2.0/CustomShell:0.2.0/")).toEqual({
      client: "CustomShell",
      version: "0.2.0",
    });
    expect(classifyUserAgent(null)).toEqual({ client: null, version: null });
    expect(classifyUserAgent("///")).toEqual({ client: null, version: null });
  });
});

describe("addrToIdentity", () => {
  it("carries host, port and network and nothing else", () => {
    expect(
      addrToIdentity({ timestampSec: 1, services: 1n, network: "ipv4", host: "8.8.8.8", port: 1 }),
    ).toEqual({ host: "8.8.8.8", port: 1, network: "ipv4" });
  });
});

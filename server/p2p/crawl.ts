import { randomBytes } from "node:crypto";
import net from "node:net";
import {
  CRAWLER_PROTOCOL_VERSION,
  CRAWLER_USER_AGENT,
  MessageReader,
  encodeMessage,
  buildGetaddr,
  buildPong,
  buildSendAddrV2,
  buildVerack,
  buildVersion,
  parseAddr,
  parseAddrV2,
  parseVersion,
  type AddrEntry,
  type ParsedVersion,
} from "./codec";
import type { CrawlTotals, NetStore, NodeIdentity, ProbeOutcome } from "./net-store";

/**
 * The crawl engine: probe every known address, harvest gossip, record outcomes.
 *
 * Shaped like `server/venue-poll.ts`: a pure-ish `crawlOnce(deps)` over injected collaborators, driven
 * by a sequential while-loop so cycles can never overlap. Two properties matter:
 *
 *  - No peer can take down a cycle: every probe's failure is an outcome to record, never an
 *    exception that escapes the worker.
 *  - Fan-out is bounded: a fixed worker pool, never `Promise.all` over every address.
 */

/** A thrown value's message, for a log line or a probe's recorded error. */
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const CRAWL_INTERVAL_MS = 10 * 60_000;
export const DEFAULT_CONCURRENCY = 48;
/** Whole-probe deadline: connect, handshake, gossip, gone. */
const PROBE_TIMEOUT_MS = 15_000;
/** After the first gossip message, how long to linger for stragglers before hanging up. */
const GOSSIP_LINGER_MS = 2_000;
/** A peer answers getaddr with up to 1,000 entries per message; accepting more than a couple
 * of messages' worth means one hostile peer chooses how big our address table gets. */
const MAX_ADDRS_PER_PEER = 2_000;

/** Addresses dialled per cycle. The network has about 5,000 known nodes; this leaves headroom. */
const MAX_DIAL_PER_CYCLE = 10_000;

/** The public DNS seeders. Bootstrap and top-up only — after the first cycle the database
 * itself is the seed list. Hosts are configuration in spirit; overridable via env in main. */
export const DEFAULT_DNS_SEEDS = [
  "dnsseed.z.cash",
  "mainnet.seeder.zfnd.org",
  "dnsseed.str4d.xyz",
] as const;

export const MAINNET_P2P_PORT = 8233;

export interface ProbeResult {
  ok: boolean;
  pingMs: number | null;
  version: ParsedVersion | null;
  advertised: AddrEntry[];
  error: string | null;
}

/**
 * Gossip carries garbage — private ranges, loopback, multicast — and probing those from a
 * rented box is at best noise and at worst reads as scanning someone's internal network.
 * Only routable addresses are recorded at all.
 */
export function isRoutableHost(host: string, network: AddrEntry["network"]): boolean {
  if (network === "torv3") return /^[a-z2-7]{56}\.onion$/.test(host);
  if (network === "ipv4") {
    const parts = host.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return false;
    }
    const [a, b, c] = parts as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    // Documentation, IETF and 6to4-relay ranges.
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 192 && b === 88 && c === 99) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  const lower = host.toLowerCase();
  // An embedded IPv4 form, or anything starting "::" (unspecified, loopback, IPv4-compatible,
  // IPv4-mapped), can reach IPv4 space the rules above would refuse.
  if (lower.includes(".") || lower.startsWith("::")) return false;
  if (/^f[cd]/.test(lower)) return false; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(lower)) return false; // fe80::/10 link-local
  if (/^ff/.test(lower)) return false; // multicast
  if (/^64:ff9b:/.test(lower)) return false; // NAT64
  if (/^2002:/.test(lower)) return false; // 6to4
  if (/^2001:0?:/.test(lower)) return false; // Teredo 2001::/32
  if (/^2001:db8:/.test(lower)) return false; // documentation
  if (/^100::/.test(lower) || /^100:0:0:0:/.test(lower)) return false; // discard 100::/64
  return true;
}

export function addrToIdentity(entry: AddrEntry): NodeIdentity {
  return { host: entry.host, port: entry.port, network: entry.network };
}

/**
 * One handshake: connect, version/verack, sendaddrv2 + getaddr, collect gossip, disconnect
 * politely. The measured `pingMs` is TCP-connect-to-verack, a fact about our vantage point and
 * labelled as such wherever it renders. Never throws; a failure is a result.
 */
export function probePeer(
  node: NodeIdentity,
  magic: Buffer,
  opts: {
    timeoutMs?: number;
    gossipLingerMs?: number;
    bestHeight?: number;
    /**
     * Ask for addrv2 gossip (BIP/ZIP 155), the only form that can carry Tor v3 addresses. Off by
     * default: Zebra, most of the network, does not implement ZIP 155 and drops a connection on an
     * unknown command, which costs almost all gossip. The trade: torv3 peers are found only if a
     * zcashd peer volunteers them, so the Tor figure rests mostly on the exit-list flag.
     */
    sendAddrV2?: boolean;
  } = {},
): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const gossipLingerMs = opts.gossipLingerMs ?? GOSSIP_LINGER_MS;
  return new Promise((resolve) => {
    const started = Date.now();
    const reader = new MessageReader(magic);
    const advertised: AddrEntry[] = [];
    let version: ParsedVersion | null = null;
    let pingMs: number | null = null;
    let sawVerack = false;
    let settled = false;
    let lingerTimer: NodeJS.Timeout | undefined;

    const socket = net.connect({ host: node.host, port: node.port });
    socket.setNoDelay(true);

    const finish = (error: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (lingerTimer) clearTimeout(lingerTimer);
      socket.destroy();
      const ok = version !== null && sawVerack;
      resolve({
        ok,
        pingMs: ok ? pingMs : null,
        version: ok ? version : null,
        advertised: ok ? advertised.slice(0, MAX_ADDRS_PER_PEER) : [],
        // A handshake that completed and then timed out collecting gossip is still a
        // reachable node — the error slot is for the probes that never got there.
        error: ok ? null : (error ?? "handshake incomplete"),
      });
    };

    const deadline = setTimeout(() => finish("timed out"), timeoutMs);
    deadline.unref();

    socket.on("error", (error) => finish(error.message));
    socket.on("close", () => finish(null));
    socket.on("connect", () => {
      // The version message alone during the handshake. BIP 155 puts sendaddrv2 before verack,
      // but Zebra does not implement ZIP 155 and a strict handshake may treat any unexpected
      // pre-verack message as a violation, so it goes out after verack (below), where a peer that
      // knows it may honour it and one that does not ignores an unknown command.
      socket.write(encodeVersionMessage(magic, opts.bestHeight ?? 0));
    });
    socket.on("data", (chunk) => {
      try {
        for (const message of reader.push(chunk)) {
          switch (message.command) {
            case "version":
              version = parseVersion(message.payload);
              socket.write(buildVerack(magic));
              break;
            case "verack":
              sawVerack = true;
              pingMs = Date.now() - started;
              socket.write(
                opts.sendAddrV2
                  ? Buffer.concat([buildGetaddr(magic), buildSendAddrV2(magic)])
                  : buildGetaddr(magic),
              );
              break;
            case "ping":
              socket.write(buildPong(magic, message.payload));
              break;
            case "addr":
              advertised.push(...parseAddr(message.payload));
              scheduleLinger();
              break;
            case "addrv2":
              advertised.push(...parseAddrV2(message.payload).entries);
              scheduleLinger();
              break;
            default:
              // inv, headers, whatever else the peer volunteers — not this crawler's business.
              break;
          }
          if (advertised.length >= MAX_ADDRS_PER_PEER) return finish(null);
        }
      } catch (error) {
        finish(errorText(error));
      }
    });

    function scheduleLinger(): void {
      if (lingerTimer) clearTimeout(lingerTimer);
      lingerTimer = setTimeout(() => finish(null), gossipLingerMs);
      lingerTimer.unref();
    }
  });
}

/** Our own version message: honest user agent, services 0 — this crawler serves no blocks. */
function encodeVersionMessage(magic: Buffer, bestHeight: number): Buffer {
  const payload = buildVersion({
    protocolVersion: CRAWLER_PROTOCOL_VERSION,
    services: 0n,
    timestampSec: Math.floor(Date.now() / 1000),
    nonce: randomBytes(8),
    userAgent: CRAWLER_USER_AGENT,
    startHeight: bestHeight,
  });
  return encodeMessage(magic, "version", payload);
}

export interface CrawlDeps {
  store: Pick<
    NetStore,
    | "dialableNodes"
    | "beginCrawl"
    | "finishCrawl"
    | "recordSeen"
    | "recordProbe"
    | "enrichPending"
    | "recordReleaseDay"
  >;
  /** DNS seeder resolution, injected so tests never touch the resolver. */
  resolveSeeds: () => Promise<NodeIdentity[]>;
  probe: (node: NodeIdentity) => Promise<ProbeResult>;
  now: () => number;
  log: (message: string) => void;
  concurrency?: number;
  /** The network's listening port (8233 on mainnet). Gossip is normalised onto it — see
   * `normaliseGossipPort`. */
  p2pPort?: number;
}

/**
 * Zebra gossips the addresses of peers that connected to it with the source port of that
 * inbound connection: an ephemeral port nobody listens on, so most gossiped ports are not
 * dialable. The host is still real, and a node behind an ephemeral port almost always listens on
 * the default, so the address is recorded on the default port and probed there next cycle. A
 * host that turns out not to listen is pruned as never-reachable.
 */
function normaliseGossipPort(entry: AddrEntry, p2pPort: number): NodeIdentity {
  return {
    host: entry.host,
    port: entry.port === p2pPort ? entry.port : p2pPort,
    network: entry.network,
  };
}

/** One cycle. Probes what the database knew at cycle start; newly gossiped addresses are
 * recorded and get their first probe next cycle, which is what bounds a cycle's size. */
export async function crawlOnce(deps: CrawlDeps): Promise<CrawlTotals> {
  const nowSec = (): number => Math.floor(deps.now() / 1000);
  try {
    const seeds = (await deps.resolveSeeds()).filter((s) => isRoutableHost(s.host, s.network));
    await deps.store.recordSeen(nowSec(), seeds);
  } catch (error) {
    // A seeder outage is not a crawl outage: the database already holds the network.
    deps.log(`seed resolution FAILED ${errorText(error)}`);
  }

  const targets = await deps.store.dialableNodes(MAX_DIAL_PER_CYCLE);
  const crawlId = await deps.store.beginCrawl(nowSec());
  let attempted = 0;
  let reachable = 0;
  let newNodes = 0;

  const queue = [...targets];
  const worker = async (): Promise<void> => {
    for (;;) {
      const node = queue.shift();
      if (!node) return;
      try {
        const result = await deps.probe(node);
        attempted += 1;
        if (result.ok) reachable += 1;
        const outcome: ProbeOutcome = {
          ok: result.ok,
          pingMs: result.pingMs,
          version: result.version,
          error: result.error,
        };
        await deps.store.recordProbe(crawlId, node, nowSec(), outcome);
        if (result.ok && result.advertised.length > 0) {
          const routable = result.advertised
            .filter((a) => a.port > 0 && a.port <= 65535 && isRoutableHost(a.host, a.network))
            .map((a) => normaliseGossipPort(a, deps.p2pPort ?? MAINNET_P2P_PORT));
          newNodes += await deps.store.recordSeen(nowSec(), routable, node);
        }
      } catch (error) {
        // A store hiccup on one node must not cost the rest of the cycle.
        deps.log(`probe of ${node.host} FAILED past the socket: ${errorText(error)}`);
      }
    }
  };

  const width = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, () => worker()));

  const totals: CrawlTotals = { finishedAt: nowSec(), attempted, reachable, newNodes };
  await deps.store.finishCrawl(crawlId, totals);
  const enriched = await deps.store.enrichPending(nowSec());
  // The daily release record runs after the cycle is closed, and its failure is logged rather
  // than thrown: a missed line of history is milder than a crawl cycle reported as failed.
  let releaseGroups = 0;
  try {
    releaseGroups = await deps.store.recordReleaseDay(nowSec());
  } catch (error) {
    deps.log(`release record FAILED ${errorText(error)}`);
  }
  deps.log(
    `crawl ${crawlId}: ${reachable}/${attempted} reachable, ${newNodes} new, ${enriched} enriched, ` +
      `${releaseGroups} release groups recorded`,
  );
  return totals;
}

/** Runs cycles forever, sequentially — the venue-poll.ts shape. Returns a stop handle. */
export function startCrawling(deps: CrawlDeps, intervalMs = CRAWL_INTERVAL_MS): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        await crawlOnce(deps);
      } catch (error) {
        deps.log(`crawl cycle FAILED ${errorText(error)}`);
      }
      if (stopped) break;
      // Not unref'd. Between cycles this timer is the only thing on the event loop (every socket
      // is closed and every other timer here is unref'd), so an unref'd sleep would let Node exit
      // after each cycle; the container restart that follows reconnects within seconds, and
      // Zebra peers back off a host that does that.
      await new Promise<void>((resolve) => {
        timer = setTimeout(resolve, intervalMs);
      });
    }
  };
  void loop();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

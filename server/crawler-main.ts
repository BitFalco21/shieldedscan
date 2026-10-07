import { Resolver } from "node:dns/promises";
import { NETWORK_MAGIC } from "./p2p/codec";
import {
  CRAWL_INTERVAL_MS,
  DEFAULT_CONCURRENCY,
  DEFAULT_DNS_SEEDS,
  MAINNET_P2P_PORT,
  probePeer,
  startCrawling,
  type CrawlDeps,
} from "./p2p/crawl";
import { NetStore, type NodeIdentity } from "./p2p/net-store";
import { fetchTorExitList } from "./p2p/tor-exits";
import { DAY_SECONDS } from "@/domain/time";
import { log, parseNetworkEnv, requirePostgres } from "./entrypoint";

/**
 * The network crawler, as its own process and container. It opens outbound TCP to arbitrary
 * internet peers, which nothing else on the host does, so a crash-looping crawler must never cost
 * an ingested block or a served request.
 *
 * It holds Postgres credentials and nothing else: no API bearer token, no node RPC, no X
 * credential. The MaxMind license key lives only with the cron refresh script.
 */

const SCHEMA_PATH = process.env.NET_SCHEMA_PATH ?? "./schema-net.sql";
/** Zcash testnet's listening port; mainnet's is `MAINNET_P2P_PORT`. */
const TESTNET_P2P_PORT = 18_233;

const NETWORK = parseNetworkEnv();
const MAGIC = NETWORK_MAGIC[NETWORK];
const P2P_PORT = Number(
  process.env.ZCASH_P2P_PORT ?? (NETWORK === "testnet" ? TESTNET_P2P_PORT : MAINNET_P2P_PORT),
);
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? DEFAULT_CONCURRENCY);
const INTERVAL_MS = Number(process.env.CRAWL_INTERVAL_MS ?? CRAWL_INTERVAL_MS);
const DNS_SEEDS = (process.env.DNS_SEEDS ?? DEFAULT_DNS_SEEDS.join(",")).split(",").filter(Boolean);

requirePostgres("the crawler has no in-memory mode");

const store = new NetStore(process.env.DATABASE_URL);
await store.applySchema(SCHEMA_PATH);
log(`schema applied, crawling ${NETWORK} (port ${P2P_PORT}) every ${INTERVAL_MS / 1000}s`);

const resolver = new Resolver();

/**
 * DNS seed resolution, for bootstrap and top-up only: after the first cycle the database is the
 * seed list, so a total seeder outage is logged and tolerated (see `crawlOnce`). Each seeder is
 * an A/AAAA record set; every answer is a listening node on the P2P port.
 */
async function resolveSeeds(): Promise<NodeIdentity[]> {
  const out: NodeIdentity[] = [];
  for (const seed of DNS_SEEDS) {
    try {
      const [v4, v6] = await Promise.allSettled([resolver.resolve4(seed), resolver.resolve6(seed)]);
      if (v4.status === "fulfilled") {
        for (const host of v4.value) out.push({ host, port: P2P_PORT, network: "ipv4" });
      }
      if (v6.status === "fulfilled") {
        for (const host of v6.value) out.push({ host, port: P2P_PORT, network: "ipv6" });
      }
    } catch (error) {
      log(`seed ${seed} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}

const deps: CrawlDeps = {
  store,
  resolveSeeds,
  // sendaddrv2 is off unless asked for; see `probePeer`'s option doc.
  probe: (node) => probePeer(node, MAGIC, { sendAddrV2: process.env.CRAWL_SEND_ADDRV2 === "1" }),
  now: () => Date.now(),
  log,
  concurrency: CONCURRENCY,
  p2pPort: P2P_PORT,
};

const stop = startCrawling(deps, INTERVAL_MS);

/**
 * Housekeeping on its own slow timer: prune the probe/gossip history and refresh the Tor exit
 * list. Failures are logged and swallowed: a stale Tor list or an un-pruned week is milder than a
 * crashed crawler.
 */
const PRUNE_PROBE_SECONDS = Number(process.env.PRUNE_PROBE_SECONDS ?? 30 * DAY_SECONDS);
const PRUNE_NODE_SECONDS = Number(process.env.PRUNE_NODE_SECONDS ?? 30 * DAY_SECONDS);
const HOUSEKEEP_MS = Number(process.env.HOUSEKEEP_MS ?? 6 * 60 * 60_000);

async function housekeep(): Promise<void> {
  try {
    await store.prune(Math.floor(Date.now() / 1000), {
      probeSeconds: PRUNE_PROBE_SECONDS,
      nodeSeconds: PRUNE_NODE_SECONDS,
    });
  } catch (error) {
    log(`prune FAILED ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const exits = await fetchTorExitList();
    await store.replaceTorExits(exits, Math.floor(Date.now() / 1000));
    log(`tor exit list refreshed: ${exits.length} exits`);
  } catch (error) {
    log(`tor exit refresh FAILED ${error instanceof Error ? error.message : String(error)}`);
  }
}

void housekeep();
const housekeepTimer = setInterval(() => void housekeep(), HOUSEKEEP_MS);
housekeepTimer.unref();

const shutdown = (signal: string) => {
  log(`${signal} received, stopping after the current cycle`);
  stop();
  clearInterval(housekeepTimer);
  void store.close().then(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

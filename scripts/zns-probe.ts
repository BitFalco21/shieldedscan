/**
 * Live check of the ZNS registry, run from a laptop: samples which backend answers, then runs the
 * REAL `ZnsTracker` against the live registry and prints what it would publish.
 *
 * The one substitution: the tracker's chain check normally reads our Postgres index, which a
 * laptop does not have (and must not reach — the boundary rule). Here it asks the public `/v1`
 * API for each claim txid's height instead, which is the same fact from the same chain.
 *
 *   npx esbuild scripts/zns-probe.ts --bundle --platform=node --format=esm \
 *     --alias:@=./src --outfile=/tmp/zns-probe.mjs --log-level=warning && node /tmp/zns-probe.mjs
 */
import {
  parseZnsStatus,
  ZNS_MAINNET_ADMIN_PUBKEY,
  ZNS_MAINNET_UIVK,
  ZNS_MAINNET_URL,
  ZnsTracker,
} from "../server/zns";

const API = "https://api.shieldedscan.xyz";
const NAME = process.argv[2] ?? "zenith";

/**
 * GET against our public API, paced under its per-IP limit (20/s) and retrying a 429 after its
 * Retry-After. Without pacing, 429s would read as "not on chain" and exclude claims.
 */
let lastCall = 0;
async function v1(path: string): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wait = lastCall + 100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(`${API}${path}`);
    if (res.status !== 429) return res;
    const retry = Number(res.headers.get("retry-after") ?? "2");
    await new Promise((r) => setTimeout(r, Math.max(1, retry) * 1000));
  }
  throw new Error(`still rate-limited on ${path}`);
}

async function ourTip(): Promise<number> {
  const body = (await (await v1("/v1/blocks?limit=1")).json()) as {
    items: { height: number }[];
  };
  return body.items[0]!.height;
}

// Claim heights never change, so each txid is asked once however many attempts a poll makes.
const blockCache = new Map<string, { height: number; timestamp: number } | null>();
async function txBlocks(
  txids: readonly string[],
): Promise<Map<string, { height: number; timestamp: number }>> {
  const todo = txids.filter((t) => !blockCache.has(t));
  for (const txid of todo) {
    const res = await v1(`/v1/transactions/${txid}`);
    if (res.status === 404) {
      blockCache.set(txid, null);
      console.log(`  (txid ${txid.slice(0, 12)}… not on our chain)`);
      continue;
    }
    if (!res.ok) throw new Error(`/v1 answered ${res.status} for ${txid}`);
    const tx = (await res.json()) as { blockHeight: number | null; timestamp: number };
    blockCache.set(
      txid,
      tx.blockHeight === null ? null : { height: tx.blockHeight, timestamp: tx.timestamp },
    );
  }
  const out = new Map<string, { height: number; timestamp: number }>();
  for (const t of txids) {
    const b = blockCache.get(t);
    if (b) out.set(t, b);
  }
  return out;
}

async function sampleBackends(tip: number): Promise<void> {
  console.log(`\n== which backend answers? (our tip ${tip})`);
  for (let i = 0; i < 10; i += 1) {
    const res = await fetch(ZNS_MAINNET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: {} }),
    });
    const s = parseZnsStatus(await res.json());
    const lag = s ? tip - s.syncedHeight : NaN;
    console.log(
      `  status #${i + 1}: synced ${s?.syncedHeight} — ${lag} blocks behind${lag > 100 ? "  ← STALE" : ""}`,
    );
  }
}

const tip = await ourTip();
await sampleBackends(tip);

console.log(`\n== the real tracker, three polls`);
const tracker = new ZnsTracker({
  url: ZNS_MAINNET_URL,
  pinnedUivk: ZNS_MAINNET_UIVK,
  pinnedAdminPubkey: ZNS_MAINNET_ADMIN_PUBKEY,
  txBlocks,
  tipHeight: ourTip,
  fetch: globalThis.fetch,
  now: Date.now,
  log: (m) => console.log(`  ${m}`),
});
for (let poll = 1; poll <= 3; poll += 1) {
  console.log(` poll ${poll}:`);
  await tracker.refresh();
}

const answer = tracker.lookupName(NAME);
console.log(`\n== lookup "${NAME}"`);
console.log(
  answer === null
    ? "  no snapshot accepted — the site would say: name lookup unavailable"
    : JSON.stringify(answer, null, 2),
);

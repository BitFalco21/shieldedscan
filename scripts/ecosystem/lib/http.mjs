/**
 * Polite fetching for ecosystem discovery: one identifying User-Agent, a minimum gap per
 * host, bounded retries on 429/5xx, and an on-disk cache so a re-run costs the sources
 * nothing. The cache is keyed by URL and lives under scripts/ecosystem/out/ (gitignored);
 * delete it to force a fresh read.
 *
 * A failed fetch THROWS. A source that half-answers must not look like a source with fewer
 * projects in it — the caller decides whether one failure voids the whole source.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = "scripts/ecosystem/out/cache";
const USER_AGENT = "shieldedscan-ecosystem-discovery/1 (+https://shieldedscan.xyz)";

/** Minimum milliseconds between two requests to the same host. crates.io asks for 1/s. */
const HOST_GAP_MS = {
  "crates.io": 1100,
  "api.github.com": 1100,
  "raw.githubusercontent.com": 150,
  "openzcash.org": 500,
};
const DEFAULT_GAP_MS = 1000;

const lastHit = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `bucket` separates limits that share a host (GitHub search is 10/min, its core API 60/h). */
async function waitForSlot(bucket, gap) {
  // Reserved before sleeping, so concurrent callers queue instead of firing together.
  const now = Date.now();
  const slot = Math.max(now, (lastHit.get(bucket) ?? 0) + gap);
  lastHit.set(bucket, slot);
  if (slot > now) await sleep(slot - now);
}

function cachePath(url) {
  return join(CACHE_DIR, createHash("sha1").update(url).digest("hex") + ".json");
}

/**
 * GET `url` and return its body as text. `accept` sets the Accept header. Throws on any
 * status outside 2xx once retries are spent; a 404 is thrown immediately, since it is an
 * answer and retrying it only spends the host's patience.
 */
export async function fetchText(url, { accept = "*/*", retries = 3, bucket, gapMs } = {}) {
  const file = cachePath(url);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).body;

  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    await waitForSlot(bucket ?? host, gapMs ?? HOST_GAP_MS[host] ?? DEFAULT_GAP_MS);
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept } });
    if (res.ok) {
      const body = await res.text();
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(file, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }));
      return body;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new Error(`GET ${url} -> HTTP ${res.status}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt,
    );
  }
}

export async function fetchJson(url, options = {}) {
  return JSON.parse(await fetchText(url, { accept: "application/json", ...options }));
}

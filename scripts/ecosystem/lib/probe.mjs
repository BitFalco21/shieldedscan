/**
 * A liveness probe that RECORDS an answer instead of throwing on one. Enrichment needs to know
 * that a site answered 404, that it redirected elsewhere, or that its host no longer resolves —
 * each of those is a finding about the candidate, where `http.mjs`'s fetchText treats anything
 * but 2xx as a failure of the run.
 *
 * HTTP answers are cached (including 4xx), so a re-run costs the sites nothing. Network errors
 * are NOT cached: a timeout on one run is not evidence the site is gone, and the next run should
 * ask again.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = "scripts/ecosystem/out/probe-cache";
const USER_AGENT =
  "Mozilla/5.0 (compatible; shieldedscan-ecosystem-discovery/1; +https://shieldedscan.xyz)";
const TIMEOUT_MS = 12_000;
/** Enough for any page's title, meta tags and opening copy; nothing past it is read. */
const MAX_BODY_BYTES = 600_000;
const HOST_GAP_MS = 1_000;

const lastHit = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readCapped(res) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8").slice(0, MAX_BODY_BYTES);
}

/**
 * @returns {Promise<{ url: string, status: number | null, finalUrl: string | null,
 *   contentType: string | null, body: string, error: string | null, cached: boolean }>}
 */
export async function probe(url) {
  const file = join(CACHE_DIR, createHash("sha1").update(url).digest("hex") + ".json");
  if (existsSync(file)) return { ...JSON.parse(readFileSync(file, "utf8")), cached: true };

  // Reserve the slot BEFORE sleeping: workers that read the clock together would otherwise
  // all see the same last hit, sleep the same time, and fire at once.
  const host = new URL(url).host;
  const now = Date.now();
  const slot = Math.max(now, (lastHit.get(host) ?? 0) + HOST_GAP_MS);
  lastHit.set(host, slot);
  if (slot > now) await sleep(slot - now);

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    const contentType = res.headers.get("content-type");
    // HTML pages and XML feeds (a repo's commits.atom) are read; binaries are not.
    const body = /html|xml/.test(contentType ?? "") ? await readCapped(res) : "";
    const result = {
      url,
      status: res.status,
      finalUrl: res.url,
      contentType,
      body,
      error: null,
      fetchedAt: new Date().toISOString(),
    };
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(result));
    return { ...result, cached: false };
  } catch (error) {
    const cause = error?.cause?.code ?? error?.name ?? "error";
    return {
      url,
      status: null,
      finalUrl: null,
      contentType: null,
      body: "",
      error: String(cause),
      cached: false,
    };
  }
}

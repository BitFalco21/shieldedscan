/**
 * The edge's answer to a crawler, decided in middleware before a page is rendered. Every
 * detail page is a server render, so a bulk crawl costs real function time even when every
 * response is correct; the edge is the only place cheap enough to say no.
 *
 * Two pure decisions, testable without a request:
 *  - Known bulk scrapers are refused outright (`isBlockedAgent`). Search engines are not on the
 *    list; they honour `robots.txt`, which keeps them off the detail pages.
 *  - Everyone else is rate-limited on the expensive paths only (`RateLimiter`). The homepage,
 *    static pages, docs and the live-feed poll are never counted.
 *
 * Counters live in the isolate's memory only, written to no disk or log (no visitor logs). The
 * limit is per isolate and therefore approximate; its job is to make a crawl expensive, not to
 * count exactly. A request with no client identifier is not limited, so a platform change
 * cannot lock everyone out.
 */

/**
 * User agents refused on every path, matched as case-insensitive substrings of self-declared
 * names. An explicit list rather than a "looks like a bot" heuristic: a heuristic wide enough
 * to catch a headless scraper also catches a reader's privacy browser.
 */
export const BLOCKED_AGENTS: readonly string[] = [
  // AI training crawlers. Answer-time fetchers (ChatGPT-User, OAI-SearchBot, PerplexityBot,
  // Claude-Web) are deliberately absent: they fetch one page on a person's question and can
  // cite the site, without enumerating it.
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
  "FacebookBot",
  "Google-Extended",
  "Applebot-Extended",
  "cohere-ai",
  "Diffbot",
  "ImagesiftBot",
  "omgili",
  "PetalBot",
  "Timpibot",
  // SEO and link-graph scrapers.
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
  "BLEXBot",
  "DataForSeoBot",
  "serpstatbot",
  "Barkrowler",
];

export function isBlockedAgent(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BLOCKED_AGENTS.some((name) => ua.includes(name.toLowerCase()));
}

/**
 * The paths whose render costs a backend round trip per identifier: the three detail pages,
 * the paginated lists, search, and the address history. Anything a crawler enumerates.
 */
const EXPENSIVE_PATH = /^\/(tx|block|address)\/|^\/(blocks|txs|search|cross-chain)(\/|$)/;

export function isExpensivePath(pathname: string): boolean {
  return EXPENSIVE_PATH.test(pathname);
}

/** Sixty expensive pages a minute from one address. A reader does not reach it. */
export const CRAWL_LIMIT = 60;
export const CRAWL_WINDOW_MS = 60_000;
/** Bound on remembered addresses, so a spoofed-address flood cannot grow the map forever. */
const MAX_TRACKED = 20_000;

/**
 * A fixed-window counter per key. Simpler than a token bucket and good enough: the window is
 * a minute and the limit is far above a person, so the edge of the window does not matter.
 */
export class RateLimiter {
  readonly #hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly limit = CRAWL_LIMIT,
    private readonly windowMs = CRAWL_WINDOW_MS,
  ) {}

  /** True when this request is within the allowance; counts it either way. */
  allow(key: string, now = Date.now()): boolean {
    const entry = this.#hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      if (this.#hits.size >= MAX_TRACKED) this.#prune(now);
      this.#hits.set(key, { count: 1, windowStart: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  #prune(now: number): void {
    for (const [key, entry] of this.#hits) {
      if (now - entry.windowStart >= this.windowMs) this.#hits.delete(key);
    }
    // Still full after dropping the stale ones: forget the oldest half rather than grow.
    if (this.#hits.size >= MAX_TRACKED) {
      let n = 0;
      for (const key of this.#hits.keys()) {
        if (n++ >= MAX_TRACKED / 2) break;
        this.#hits.delete(key);
      }
    }
  }

  /** Test seam. */
  get size(): number {
    return this.#hits.size;
  }
}

export type CrawlVerdict = "allow" | "blocked-agent" | "throttled";

export interface CrawlRequest {
  pathname: string;
  userAgent: string | null;
  /** The client address as the platform reports it; null means "cannot be limited". */
  clientId: string | null;
}

export function crawlVerdict(
  request: CrawlRequest,
  limiter: RateLimiter,
  now = Date.now(),
): CrawlVerdict {
  if (isBlockedAgent(request.userAgent)) return "blocked-agent";
  if (!isExpensivePath(request.pathname) || request.clientId === null) return "allow";
  return limiter.allow(request.clientId, now) ? "allow" : "throttled";
}

import { describe, expect, it } from "vitest";
import {
  CRAWL_LIMIT,
  CRAWL_WINDOW_MS,
  RateLimiter,
  crawlVerdict,
  isBlockedAgent,
  isExpensivePath,
} from "../crawl-guard";

describe("isBlockedAgent", () => {
  it("refuses self-declared bulk scrapers, case-insensitively", () => {
    expect(isBlockedAgent("Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)")).toBe(
      true,
    );
    expect(
      isBlockedAgent(
        "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
      ),
    ).toBe(true);
    expect(
      isBlockedAgent("mozilla/5.0 (compatible; ahrefsbot/7.0; +http://ahrefs.com/robot/)"),
    ).toBe(true);
  });

  it("lets readers and search engines through", () => {
    expect(
      isBlockedAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36",
      ),
    ).toBe(false);
    expect(
      isBlockedAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    ).toBe(false);
    expect(
      isBlockedAgent("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"),
    ).toBe(false);
    expect(
      isBlockedAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
      ),
    ).toBe(false);
    expect(isBlockedAgent(null)).toBe(false);
  });
});

describe("isExpensivePath", () => {
  it("names the enumerable pages and nothing else", () => {
    for (const p of [
      "/tx/abc",
      "/block/123",
      "/address/t1x",
      "/blocks",
      "/blocks/",
      "/txs",
      "/search",
      "/cross-chain",
      "/cross-chain/flows",
    ]) {
      expect(isExpensivePath(p), p).toBe(true);
    }
    for (const p of [
      "/",
      "/shielded",
      "/analytics",
      "/api/live",
      "/api/stats",
      "/api-docs",
      "/privacy",
      "/blocksmith",
      "/transactions",
    ]) {
      expect(isExpensivePath(p), p).toBe(false);
    }
  });
});

describe("RateLimiter", () => {
  it("allows exactly the limit inside one window, then refuses", () => {
    const l = new RateLimiter(3, 1_000);
    expect([l.allow("a", 0), l.allow("a", 10), l.allow("a", 20)]).toEqual([true, true, true]);
    expect(l.allow("a", 30)).toBe(false);
    expect(l.allow("b", 30)).toBe(true); // another address is another budget
  });

  it("forgets after the window", () => {
    const l = new RateLimiter(1, 1_000);
    expect(l.allow("a", 0)).toBe(true);
    expect(l.allow("a", 500)).toBe(false);
    expect(l.allow("a", 1_000)).toBe(true);
  });

  it("does not grow without bound under a flood of distinct keys", () => {
    const l = new RateLimiter(1, 1_000);
    for (let i = 0; i < 50_000; i += 1) l.allow(`k${i}`, 0);
    expect(l.size).toBeLessThanOrEqual(20_000);
  });
});

describe("crawlVerdict", () => {
  const ua = "Mozilla/5.0 Chrome/128.0";
  it("throttles only expensive paths, and only when the client can be identified", () => {
    const l = new RateLimiter(2, CRAWL_WINDOW_MS);
    const detail = { pathname: "/tx/abc", userAgent: ua, clientId: "1.2.3.4" };
    expect(crawlVerdict(detail, l, 0)).toBe("allow");
    expect(crawlVerdict(detail, l, 0)).toBe("allow");
    expect(crawlVerdict(detail, l, 0)).toBe("throttled");
    // The homepage and the live poll are never counted.
    expect(crawlVerdict({ ...detail, pathname: "/" }, l, 0)).toBe("allow");
    expect(crawlVerdict({ ...detail, pathname: "/api/live" }, l, 0)).toBe("allow");
    // No identifier: never refused — the alternative is refusing everyone on a header change.
    expect(crawlVerdict({ ...detail, clientId: null }, l, 0)).toBe("allow");
  });

  it("refuses a blocked agent on every path, before any counting", () => {
    const l = new RateLimiter(CRAWL_LIMIT, CRAWL_WINDOW_MS);
    expect(crawlVerdict({ pathname: "/", userAgent: "GPTBot/1.0", clientId: "1.2.3.4" }, l)).toBe(
      "blocked-agent",
    );
    expect(l.size).toBe(0);
  });

  it("the production limit is above what a reader does", () => {
    // Sixty detail pages a minute is one a second, sustained; a person clicking does not.
    expect(CRAWL_LIMIT).toBeGreaterThanOrEqual(60);
  });
});

describe("answer-time AI fetchers are allowed", () => {
  it("lets ChatGPT-User, OAI-SearchBot and PerplexityBot through while GPTBot stays refused", () => {
    expect(
      isBlockedAgent("Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)"),
    ).toBe(false);
    expect(isBlockedAgent("Mozilla/5.0 (compatible; OAI-SearchBot/1.0)")).toBe(false);
    expect(isBlockedAgent("Mozilla/5.0 (compatible; PerplexityBot/1.0)")).toBe(false);
    expect(isBlockedAgent("Mozilla/5.0 (compatible; GPTBot/1.2)")).toBe(true);
  });
});

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CRAWL_LIMIT } from "@/lib/crawl-guard";

/**
 * The crawl guard as the proxy applies it, and the one knob that turns its per-address
 * throttle off. The e2e suite is a single address making hundreds of requests a minute, and
 * `next start` supplies a forwarded-for header even on localhost, so without the knob the
 * suite would be throttled by its own site. The knob must not disarm the agent block: a
 * self-declared bulk crawler is still refused under it.
 *
 * The limiter is module state, so each case loads a fresh copy of the proxy.
 */

const ADDRESS = "203.0.113.9";

function request(path: string, userAgent = "Mozilla/5.0 (test)"): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { "x-forwarded-for": ADDRESS, "user-agent": userAgent },
  });
}

async function freshProxy() {
  vi.resetModules();
  return (await import("../proxy")).proxy;
}

afterEach(() => {
  delete process.env.CRAWL_GUARD_DISABLED;
});

describe("the crawl guard in the proxy", () => {
  it("throttles one address past the limit on an expensive path", async () => {
    const proxy = await freshProxy();
    let last = 200;
    for (let i = 0; i < CRAWL_LIMIT + 1; i += 1) last = proxy(request(`/block/${i}`)).status;
    expect(last).toBe(429);
  });

  it("with CRAWL_GUARD_DISABLED=1 the same address is never throttled", async () => {
    process.env.CRAWL_GUARD_DISABLED = "1";
    const proxy = await freshProxy();
    const statuses = new Set<number>();
    for (let i = 0; i < CRAWL_LIMIT + 20; i += 1)
      statuses.add(proxy(request(`/block/${i}`)).status);
    expect([...statuses]).toEqual([200]);
  });

  it("the knob leaves the agent block armed", async () => {
    process.env.CRAWL_GUARD_DISABLED = "1";
    const proxy = await freshProxy();
    expect(proxy(request("/block/1", "Mozilla/5.0 (compatible; GPTBot/1.0)")).status).toBe(403);
  });
});

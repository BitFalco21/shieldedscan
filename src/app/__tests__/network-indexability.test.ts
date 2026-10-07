import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Testnet must never be indexable, whatever the stage flag says: testnet figures in search
 * results are indistinguishable from real ones. Testnet runs with NEXT_PUBLIC_STAGE=public
 * (which also arms `assertLiveSourcesConfigured`), so indexability keys off both flags.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadAt(stage: string, network?: string) {
  vi.stubEnv("NEXT_PUBLIC_STAGE", stage);
  if (network) vi.stubEnv("NEXT_PUBLIC_NETWORK", network);
  vi.resetModules();
  const robots = (await import("../robots")).default;
  const sitemap = (await import("../sitemap")).default;
  return { robots: robots(), sitemap: sitemap() };
}

describe("testnet indexability", () => {
  it("public mainnet allows crawling (except the social card render surface) and publishes a sitemap", async () => {
    const { robots, sitemap } = await loadAt("public");
    expect(robots.rules).toEqual([
      {
        userAgent: "*",
        allow: ["/", "/icon.png", "/apple-icon.png"],
        disallow: ["/social/", "/tx/", "/address/", "/block/", "/*?"],
        crawlDelay: 5,
      },
    ]);
    expect(robots.sitemap).toBeTruthy();
    expect(sitemap.length).toBeGreaterThan(0);
  });

  it("public TESTNET stays fully un-indexable and publishes no sitemap entries", async () => {
    const { robots, sitemap } = await loadAt("public", "testnet");
    expect(robots.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(robots.sitemap).toBeUndefined();
    expect(sitemap).toEqual([]);
  });

  it("testnet sitemap URLs could only ever be testnet ones (belt for the braces)", async () => {
    // If the empty-sitemap gate is loosened, URLs must still point at the testnet origin, not
    // duplicate mainnet's.
    vi.stubEnv("NEXT_PUBLIC_STAGE", "public");
    vi.stubEnv("NEXT_PUBLIC_NETWORK", "testnet");
    vi.resetModules();
    const { siteUrl } = await import("@/lib/site");
    expect(siteUrl).toBe("https://testnet.shieldedscan.xyz");
  });
});

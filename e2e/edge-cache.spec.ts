/**
 * The shared edge cache, at the HTTP boundary of a production build.
 *
 * Proves the server sends the intended headers, and that routes outside the policy send none. It
 * cannot prove Netlify honours them (the plugin merges its own `Netlify-Vary` defaults on the
 * deploy); only `cache-status` on the deployed site does that.
 */

import { expect, test } from "@playwright/test";
import { EDGE_CACHE_POLICIES, edgeCacheControl } from "../src/lib/edge-cache";
import { TRANSPARENT_ADDR } from "./surface";

/** A concrete URL for each policy's pattern, on the fixture data. */
const SAMPLE: Record<string, string> = {
  "/address/:addr": `/address/${TRANSPARENT_ADDR}`,
  "/name/:name": "/name/zenith",
  "/charts/:slug": "/charts/median-fee",
};
const urlFor = (source: string): string => SAMPLE[source] ?? source;

test.describe("cached routes", () => {
  for (const policy of EDGE_CACHE_POLICIES) {
    const url = urlFor(policy.source);

    test(`${url} sends its CDN policy and cache key`, async ({ request }) => {
      const res = await request.get(url);
      const headers = res.headers();

      expect(res.status()).toBe(200);
      expect(headers["netlify-cdn-cache-control"]).toBe(edgeCacheControl(policy));
      for (const name of policy.query) expect(headers["netlify-vary"]).toContain(name);
      // The browser and Cloudflare must not keep the page: only Netlify's CDN shares it.
      expect(headers["cache-control"]).toMatch(/private|no-store/);
      expect(headers["cdn-cache-control"]).toBeUndefined();
      // A shared copy must carry nothing about the reader who caused it.
      expect(headers["set-cookie"]).toBeUndefined();
      // Added to the security headers, never in place of them.
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(headers["strict-transport-security"]).toBeDefined();
    });

    test(`${url} sends the same policy on a client navigation`, async ({ request }) => {
      // The flight payload is keyed apart from the HTML by `_rsc` and the RSC header, both in the
      // plugin's own Netlify-Vary; it must be cached on the same terms.
      const res = await request.get(`${url}${url.includes("?") ? "&" : "?"}_rsc=e2e`, {
        headers: { RSC: "1" },
      });
      expect(res.headers()["netlify-cdn-cache-control"]).toBe(edgeCacheControl(policy));
    });
  }

  test("a filtered list names every filter in its key", async ({ request }) => {
    const res = await request.get("/txs?kind=shielded");
    expect(res.headers()["netlify-vary"]).toBe("query=kind|pool|before|after");
  });
});

test.describe("routes outside the policy", () => {
  // Fresh by contract (search resolves existence; mempool is seconds old), the live feed keeps its
  // own five-second policy, and a page that reads no data is prerendered and cached by the plugin.
  for (const url of [
    "/search?q=nothing",
    "/mempool",
    "/api/live?kind=all&direction=all",
    "/about",
  ]) {
    test(`${url} sends no edge policy of ours`, async ({ request }) => {
      const res = await request.get(url, { maxRedirects: 0 });
      expect(res.headers()["netlify-cdn-cache-control"]).toBeUndefined();
    });
  }

  test("the live feed keeps its own five-second policy", async ({ request }) => {
    const res = await request.get("/api/live?kind=all&direction=all");
    expect(res.headers()["cache-control"]).toBe("public, s-maxage=5");
  });
});

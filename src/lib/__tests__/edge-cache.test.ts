import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EDGE_CACHE_POLICIES, edgeCacheControl, edgeCacheHeaders } from "../edge-cache";

/**
 * Pins the shared edge cache's policy table. It proves the headers are built as intended and that
 * every cache key names what its page reads; only a request against a deployed build proves
 * Netlify honours them.
 */

const appDir = join(process.cwd(), "src", "app");

/** `/address/:addr` → `src/app/address/[addr]/page.tsx`. */
const pageSource = (source: string): string =>
  readFileSync(
    join(appDir, ...source.split("/").map((s) => s.replace(/^:(.+)$/, "[$1]")), "page.tsx"),
    "utf8",
  );

/** The keys of the page's `searchParams: Promise<{ … }>` type, or none. */
function searchParamKeys(source: string): string[] {
  const literal = /searchParams:\s*Promise<\{([^}]*)\}>/.exec(source)?.[1];
  if (literal === undefined) return [];
  return [...literal.matchAll(/(\w+)\?:/g)].map((m) => m[1]!).sort();
}

describe("edge cache policies", () => {
  it("builds the CDN directive, with stale-while-revalidate only where allowed", () => {
    expect(edgeCacheControl({ source: "/x", freshSeconds: 5, staleSeconds: 30, query: [] })).toBe(
      "public, s-maxage=5, stale-while-revalidate=30, durable",
    );
    expect(edgeCacheControl({ source: "/x", freshSeconds: 10, staleSeconds: 0, query: [] })).toBe(
      "public, s-maxage=10, durable",
    );
  });

  it("names the query parameters in Netlify's own format, and omits an empty list", () => {
    const policy = { source: "/x", freshSeconds: 5, staleSeconds: 0, query: ["kind", "before"] };
    expect(edgeCacheHeaders(policy)).toContainEqual({
      key: "Netlify-Vary",
      value: "query=kind|before",
    });
    expect(edgeCacheHeaders({ ...policy, query: [] }).map((h) => h.key)).toEqual([
      "Netlify-CDN-Cache-Control",
    ]);
  });

  it("never emits a header that downstream caches or the browser would act on", () => {
    // `Cache-Control` and `CDN-Cache-Control` travel on to Cloudflare and the browser; the HTML
    // must be shared by Netlify's CDN alone.
    for (const policy of EDGE_CACHE_POLICIES) {
      for (const { key } of edgeCacheHeaders(policy)) expect(key).toMatch(/^Netlify-/);
    }
  });

  it.each(EDGE_CACHE_POLICIES.map((p) => [p.source, p]))(
    "%s keys on exactly the query parameters its page reads",
    (_, policy) => {
      expect([...policy.query].sort()).toEqual(searchParamKeys(pageSource(policy.source)));
    },
  );

  it.each(["/address/:addr", "/name/:name"])("%s never serves a stale copy", (source) => {
    const policy = EDGE_CACHE_POLICIES.find((p) => p.source === source);
    expect(policy?.staleSeconds).toBe(0);
    expect(policy?.freshSeconds).toBeLessThanOrEqual(10);
  });

  it("caches every listed route and claims no stale-if-error", () => {
    for (const policy of EDGE_CACHE_POLICIES) {
      expect(policy.freshSeconds).toBeGreaterThan(0);
      expect(edgeCacheControl(policy)).not.toContain("stale-if-error");
    }
  });
});

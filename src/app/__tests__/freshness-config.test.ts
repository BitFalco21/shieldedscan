import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRERENDERED_REVALIDATE_SECONDS } from "@/data";

/**
 * The freshness contract.
 *
 * Next serves an expired cache entry as-is and refreshes behind the response, so on a
 * low-traffic site the first visitor after an idle period sees stale data. Routes whose job
 * is to be current declare `fetchCache = "force-no-store"`; prerendered pages that keep their
 * cache are refreshed by the warmer instead.
 *
 * This proves the declarations exist and that every new query-driven route is classified.
 * It proves nothing about what the deployed site serves; only a first request against
 * production after an idle period does that.
 *
 * Discovery is by `searchParams`, which selects the list and query routes. Detail routes
 * (`/block/[id]`, `/tx/[txid]`) are cached against reorg depth by `blockRevalidate`, a
 * different contract.
 */

const appDir = join(process.cwd(), "src", "app");

/** Every `page.tsx` under `src/app`, as a route path. */
function routePages(dir: string, route = ""): { route: string; source: string }[] {
  const out: { route: string; source: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...routePages(path, `${route}/${entry.name}`));
    } else if (entry.name === "page.tsx") {
      out.push({ route: route === "" ? "/" : route, source: readFileSync(path, "utf8") });
    }
  }
  return out;
}

const pages = routePages(appDir);
const queryRoutes = pages.filter((p) => p.source.includes("searchParams"));
const FRESH = 'export const fetchCache = "force-no-store";';

/**
 * Routes that must never be served from a stale cache entry.
 *
 * `/search` is here because resolution decides whether an identifier EXISTS, and a stale
 * answer 404s a block that was just mined.
 */
const MUST_BE_FRESH = [
  "/address/[addr]",
  "/blocks",
  // Third-party figures are not exempt: a cached 200 is replayed without asking the API, so
  // the API's own 30-minute staleness limit cannot protect the reader.
  "/compare",
  "/cross-chain",
  // `?range=` makes this dynamic; a stale entry hurts a narrow window most, since it is mostly
  // made of recent rows.
  "/cross-chain/flows",
  // Same `?range=` as flows. Its adapter memoises for one minute per instance, which is
  // bounded; the durable Data Cache is not.
  "/cross-chain/protocols",
  "/mempool",
  // The node map's dynamic tab: a filter and a cursor over figures recomputed every crawl.
  "/network/nodes",
  "/reorgs",
  // Keyset lists whose first page would otherwise be a stale ranking.
  "/mining",
  "/rich-list",
  "/search",
  "/txs",
];

/** Query routes left cached on purpose, each with the reason it is not a freshness risk. */
const DELIBERATELY_CACHED: string[] = [];

describe("freshness configuration", () => {
  it("classifies every query-driven route as fresh or deliberately cached", () => {
    // A new list page must not slip in unclassified and silently inherit the stale read.
    expect(queryRoutes.map((p) => p.route).sort()).toEqual(
      [...MUST_BE_FRESH, ...DELIBERATELY_CACHED].sort(),
    );
  });

  it.each(MUST_BE_FRESH)("%s opts out of the fetch Data Cache", (route) => {
    const page = pages.find((p) => p.route === route);
    expect(page, `no page.tsx for ${route}`).toBeDefined();
    expect(page?.source).toContain(FRESH);
  });

  /**
   * `/halving` has no `searchParams`, so discovery cannot see it. It stays cached: the
   * countdown moves by seconds per day, it prints the block height it was read at, and the
   * warmer keeps it current.
   */
  it("keeps /halving prerendered, with a revalidate and a warmer slot", () => {
    const page = pages.find((p) => p.route === "/halving");
    expect(page, "no page.tsx for /halving").toBeDefined();
    expect(page?.source).not.toContain(FRESH);
    expect(page?.source).toMatch(/export const revalidate = \d+/);
  });

  /**
   * `/stats` and `/stats/shielded` stay cached: they are built to be linked, print the block
   * and instant their figures were read at, and a live layer polls `/api/stats` on top.
   */
  it.each(["/stats", "/stats/shielded"])("keeps %s prerendered, with a revalidate", (route) => {
    const page = pages.find((p) => p.route === route);
    expect(page, `no page.tsx for ${route}`).toBeDefined();
    expect(page?.source).not.toContain(FRESH);
    expect(page?.source).toMatch(/export const revalidate = \d+/);
  });

  /**
   * `/pulse` has no query parameter (replay is client state), so discovery cannot see it. It
   * stays cached: frame 0 is a real render for readers without JavaScript, every figure prints
   * its block, and a live layer polls `/api/pulse/live` on top.
   */
  it("keeps /pulse prerendered, with a revalidate and no scan word", () => {
    const page = pages.find((p) => p.route === "/pulse");
    expect(page, "no page.tsx for /pulse").toBeDefined();
    expect(page?.source).not.toContain(FRESH);
    expect(page?.source).toMatch(/export const revalidate = 60/);
    // Not even in a comment: discovery is a text scan, so the word in prose would file this
    // page under the query-route contract.
    expect(page?.source).not.toContain("searchParams");
  });

  /**
   * `/compare/all` takes no query parameter, so discovery cannot see it. Fresh, like
   * `/compare`: a cached 200 of third-party figures is replayed without asking the API.
   */
  it("keeps /compare/all fresh, with no scan word", () => {
    const page = pages.find((p) => p.route === "/compare/all");
    expect(page, "no page.tsx for /compare/all").toBeDefined();
    expect(page?.source).toContain(FRESH);
    // Not even in a comment, as for `/pulse` above.
    expect(page?.source).not.toContain("searchParams");
  });

  it("keeps the ledger's own live endpoints out of every cache", () => {
    // The page may be cached; the endpoints that refresh it may not.
    for (const route of ["live", "window"]) {
      const source = readFileSync(join(appDir, "api", "pulse", route, "route.ts"), "utf8");
      expect(source, route).toContain(FRESH);
    }
  });

  /**
   * `/mining-cost` reads no query parameter (the tariff band is client state). Cached: the
   * height its terms were read at is printed, so a stale render is visibly dated.
   */
  it("keeps /mining-cost prerendered, with a revalidate and no scan word", () => {
    const page = pages.find((p) => p.route === "/mining-cost");
    expect(page, "no page.tsx for /mining-cost").toBeDefined();
    expect(page?.source).not.toContain(FRESH);
    expect(page?.source).toMatch(/export const revalidate = \d+/);
    expect(page?.source).not.toContain("searchParams");
  });

  /**
   * The prerendered `/network` tabs read no query parameter (lens, toggles and camera are
   * client state). Cached: the crawl's instant is printed, so a stale render is visibly dated.
   */
  it.each(["/network", "/network/map", "/network/software", "/network/upgrade", "/network/health"])(
    "keeps %s prerendered, with a revalidate and no scan word",
    (route) => {
      const page = pages.find((p) => p.route === route);
      expect(page, `no page.tsx for ${route}`).toBeDefined();
      expect(page?.source).not.toContain(FRESH);
      expect(page?.source).toMatch(/export const revalidate = 60/);
      expect(page?.source).not.toContain("searchParams");
    },
  );

  it("keeps the sky's own endpoint out of every cache", () => {
    // The tab may be cached; the graph it fetches after mount may not.
    const route = readFileSync(join(appDir, "api", "network", "topology", "route.ts"), "utf8");
    expect(route).toContain(FRESH);
  });

  it("keeps /fact-check prerendered — sourced prose, and every live row prints its own height", () => {
    const page = pages.find((p) => p.route === "/fact-check");
    expect(page, "no page.tsx for /fact-check").toBeDefined();
    expect(page?.source).not.toContain(FRESH);
    expect(page?.source).toMatch(/export const revalidate = 60/);
    expect(page?.source).toContain("getPrerenderedDataSource()");
  });

  it("keeps /zips prerendered with a revalidate — reference content, asOf printed on the page", () => {
    const page = pages.find((p) => p.route === "/zips");
    expect(page, "no page.tsx for /zips").toBeDefined();
    expect(page?.source).not.toContain(FRESH);
    expect(page?.source).toMatch(/export const revalidate = \d+/);
  });

  it("keeps the stats's own live endpoint out of every cache", () => {
    // The page may be cached; the endpoint that refreshes it may not.
    const route = readFileSync(join(appDir, "api", "stats", "route.ts"), "utf8");
    expect(route).toContain(FRESH);
  });

  it("leaves the prerendered homepage cached", () => {
    // The opt-out would make `/` dynamic and lose the CDN caching that absorbs traffic spikes
    // and API restarts; the warmer keeps it current. The build legend must show `/` as Static.
    const home = pages.find((p) => p.route === "/");
    expect(home?.source).not.toContain(FRESH);
  });
});

describe("cache warmer", () => {
  const warmer = readFileSync(
    join(process.cwd(), "netlify", "functions", "warm-cache.mjs"),
    "utf8",
  );

  it("runs on a schedule", () => {
    expect(warmer).toMatch(/schedule:\s*"(\*|[0-9,*/-]+)\s/);
  });

  it("warms the prerendered homepage, which cannot opt out of its cache", () => {
    const paths = /const PATHS = \[([^\]]*)\]/.exec(warmer)?.[1] ?? "";
    expect(paths).toContain('"/"');
  });

  it("warms /halving, which prints a per-block figure and keeps its cache", () => {
    // A prerendered page with a tip-derived number needs something other than a reader to
    // trigger its refresh.
    const paths = /const PATHS = \[([^\]]*)\]/.exec(warmer)?.[1] ?? "";
    expect(paths).toContain('"/halving"');
  });

  it("warms /stats, which prints a per-block figure and keeps its cache", () => {
    const paths = /const PATHS = \[([^\]]*)\]/.exec(warmer)?.[1] ?? "";
    expect(paths).toContain('"/stats"');
  });

  it("warms /pulse, whose frame 0 is built from a block height it prints", () => {
    const paths = /const PATHS = \[([^\]]*)\]/.exec(warmer)?.[1] ?? "";
    expect(paths).toContain('"/pulse"');
  });

  it("is discoverable by Netlify from committed config, not the dashboard", () => {
    const toml = readFileSync(join(process.cwd(), "netlify.toml"), "utf8");
    expect(toml).toMatch(/\[functions\]/);
    expect(toml).toMatch(/directory\s*=\s*"netlify\/functions"/);
  });
});

/**
 * A page's effective revalidate is the minimum across its fetches, and the default source's
 * tip reads use 15 s. `getPrerenderedDataSource()` returns a source whose reads match
 * `PRERENDERED_REVALIDATE_SECONDS`; every page declaring a revalidate must use it and declare
 * at least that window.
 */
describe("prerendered pages read through the prerendered source", () => {
  const prerendered = pages.filter((p) => /export const revalidate = \d+/.test(p.source));

  it("finds the prerendered pages", () => {
    expect(prerendered.map((p) => p.route)).toEqual(
      expect.arrayContaining(["/", "/shielded", "/analytics", "/charts", "/pulse", "/stats"]),
    );
  });

  it.each(prerendered.map((p) => p.route))("%s uses getPrerenderedDataSource", (route) => {
    const page = pages.find((p) => p.route === route)!;
    if (!page.source.includes("DataSource")) return;
    expect(page.source).toContain("getPrerenderedDataSource()");
    expect(page.source).not.toMatch(/\bgetDataSource\(/);
  });

  it.each(prerendered.map((p) => p.route))("%s declares at least the source window", (route) => {
    const page = pages.find((p) => p.route === route)!;
    const declared = Number(/export const revalidate = (\d+)/.exec(page.source)![1]);
    expect(declared).toBeGreaterThanOrEqual(PRERENDERED_REVALIDATE_SECONDS);
  });
});

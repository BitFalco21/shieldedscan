/**
 * Broken internal links and routing.
 *
 * Guards against links rendered with a missing leading slash, links to a bare `/address` with
 * no parameter, links that 404, and — the inverse — a confident fake page where a not-found
 * belongs. A rendered-DOM crawler reads every internal href the app emits, checks its shape
 * against the route table, then checks it resolves. Neither half is enough alone: a shape check
 * misses a well-formed link to a missing row, and a resolve check misses a link that 200s onto
 * the wrong page.
 */

import { expect, test, type Page } from "@playwright/test";
import { ROUTES, collectPageErrors, isOurError } from "./surface";

/**
 * Every route shape this app is allowed to link to.
 *
 * Deliberately strict about parameters — an `/address/0x…` style mistake would pass a
 * permissive `\/address\/.+`.
 */
const VALID_ROUTES: readonly RegExp[] = [
  /^\/$/,
  /^\/blocks$/,
  // A block is addressable by height or by hash — `getBlock(id)` accepts both.
  /^\/block\/(\d+|[0-9a-f]{64})$/,
  /^\/txs$/,
  /^\/tx\/[0-9a-f]{64}$/,
  /^\/address\/(t[13][a-zA-Z0-9]{20,40}|zs1[a-z0-9]{20,300}|u1[a-z0-9]{20,300})$/,
  /^\/shielded$/,
  /^\/cross-chain$/,
  /^\/cross-chain\/flows$/,
  /^\/cross-chain\/protocols$/,
  /^\/cross-chain\/[a-z]+-\d+$/,
  // The production shape for a Midgard venue: `<protocol>-<inbound txid>` (midgard.ts).
  /^\/cross-chain\/(?:maya|thorchain)-[0-9a-f]{64}$/,
  /^\/analytics$/,
  /^\/charts$/,
  /^\/charts\/[a-z-]+$/,
  // The window is enumerated rather than matched as `.+`: an unrecognised value parses to the
  // default (`parseMiningWindow`), so a typo would render the 7d page under a URL promising 24h.
  /^\/mining(\?window=(24h|3d|7d|30d|90d|1y))?$/,
  // `?vs=` is not enumerated: an unrecognised value renders a stated "NOT FOUND" rather than the
  // default page. `compare.spec.ts` asserts every option in the picker resolves to its asset.
  /^\/compare$/,
  // The whole table is its own route rather than a tab parameter: a tab here is a page, with a
  // URL to share and a prerender of its own.
  /^\/compare\/all$/,
  // The two stats faces are routes, not one page with a tab parameter.
  /^\/stats$/,
  /^\/stats\/shielded$/,
  /^\/halving$/,
  /^\/satoshi$/,
  /^\/learn$/,
  /^\/fact-check$/,
  /^\/mining-cost$/,
  /^\/pulse$/,
  // The node map's six tabs. The nodes list's query string (filters, cursors) is stripped
  // before matching, like every other list's.
  /^\/network$/,
  /^\/network\/(map|software|upgrade|health|nodes)$/,
  /^\/zips$/,
  /^\/ecosystem$/,
  // A Zcash Name System name: the registry's own rule, lowercase letters and digits, 1–62.
  /^\/name\/[a-z0-9]{1,62}$/,
  /^\/rich-list$/,
  /^\/mempool$/,
  /^\/reorgs$/,
  /^\/donate$/,
  /^\/about$/,
  /^\/brand$/,
  // The two downloadable brand assets, enumerated exactly: a wildcard would let a mistyped
  // filename pass this suite and 404 for a visitor.
  /^\/brand\/shieldedscan-mark\.svg$/,
  /^\/brand\/shieldedscan-avatar\.png$/,
  /^\/privacy$/,
  /^\/terms$/,
  /^\/api-docs$/,
  /^\/mcp$/,
  // Listed unconditionally, unlike its entry in ROUTES. Flag-gated surfaces only render this
  // link where the flag is on, but if one ever appears elsewhere the shape must already be
  // known, or this suite would report a malformed link where the real bug is a leaked flag.
  /^\/ai-agent$/,
  /^\/search$/,
];

interface FoundLink {
  href: string;
  text: string;
}

/** Every in-app href the page rendered, with external links and hash-only anchors dropped. */
async function internalLinks(page: Page): Promise<FoundLink[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => ({
        href: a.getAttribute("href") ?? "",
        text: (a.textContent ?? "").trim().slice(0, 60),
      }))
      .filter(({ href }) => {
        if (href === "" || href.startsWith("#")) return false;
        return !/^(https?:|mailto:|tel:)/i.test(href);
      }),
  );
}

test.describe("internal links", () => {
  test("every internal href is absolute and matches a known route shape", async ({ page }) => {
    // A shared link built without its leading slash resolves against whatever page the shared
    // component sits on, so it 404s on every page but one. One assertion catches the class.
    const offenders: string[] = [];

    for (const route of ROUTES) {
      await page.goto(route);
      for (const link of await internalLinks(page)) {
        const { href, text } = link;
        if (!href.startsWith("/")) {
          offenders.push(`${route}: relative href "${href}" (link text: "${text}")`);
          continue;
        }
        const path = href.split("?")[0]?.split("#")[0] ?? "";
        if (!VALID_ROUTES.some((pattern) => pattern.test(path))) {
          offenders.push(`${route}: href "${href}" matches no route shape (text: "${text}")`);
        }
      }
    }

    expect(offenders, `malformed internal links:\n${offenders.join("\n")}`).toEqual([]);
  });

  test("every internal href resolves without a 404 or a server error", async ({
    page,
    request,
  }) => {
    const seen = new Map<string, string>(); // href -> first page that linked it
    for (const route of ROUTES) {
      await page.goto(route);
      for (const { href } of await internalLinks(page)) {
        if (!seen.has(href)) seen.set(href, route);
      }
    }
    expect(seen.size).toBeGreaterThan(10); // the crawl found something; a silent empty pass is a failed test

    // Checked in bounded batches: one round trip per unique href in sequence would grow past
    // the suite timeout with the site. Bounded, not unbounded: this is a single Next server.
    const entries = [...seen.entries()];
    const broken: string[] = [];
    const BATCH = 8;
    for (let i = 0; i < entries.length; i += BATCH) {
      const results = await Promise.all(
        entries.slice(i, i + BATCH).map(async ([href, from]) => {
          const response = await request.get(href);
          return response.status() >= 400
            ? `${href} -> HTTP ${response.status()} (linked from ${from})`
            : null;
        }),
      );
      broken.push(...results.filter((r): r is string => r !== null));
    }
    expect(broken, `dead internal links:\n${broken.join("\n")}`).toEqual([]);
  });

  test("no page throws while rendering, and none logs an error", async ({ page }) => {
    // A broken link often comes with an uncaught TypeError. A page that renders but throws is
    // a bug even when it looks right, so this runs across the whole surface.
    //
    // `test.slow()`: this walks every route sequentially, waiting for `networkidle` on each, so
    // it is a sweep, not a slow page.
    test.slow();
    const failures: string[] = [];
    for (const route of ROUTES) {
      const errors = collectPageErrors(page);
      const response = await page.goto(route);
      expect(response?.status(), `${route} did not return 200`).toBeLessThan(400);
      await page.waitForLoadState("networkidle");
      const ours = errors.filter(isOurError);
      if (ours.length > 0) failures.push(`${route}: ${ours.join(" | ")}`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

test.describe("invalid routes must not render confident pages", () => {
  /**
   * The inverse test — a nonexistent identifier rendering a page rather than a not-found. On an
   * explorer this is worse than a 404: the page asserts a thing exists on-chain when it does not.
   */
  const GARBAGE = [
    "/block/99999999999",
    "/block/-1",
    "/block/0x1234",
    "/block/not-a-height",
    `/tx/${"z".repeat(64)}`,
    "/tx/tooshort",
    `/tx/${"a".repeat(63)}`,
    "/address/garbage",
    "/address/0x0000000000000000000000000000000000000000",
    "/address/t1DoesNotExistAtAllFixture00001",
    "/cross-chain/nope-1",
    "/cross-chain/thor-99999",
  ];

  for (const path of GARBAGE) {
    test(`${path} renders the designed not-found`, async ({ page }) => {
      const errors = collectPageErrors(page);
      const response = await page.goto(path);

      expect(response?.status(), `${path} should be a 404`).toBe(404);
      await expect(page.getByText("NOT ON CHAIN")).toBeVisible();
      // No stack trace, no framework error overlay, no raw exception text.
      await expect(page.locator("body")).not.toContainText(/at .*\(.*:\d+:\d+\)/);

      // The browser logs "Failed to load resource … 404" for the document itself, which is
      // the correct status doing its job — not an application error. Filtering it is the
      // difference between this test checking the page and it checking the status twice.
      const applicationErrors = errors
        .filter(isOurError)
        .filter((text) => !/Failed to load resource.*40[34]/i.test(text));
      expect(applicationErrors, applicationErrors.join(" | ")).toEqual([]);
    });
  }

  test("a hand-typed query string never changes what the page claims", async ({ page }) => {
    // Filter values are parsed in domain/ with "anything unrecognised means all", so a
    // hand-edited URL must fall back rather than reaching the data layer or emptying the
    // table.
    for (const path of [
      "/txs?kind=<script>alert(1)</script>",
      "/txs?kind=../../etc/passwd",
      "/cross-chain?protocol=%00",
      "/cross-chain?direction=sideways",
      "/blocks?before=garbage",
      "/mempool?page=-1",
      // A stale ?page= (the pre-keyset URL shape, possibly bookmarked) and a garbage cursor:
      // both must resolve to the first page, never throw.
      `/address/t1XWk29dAliceFixtureAddr000001?page=999999`,
      `/address/t1XWk29dAliceFixtureAddr000001?before=garbage`,
    ]) {
      const errors = collectPageErrors(page);
      const response = await page.goto(path);
      expect(response?.status(), `${path} errored`).toBeLessThan(500);
      await expect(page.locator("main")).toBeVisible();
      // The injected string must never be echoed back into the document.
      await expect(page.locator("body")).not.toContainText("alert(1)");
      expect(errors.filter(isOurError), `${path}: ${errors.join(" | ")}`).toEqual([]);
    }
  });
});

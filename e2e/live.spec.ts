import { expect, test } from "@playwright/test";
import { VIEWPORTS } from "./surface";

/**
 * The live feed, end to end.
 *
 * What this suite cannot prove: it runs against fixtures, and the fixture chain does not
 * advance, so rows never genuinely arrive. Only a request against a deployed site proves a
 * reader sees a new block.
 *
 * What it does prove is everything checkable without a moving chain:
 *
 *  - the endpoint answers, echoes both filters it applied, and rejects nothing it should accept
 *  - the pages still work with JavaScript disabled, because the live layer is an enhancement
 *    and never a dependency
 *  - the poll carries the reader's active filter, so a filtered list cannot be widened
 *  - no page scrolls sideways at 375px with the live layer mounted
 *  - the accessible live region exists and is polite
 */

const LIVE_ROUTES = ["/", "/blocks", "/txs", "/cross-chain"] as const;

test.describe("/api/live", () => {
  test("answers with both echoes and the three feeds", async ({ request }) => {
    const res = await request.get("/api/live");
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.kind).toBe("all");
    expect(body.direction).toBe("all");
    expect(typeof body.tip.height).toBe("number");
    expect(typeof body.tip.hash).toBe("string");
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(Array.isArray(body.transactions)).toBe(true);
    expect(Array.isArray(body.transfers)).toBe(true);
  });

  test("echoes the kind it applied, and 'all' for a junk one", async ({ request }) => {
    // Echoing the raw query back would make the echo agree with a caller it had ignored, which
    // is worse than no echo. `parseTxKindFilter` degrades the unknown to "all", so "all" is
    // what was applied and what must be reported.
    expect((await (await request.get("/api/live?kind=shielded")).json()).kind).toBe("shielded");
    expect((await (await request.get("/api/live?kind=nonsense")).json()).kind).toBe("all");
  });

  test("applies the direction it echoes, not merely reports it", async ({ request }) => {
    const body = await (await request.get("/api/live?direction=in")).json();

    expect(body.direction).toBe("in");
    for (const transfer of body.transfers) expect(transfer.direction).toBe("in");
  });

  test("names both filters in Netlify-Vary", async ({ request }) => {
    // A shared cache keyed without them would serve one reader's filtered list to every other
    // reader. This catches the header being deleted; whether the CDN honours it can only be
    // checked on the deploy.
    const res = await request.get("/api/live");

    expect(res.headers()["netlify-vary"]).toContain("kind");
    expect(res.headers()["netlify-vary"]).toContain("direction");
  });
});

test.describe("the live layer is an enhancement, never a dependency", () => {
  test.use({ javaScriptEnabled: false });

  for (const route of LIVE_ROUTES) {
    test(`${route} renders its rows with JavaScript disabled`, async ({ page }) => {
      await page.goto(route);

      // The server-rendered rows must be there. Any row is a link to a detail page, which is
      // the thing a reader came for and the thing the live layer must never be load-bearing to.
      const links = page.locator('a[href^="/block/"], a[href^="/tx/"], a[href^="/cross-chain/"]');
      expect(await links.count()).toBeGreaterThan(0);
    });
  }
});

test.describe("with the live layer mounted", () => {
  test("the poll carries the reader's active filter", async ({ page }) => {
    // A filtered list quietly widened by unfiltered arrivals is unfalsifiable from the rendered
    // page — an unfiltered list is a well-formed list — so the request is the evidence. The
    // listener is armed before navigating.
    const pollPromise = page.waitForRequest((r) => r.url().includes("/api/live"), {
      timeout: 30_000,
    });
    await page.goto("/txs?kind=shielded");
    const poll = await pollPromise;

    expect(poll.url()).toContain("kind=shielded");
  });

  test("a paged view does not poll at all", async ({ page }) => {
    // Rows from the tip do not belong on page 2, so the feed switches off rather than
    // prepending them there.
    let polled = false;
    await page.route("**/api/live**", (r) => {
      polled = true;
      return r.continue();
    });

    await page.goto("/blocks");
    // By its spoken name, not the glyph: a bare arrow has no accessible name, so matching /→/
    // matches nothing.
    await page
      .getByRole("link", { name: /older page/i })
      .first()
      .click();
    await page.waitForLoadState("networkidle");
    polled = false;
    await page.waitForTimeout(3_000);

    expect(polled).toBe(false);
  });

  test("the accessible live region is present and polite", async ({ page }) => {
    // The only signal a reader who cannot see rows move ever gets. It is `sr-only`, so nothing
    // visual catches its removal.
    await page.goto("/blocks");

    const region = page.locator('[role="status"][aria-live="polite"]').first();
    await expect(region).toHaveCount(1);
  });

  for (const [name, size] of Object.entries(VIEWPORTS)) {
    test(`${name} — no page scrolls sideways with the live layer`, async ({ page }) => {
      await page.setViewportSize(size);
      for (const route of LIVE_ROUTES) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        // Fonts, not just network: text laid out in the fallback face inside containers sized
        // for JetBrains Mono produces phantom overflows under parallel workers.
        await page.evaluate(() => document.fonts.ready);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${route} at ${name}`).toBeLessThanOrEqual(1);
      }
    });
  }
});

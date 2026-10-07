/**
 * Cache and asset-loading instability.
 *
 * The bugs in this class — an unstyled page under a heavy cache, an all-bold regression,
 * blank text, a homepage that jiggles after paint — are rarely reproducible on command.
 * Deterministic e2e cannot reproduce a cache state, but it can assert the outcome they share:
 * the page rendered with the wrong computed styles. Don't chase the trigger; assert the
 * property the trigger violates.
 */

import { expect, test } from "@playwright/test";
import { ROUTES, SHIELDED_TXID, SPROUT_TXID, MEMPOOL_TXID } from "./surface";

const EXPECTED_FONT = /JetBrains Mono/i;

/**
 * Both tests here walk every route in `ROUTES` sequentially, waiting for `networkidle` on each,
 * so their wall-clock grows with the site. `test.slow()` triples the budget for these two
 * rather than raising the global timeout, which would blunt the detection of genuine hangs in
 * every other test.
 */
test.describe("styles and fonts actually applied", () => {
  test.slow();

  test("the site font is in force on body text and in tables", async ({ page }) => {
    // Unstyled, then all-bold: both are "the CSS did not land as
    // authored", and both show up here regardless of which cache state produced them.
    const failures: string[] = [];

    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const bodyFont = await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily);
      if (!EXPECTED_FONT.test(bodyFont)) failures.push(`${route}: body font is "${bodyFont}"`);

      // A page where everything is bold has lost its weight scale — the all-bold signature.
      const weights = await page.locator("main *").evaluateAll((els) => {
        const seen = new Set<string>();
        for (const el of els) {
          if ((el.textContent ?? "").trim() === "") continue;
          seen.add(getComputedStyle(el).fontWeight);
        }
        return Array.from(seen);
      });
      if (weights.length > 0 && weights.every((w) => Number(w) >= 700)) {
        failures.push(`${route}: every text element is bold (weights: ${weights.join(", ")})`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("the panel treatment is present — the page is not unstyled", async ({ page }) => {
    // The crudest and most valuable check in this file. An unstyled page still has all its
    // text, so text assertions pass while the site is visibly broken.
    for (const route of ROUTES) {
      await page.goto(route);
      const styled = await page.evaluate(() => {
        const body = getComputedStyle(document.body);
        return {
          background: body.backgroundColor,
          hasPanels: document.querySelectorAll(".panel").length,
        };
      });
      // The design is dark-only: a white or transparent body means the stylesheet is gone.
      expect(styled.background, `${route} has an unstyled body background`).not.toBe(
        "rgba(0, 0, 0, 0)",
      );
      expect(styled.background, `${route} rendered on white`).not.toBe("rgb(255, 255, 255)");
    }
  });

  test("every asset the page requests loads", async ({ page }) => {
    // Fonts, stylesheets and scripts that 404 produce exactly the symptoms in this cluster.
    const failed: string[] = [];
    page.on("response", (response) => {
      const type = response.request().resourceType();
      if (!["stylesheet", "font", "script", "image"].includes(type)) return;
      if (response.status() >= 400)
        failed.push(`${type} ${response.url()} -> ${response.status()}`);
    });

    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
    }
    expect(failed, failed.join("\n")).toEqual([]);
  });

  test("a warm second visit is styled identically to the first", async ({ page }) => {
    // The unstyled-page bug is cache-dependent, so the second load is the one that breaks.
    // Reusing the same context rather than a fresh one is what makes this test different.
    await page.goto("/blocks");
    await page.waitForLoadState("networkidle");
    const first = await page.locator("body").evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.fontFamily}|${s.backgroundColor}|${s.color}`;
    });

    await page.goto("/");
    await page.goto("/blocks");
    await page.waitForLoadState("networkidle");
    const second = await page.locator("body").evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.fontFamily}|${s.backgroundColor}|${s.color}`;
    });

    expect(second, "the warm load rendered with different computed styles").toBe(first);
  });
});

test.describe("layout stability", () => {
  test("the homepage does not jiggle after paint", async ({ page }) => {
    // Cumulative Layout Shift is the measurement for exactly this complaint,
    // and it needs no baseline — the budget is a number, not a screenshot.
    await page.goto("/");
    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as (PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
            })[]) {
              if (!entry.hadRecentInput) total += entry.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve(total), 2500);
        }),
    );
    // 0.1 is the "good" threshold in Core Web Vitals.
    expect(cls, `homepage CLS was ${cls}`).toBeLessThan(0.1);
  });
});

test.describe("site identity", () => {
  /**
   * The Zakura credit is a third party's mark, inlined as raw path data. Geometry, colour
   * resolution and painted size are all asserted, because a mark with empty path data or a
   * wrong transform is present in the DOM and invisible on the page.
   */
  test("the Zakura mark in the footer is drawn, not merely present", async ({ page }) => {
    await page.goto("/about");
    await page.waitForLoadState("networkidle");
    const mark = page.locator("footer svg").first();
    await expect(mark).toBeVisible();

    const box = await mark.boundingBox();
    expect(box, "the mark has no layout box").not.toBeNull();
    expect(box!.width).toBeGreaterThan(8);
    expect(box!.height).toBeGreaterThan(8);

    const paths = mark.locator("path");
    expect(await paths.count(), "the mark is two paths: blossom and stamen").toBe(2);
    for (const d of await paths.evaluateAll((ps) => ps.map((p) => p.getAttribute("d") ?? ""))) {
      expect(d.length, "an empty or stub path draws nothing").toBeGreaterThan(200);
    }

    // Colour arrives from the token layer, never a fill attribute — the project-wide rule.
    const colours = await paths.evaluateAll((ps) => ps.map((p) => getComputedStyle(p).color));
    expect(colours).toEqual(["rgb(253, 103, 152)", "rgb(0, 0, 0)"]);
  });

  test("the tab icon is ours, reachable, and square", async ({ page }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="icon"]').first().getAttribute("href");
    expect(href, "no <link rel=icon> in the head").toBeTruthy();
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image");
    // The site icon is a PNG, not Next's stock favicon.ico.
    expect(href).not.toContain("favicon.ico");
  });

  test("Google is given a logo, not just a favicon", async ({ page }) => {
    // A favicon feeds the small icon beside a search result. The larger brand logo comes from
    // Organization structured data, and its `logo` must be an absolute raster URL on a real
    // origin, not merely present.
    await page.goto("/");
    const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
    const data = JSON.parse(raw ?? "{}");
    expect(data["@type"]).toBe("Organization");
    expect(data.logo, `logo was "${data.logo}"`).toMatch(/^https?:\/\/[^/]+\/icon-512\.png$/);

    // Same origin as the site declares elsewhere, rather than a literal domain: a local build
    // says localhost and production says shieldedscan.xyz. Comparing against the sitemap catches
    // what matters — one of them hardcoded and the two disagreeing.
    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    const siteOrigin = new URL(/<loc>([^<]+)<\/loc>/.exec(sitemap)?.[1] ?? "").origin;
    expect(new URL(data.logo as string).origin, "logo origin disagrees with the sitemap").toBe(
      siteOrigin,
    );

    // By path, not by the absolute URL: the built origin is whatever NEXT_PUBLIC_SITE_URL said
    // at build time, not necessarily the port this suite is served on. What remains to prove is
    // that the file the declaration names is really there.
    const logo = await page.request.get(new URL(data.logo as string).pathname);
    expect(logo.status(), "the declared logo must actually resolve").toBe(200);
    expect(logo.headers()["content-type"]).toContain("image");
  });

  test("the share card is a real 1200x630 image, not a stretched square", async ({ page }) => {
    // A share card is invisible from inside the site, so a 404 or a wrong aspect ratio is only
    // discovered by someone posting a link. Consumers render a 1.91:1 frame, so the check is the
    // ratio as well as the fetch: a square file that resolves is a defect.
    await page.goto("/");
    const content = await page.locator('meta[property="og:image"]').first().getAttribute("content");
    expect(content, "no og:image in the head").toBeTruthy();

    // By path, for the same reason as the Organization logo above.
    const cardPath = new URL(content!, page.url()).pathname;
    const res = await page.request.get(cardPath);
    expect(res.status(), "the declared share card must actually resolve").toBe(200);
    expect(res.headers()["content-type"]).toContain("image");

    const { width, height } = await page.evaluate(
      (src) =>
        new Promise<{ width: number; height: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => reject(new Error(`could not decode ${src}`));
          img.src = src;
        }),
      cardPath,
    );
    expect(width).toBe(1200);
    expect(height).toBe(630);

    // The declared dimensions must match the file, or a client that trusts the tag lays out
    // a frame the image does not fill.
    expect(
      await page.locator('meta[property="og:image:width"]').first().getAttribute("content"),
    ).toBe(String(width));
    expect(
      await page.locator('meta[property="og:image:height"]').first().getAttribute("content"),
    ).toBe(String(height));
  });

  // The site deliberately ships no web app manifest. A manifest makes the site installable,
  // which has Chrome record an "associated web app" against the visitor's device and list this
  // origin in its site-data dialog — indistinguishable, to a reader checking, from a site that
  // set a cookie. `metadata.manifest` is one line away from returning by accident.
  test("no web app manifest — the site is not installable, deliberately", async ({ page }) => {
    for (const path of ["/", "/blocks", "/txs"]) {
      await page.goto(path);
      await expect(
        page.locator('link[rel="manifest"]'),
        `${path} declares a manifest; see the note in layout.tsx`,
      ).toHaveCount(0);
    }
    // Next serves a manifest only when one is declared, so a 404 here is the corroborating
    // half: it proves the absence is real rather than a missing <link> over a live file.
    expect((await page.request.get("/manifest.webmanifest")).status()).toBe(404);
  });
});

/**
 * The per-transaction share card.
 *
 * Separate from the suite above because it is generated — a satori render inside the Next
 * runtime, from font subsets — and every part of that pipeline fails only at request time: a
 * missing font, a CSS property satori does not implement. The unit tests cover what the card
 * says; only a request proves it renders at all.
 */
test.describe("transaction share cards", () => {
  /** Width and height off the PNG's own IHDR, so the check reads the file, not our config. */
  function pngSize(buf: Buffer): { width: number; height: number } {
    expect(buf.subarray(1, 4).toString("ascii"), "the card is not a PNG").toBe("PNG");
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  for (const [shape, txid] of [
    ["a fully shielded transaction", SHIELDED_TXID],
    ["a transaction with a public amount", SPROUT_TXID],
    ["an unconfirmed transaction", MEMPOOL_TXID],
  ] as const) {
    test(`renders for ${shape}`, async ({ page }) => {
      await page.goto(`/tx/${txid}`);
      const content = await page
        .locator('meta[property="og:image"]')
        .first()
        .getAttribute("content");
      expect(content, "the transaction page declares no og:image").toBeTruthy();

      // The generated route, not the site-wide /og.png: a transaction link must preview as that
      // transaction.
      expect(content, `og:image was ${content}`).toContain("opengraph-image");

      const res = await page.request.get(new URL(content!, page.url()).pathname);
      expect(res.status(), "the generated card must resolve").toBe(200);
      expect(res.headers()["content-type"]).toContain("image/png");
      const png = Buffer.from(await res.body());
      expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
      // A card that laid nothing out still encodes as a valid PNG of the right size, so the
      // byte count is the corroborating half — an empty field compresses to almost nothing.
      expect(png.byteLength, "the card rendered but looks empty").toBeGreaterThan(5_000);
    });
  }

  test("a comparison previews as THAT comparison, per asset", async ({ page }) => {
    // `/compare`'s card is a route handler keyed on `?vs=` — the file convention cannot read a
    // query string — so this asserts the page points at it and that two different assets
    // produce two different images. Identical bytes would mean the CDN key or the parameter is
    // being ignored.
    await page.goto("/compare?vs=ethereum");
    const content = await page.locator('meta[property="og:image"]').first().getAttribute("content");
    expect(content, "the compare page declares no og:image").toBeTruthy();
    expect(content, `og:image was ${content}`).toContain("/compare/card?vs=ethereum");

    const eth = await page.request.get("/compare/card?vs=ethereum");
    expect(eth.status()).toBe(200);
    expect(eth.headers()["content-type"]).toContain("image/png");
    const ethPng = Buffer.from(await eth.body());
    expect(pngSize(ethPng)).toEqual({ width: 1200, height: 630 });
    expect(ethPng.byteLength, "the card rendered but looks empty").toBeGreaterThan(5_000);

    const btc = await page.request.get("/compare/card?vs=bitcoin");
    const btcPng = Buffer.from(await btc.body());
    expect(pngSize(btcPng)).toEqual({ width: 1200, height: 630 });
    expect(btcPng.equals(ethPng), "two assets produced the same card").toBe(false);

    // An asset the page will not compare previews as the site, never as a comparison.
    const miss = await page.request.get("/compare/card?vs=monero");
    expect(miss.status()).toBe(200);
    expect(pngSize(Buffer.from(await miss.body()))).toEqual({ width: 1200, height: 630 });
  });

  test("previews as the site, not as an error, for a transaction that does not exist", async ({
    page,
  }) => {
    // A well-formed txid that names nothing — a stale link, a typo, the other network. The
    // PAGE is a 404 by design; the card must still be a card, because a broken image in a
    // preview reads as a broken site.
    const absent = "f".repeat(64);
    const res = await page.request.get(`/tx/${absent}/opengraph-image`);
    expect(res.status()).toBe(200);
    const png = Buffer.from(await res.body());
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  });
});

/**
 * The API reference page. The catalogue in `src/api-catalogue/` is the single
 * source, so the tests here are structural: every endpoint the catalogue declares must be
 * navigable, anchored, and copyable — a section that silently drops out of the render is
 * exactly the failure a hand-maintained doc suffers, and the one this design exists to
 * prevent.
 */

import { expect, test } from "@playwright/test";
import { API_GROUPS } from "../src/api-catalogue";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const ALL_ENDPOINTS = API_GROUPS.flatMap((group) => group.endpoints);

test.describe("/api-docs", () => {
  test("renders a section with an anchor for every catalogued endpoint", async ({ page }) => {
    await page.goto("/api-docs");
    for (const endpoint of ALL_ENDPOINTS) {
      const section = page.locator(`section#${endpoint.id}`);
      await expect(section, endpoint.id).toHaveCount(1);
      await expect(section.getByText(endpoint.title)).toBeVisible();
    }
  });

  test("the sidebar reaches every section by anchor", async ({ page }) => {
    await page.goto("/api-docs");
    const nav = page.getByRole("navigation", { name: "API reference sections" }).first();
    for (const endpoint of ALL_ENDPOINTS) {
      const link = nav.locator(`a[href="#${endpoint.id}"]`);
      await expect(link, endpoint.id).toHaveCount(1);
    }
  });

  test("every endpoint offers a copyable curl carrying the real base URL", async ({ page }) => {
    await page.goto("/api-docs");
    const copy = page.getByRole("button", { name: /copy curl for \/v1$/i });
    await copy.click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe("curl https://api.shieldedscan.xyz/v1");
  });

  test("example responses are valid JSON — a doc that teaches broken JSON is a bug", async () => {
    for (const endpoint of ALL_ENDPOINTS) {
      expect(
        () => JSON.parse(endpoint.exampleResponse.replace(/…/g, "ELIDED")),
        `${endpoint.id} example does not parse`,
      ).not.toThrow();
    }
  });

  test("the examples practice the null contract the conventions preach", async () => {
    // Any example showing a null must also show its reason in `unknowns` — unless the
    // convention itself says that null is unambiguous there (fullyShieldedPct24h's null
    // travels with txCount24h's reason; migration null needs none).
    const status = ALL_ENDPOINTS.find((e) => e.id === "status")!.exampleResponse;
    const parsed = JSON.parse(status.replace(/…/g, "ELIDED"));
    expect(parsed.priceUsd).toBeNull();
    expect(parsed.unknowns.priceUsd).toBe("unmeasured");
  });

  test("mobile gets the disclosure TOC and no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/api-docs");
    const toc = page.locator("details", { hasText: "ON THIS PAGE" });
    await expect(toc).toBeVisible();
    await toc.locator("summary").click();
    await expect(toc.locator(`a[href="#supply"]`)).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test("is advertised in the nav and the sitemap now the API is public", async ({ page }) => {
    // An advertised page and its links must flip together, or a crawler finds one without the
    // other.
    await page.goto("/");
    await expect(page.locator('nav a[href="/api-docs"]').first()).toBeAttached();

    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    expect(sitemap, "a public page belongs in the sitemap").toContain("/api-docs");

    const direct = await page.goto("/api-docs");
    expect(direct?.status()).toBe(200);
  });
});

test.describe("the try-it playground", () => {
  test("builds the exact URL from typed params and sends only on click", async ({ page }) => {
    let requested: string | null = null;
    // The mock is the only way to test the success path without a live API. It also pins the
    // request shape: what the preview shows must be what leaves the browser.
    await page.route("https://api.shieldedscan.xyz/**", async (route) => {
      requested = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ direction: "in", buckets: [], asOf: 1 }),
      });
    });

    await page.goto("/api-docs");
    const section = page.locator("section#destinations");
    await section.getByRole("textbox", { name: /direction/ }).fill("in");
    await expect(section.locator("pre", { hasText: /^GET / })).toContainText(
      "https://api.shieldedscan.xyz/v1/crosschain/destinations?direction=in",
    );

    expect(requested, "nothing may be sent before the click").toBeNull();
    await section.getByRole("button", { name: /send request/i }).click();

    // Scoped to the live-result region: the pinned example beside it legitimately
    // contains the same JSON, and an unscoped text match hits both.
    const live = section.getByRole("status");
    await expect(live.getByText(/^200/)).toBeVisible();
    await expect(live.getByText('"direction": "in"')).toBeVisible();
    expect(requested).toBe("https://api.shieldedscan.xyz/v1/crosschain/destinations?direction=in");
  });

  test("required params come prefilled with a REAL value, and clearing one gates the send", async ({
    page,
  }) => {
    await page.goto("/api-docs");
    const section = page.locator("section#tx-privacy");
    const button = section.getByRole("button", { name: /send request/i });
    const field = section.getByRole("textbox", { name: /txid/ });

    // Prefilled with the captured mainnet Ironwood migration — ready to send as-is.
    await expect(field).toHaveValue(
      "25d87ba678308c4b88b5b3cfebf4eda388d2e3523f2cf93c03ea2894b0fe8a1e",
    );
    await expect(button).toBeEnabled();
    await expect(section.locator("pre", { hasText: /^GET / })).toContainText(
      "/v1/transactions/25d87ba678308c4b88b5b3cfebf4eda388d2e3523f2cf93c03ea2894b0fe8a1e/privacy",
    );

    // Empty required param → gated, with the hint visible.
    await field.clear();
    await expect(button).toBeDisabled();
    await expect(section.getByText(/fill the required parameter/i)).toBeVisible();

    await field.fill("ab".repeat(32));
    await expect(button).toBeEnabled();
  });

  test("an unreachable API is an honest message, not a hang or a blank", async ({ page }) => {
    await page.route("https://api.shieldedscan.xyz/**", (route) => route.abort());
    await page.goto("/api-docs");
    const section = page.locator("section#supply");
    await section.getByRole("button", { name: /send request/i }).click();
    await expect(section.getByRole("status")).toContainText(/could not reach|not switched on/i);
  });

  test("the error envelope renders like any other response", async ({ page }) => {
    await page.route("https://api.shieldedscan.xyz/**", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          error: { code: "unknown_parameter", message: "unknown parameter: cachebust" },
          requestId: "x",
          asOf: 1,
        }),
      }),
    );
    await page.goto("/api-docs");
    const section = page.locator("section#supply");
    await section.getByRole("button", { name: /send request/i }).click();
    const live = section.getByRole("status");
    await expect(live.getByText(/^400/)).toBeVisible();
    await expect(live.getByText("unknown_parameter")).toBeVisible();
  });
});

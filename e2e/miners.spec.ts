/**
 * `/miners`, a pool's page and the `/mining` redirect, at a phone's width and a desktop's.
 *
 * Properties, not spot values: the shielded row states no number, shares in the bar add up to the
 * whole, a legend item brings its segment forward by pointer and by keyboard, every pool name
 * links its page and every address its own, and nothing scrolls the page sideways.
 */

import { expect, test, type Page } from "@playwright/test";

async function pageScrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

for (const width of [390, 1280]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
    });

    test("/miners shows the window, its pools and no number for the shielded coinbase", async ({
      page,
    }) => {
      await page.goto("/miners");
      await expect(page.getByRole("heading", { level: 1, name: "Miners" })).toBeVisible();
      await expect(page.getByRole("link", { name: "30D" })).toHaveAttribute("aria-current", "page");
      // Closed windows are not offered while the NU6.1 row waits for its repair.
      await expect(page.getByRole("link", { name: "1Y", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "ALL", exact: true })).toHaveCount(0);

      const table = page.getByRole("table", { name: /Mining pools/ });
      const shielded = table.getByRole("row").filter({ hasText: "shielded coinbase" });
      await expect(shielded.locator(".redact").first()).toBeVisible();
      // Its ZEC cell holds the veil and no digit.
      await expect(shielded.locator("td").nth(3)).not.toHaveText(/\d/);

      const viabtc = table.getByRole("link", { name: "ViaBTC", exact: true });
      await expect(viabtc).toHaveAttribute("href", "/miners/viabtc");

      expect(await pageScrollsSideways(page)).toBe(false);
    });

    test("the share bar's segments add up to the whole window", async ({ page }) => {
      await page.goto("/miners");
      const widths = await page
        .locator("[data-segment-key]")
        .evaluateAll((rects) => rects.map((r) => Number(r.getAttribute("width"))));
      const sum = widths.reduce((s, w) => s + w, 0);
      // Each segment leaves a 0.15 gap out of 100.
      expect(sum + 0.15 * widths.length).toBeCloseTo(100, 0);
    });

    test("a legend item brings its segment forward, by pointer and by keyboard", async ({
      page,
    }) => {
      await page.goto("/miners");
      const item = page.locator('[data-legend-key="foundry"]').first();
      const own = page.locator('[data-segment-key="foundry"]');
      const other = page.locator('[data-segment-key="viabtc"]');
      if (width >= 1024) {
        await item.hover();
        await expect(other).toHaveClass(/opacity-25/);
        await expect(own).not.toHaveClass(/opacity-25/);
        await page.mouse.move(0, 0);
      }
      await item.focus();
      await expect(other).toHaveClass(/opacity-25/);
      await expect(own).not.toHaveClass(/opacity-25/);
    });

    test("a pool row opens to its payout addresses, each linked", async ({ page }) => {
      await page.goto("/miners");
      const toggle = page.locator('button[aria-controls="addresses-viabtc"]');
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const list = page.locator("#addresses-viabtc");
      const links = list.getByRole("link");
      expect(await links.count()).toBeGreaterThan(0);
      for (const href of await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
        expect(href).toMatch(/^\/address\/t1/);
      }
      await expect(list).toContainText(/blocks · [\d,.]+ ZEC · \$/);
      expect(await pageScrollsSideways(page)).toBe(false);
    });

    test("the NSM section states its figures and starts its days at NU7", async ({ page }) => {
      await page.goto("/miners");
      const section = page.locator("section", {
        has: page.getByRole("heading", { name: "NSM · SINCE NU7" }),
      });
      await expect(section).toBeVisible();
      for (const label of ["NSM BALANCE", "FEES TO THE NSM", "FEES KEPT BY MINERS"]) {
        // Each tile pairs a ZEC figure with its USD: the NSM is public, never veiled.
        const tile = section.locator(".stat-card", { hasText: label });
        await expect(tile).toContainText(/[\d.,]+ ZEC/);
        await expect(tile).toContainText("$");
        await expect(tile.locator(".redact")).toHaveCount(0);
      }
      // The fixture's 30D window opens before its activation: the sums say where they start.
      await expect(section.locator(".stat-card", { hasText: "FEES TO THE NSM" })).toContainText(
        /60% of [\d.,]+ ZEC in fees · since \d+ \w+/,
      );
      // The chart's days begin at activation; the space before it is named, not drawn as zeros.
      await expect(section.getByText("no NSM before NU7")).toBeVisible();
      await expect(section.getByRole("link", { name: /ZIP 235/ })).toHaveAttribute(
        "href",
        "https://zips.z.cash/zip-0235",
      );
      expect(await pageScrollsSideways(page)).toBe(false);
    });

    test("a window chip is a link that carries the window", async ({ page }) => {
      await page.goto("/miners");
      await page.getByRole("link", { name: "90D" }).click();
      await expect(page).toHaveURL(/\/miners\?window=90d$/);
      await expect(page.getByRole("link", { name: "90D" })).toHaveAttribute("aria-current", "page");
    });

    test("a pool's page shows its figures, addresses and recent blocks", async ({ page }) => {
      await page.goto("/miners/viabtc");
      await expect(page.getByRole("heading", { level: 1, name: /ViaBTC/ })).toBeVisible();
      await expect(page.getByText("PAID", { exact: true })).toBeVisible();
      const recent = page.getByRole("table", { name: /newest blocks/ });
      const first = recent.getByRole("link").first();
      await expect(first).toHaveAttribute("href", /^\/block\/\d+$/);
      expect(await pageScrollsSideways(page)).toBe(false);
    });

    test("an unknown pool answers 404", async ({ page }) => {
      const res = await page.goto("/miners/not-a-pool");
      expect(res?.status()).toBe(404);
    });
  });
}

test.describe("/mining", () => {
  test("redirects permanently to /miners, keeping a window it can still serve", async ({
    request,
  }) => {
    const cases: [string, string][] = [
      ["/mining", "/miners?window=7d"],
      ["/mining?window=24h", "/miners?window=7d"],
      ["/mining?window=30d", "/miners"],
      ["/mining?window=90d", "/miners?window=90d"],
      ["/mining?window=1y", "/miners"],
    ];
    for (const [from, to] of cases) {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status(), from).toBe(308);
      expect(res.headers()["location"], from).toBe(to);
    }
  });
});

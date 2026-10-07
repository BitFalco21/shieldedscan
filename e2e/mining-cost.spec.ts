import { expect, test } from "@playwright/test";

/**
 * `/mining-cost` — what only interaction can show. The whole-site sweeps cover the page at
 * rest (overflow, contrast, one h1, no NaN, no off-origin request, no storage); this file
 * touches the controls:
 *
 * - switching the tariff band changes the figures, so the toggle is applied and not merely
 *   drawn;
 * - the zoom buttons transform the map and reset restores it;
 * - hovering a country fills the readout;
 * - the calculator answers a typed tariff and sends nothing anywhere.
 */

test.describe("/mining-cost", () => {
  test("the band toggle changes the ranking and the map stays put", async ({ page }) => {
    await page.goto("/mining-cost");
    const business = await page.getByRole("button", { name: /business/i });
    const household = await page.getByRole("button", { name: /^household$/i });
    await expect(business).toHaveAttribute("aria-pressed", "true");
    const before = await page.locator("table tbody").innerText();
    await household.click();
    await expect(household).toHaveAttribute("aria-pressed", "true");
    const after = await page.locator("table tbody").innerText();
    expect(after).not.toBe(before);
    // Still exactly one map, still with land on it.
    await expect(page.locator(".cost-map svg path")).not.toHaveCount(0);
  });

  test("the folded row opens the whole ranking in place and folds it back", async ({ page }) => {
    await page.goto("/mining-cost");
    const rows = page.locator("table tbody tr");
    const foldedCount = await rows.count();
    const showAll = page.getByRole("button", { name: /show all \d+ countries/i });
    const total = Number(/show all (\d+)/i.exec((await showAll.innerText()) ?? "")?.[1]);
    expect(total).toBeGreaterThan(foldedCount);
    await showAll.click();
    // Every country plus the "show fewer" row; the cheapest is still first.
    await expect(rows).toHaveCount(total + 1);
    await expect(rows.first()).toContainText(/\$0\.0\d\d \/ kWh/);
    await page.getByRole("button", { name: /show fewer/i }).click();
    await expect(rows).toHaveCount(foldedCount);
  });

  test("zoom in transforms the map, reset returns it, and no request leaves the origin", async ({
    page,
  }) => {
    const offOrigin: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1"))
        offOrigin.push(url);
    });
    await page.goto("/mining-cost");
    const group = page.locator(".cost-map svg > g");
    await expect(group).toHaveAttribute("transform", "translate(0 0) scale(1)");
    await page.getByRole("button", { name: "Zoom in" }).click();
    const zoomed = await group.getAttribute("transform");
    expect(zoomed).not.toBe("translate(0 0) scale(1)");
    expect(zoomed).toMatch(/scale\(1\.6/);
    await page.getByRole("button", { name: /reset the map view/i }).click();
    await expect(group).toHaveAttribute("transform", "translate(0 0) scale(1)");
    expect(offOrigin, offOrigin.join("\n")).toEqual([]);
  });

  test("hovering a country fills the readout with its tariff", async ({ page }) => {
    await page.goto("/mining-cost");
    // Germany is in the free table every quarter and large enough to hover reliably.
    const germany = page.locator('.cost-map svg path[aria-label^="Germany"]');
    await germany.hover();
    const readout = page.getByRole("status");
    await expect(readout).toContainText("Germany");
    await expect(readout).toContainText(/\/ kWh/);
  });

  test("the calculator answers a typed tariff and stores nothing", async ({ page }) => {
    await page.goto("/mining-cost");
    const input = page.getByRole("textbox", { name: /your electricity price/i });
    await input.fill("0.05");
    const results = page.locator('dl[aria-label="Your tariff, priced"]');
    await expect(results).toContainText(/electricity for one ZEC\s*\$/);
    const storage = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    // The one key this site may ever write is the theme, and nothing here chooses one.
    expect(storage.local.filter((k) => k !== "theme")).toEqual([]);
    expect(storage.session).toEqual([]);
  });
});

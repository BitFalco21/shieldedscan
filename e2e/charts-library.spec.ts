/**
 * The chart library and a chart's own page, in a real browser.
 *
 * Unit tests cover the filtering and the tables. These cover what only a browser proves: the
 * prerendered library hydrates and filters, a range survives a reload through the URL, the CSV
 * really downloads with the chart's own rows, and every card and link lands on a real page.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.describe("the chart library", () => {
  test("search and a category chip narrow the cards, and All restores them", async ({ page }) => {
    await page.goto("/charts");
    const cards = page.locator("main a[href^='/charts/']");
    const total = await cards.count();
    expect(total).toBeGreaterThan(5);

    await page.getByRole("searchbox", { name: "Search charts" }).fill("fee");
    await expect(cards).not.toHaveCount(total);
    for (const text of await cards.allTextContents()) expect(text.toLowerCase()).toContain("fee");

    await page.getByRole("searchbox", { name: "Search charts" }).fill("");
    await page.getByRole("button", { name: "Mining", exact: true }).click();
    for (const text of await cards.allTextContents()) expect(text).toContain("Mining");

    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(cards).toHaveCount(total);
  });

  test("every card opens its chart's page", async ({ page, request }) => {
    await page.goto("/charts");
    const hrefs = await page
      .locator("main a[href^='/charts/']")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    for (const href of hrefs) expect((await request.get(href)).status(), href).toBe(200);
  });
});

test.describe("a chart's own page", () => {
  test("the range lives in the URL, so a reload keeps it", async ({ page }) => {
    await page.goto("/charts/median-fee");
    await page.getByRole("button", { name: "90D" }).click();
    await expect(page).toHaveURL(/\/charts\/median-fee\?range=90d$/);
    await page.reload();
    await expect(page.getByRole("button", { name: "90D" })).toHaveAttribute("aria-pressed", "true");
  });

  test("the CSV downloads the plotted rows, headed by their units", async ({ page }) => {
    await page.goto("/charts/median-fee?range=30d");
    await expect(page.getByRole("button", { name: "30D" })).toHaveAttribute("aria-pressed", "true");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /csv/i }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("shieldedscan-median-fee-30d.csv");
    const lines = readFileSync((await download.path())!, "utf8")
      .trimEnd()
      .split("\n");
    expect(lines[0]).toBe("day,fully_shielded_median_zat,mixed_median_zat,transparent_median_zat");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) expect(line).toMatch(/^\d{4}-\d{2}-\d{2},/);
  });

  test("names the public endpoint for its data, and suggests related charts", async ({ page }) => {
    await page.goto("/charts/median-fee");
    const api = page.getByRole("link", { name: "GET /v1/analytics/fees" });
    await expect(api).toHaveAttribute("href", "/api-docs#analytics-fees");
    await expect(page.getByText(/curl "https:\/\/.+\/v1\/analytics\/fees"/)).toBeVisible();
    const related = page.locator("section", { hasText: "Related charts" }).locator("a");
    await expect(related).toHaveCount(3);
  });
});

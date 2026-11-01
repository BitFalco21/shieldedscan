/**
 * The two `/shielded` views: all pools at `/shielded` (the default) and the shielded pools at
 * `/shielded?view=shielded`, which the edge proxy serves from its own prerendered route.
 *
 * The toggle is a pair of links, so each view must render whole from its URL with scripting off,
 * and switching with scripting on must keep the URL the reader shares.
 */

import { expect, test, type Page } from "@playwright/test";

const ALL = "Every ZEC, in every pool";
const SHIELDED = "The shielded pools";

const views = (page: Page) => page.getByRole("navigation", { name: "Pool views" });
/** A part's card: the legend has a button of the same name, but only a card controls the panel. */
const cardOf = (page: Page, name: string) =>
  page.locator("button[aria-controls]").filter({ hasText: new RegExp(name) });
const legendItem = (page: Page, name: string) =>
  page
    .getByRole("list", { name: "Highlight a part of the bar" })
    .getByRole("button", { name: new RegExp(`^${name}`) });

async function expectView(page: Page, heading: string, active: "All pools" | "Shielded pools") {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  await expect(views(page).getByRole("link", { name: active })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const other = active === "All pools" ? "Shielded pools" : "All pools";
  await expect(views(page).getByRole("link", { name: other })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
}

test.describe("with scripting off", () => {
  test.use({ javaScriptEnabled: false });

  test("/shielded is the all-pools view, every part with its figure", async ({ page }) => {
    await page.goto("/shielded");
    await expectView(page, ALL, "All pools");
    await expect(views(page).getByRole("link", { name: "All pools" })).toHaveAttribute(
      "href",
      "/shielded",
    );
    for (const label of [
      "Transparent",
      "Ironwood",
      "Orchard",
      "Sapling",
      "Sprout",
      "Lockbox",
      "NSM",
      "Still to mine",
    ]) {
      await expect(cardOf(page, label)).toBeVisible();
    }
    await expect(page.getByRole("img", { name: /^21 million ZEC by pool/ })).toBeVisible();
    // Prerendered: the block it was read at, never a claim to be live without a poll.
    await expect(page.getByText(/read at block [\d,]+/)).toBeVisible();
    await expect(page.locator("main")).not.toContainText("unavailable");
  });

  test("?view=shielded is the shielded-pools page, chart included", async ({ page }) => {
    await page.goto("/shielded?view=shielded");
    await expectView(page, SHIELDED, "Shielded pools");
    await expect(page.getByText("TOTAL SHIELDED SUPPLY OVER TIME")).toBeVisible();
    await expect(page.getByText("WHERE EVERY ZEC IS")).toBeVisible();
  });

  test("an unknown view is the default", async ({ page }) => {
    await page.goto("/shielded?view=nonsense");
    await expectView(page, ALL, "All pools");
  });
});

test.describe("with scripting on", () => {
  test("the toggle switches views and keeps the shareable URL", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/shielded");
    await expectView(page, ALL, "All pools");

    await views(page).getByRole("link", { name: "Shielded pools" }).click();
    await expect(page).toHaveURL(/\/shielded\?view=shielded$/);
    await expectView(page, SHIELDED, "Shielded pools");

    await views(page).getByRole("link", { name: "All pools" }).click();
    await expect(page).toHaveURL(/\/shielded$/);
    await expectView(page, ALL, "All pools");

    await page.reload();
    await expect(page).toHaveURL(/\/shielded$/);
    expect(errors).toEqual([]);
  });

  test("goes live once its own poll is accepted, never behind the server's block", async ({
    page,
  }) => {
    const height = (text: string) => Number(text.replace(/[^\d]/g, ""));
    const response = await page.goto("/shielded");
    const served = /read at block ([\d,]+)/.exec((await response?.text()) ?? "")?.[1] ?? "";
    expect(served, "the server render prints its block").not.toBe("");
    const live = page.getByText(/live · block [\d,]+/);
    await expect(live).toBeVisible();
    expect(height(await live.innerText())).toBeGreaterThanOrEqual(height(served));
  });

  test("a card opens its panel below, one at a time", async ({ page }) => {
    await page.goto("/shielded");
    const card = (name: string) => cardOf(page, name);
    const panel = page.locator("#supply-part-panel");

    // Ironwood is open first.
    await expect(card("Ironwood")).toHaveAttribute("aria-pressed", "true");
    await expect(panel).toContainText("Ironwood");

    await card("Lockbox").click();
    await expect(card("Lockbox")).toHaveAttribute("aria-pressed", "true");
    await expect(card("Ironwood")).toHaveAttribute("aria-pressed", "false");
    await expect(panel).toContainText("No transactions");
    await expect(panel.getByRole("link")).toHaveCount(0);

    await card("Transparent").click();
    await expect(panel.getByRole("link")).toHaveAttribute("href", "/txs?kind=transparent");

    // Each shielded pool opens its own transaction list, which lists only that pool.
    await card("Sprout").click();
    await expect(panel.getByRole("link")).toHaveAttribute("href", "/txs?pool=sprout");
    await panel.getByRole("link").click();
    await expect(page).toHaveURL(/\/txs\?pool=sprout$/);
    await expect(page.getByRole("navigation", { name: "Active pool filter" })).toContainText(
      "SPROUT",
    );
    await expect(page.locator("table tbody tr").first()).toBeVisible();
  });

  test("a legend item highlights its segment, and a second press clears it", async ({ page }) => {
    await page.goto("/shielded");
    const bar = page.getByRole("img", { name: /^21 million ZEC by pool/ });
    const dimmed = bar.locator("rect.opacity-25");
    const widths = () =>
      bar
        .locator('rect[fill="currentColor"]')
        .evaluateAll((rects) => rects.map((r) => r.getAttribute("width")));
    const before = await widths();
    await expect(dimmed).toHaveCount(0);

    // By keyboard, as a reader without a mouse would.
    await legendItem(page, "Sprout").focus();
    await page.keyboard.press("Enter");
    await expect(legendItem(page, "Sprout")).toHaveAttribute("aria-pressed", "true");
    await expect(dimmed).toHaveCount(before.length - 1);
    expect(await widths(), "highlighting changed a width").toEqual(before);
    await expect(page.getByText(/^Sprout: [\d,.]+[KM]? ZEC · [<\d.]+% of 21M$/)).toBeAttached();
    // The cards are not driven by the legend.
    await expect(cardOf(page, "Ironwood")).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("Space");
    await expect(legendItem(page, "Sprout")).toHaveAttribute("aria-pressed", "false");
    await expect(dimmed).toHaveCount(0);
  });
});

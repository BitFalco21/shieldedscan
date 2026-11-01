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
      await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
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
    const card = (name: string) => page.getByRole("button", { name: new RegExp(name) });
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
  });
});

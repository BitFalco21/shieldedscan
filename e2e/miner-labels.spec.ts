/**
 * Mining pool names in the MINER column and on a pool's payout address page.
 *
 * A pool name stands in for an address, so what has to survive the substitution is checked
 * here: the link still goes to the address, `title` still carries it whole, the logo is a real
 * same-origin image that adds nothing to the accessible name, and the page fits a phone.
 */

import { expect, test, type Page } from "@playwright/test";
import { POOL_PAYOUT_ADDR } from "./surface";

/** The fixture chain's logo-less pool and its unnamed miner (src/fixtures/ids.ts). */
const NO_LOGO_POOL_ADDR = "t1e6hceYHkzCbwcwGZzKeMfXXW7x7gr19Cw";
const UNNAMED_MINER_ADDR = "t1SoloMinerPayoutFixture000003";

/** Sideways scroll of the document itself; a table scrolling inside its panel is by design. */
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

    test("/blocks names a labelled miner by its pool, linking to its address", async ({ page }) => {
      await page.goto("/blocks");
      const table = page.locator("table");

      // The logo is decorative: the link's accessible name is the pool's name alone.
      const named = table.getByRole("link", { name: "Foundry USA", exact: true }).first();
      await expect(named).toBeVisible();
      await expect(named).toHaveAttribute("href", `/address/${POOL_PAYOUT_ADDR}`);
      await expect(named).toHaveAttribute("title", POOL_PAYOUT_ADDR);

      const logo = table.locator("img[data-mining-pool-logo]").first();
      await expect(logo).toHaveAttribute("alt", "");
      await expect(logo).toHaveAttribute("src", "/ecosystem/logos/foundry.png");
      const box = await logo.boundingBox();
      expect(box?.width).toBe(16);
      expect(box?.height).toBe(16);
      expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

      // A pool with no logo keeps the label glyph, so its name never stands bare.
      const noLogo = table.getByRole("link", { name: "Kryptex", exact: true }).first();
      await expect(noLogo).toHaveAttribute("href", `/address/${NO_LOGO_POOL_ADDR}`);
      await expect(noLogo.locator("xpath=preceding-sibling::*[@data-label-icon]")).toHaveCount(1);

      // An unnamed miner is its elided address, as before.
      const unnamed = table.locator(`a[href="/address/${UNNAMED_MINER_ADDR}"]`).first();
      await expect(unnamed).toContainText("t1Solo");

      expect(await pageScrollsSideways(page)).toBe(false);
    });

    test("a pool's payout address page carries the pool's name in its name tag", async ({
      page,
    }) => {
      await page.goto(`/address/${POOL_PAYOUT_ADDR}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(POOL_PAYOUT_ADDR);
      const chip = page.locator("[data-name-tag]");
      await expect(chip).toHaveText("Foundry USA");
      const logo = chip.locator("img");
      await expect(logo).toHaveAttribute("src", "/ecosystem/logos/foundry.png");
      await expect(logo).toHaveAttribute("alt", "");
      expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      expect(await pageScrollsSideways(page)).toBe(false);
    });
  });
}

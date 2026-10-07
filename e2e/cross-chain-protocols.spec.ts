import { expect, test } from "@playwright/test";

/**
 * The protocols tab's "+N more" chains menu.
 *
 * A closed `<details>` has no box, so `overflow.spec.ts` cannot see a panel that escapes the
 * screen once opened — the blind spot `tooltips.spec.ts` and the filter-menu measurements exist
 * for. So this opens every menu at both widths and measures it, and checks it lists every chain
 * the card counts rather than only the tail.
 */
for (const width of [375, 1440]) {
  test(`every chains menu opens inside the screen and its card at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/cross-chain/protocols");
    await page.evaluate(() => document.fonts.ready);

    const cards = page
      .locator("[data-protocol]")
      .filter({ has: page.locator("[data-chains-menu]") });
    const count = await cards.count();
    expect(
      count,
      "no protocol card renders a chains menu — the fixtures lost a case",
    ).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const card = cards.nth(i);
      const menu = card.locator("[data-chains-menu]");
      await menu.locator("summary").click();
      const panel = menu.locator("table");
      await expect(panel).toBeVisible();

      const box = (await panel.boundingBox())!;
      const cardBox = (await card.boundingBox())!;
      expect(box.x, "panel escapes the screen leftward").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "panel escapes the screen rightward").toBeLessThanOrEqual(width);
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);

      // The menu is the whole ranking: one row per chain the ROUTES figure counts.
      const routes = await card.locator("dt", { hasText: "ROUTES" }).locator("+ dd").innerText();
      const stated = Number(/(\d+) chains?/.exec(routes)?.[1]);
      await expect(panel.locator("tbody tr")).toHaveCount(stated);

      // Clicking elsewhere closes it (DismissPopovers), so menus never stack up.
      await page.mouse.click(2, 2);
      await expect(panel).toBeHidden();
    }
  });
}

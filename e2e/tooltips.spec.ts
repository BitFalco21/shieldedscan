import { expect, test } from "@playwright/test";
import { SHIELDED_TXID, TIP_HEIGHT, VIEWPORTS } from "./surface";

/**
 * The `?` field hints, opened.
 *
 * `overflow.spec.ts` cannot cover these: a closed tooltip is `display: none` and contributes
 * nothing to layout, so a panel that escapes the viewport the moment it opens passes every
 * other check. Every tip on the two detail pages is opened and measured, at both widths.
 */
const ROUTES = [`/tx/${SHIELDED_TXID}`, `/block/${TIP_HEIGHT}`];

for (const [name, size] of Object.entries(VIEWPORTS)) {
  test(`${name} — every open tooltip stays inside the viewport`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const tips = page.getByRole("button", { name: /what is/i });
      const count = await tips.count();
      // A page that lost its hints entirely would otherwise pass this suite vacuously.
      expect(count, `${route} renders no field hints at all`).toBeGreaterThan(0);

      for (let i = 0; i < count; i += 1) {
        await tips.nth(i).hover();
        const panel = page.locator("[role=tooltip]").nth(i);
        const box = await panel.boundingBox();
        if (box === null) continue; // still closed — only the hovered one has a box
        expect(box.x, `${route}: tip ${i} spills off the left`).toBeGreaterThanOrEqual(-1);
        expect(
          box.x + box.width,
          `${route}: tip ${i} spills off the right at ${size.width}px`,
        ).toBeLessThanOrEqual(size.width + 1);
        expect(box.width, `${route}: tip ${i} collapsed to nothing`).toBeGreaterThan(40);
      }

      // …and an open tip must not make the PAGE scrollable sideways either.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${route} scrolls sideways with a tip open`).toBeLessThanOrEqual(1);
    }
  });
}

test("a hint is reachable and announced without a mouse", async ({ page }) => {
  // The failure mode this guards: a `?` that only responds to hover is decorative for
  // keyboard and screen-reader users, which is most of the reason to build one properly.
  await page.goto(`/block/${TIP_HEIGHT}`);
  await page.waitForLoadState("networkidle");
  const tip = page.getByRole("button", { name: /what is/i }).first();
  await tip.focus();
  const describedBy = await tip.getAttribute("aria-describedby");
  expect(describedBy, "the hint is not tied to its trigger").toBeTruthy();
  const panel = page.locator(`#${describedBy}`);
  await expect(panel).toBeVisible();
  expect((await panel.textContent())?.trim().length ?? 0).toBeGreaterThan(20);
});

/**
 * The FROM / TO column of a transparent address's history: the other side of each transaction.
 *
 * Several parties are summarised by a count and listed in a disclosure, never one named alone;
 * the disclosure closes on Escape; and on a phone the same line sits under the hash, on screen.
 */

import { expect, test } from "@playwright/test";
import { settleLayout, TRANSPARENT_ADDR, VIEWPORTS } from "./surface";

test.describe("address FROM / TO", () => {
  test("several senders are counted, listed on demand, and closed with Escape", async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto(`/address/${TRANSPARENT_ADDR}`);
    await expect(page.getByRole("columnheader", { name: "FROM / TO" })).toBeVisible();

    const trigger = page.locator("summary:visible", { hasText: "2 inputs" });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const details = page.locator("details[data-popover]", { has: trigger });
    await expect(details).toHaveAttribute("open", "");
    await expect(details.getByText("INPUTS", { exact: true })).toBeVisible();
    await expect(details.locator("a[href^='/address/']")).toHaveCount(2);

    await page.keyboard.press("Escape");
    await expect(details).not.toHaveAttribute("open", "");
  });

  test("at 375px the other side sits under the hash, on screen, and opens in place", async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto(`/address/${TRANSPARENT_ADDR}`);
    await settleLayout(page);
    // The table scrolls sideways on a phone: FROM / TO is shown under the hash, never dropped.
    await expect(page.getByRole("columnheader", { name: "FROM / TO" })).toBeHidden();
    await expect(page.getByRole("columnheader", { name: "BLOCK" })).toBeHidden();

    const trigger = page.locator("summary:visible", { hasText: "2 inputs" });
    const box = await trigger.boundingBox();
    expect(box, "the FROM / TO trigger has no box").not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(VIEWPORTS.mobile.width);

    // Opened, the list lies in place under the trigger, inside the screen.
    await trigger.click();
    const panel = page.locator("details[data-popover][open] > div").first();
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox!.x).toBeGreaterThanOrEqual(0);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(VIEWPORTS.mobile.width);
  });
});

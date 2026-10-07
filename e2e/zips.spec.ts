import { expect, test } from "@playwright/test";

/**
 * /zips invariants beyond the whole-site sweeps: every external href is the
 * number-derived canonical shape (the structural no-attacker-href claim, made
 * mechanical), the retired section is collapsed, and the source line is present.
 */
test.describe("/zips", () => {
  test("every external link is a number-derived zips.z.cash URL with noreferrer", async ({
    page,
  }) => {
    await page.goto("/zips");
    const links = page.locator("main a[href^='https://']");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const href = await links.nth(i).getAttribute("href");
      expect(href).toMatch(/^https:\/\/zips\.z\.cash\/zip-\d{4}$/);
      expect(await links.nth(i).getAttribute("rel")).toContain("noreferrer");
    }
  });

  test("the retired section is a collapsed details that opens", async ({ page }) => {
    await page.goto("/zips");
    const details = page.locator("#zips-retired details");
    await expect(details).toHaveCount(1);
    await expect(details).toHaveJSProperty("open", false);
    await details.locator("summary").click();
    await expect(details).toHaveJSProperty("open", true);
  });

  test("states its source and read instant", async ({ page }) => {
    await page.goto("/zips");
    await expect(page.getByText(/source: github\.com\/zcash\/zips/)).toBeVisible();
    await expect(page.getByText(/index read/)).toBeVisible();
  });
});

test.describe("/zips section menu", () => {
  test("the sidebar highlights the section on screen and its anchors reach their sections", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/zips");
    const nav = page.getByRole("navigation", { name: /zip sections/i }).last();
    const links = nav.locator("a[href^='#']");
    expect(await links.count()).toBeGreaterThan(1);
    for (const href of await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
      await expect(page.locator(href!)).toHaveCount(1);
    }
    // Scroll the LAST section into the observer's band; its link, and only its link, is current.
    const lastHref = await links.last().getAttribute("href");
    await page.locator(lastHref!).evaluate((el) => el.scrollIntoView({ block: "start" }));
    await expect(nav.locator(`a[href="${lastHref}"]`)).toHaveAttribute("aria-current", "location");
    expect(await nav.locator("a[aria-current]").count()).toBe(1);
    // Clicking the first anchor moves the viewport back up to it.
    const firstHref = await links.first().getAttribute("href");
    await links.first().click();
    await expect(nav.locator(`a[href="${firstHref}"]`)).toHaveAttribute("aria-current", "location");
  });
});

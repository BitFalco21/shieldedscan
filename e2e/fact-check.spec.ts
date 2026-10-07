import { expect, test } from "@playwright/test";

/**
 * /fact-check invariants beyond the whole-site sweeps: every claim is individually linkable,
 * every outbound source opens without a referrer, and every claim carries a verdict and at
 * least one source. The sweeps in `surface.ts` cover overflow, contrast, headings, values and
 * the no-off-origin-request rule for this page at rest.
 */
test.describe("/fact-check", () => {
  test("every claim has a verdict, sources, and a heading that links to its own anchor", async ({
    page,
  }) => {
    await page.goto("/fact-check");
    const articles = page.locator("article[data-claim]");
    const count = await articles.count();
    expect(count).toBeGreaterThan(5);
    for (let i = 0; i < count; i += 1) {
      const article = articles.nth(i);
      const id = await article.getAttribute("id");
      expect(id).toBeTruthy();
      await expect(article.locator(`h3 a[href="#${id}"]`)).toHaveCount(1);
      await expect(article.locator("[data-verdict]")).toHaveCount(1);
      expect(await article.locator("li a").count()).toBeGreaterThan(0);
    }
  });

  test("sources start closed, open on + and close again on -", async ({ page }) => {
    await page.goto("/fact-check");
    const sources = page.locator("#premine details");
    const summary = sources.locator("summary");
    // Both glyphs are always in the DOM; CSS shows one. Visibility is what a reader sees.
    const plus = summary.getByText("+", { exact: true });
    const minus = summary.getByText("-", { exact: true });
    await expect(sources).toHaveJSProperty("open", false);
    await expect(sources.locator("li a").first()).toBeHidden();
    await expect(plus).toBeVisible();
    await expect(minus).toBeHidden();
    await summary.click();
    await expect(sources).toHaveJSProperty("open", true);
    await expect(sources.locator("li a").first()).toBeVisible();
    await expect(minus).toBeVisible();
    await expect(plus).toBeHidden();
    await summary.click();
    await expect(sources).toHaveJSProperty("open", false);
  });

  test("a deep link lands on its claim", async ({ page }) => {
    await page.goto("/fact-check#hidden-inflation");
    await expect(page.locator("#hidden-inflation")).toBeInViewport();
    // The outline agrees with the address bar on arrival.
    await expect(
      page.locator('aside nav[aria-label="Claims on this page"] a[href="#hidden-inflation"]'),
    ).toHaveAttribute("aria-current", "location");
  });

  test("the outline jumps to a claim and follows the reader as they scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/fact-check");
    const outline = page.locator('aside nav[aria-label="Claims on this page"]');
    await expect(outline).toBeVisible();

    // A click lands on the claim and lights its own link.
    await outline.locator('a[href="#criminals-use-monero"]').click();
    await expect(page.locator("#criminals-use-monero")).toBeInViewport();
    await expect(outline.locator('a[href="#criminals-use-monero"]')).toHaveAttribute(
      "aria-current",
      "location",
    );

    // Scrolling by hand moves the highlight: exactly one link is current, and it is the one
    // for the claim now at the top. The wheel is the reader's own input, which is what hands
    // the highlight back from the clicked claim to whatever is on screen.
    await page.mouse.move(900, 400);
    await page.mouse.wheel(0, -1);
    await page.locator("#premine").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await expect(outline.locator('a[href="#premine"]')).toHaveAttribute("aria-current", "location");
    await expect(outline.locator("a[aria-current]")).toHaveCount(1);

    // The sidebar stays on screen, and choosing the second-to-last claim lights THAT claim,
    // not the last one, even though the last is then wholly on screen.
    await outline.locator('a[href="#one-company"]').click();
    await expect(page.locator("#one-company")).toBeInViewport();
    await expect(outline).toBeInViewport();
    await expect(outline.locator('a[href="#one-company"]')).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  test("on a phone the outline is a closed disclosure above the claims", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/fact-check");
    await expect(page.locator('aside nav[aria-label="Claims on this page"]')).toBeHidden();
    const disclosure = page.locator("details", { hasText: "ON THIS PAGE" });
    await expect(disclosure).toHaveJSProperty("open", false);
    await disclosure.locator("summary").click();
    await disclosure.locator('a[href="#viewing-key-backdoor"]').click();
    await expect(page.locator("#viewing-key-backdoor")).toBeInViewport();
  });

  test("every outbound source opens in a new tab without a referrer", async ({ page }) => {
    await page.goto("/fact-check");
    const links = page.locator("main a[href^='https://']");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      expect(await links.nth(i).getAttribute("rel")).toContain("noreferrer");
      expect(await links.nth(i).getAttribute("target")).toBe("_blank");
    }
  });
});

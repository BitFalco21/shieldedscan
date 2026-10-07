/**
 * `/halving` — the countdown.
 *
 * A countdown page is easy to make look right and easy to make say something false, so what
 * is tested here is what it CLAIMS: that the clock actually advances, that the exact figures
 * are exact and the estimated ones are labelled, and that a reader with no JavaScript still
 * gets a usable answer.
 */

import { expect, test } from "@playwright/test";
import { VIEWPORTS } from "./surface";

test.describe("the countdown", () => {
  test("advances", async ({ page }) => {
    // The one thing a countdown must do, and the one thing a server-rendered page cannot.
    await page.goto("/halving");
    const clock = page.locator("section[aria-label^='Countdown']").first();
    await expect(clock).toBeVisible();

    const first = await clock.innerText();
    await page.waitForTimeout(2_200);
    expect(await clock.innerText(), "the clock did not tick").not.toBe(first);
  });

  test("never counts in negative numbers", async ({ page }) => {
    await page.goto("/halving");
    const text = await page.locator("section[aria-label^='Countdown']").first().innerText();

    // Anchored on a word boundary: a bare /-\d/ matches the estimated date ("2028-11-27") and
    // the block target ("75-second"). A negative countdown is a minus starting a token.
    expect(text, "the countdown went negative").not.toMatch(/(^|\s)-\d/);
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
  });

  test("states an exact block height beside every estimate", async ({ page }) => {
    // The page's discipline: a height is consensus, a date is extrapolated. Both are on
    // screen so a reader can tell which is which.
    await page.goto("/halving");
    const hero = page.locator("section[aria-label^='Countdown']").first();

    await expect(hero).toContainText(/BLOCKS TO GO/i);
    await expect(hero).toContainText(/READ AT BLOCK/i);
    await expect(hero).toContainText(/\d{4}-\d{2}-\d{2}/);
  });

  test("the 'what changes' heading names the block the hero counts to", async ({ page }) => {
    // Two renderings of one consensus height must agree. Asserted as a relationship rather than
    // a value, so it cannot go stale at the next halving.
    await page.goto("/halving");
    const hero = await page.locator("section[aria-label^='Countdown']").first().innerText();
    const height = hero.match(/BLOCK ([\d,]+)/)?.[1];

    expect(height, "the hero did not name a block").toBeTruthy();
    await expect(
      page.getByRole("heading", { name: new RegExp(`WHAT CHANGES AT BLOCK ${height}`, "i") }),
    ).toBeVisible();
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("still answers when the halving is", async ({ page }) => {
    // The countdown is the page's only client component and it must degrade to something
    // true rather than to a blank — the coarse estimate the server rendered.
    await page.goto("/halving");

    await expect(page.locator("section[aria-label^='Countdown']").first()).toContainText(
      /\d+ (year|day|hour|minute)/,
    );
    await expect(page.getByText(/BLOCKS TO GO/i)).toBeVisible();
  });
});

test.describe("the content", () => {
  test("says the miner's cut falls by less than the total", async ({ page }) => {
    // The page's central finding. If this ever renders as two identical percentages, the
    // subsidy split has stopped being carried per recipient and the page is stating a
    // widely-repeated falsehood.
    await page.goto("/halving");

    const pcts = await page
      .locator("text=/^−\\d+\\.\\d%$/")
      .allInnerTexts()
      .then((t) => t.map((v) => Number(v.replace(/[−%]/g, ""))));

    expect(pcts.length, "expected a total and a miner change").toBeGreaterThanOrEqual(2);
    expect(Math.max(...pcts)).toBeGreaterThan(Math.min(...pcts));
  });

  test("labels Blossom as not a halving", async ({ page }) => {
    await page.goto("/halving");
    await expect(page.getByText("not a halving").first()).toBeVisible();
  });

  test("names the block interval its estimate came from", async ({ page }) => {
    await page.goto("/halving");
    await expect(page.getByText(/second (average block time|consensus target)/)).toBeVisible();
  });
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`the tables stay inside the page at ${name}`, async ({ page }) => {
    // Four columns of monospace figures is the kind of content that pushes a phone sideways;
    // each table scrolls inside its own container rather than the document doing it.
    await page.setViewportSize(viewport);
    await page.goto("/halving");
    await page.evaluate(() => document.fonts.ready);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(1);
  });
}

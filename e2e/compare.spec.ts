/**
 * `/compare` — Zcash's market cap against a larger asset's.
 *
 * Not covered by `filters.spec.ts`: its picker does not narrow a list, it re-asks the page's
 * whole question, so a state-machine test that asserts rows change has nothing to measure.
 * What needs testing is what makes this page different: its figures come from a third party,
 * and its arithmetic is a ratio a reader can redo.
 */

import { expect, test, type Page } from "@playwright/test";
import { VIEWPORTS } from "./surface";

/*
 * Matched on a substring, because the accessible name carries the current selection — "BTC —
 * choose an asset to compare with" — so that it contains the control's visible text, which
 * WCAG 2.5.3 requires and a speech-input user depends on.
 */
const picker = (page: Page) => page.locator('summary[aria-label*="an asset to compare with"]');
/** The summary IS the chip: everything inside the border opens the menu, not just the caret. */
const chip = picker;

/** `<details>` opens on click; the menu's links live in the panel beside the summary. */
async function openPicker(page: Page): Promise<void> {
  await picker(page).click();
  await expect(picker(page).locator("xpath=..")).toHaveAttribute("open", "");
}

test.describe("the comparison", () => {
  test("the landing URL states a comparison rather than an empty control", async ({ page }) => {
    // The version a search engine indexes. A page that opens as a control and no content is
    // the one thing the default asset exists to prevent.
    await page.goto("/compare");

    await expect(page.getByText("ONE ZEC WOULD BE WORTH", { exact: true })).toBeVisible();
    await expect(page.locator("text=/^\\$[0-9,]+\\.[0-9]{2}$/").first()).toBeVisible();
  });

  test("the multiple reconciles with the two market caps printed beside it", async ({ page }) => {
    /*
     * The page's central honesty property, and the reason `compareToZec` anchors on the cap
     * ratio rather than on Zcash's supply: a reader who divides the two figures on screen must
     * land on the multiple between them. Recomputed here from the rendered text.
     */
    await page.goto("/compare");

    const caps = await page.locator("dt", { hasText: /^market cap$/ }).evaluateAll((dts) =>
      // The dd that FOLLOWS the dt, not the first dd under its parent: the card's `<dl>` is
      // one grid, so the parent's first dd is the price row's.
      dts.map((dt) => dt.nextElementSibling?.getAttribute("title") ?? ""),
    );
    expect(caps.length, "expected a market cap for each side").toBe(2);

    const [zecCap, otherCap] = caps.map((c) => Number(c.replace(/[$,]/g, "")));
    expect(zecCap, "Zcash's exact market cap should be in the title attribute").toBeGreaterThan(0);

    const multipleText = await page.locator("text=/^[0-9,]+\\.[0-9]{2}x$/").first().innerText();
    const shown = Number(multipleText.replace(/[x,]/g, ""));
    expect(shown).toBeCloseTo(otherCap! / zecCap!, 1);
  });

  test("reads the formula across the top with both full names, before the figure", async ({
    page,
  }) => {
    // The hero's first line reads Zcash · with the market cap of · Bitcoin, each name over its
    // own card, coin A left and coin B right.
    await page.goto("/compare");
    const hero = page.locator("section[aria-label]").first();
    const text = await hero.innerText();
    expect(text.indexOf("Zcash")).toBeLessThan(text.indexOf("WITH THE MARKET CAP OF"));
    expect(text.indexOf("WITH THE MARKET CAP OF")).toBeLessThan(text.indexOf("Bitcoin"));
    expect(text).not.toMatch(/the price of/i);

    const cards = hero.locator("[data-coin-role]");
    await expect(cards).toHaveCount(2);
    const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
    // Side by side at desktop: A strictly left of B, on one row.
    expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  });

  test("every figure is attributed, and dated", async ({ page }) => {
    // The one page here whose numbers cannot be checked against the Zcash chain, so the
    // reader is told whose they are and when they were read.
    await page.goto("/compare");

    await expect(page.getByText(/CoinGecko/).first()).toBeVisible();
    await expect(page.getByText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/).first()).toBeVisible();
  });
});

test.describe("the picker", () => {
  test("every option navigates to its own comparison", async ({ page }) => {
    await page.goto("/compare");
    await openPicker(page);

    // Scoped to the picker's own panel: the nav's analytics menu is also a `data-popover`
    // disclosure carrying a hidden `/compare` link, and clicking it would hang.
    const options = picker(page).locator("xpath=following-sibling::div").locator("a");
    const count = await options.count();
    expect(count, "the picker offered nothing").toBeGreaterThan(2);

    for (let i = 0; i < count; i += 1) {
      await page.goto("/compare");
      await openPicker(page);
      const option = options.nth(i);
      const href = (await option.getAttribute("href"))!;
      // The name is the first line; the market cap follows it. Compared case-insensitively
      // because `.microlabel` uppercases in CSS while the DOM keeps "Bitcoin".
      const name = (await option.innerText()).split("\n")[0]!.trim().toLowerCase();

      await option.click();
      await expect(page).toHaveURL(new RegExp(`${href.replace("?", "\\?")}$`));
      await expect(page.getByText("ONE ZEC WOULD BE WORTH", { exact: true })).toBeVisible();
      // It must show the asset that was clicked, not merely an asset: a silent fallback to the
      // default would render identically to a working control.
      expect((await chip(page).innerText()).toLowerCase()).toContain(name);
    }
  });

  test("a URL naming an asset it will not compare says so, and never substitutes one", async ({
    page,
  }) => {
    // A stale bookmark, an asset that fell below Zcash, and a typo. Each is a different fact
    // and each keeps the picker, so the page is never a dead end.
    for (const [vs, heading] of [
      ["monero", "NOT A LARGER ASSET"],
      ["tether", "NOT COMPARED"],
      ["definitely-not-an-asset", "NOT FOUND"],
    ] as const) {
      await page.goto(`/compare?vs=${vs}`);
      await expect(page.getByText(heading)).toBeVisible();
      await expect(page.getByText("ONE ZEC WOULD BE WORTH", { exact: true })).toHaveCount(0);
      await expect(picker(page)).toBeVisible();
    }
  });

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`the open menu stays on screen at ${name}`, async ({ page }) => {
      /*
       * `overflow.spec.ts` cannot catch this: a right-anchored panel on a left-edge control
       * escapes leftward, which adds no scrollWidth. This control sits at the start of its line.
       */
      await page.setViewportSize(viewport);
      await page.goto("/compare");
      await page.evaluate(() => document.fonts.ready);
      await openPicker(page);

      const box = await picker(page).locator("xpath=following-sibling::div").boundingBox();
      expect(box, "the picker opened with no panel").not.toBeNull();
      expect(box!.x, "the picker opens off the left edge").toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, "the picker opens past the right edge").toBeLessThanOrEqual(
        viewport.width,
      );
    });
  }
});

test.describe("the full table", () => {
  test("the tabs reach both views, and each marks itself current", async ({ page }) => {
    await page.goto("/compare");
    const tabs = page.getByRole("navigation", { name: "Compare views" });
    await expect(tabs.getByRole("link", { name: "comparison" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await tabs.getByRole("link", { name: "all assets" }).click();
    await expect(page).toHaveURL(/\/compare\/all$/);
    await expect(
      page.getByRole("navigation", { name: "Compare views" }).getByRole("link", {
        name: "all assets",
      }),
    ).toHaveAttribute("aria-current", "page");

    await page
      .getByRole("navigation", { name: "Compare views" })
      .getByRole("link", {
        name: "comparison",
      })
      .click();
    await expect(page).toHaveURL(/\/compare$/);
  });

  test("offers exactly the assets the picker does", async ({ page }) => {
    /*
     * The two views answer one question and must agree about which assets it can be asked
     * of. They reach `eligibleAssets` by different paths — the picker maps it directly, the
     * table goes through `compareToZecAll` — so a divergence here is real and would show as
     * an asset offered on one tab and missing from the other.
     */
    await page.goto("/compare");
    await openPicker(page);
    const fromPicker = await picker(page)
      .locator("xpath=following-sibling::div")
      .locator("a")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));

    await page.goto("/compare/all");
    const fromTable = await page
      .getByRole("table")
      .locator("tbody a")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));

    expect(fromTable.length, "the table offered nothing").toBeGreaterThan(2);
    expect(fromTable).toEqual(fromPicker);
  });

  test("every row states the figure its own comparison page states", async ({ page }) => {
    /*
     * The cross-view honesty check, and the reason `compareToZecAll` maps `compareToZec` rather
     * than dividing again: a row and the page it links to must not disagree about what one ZEC
     * would be worth. A second division would differ by ~0.09%.
     */
    await page.goto("/compare/all");
    const rows = page.getByRole("table").locator("tbody tr");
    const count = await rows.count();
    expect(count, "the table offered nothing").toBeGreaterThan(2);

    for (let i = 0; i < count; i += 1) {
      const cells = await rows.nth(i).getByRole("cell").allInnerTexts();
      const href = (await rows.nth(i).locator("a").getAttribute("href"))!;
      const inTable = cells[cells.length - 1]!.trim();

      await page.goto(href);
      // `.compare-figure` is the implied price's own class. A bare dollar-shaped locator would
      // match coin A's price first and fail on a correct page.
      const onDetail = await page.locator(".compare-figure").innerText();
      expect(onDetail.trim(), `row ${i} (${href}) disagrees with its own page`).toBe(inTable);
      await page.goto("/compare/all");
    }
  });

  test("never dresses the arithmetic as a prediction", async ({ page }) => {
    // The risk this view carries and the single comparison does not: a column of ascending
    // dollar figures is readily screenshotted as a price-target list.
    await page.goto("/compare/all");
    const text = await page.locator("main").innerText();

    expect(text).toMatch(/ONE ZEC WOULD BE/i);
    expect(text).toMatch(/circulating supply held fixed/i);
    expect(text).toMatch(/arithmetic, not a forecast/i);
    for (const forbidden of [/\btarget\b/i, /\bpotential\b/i, /\bprediction\b/i]) {
      expect(text, String(forbidden)).not.toMatch(forbidden);
    }
  });
});

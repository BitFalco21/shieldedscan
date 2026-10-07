/**
 * Scroll and back-navigation state.
 *
 * Guards against the page autoscrolling while the reader is mid-scroll, opening at the wrong
 * section, losing its position on Back, or being stuck after Back. "The URL is right" passes
 * while the experience is broken, so these assert the behaviour: Back restores position,
 * forward navigation starts at the top, and nothing moves after load settles.
 */

import { expect, test, type Page } from "@playwright/test";
import { VIEWPORTS } from "./surface";

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

/**
 * Scroll as far down as this page actually allows, and report where it landed.
 *
 * Deliberately not a fixed pixel target: on a viewport where the list affords less travel, a
 * hardcoded offset fails without anything being wrong. Returns 0 when the page does not scroll
 * at all, so callers can skip rather than assert nonsense.
 */
async function scrollToBottom(page: Page): Promise<number> {
  await page.waitForLoadState("networkidle");
  const target = await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    window.scrollTo(0, max);
    return max;
  });
  if (target <= 0) return 0;
  await expect.poll(() => scrollY(page)).toBeGreaterThan(target * 0.5);
  return scrollY(page);
}

/** Wait until the page has stopped moving on its own, then report where it settled. */
async function settledScrollY(page: Page): Promise<number> {
  await page.waitForLoadState("networkidle");
  let previous = -1;
  for (let i = 0; i < 10; i += 1) {
    const current = await scrollY(page);
    if (current === previous) return current;
    previous = current;
    await page.waitForTimeout(100);
  }
  return previous;
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} — scroll and history`, () => {
    test.use({ viewport });

    test("Back restores the scroll position of a long list", async ({ page }) => {
      await page.goto("/blocks");
      const left = await scrollToBottom(page);
      test.skip(left === 0, "/blocks does not scroll at this viewport");

      // The last row, deliberately. Playwright scrolls a target into view before clicking, so
      // clicking the first row would scroll the page back to the top and then "prove" that a
      // position of 0 was restored as 0.
      await page.locator("table tbody tr a[href^='/block/']").last().click();
      await expect(page).toHaveURL(/\/block\//);
      await page.goBack();
      await expect(page).toHaveURL(/\/blocks$/);

      const restored = await settledScrollY(page);
      expect(
        restored,
        `Back landed at ${restored}px; the reader left from ${left}px`,
      ).toBeGreaterThan(left * 0.75);
    });

    test("a forward navigation starts at the top, not where the last page was", async ({
      page,
    }) => {
      await page.goto("/blocks");
      const left = await scrollToBottom(page);
      test.skip(left === 0, "/blocks does not scroll at this viewport");

      await page.locator("table tbody tr a[href^='/block/']").last().click();
      await expect(page).toHaveURL(/\/block\//);

      const landed = await settledScrollY(page);
      expect(
        landed,
        `the detail page opened ${landed}px down instead of at the top (came from ${left}px)`,
      ).toBeLessThan(50);
    });

    test("nothing scrolls the page on its own after load settles", async ({ page }) => {
      // An autoscroll-to-top firing after the reader had already started reading.
      for (const route of ["/", "/blocks", "/txs", "/cross-chain", "/analytics"]) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");

        /*
         * Derived from what the page affords, never a hardcoded offset: the browser would clamp
         * it and the test would report an unprompted scroll that never happened. Scrolling to
         * half of what is available tests the same property on a page of any height. A page too
         * short to scroll cannot exhibit the bug, so it is skipped rather than failed.
         */
        const room = await page.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight,
        );
        if (room < 100) continue;
        const target = Math.floor(room / 2);
        await page.evaluate((y) => window.scrollTo(0, y), target);
        await page.waitForTimeout(800);
        const after = await scrollY(page);
        expect(
          after,
          `${route} moved the page from ${target}px to ${after}px unprompted`,
        ).toBeGreaterThan(target - 50);
      }
    });

    test("the page still works after Back — it is not stuck", async ({ page }) => {
      // "Stuck" means the DOM is still there but nothing responds, so the test
      // has to interact after going back rather than just check the URL.
      await page.goto("/blocks");
      await page.locator("table tbody tr td a").first().click();
      await expect(page).toHaveURL(/\/block\//);
      await page.goBack();
      await expect(page).toHaveURL(/\/blocks$/);

      await page.getByRole("link", { name: "Older page" }).click();
      await expect(page).toHaveURL(/before=/);
      await expect(page.locator("table tbody tr").first()).toBeVisible();
    });
  });
}

/**
 * The grouped desktop nav.
 *
 * Groups are `<details>` disclosures, so their children exist in the DOM while collapsed.
 * "The link is present" is therefore a worthless assertion — these check that a reader can
 * reach them, that the menu does not follow you to the next page, and that a section stays lit
 * from inside it.
 */
test.describe("grouped navigation", () => {
  // Keep this list pointing at linked routes only — a deliberately unlinked child would fail
  // here for the right reason and read as the wrong one.
  const GROUPS = [
    { summary: "explore", child: "/blocks" },
    { summary: "analytics", child: "/shielded" },
  ] as const;

  for (const group of GROUPS) {
    test(`the ${group.summary} group opens and reaches ${group.child}`, async ({ page }) => {
      await page.goto("/");
      const link = page.locator(`nav a[href="${group.child}"]`);
      // Collapsed: in the DOM, but genuinely not reachable.
      await expect(link).not.toBeVisible();

      await page.locator("nav summary").filter({ hasText: group.summary }).click();
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${group.child}$`));
    });
  }

  test("opening one group closes the other", async ({ page }) => {
    /*
     * Only one group may be open at a time. `<details>` elements are independent unless they
     * share a `name`, which makes the browser itself an exclusive accordion.
     *
     * This needs a real browser: the behaviour lives in the HTML parser's details-name group,
     * and jsdom renders the attribute and ignores what it means. Asserting on `open` rather than
     * the attribute is the point.
     */
    await page.goto("/");
    const explore = page
      .locator("nav details")
      .filter({ has: page.locator("summary", { hasText: "explore" }) });
    const analytics = page
      .locator("nav details")
      .filter({ has: page.locator("summary", { hasText: "analytics" }) });

    await explore.locator("summary").click();
    await expect(explore).toHaveAttribute("open", "");

    await analytics.locator("summary").click();
    await expect(analytics).toHaveAttribute("open", "");
    await expect(explore).not.toHaveAttribute("open", "");
    // And the first group's children are genuinely gone, not merely un-flagged.
    await expect(page.locator('nav a[href="/blocks"]')).not.toBeVisible();
  });

  test("a group still closes itself when its own summary is clicked again", async ({ page }) => {
    // The exclusive accordion must not cost the ordinary toggle: `name` groups siblings, it
    // does not pin one open.
    await page.goto("/");
    const summary = page.locator("nav summary").filter({ hasText: "explore" });
    await summary.click();
    await expect(page.locator('nav a[href="/blocks"]')).toBeVisible();
    await summary.click();
    await expect(page.locator('nav a[href="/blocks"]')).not.toBeVisible();
  });

  test("a group does not stay open over the page it navigated to", async ({ page }) => {
    // The failure the `key={pathname}` remount exists to prevent: `<details>` keeps its own
    // open state across a client-side route change, so the menu hangs over the new page.
    await page.goto("/");
    await page.locator("nav summary").filter({ hasText: "explore" }).click();
    await page.locator('nav a[href="/reorgs"]').click();
    await expect(page).toHaveURL(/\/reorgs$/);
    await expect(page.locator('nav a[href="/blocks"]')).not.toBeVisible();
  });

  test("a group is highlighted while you are inside it", async ({ page }) => {
    // Without this a reader deep in a section sees every nav entry looking equally unvisited.
    // Uses a linked route: an active group is computed from the children the nav lists.
    //
    // Discriminated on `text-ink-dim`, not `text-green`: the inactive class string is
    // `text-ink-dim before:text-green-faint hover:text-green`, so a /text-green/ match would
    // succeed on an inactive item via its hover and prefix variants.
    await page.goto("/shielded");
    await expect(page.locator("nav summary").filter({ hasText: "analytics" })).not.toHaveClass(
      /text-ink-dim/,
    );
    await expect(page.locator("nav summary").filter({ hasText: "explore" })).toHaveClass(
      /text-ink-dim/,
    );
  });

  test("the top level is exactly home, explore, analytics, api (+ ask zeno when enabled, + learn on mainnet)", async ({
    page,
  }) => {
    // Asserts the whole list rather than the presence of each item, so a nav entry appearing or
    // vanishing is a deliberate edit here. Flag-gated entries derive their expectation from the
    // same flag the nav reads, which keeps the whole-list assertion intact in both
    // configurations.
    await page.goto("/");
    const labels = await page.locator("nav > div > div > span > *").evaluateAll((els) =>
      els.map((el) =>
        (el.tagName === "DETAILS"
          ? (el.querySelector("summary")?.textContent ?? "")
          : (el.textContent ?? "")
        )
          .replace("▾", "")
          // A label may hold a non-breaking space ("ask zeno" does); the test is about the
          // words, not the space character.
          .replace(/\s+/g, " ")
          .trim(),
      ),
    );
    const expected = ["home", "explore", "analytics", "api"];
    if (process.env.NEXT_PUBLIC_AGENT_ENABLED === "1") expected.push("ask zeno");
    // Mainnet-only, like the route, so the expectation reads the same flag the nav does.
    if (process.env.NEXT_PUBLIC_NETWORK !== "testnet") expected.push("learn");
    expect(labels).toEqual(expected);
  });
});

test.describe("mobile navigation", () => {
  test.use({ viewport: VIEWPORTS.mobile });

  test("the menu closes on navigation and leaves no stale highlight", async ({ page }) => {
    // A hover highlight left behind on a touch device, where there is no
    // pointer to move away and clear it.
    await page.goto("/");
    await page.getByRole("button", { name: "Navigation menu" }).click();
    const menu = page.locator("#nav-menu");
    await expect(menu).toBeVisible();

    await menu.getByRole("link", { name: "Blocks" }).click();
    await expect(page).toHaveURL(/\/blocks$/);
    await expect(menu, "the menu stayed open over the page it navigated to").not.toBeVisible();
  });
});

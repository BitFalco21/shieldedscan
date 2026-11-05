import { expect, test, type Page } from "@playwright/test";

/**
 * The NU7 countdown on `/block/3543405` and the site bar that leads to it.
 *
 * The fixture chain sits far below the activation height and does not advance, so `/api/live`
 * is stubbed with the fixture's own answer moved up to just below (or at) the height. The page
 * itself is the production render; only the client's polls are answered here.
 */

const H = 3_543_405;
const COUNTDOWN = `/block/${H}`;
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
] as const;

/** Answer every poll with the real payload, its chain shifted so the tip is `tip`. */
async function stubFeed(page: Page, tip: () => number) {
  await page.route("**/api/live**", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const shift = tip() - body.tip.height;
    const now = Math.floor(Date.now() / 1000);
    const age = now - 30 - body.tip.lastBlockTimestamp;
    body.tip = {
      ...body.tip,
      height: tip(),
      lastBlockTimestamp: body.tip.lastBlockTimestamp + age,
    };
    body.blocks = body.blocks.map((b: { height: number; timestamp: number }) => ({
      ...b,
      height: b.height + shift,
      timestamp: b.timestamp + age,
    }));
    await route.fulfill({ response: res, json: body });
  });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const viewport of WIDTHS) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("the countdown renders from the feed, with no sideways scroll", async ({ page }) => {
      await stubFeed(page, () => H - 412);
      const res = await page.goto(COUNTDOWN);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveTitle(/NU7 countdown/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "NU7 activates at this block",
      );
      await expect(page.locator(".nu7-count")).toHaveText("412");
      await expect(page.getByText("what changes at block 3,543,405")).toBeVisible();
      await expect(page.locator("canvas[role=img]")).toBeVisible();
      // The bar is not shown on the page it leads to.
      await expect(page.getByRole("button", { name: "Hide for this page view" })).toHaveCount(0);
      await noSidewaysScroll(page);
    });

    test("the site bar fills in its counts and closes for this view", async ({ page }) => {
      await stubFeed(page, () => H - 412);
      await page.goto("/blocks");
      const bar = page.getByRole("link", { name: /nu7>/ });
      await expect(bar).toHaveAttribute("href", COUNTDOWN);
      await expect(bar).toContainText("412");
      await noSidewaysScroll(page);
      await page.getByRole("button", { name: "Hide for this page view" }).click();
      await expect(bar).toHaveCount(0);
      // Nothing is stored: the next load brings it back.
      await page.reload();
      await expect(page.getByRole("link", { name: /nu7>/ })).toBeVisible();
    });
  });
}

test("the activation is shown when the tip reaches the height, then the page refreshes", async ({
  page,
}) => {
  let tip = H - 1;
  await stubFeed(page, () => tip);
  await page.goto(COUNTDOWN);
  await expect(page.locator(".nu7-count")).toHaveText("1");

  const refreshed = page.waitForRequest(
    (r) => r.url().includes(COUNTDOWN) && r.headers()["rsc"] === "1",
    { timeout: 20_000 },
  );
  tip = H;
  // Coming back to the tab polls at once.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText(/NU7 is active/)).toBeVisible();
  await expect(page.locator(".nu7-flash")).toHaveCount(1);
  await expect(page.getByText("target 25 s · was 75 s")).toBeVisible();
  await expect(page.getByText("was 1.25")).toBeVisible();
  await refreshed;
});

test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the activation shows its end state at once", async ({ page }) => {
    let tip = H - 1;
    await stubFeed(page, () => tip);
    await page.goto(COUNTDOWN);
    await expect(page.locator(".nu7-count")).toHaveText("1");
    tip = H;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText(/NU7 is active/)).toBeVisible();
    await expect(page.locator(".nu7-flash, .nu7-type")).toHaveCount(0);
  });
});

test("any other missing block is still a 404", async ({ page }) => {
  expect((await page.goto(`/block/${H + 1}`))?.status()).toBe(404);
  expect((await page.goto(`/block/0${H}`))?.status()).toBe(404);
});

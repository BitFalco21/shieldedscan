/**
 * Zcash Name System — a name typed anywhere reaches its own page and, from there, the address its
 * registrant pointed it at; nothing on the site labels an address with a name the reader did not
 * reach it through.
 *
 * Runs against the fixture registry (`src/fixtures/zns.ts`): `zenith` is a plain claim, `abraham`
 * is listed for sale and was moved off zenith's address, `kazecstan` is released, and `stalename`
 * stands for a registry too far behind to trust.
 */

import { expect, test, type Page } from "@playwright/test";

const ZENITH =
  "u175lny2wwmwzkhh83ef8weypdyfeacdq4up9pprqxsrsupcm8ag5fj3vtjakv32k6qus7fay4myqn3cvnlaa4hkdhnfgzdhmyyphma74kdz82ysqgm9urexdckg48x95q793xyy87h3833mpau9rtrl28w085lpvufglnvr6fus3eufeg";

function collectForeignRequests(page: Page): string[] {
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
      foreign.push(url);
    }
  });
  return foreign;
}

test.describe("a Zcash name resolves forward", () => {
  test("the hero takes `Zenith.zcash` to the name page, and on to the address", async ({
    page,
  }) => {
    const foreign = collectForeignRequests(page);
    await page.goto("/");
    const field = page.getByRole("searchbox").first();
    await field.fill("Zenith.zcash");
    await field.press("Enter");
    await expect(page).toHaveURL(/\/name\/zenith$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("zenith.zcash");

    await page.locator(`a[href="/address/${ZENITH}?name=zenith"]`).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(ZENITH);
    await expect(page.locator("[data-zns-name]")).toContainText("zenith.zcash");
    // Names are answered from the API's snapshot; no visitor query reaches the registry.
    expect(foreign, `off-origin requests:\n${foreign.join("\n")}`).toEqual([]);
  });

  test("the palette offers the confirmed name, and nothing for a word nobody registered", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "Search the Zcash chain" });
    const field = dialog.getByRole("searchbox");
    await field.fill("zenith");
    await expect(dialog.getByText("Name — zenith.zcash")).toBeVisible();
    // ZNS treats `.zec` as the same name, so the palette does too.
    await field.fill("zenith.zec");
    await expect(dialog.getByText("Name — zenith.zcash")).toBeVisible();

    await field.fill("nobodyregisteredthis");
    // Wait past the debounce and the round trip, then assert no guessed destination appeared.
    await page.waitForTimeout(1500);
    await expect(dialog.locator('a[href*="/name/"]')).toHaveCount(0);
    await expect(dialog.getByText(/nobodyregisteredthis\.zcash/)).toHaveCount(0);
  });

  test("a listed name shows its price and its history", async ({ page }) => {
    await page.goto("/name/abraham");
    await expect(page.locator("[data-zns-listing]")).toContainText("2.50 ZEC");
    await expect(page.locator("[data-zns-event]")).toHaveCount(3);
  });

  test("the copy button hands over the FULL address", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/name/zenith");
    await page.getByRole("button", { name: "Copy address" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ZENITH);
  });

  test("a name link previews as that name", async ({ page, request }) => {
    await page.goto("/name/zenith");
    const image = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(image).toMatch(/\/name\/zenith\/opengraph-image/);
    const res = await request.get(new URL(image!).pathname);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      /zenith\.zcash/,
    );
  });

  test("a released name keeps its page, saying it is not registered", async ({ page }) => {
    await page.goto("/search?q=kazecstan");
    await expect(page).toHaveURL(/\/name\/kazecstan$/);
    await expect(page.locator("[data-zns-status]")).toHaveText("released");
    await expect(page.locator("[data-zns-unregistered]")).toContainText("released");
  });
});

test.describe("a name the registry cannot vouch for is never shown", () => {
  test("an unregistered name gets the designed miss from search, and a real 404 as a page", async ({
    page,
  }) => {
    const response = await page.goto("/search?q=nobodyregisteredthis");
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "No one has registered this name",
    );
    await expect(page.locator("a[data-zns-explorer]")).toHaveAttribute(
      "href",
      "https://www.zcashnames.com/explorer?search=nobodyregisteredthis",
    );
    expect((await page.goto("/name/nobodyregisteredthis"))?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "No one has registered this name",
    );
    // The 404 gets no route params, so its chip reads the name from the URL.
    await expect(page.locator("a[data-zns-explorer]")).toHaveAttribute(
      "href",
      "https://www.zcashnames.com/explorer?search=nobodyregisteredthis",
    );
    expect((await page.goto("/name/Not_A_Name"))?.status()).toBe(404);
    // Not a name, so nothing to filter by: their homepage.
    await expect(page.locator("a[data-zns-explorer]")).toHaveAttribute(
      "href",
      "https://www.zcashnames.com",
    );
  });

  test("a stale registry reads as unavailable, never as a miss or an address", async ({ page }) => {
    await page.goto("/search?q=stalename");
    await expect(page).toHaveURL(/\/search\?q=stalename$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Name lookup unavailable right now",
    );
    const response = await page.goto("/name/stalename");
    expect(response?.status()).toBe(200);
    await expect(page.locator("main")).toContainText(/TEMPORARILY UNAVAILABLE/i);
  });

  test("a name moved off an address does not label it — the link is re-checked", async ({
    page,
  }) => {
    // `abraham` once pointed at zenith's address and has since moved; its history links there.
    await page.goto(`/address/${ZENITH}?name=abraham`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(ZENITH);
    await expect(page.locator("[data-zns-name]")).toHaveCount(0);
  });

  test("without a searched name the address page carries no name at all", async ({ page }) => {
    await page.goto(`/address/${ZENITH}`);
    await expect(page.locator("[data-zns-name]")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(".zcash");
  });
});

import { expect, test } from "@playwright/test";
import { VIEWPORTS, collectPageErrors, isOurError } from "./surface";

/**
 * `/satoshi` — what only a pull can show. The whole-site sweeps cover the page at rest
 * (overflow, contrast, one h1, no NaN, no off-origin request, no storage); this file pulls
 * the lever and holds the machine to its own claims:
 *
 * - a pull sends NOTHING and stores NOTHING — the page's privacy sentence, tested;
 * - the ticket's key and address are well-formed Bitcoin values, so a reader can paste them
 *   into any offline tool (the derivation itself is pinned against OpenSSL in vitest);
 * - two pulls differ, so the machine is not replaying one fixture;
 * - the printed ticket does not push the phone layout sideways.
 */

const ADDRESS = /^1[1-9A-HJ-NP-Za-km-z]{25,33}$/;
const WIF = /^5[1-9A-HJ-NP-Za-km-z]{50}$/;

test.describe("/satoshi", () => {
  test("a pull prints a real ticket and reaches no network and no storage", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = collectPageErrors(page);
    await page.goto("/satoshi");
    await page.waitForLoadState("networkidle");

    const requests: string[] = [];
    page.on("request", (r) => {
      // Next may prefetch its own chunks on hover; anything that is not this origin is a leak.
      const url = r.url();
      if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
        requests.push(`${r.resourceType()} ${url}`);
      }
    });

    await page.getByRole("button", { name: "pull" }).click();
    const ticket = page.locator("[data-ticket]");
    await expect(ticket).toBeVisible();

    const hex = (await page.locator("[data-ticket-hex]").textContent()) ?? "";
    const wif = ((await page.locator("[data-ticket-wif]").textContent()) ?? "").slice(0, 51);
    const address = (await page.locator("[data-ticket-address]").textContent()) ?? "";
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(wif).toMatch(WIF);
    expect(address).toMatch(ADDRESS);
    // Not the target: a page that announced a jackpot in CI would be the fabrication itself.
    expect(address).not.toBe("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    await expect(page.locator("[data-ticket]")).toContainText("NO MATCH");
    await expect(page.locator("[data-pulls]")).toHaveText("000001");

    await page.getByRole("button", { name: "pull" }).click();
    await expect(page.locator("[data-pulls]")).toHaveText("000002");
    const second = (await page.locator("[data-ticket-hex]").textContent()) ?? "";
    expect(second).not.toBe(hex);

    expect(requests, "a pull must reach no other origin").toEqual([]);
    const stored = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    expect(stored).toEqual({ local: [], session: [] });
    expect(errors.filter(isOurError)).toEqual([]);
  });

  test("with motion, the reels spin before the ticket prints", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/satoshi");
    await page.getByRole("button", { name: "pull" }).click();
    const body = page.locator(".slot-body");
    await expect(body).toHaveAttribute("data-phase", "spinning");
    await expect(page.getByRole("button", { name: "pull" })).toBeDisabled();
    await expect(body).toHaveAttribute("data-phase", "landed", { timeout: 6_000 });
    await expect(page.locator("[data-ticket]")).toHaveClass(/is-out/);
  });

  test("the printed ticket does not scroll the phone sideways", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/satoshi");
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole("button", { name: "pull" }).click();
    await expect(page.locator("[data-ticket]")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the ticket's copy button copies the WHOLE key, never a truncated one", async ({
    browser,
  }) => {
    // The site-wide copy sweep cannot reach this button: it exists only after a pull.
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto("/satoshi");
    await page.getByRole("button", { name: "pull" }).click();
    await expect(page.locator("[data-ticket]")).toBeVisible();
    const shown = ((await page.locator("[data-ticket-wif]").textContent()) ?? "").slice(0, 51);
    await page.locator("[data-ticket-wif] button").click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(shown);
    expect(copied).toMatch(WIF);
    await context.close();
  });

  test("the odds are stated as an approximation and no lock is called stronger", async ({
    page,
  }) => {
    await page.goto("/satoshi");
    const text = (await page.locator("main").innerText()) ?? "";
    expect(text).toMatch(/≈ 1 in 2160|≈ 1 in 2\s*160/);
    expect(text).not.toMatch(/harder to crack|stronger key|stronger lock/i);
    expect(text).toMatch(/unspendable by consensus/);
    expect(text).toMatch(/read 2026-\d\d-\d\d/);
  });
});

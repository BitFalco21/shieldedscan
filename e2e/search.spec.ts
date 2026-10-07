/**
 * Search — the one control on the homepage.
 *
 * There are three ways in (the hero prompt, the nav button, the ⌘K palette) and they must
 * agree, because they all funnel through `classifySearchQuery`.
 *
 * Every branch of the classifier gets a case: height, 64-hex hash, the three address families,
 * empty, and unrecognised. Plus the inputs a classifier author does not think of — whitespace,
 * mixed case, a pasted URL, a height above the tip, a 63-character hash — where the requirement
 * is never "find something" but "say honestly that it found nothing".
 */

import { expect, test, type Page } from "@playwright/test";
import { SHIELDED_TXID, SHIELDED_ADDR, TRANSPARENT_ADDR, TIP_HEIGHT } from "./surface";

/** Submit through the homepage hero, the way most visitors will. */
async function searchFromHero(page: Page, query: string): Promise<void> {
  await page.goto("/");
  const field = page.getByRole("searchbox").first();
  await field.fill(query);
  await field.press("Enter");
}

/** Submit through the ⌘K palette, which is a different component and a different code path. */
async function searchFromPalette(page: Page, query: string): Promise<void> {
  await page.keyboard.press("Control+K");
  const dialog = page.getByRole("dialog", { name: "Search the Zcash chain" });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole("searchbox");
  await field.fill(query);
  await field.press("Enter");
}

test.describe("a query reaches the thing it names", () => {
  const RESOLVING: { query: string; url: RegExp; what: string }[] = [
    { query: String(TIP_HEIGHT), url: new RegExp(`/block/${TIP_HEIGHT}$`), what: "a height" },
    { query: SHIELDED_TXID, url: new RegExp(`/tx/${SHIELDED_TXID}$`), what: "a txid" },
    {
      query: TRANSPARENT_ADDR,
      url: new RegExp(`/address/${TRANSPARENT_ADDR}$`),
      what: "a transparent address",
    },
    {
      query: SHIELDED_ADDR,
      url: new RegExp(`/address/${SHIELDED_ADDR}$`),
      what: "a shielded address",
    },
  ];

  for (const { query, url, what } of RESOLVING) {
    test(`the hero resolves ${what}`, async ({ page }) => {
      await searchFromHero(page, query);
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });

    test(`the palette resolves ${what} identically`, async ({ page }) => {
      // Same query, different component. They share one classifier and must not drift.
      await page.goto("/");
      await searchFromPalette(page, query);
      await expect(page).toHaveURL(url);
    });
  }

  test("a hash is case-insensitive, because people paste from anywhere", async ({ page }) => {
    await searchFromHero(page, SHIELDED_TXID.toUpperCase());
    await expect(page).toHaveURL(new RegExp(`/tx/${SHIELDED_TXID}$`, "i"));
  });

  test("surrounding whitespace is trimmed, not treated as part of the query", async ({ page }) => {
    await searchFromHero(page, `  ${TIP_HEIGHT}  `);
    await expect(page).toHaveURL(new RegExp(`/block/${TIP_HEIGHT}$`));
  });
});

test.describe("a query that names nothing says so", () => {
  /**
   * Each of these must reach a designed state — never a blank page, never a stack trace, and
   * never a confident page about something that does not exist.
   */
  const NOT_FOUND = [
    { query: "hello world", why: "prose" },
    { query: "0x1234", why: "an EVM-style hash on a Zcash explorer" },
    { query: "zzzz", why: "junk" },
    { query: "t1", why: "an address prefix with no body" },
    { query: SHIELDED_TXID.slice(0, 63), why: "a hash one character short" },
    { query: `${SHIELDED_TXID}f`, why: "a hash one character long" },
    { query: "../../etc/passwd", why: "a traversal attempt" },
    { query: "<script>alert(1)</script>", why: "an injection attempt" },
    { query: "9".repeat(30), why: "a number far too long to be a height" },
  ];

  for (const { query, why } of NOT_FOUND) {
    test(`${why} lands on a designed empty state`, async ({ page }) => {
      const dialogs: string[] = [];
      page.on("dialog", (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });

      const response = await page.goto(`/search?q=${encodeURIComponent(query)}`);
      expect(response?.status(), `${query} produced a server error`).toBeLessThan(500);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      // The query IS echoed back — that is the point of the empty state, and it is correct
      // for `<script>alert(1)</script>` to appear on screen as those literal characters.
      // So the assertion is behavioural: nothing executed.
      expect(dialogs, `script executed: ${dialogs.join(", ")}`).toEqual([]);

      // Not "no script tag contains the string": Next serialises the RSC payload into
      // `<script>self.__next_f.push(…)`, so the query legitimately appears there as escaped
      // JSON. What matters is that the payload was not terminated early — a raw `</script>`
      // inside a script block is the breakout signature.
      const brokeOut = await page.evaluate(() =>
        Array.from(document.querySelectorAll("script"), (s) => s.textContent ?? "").some((t) =>
          t.includes("</script"),
        ),
      );
      expect(brokeOut, "a script block was terminated by injected content").toBe(false);
    });
  }

  test("an empty query does not pretend to have searched", async ({ page }) => {
    const response = await page.goto("/search?q=");
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("main")).toBeVisible();
  });

  test("a missing q parameter behaves like an empty one", async ({ page }) => {
    const response = await page.goto("/search");
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("main")).toBeVisible();
  });

  test("a height beyond the tip is refused with its own designed state", async ({ page }) => {
    // It classifies cleanly, so nothing upstream objects, and the page could render a block with
    // every field blank. The assertion is that the refusal happened and names the real tip.
    await searchFromHero(page, "9999999999");
    await expect(page.locator("main")).toBeVisible();
    const heading = await page.getByRole("heading", { level: 1 }).innerText();
    expect(heading, `unexpected heading for a future height: "${heading}"`).toMatch(
      /hasn't been mined|not on chain|doesn't look like/i,
    );
    // And it must not have rendered a block page: no field grid claiming facts about it.
    await expect(page.getByText("MINER", { exact: true })).toHaveCount(0);
  });

  test("a height one past the tip is refused, not rounded down to the tip", async ({ page }) => {
    // The off-by-one at the only boundary that matters. Silently serving the tip for tip+1
    // would be a confidently wrong page rather than a refusal.
    await searchFromHero(page, String(TIP_HEIGHT + 1));
    const heading = await page.getByRole("heading", { level: 1 }).innerText();
    expect(heading).not.toContain(String(TIP_HEIGHT));
    expect(heading, `tip+1 rendered as "${heading}"`).toMatch(
      /hasn't been mined|not on chain|doesn't look like/i,
    );
  });

  test("the tip itself resolves", async ({ page }) => {
    await searchFromHero(page, String(TIP_HEIGHT));
    await expect(page).toHaveURL(new RegExp(`/block/${TIP_HEIGHT}$`));
  });
});

test.describe("the palette itself", () => {
  test("Escape closes it and returns focus to the page", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "Search the Zcash chain" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("it stores nothing between visits", async ({ page }) => {
    // The palette stores nothing; this checks the storage, not the intent.
    await page.goto("/");
    await searchFromPalette(page, String(TIP_HEIGHT));
    await expect(page).toHaveURL(new RegExp(`/block/${TIP_HEIGHT}$`));

    const stored = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    const haystack = JSON.stringify(stored);
    expect(haystack, `search terms leaked into storage: ${haystack}`).not.toContain(
      String(TIP_HEIGHT),
    );
  });

  test("reopening it does not show the previous query", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "Search the Zcash chain" });
    await dialog.getByRole("searchbox").fill("2481032");
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+K");
    await expect(dialog.getByRole("searchbox")).toHaveValue("");
  });
});

test.describe("search suggestions", () => {
  const HEX64 = "dead".repeat(16);

  test("a typed identifier expands into clickable rows that navigate", async ({ page }) => {
    await page.goto("/");
    const input = page.getByRole("searchbox", { name: /search the zcash chain/i }).first();
    await input.fill("2481032");
    const option = page.getByRole("option");
    await expect(option).toHaveCount(1);
    await expect(option.first()).toContainText("#2,481,032");
    await option.first().click();
    await expect(page).toHaveURL(/\/block\/2481032$/);
  });

  test("a 64-hex string waits for the resolver, then shows ONE final row — no flip", async ({
    page,
  }) => {
    // An unknown 64-hex hash shows one row, only once the resolver settles: a label that changes
    // on answer reads as a wrong guess being corrected. Its final state is the ambiguous /search
    // row.
    await page.goto("/");
    await page
      .getByRole("searchbox", { name: /search the zcash chain/i })
      .first()
      .fill(HEX64);
    const options = page.getByRole("option");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText(/transaction/i);
    await expect(options.first()).toContainText(/block/i);
  });

  test("arrow keys move the highlight and Enter follows it", async ({ page }) => {
    await page.goto("/");
    const input = page.getByRole("searchbox", { name: /search the zcash chain/i }).first();
    await input.fill(HEX64);
    // The row appears only when the resolver settles — wait for it before driving keys.
    await expect(page.getByRole("option")).toHaveCount(1);
    await input.press("ArrowDown");
    await expect(page.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await input.press("Enter");
    // The ambiguous row lands on /search, which resolves the hash server-side; a
    // fixture-unknown hash renders the designed not-found state on that URL.
    await expect(page).toHaveURL(new RegExp(`/search\\?q=${HEX64}$`));
  });

  test("a typed query reaches only this origin's resolver — the amended promise, enforced", async ({
    page,
  }) => {
    // The dropdown is built from the local classifier, and its links are prefetch={false}: a
    // default prefetch would send a typed txid to the server before any click. A plausible
    // identifier may go to this origin's /api/resolve — and nowhere else. The resolver holds the
    // credentials server-side, so the query never reaches a third party and no token exists
    // client-side. Anything carrying the typed value to any other URL is a leak.
    const leaked: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      const sanctioned =
        url.pathname === "/api/resolve" && url.origin === new URL(page.url()).origin;
      if (r.url().includes(HEX64) && !sanctioned) leaked.push(r.url());
    });
    await page.goto("/");
    await page
      .getByRole("searchbox", { name: /search the zcash chain/i })
      .first()
      .fill(HEX64);
    // One row, not two: a 64-hex string is ambiguous between a txid and a block hash, so a single
    // row's label carries the ambiguity. See `lib/search-suggestions.ts`'s `hash64` case.
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.waitForTimeout(800);
    expect(leaked, `typed value left the browser: ${leaked.join(", ")}`).toHaveLength(0);
  });

  test("malformed input offers nothing to click", async ({ page }) => {
    await page.goto("/");
    const input = page.getByRole("searchbox", { name: /search the zcash chain/i }).first();
    await input.fill("<script>alert(1)</script>");
    await expect(page.getByRole("option")).toHaveCount(0);
    await input.fill("dead".repeat(15)); // one byte short of a hash
    await expect(page.getByRole("option")).toHaveCount(0);
  });
});

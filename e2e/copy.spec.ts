/**
 * Copy controls.
 *
 * Every hash and address on the site is displayed elided (`b2481032…00000000`), so the copy
 * button is the only way to get the real value. If it ever copies the displayed text instead
 * of the full one, every paste is wrong and the page looks perfect. These tests check the
 * clipboard rather than the prop.
 */

import { expect, test } from "@playwright/test";
import { SHIELDED_ADDR, SHIELDED_TXID, TIP_HEIGHT, TRANSPARENT_ADDR } from "./surface";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const readClipboard = (page: import("@playwright/test").Page) =>
  page.evaluate(() => navigator.clipboard.readText());

test.describe("a copy control yields the whole value", () => {
  test("the transparent address page copies the full address", async ({ page }) => {
    await page.goto(`/address/${TRANSPARENT_ADDR}`);
    await page
      .getByRole("button", { name: /copy address/i })
      .first()
      .click();
    expect(await readClipboard(page)).toBe(TRANSPARENT_ADDR);
  });

  test("the shielded address page copies the full address", async ({ page }) => {
    // The longer and more error-prone of the two, and the one where a mistyped character
    // silently looks up a different address.
    await page.goto(`/address/${SHIELDED_ADDR}`);
    await page
      .getByRole("button", { name: /copy address/i })
      .first()
      .click();
    expect(await readClipboard(page)).toBe(SHIELDED_ADDR);
  });

  test("a transaction page copies the full txid", async ({ page }) => {
    // Targets the heading's button and asserts the exact txid, not merely "something 64
    // characters long" — the block hash also satisfies a length check.
    await page.goto(`/tx/${SHIELDED_TXID}`);
    await page.locator("h1").getByRole("button", { name: /copy/i }).click();
    const copied = await readClipboard(page);
    expect(copied, "the copied value is elided").not.toContain("…");
    expect(copied).toBe(SHIELDED_TXID);
  });

  test("no copy button anywhere yields elided or empty text", async ({ page }) => {
    // The generic form, swept across the pages that carry the most of them. A single
    // regression in `HashLink` would break every one at once, so breadth matters more than
    // knowing which value each button holds.
    const offenders: string[] = [];
    for (const route of [
      `/block/${TIP_HEIGHT}`,
      `/tx/${SHIELDED_TXID}`,
      `/address/${TRANSPARENT_ADDR}`,
      "/cross-chain/thor-8842",
      "/blocks",
      "/reorgs",
    ]) {
      await page.goto(route);
      const buttons = page.getByRole("button", { name: /copy/i });
      const count = Math.min(await buttons.count(), 12);
      for (let i = 0; i < count; i += 1) {
        await buttons.nth(i).click();
        const copied = (await readClipboard(page)).trim();
        if (copied === "") offenders.push(`${route} button ${i + 1}: copied nothing`);
        else if (copied.includes("…"))
          offenders.push(`${route} button ${i + 1}: copied "${copied}"`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("a copied hash is the full value of the hash it sits beside", async ({ page }) => {
    // Stronger than "not elided": it must be the value of that row. A shared or off-by-one prop
    // would copy a neighbour's hash, which looks plausible on screen.
    //
    // Compared against the link's `title`, not its `href`: a /blocks row links by height
    // (`/block/2481032`) while the copy button carries the hash. Both are correct.
    await page.goto("/blocks");
    const rows = page.locator("table tbody tr");
    const count = Math.min(await rows.count(), 5);
    const mismatches: string[] = [];

    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      const copy = row.getByRole("button", { name: /copy/i });
      if ((await copy.count()) === 0) continue;

      // Every HashLink puts the untruncated value in `title` on the anchor it wraps.
      const titles = await row
        .locator("a[title]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("title") ?? ""));
      await copy.first().click();
      const copied = (await readClipboard(page)).trim();

      if (copied === "") {
        mismatches.push(`row ${i + 1}: copied nothing`);
      } else if (!titles.includes(copied)) {
        mismatches.push(
          `row ${i + 1}: copied "${copied}" which is not any value in the row (${titles.join(", ")})`,
        );
      }
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  });
});

test.describe("the control is reachable and announced", () => {
  test("every copy button has an accessible name naming what it copies", async ({ page }) => {
    // "button" tells a screen-reader user nothing. The name must say which value.
    await page.goto(`/block/${TIP_HEIGHT}`);
    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .filter((b) => (b.textContent ?? "").trim() === "" || /⧉|✓/.test(b.textContent ?? ""))
        .filter((b) => !(b.getAttribute("aria-label") ?? "").trim())
        .map((b) => b.outerHTML.slice(0, 100)),
    );
    expect(unnamed, `icon-only buttons with no accessible name:\n${unnamed.join("\n")}`).toEqual(
      [],
    );
  });

  test("it is operable from the keyboard", async ({ page }) => {
    await page.goto(`/address/${TRANSPARENT_ADDR}`);
    const copy = page.getByRole("button", { name: /copy address/i }).first();
    await copy.focus();
    await page.keyboard.press("Enter");
    expect(await readClipboard(page)).toBe(TRANSPARENT_ADDR);
  });
});

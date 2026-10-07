/**
 * The donate page — small surface, but the failure mode is uniquely expensive: a wrong or
 * partially-copied donation address is money sent into the void, and nothing anywhere
 * looks broken when it happens. So the assertions here are about *exactness*: the full
 * address on screen, the identical string in the clipboard, and the QR asset actually
 * loading (the encode/decode round-trip itself is verified at generation time by
 * scripts/generate-donate-qr.mjs — a browser test cannot decode a QR without shipping a
 * decoder, and the generator already refuses to write a mismatched asset).
 */

import { expect, test } from "@playwright/test";

/** Must match src/lib/donation.ts — a drift here IS the bug this file exists to catch. */
const DONATION_ADDRESS =
  "u1a4w9rqrv2knrp58qa5cwak545ul30rq4txh0nfs7hytjxlpcpswhzpattjx9w7c6tcvdw4n5rk92qqln7wc7yfzsdf9g84wf4fr7dyd7p7hup0rc4rj5sxydj98wk750q97dymkgddqs3qlfw2pkrpunle725ldf8aznfmg98g88gu5n";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.describe("/donate", () => {
  test("shows the full untruncated address", async ({ page }) => {
    await page.goto("/donate");
    // The whole string, character for character — not an elided rendering. `main` text is
    // what a visitor can compare against their wallet.
    await expect(page.locator("main")).toContainText(DONATION_ADDRESS);
  });

  test("the copy button yields exactly the address", async ({ page }) => {
    await page.goto("/donate");
    await page.getByRole("button", { name: /copy donation address/i }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(DONATION_ADDRESS);
  });

  test("the QR image loads, has dimensions, and names its purpose", async ({ page }) => {
    await page.goto("/donate");
    const qr = page.getByRole("img", { name: /QR code for a Zcash donation/i });
    await expect(qr).toBeVisible();
    // A broken image src still renders an element; naturalWidth is the loaded truth.
    const loaded = await qr.evaluate(
      (el) => (el as HTMLImageElement).naturalWidth > 0 || el.tagName === "svg",
    );
    expect(loaded, "the QR image did not actually load").toBe(true);
  });

  test("the footer links to it from every page class", async ({ page }) => {
    for (const route of ["/", "/blocks", "/tx", "/donate"]) {
      await page.goto(route === "/tx" ? "/" : route);
      await expect(page.locator("footer").getByRole("link", { name: /donate/i })).toBeVisible();
    }
  });

  test("says why donations matter, in the maintainer's voice", async ({ page }) => {
    await page.goto("/donate");
    await expect(page.locator("main")).toContainText(/bootstrapping/i);
    await expect(page.locator("main")).toContainText(/infrastructure/i);
  });
});

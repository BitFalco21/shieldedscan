/**
 * Outbound links.
 *
 * `links.spec.ts` crawls only internal hrefs. Venue links matter more: the far leg of a swap is
 * the one figure here that cannot be checked against the Zcash chain, so an outbound link that
 * goes nowhere breaks the page's claim.
 *
 * A status check is not enough:
 *
 *   GET https://explorer.near-intents.org/transactions/abc  ->  HTTP 200
 *
 * The venue is a client-rendered app: its server answers 200 for any path under
 * `/transactions/` and renders "404 Transaction not found" in the browser. So these tests load
 * the page and read what it says.
 *
 * Tagged `@external` because it depends on a third party being reachable. Keep it out of the
 * commit gate — a venue's outage must never turn this repo's CI red — and run it on a schedule,
 * where a venue changing its URL scheme is exactly what you want to hear about.
 */

import { expect, test, type Page } from "@playwright/test";
import { ROUTES } from "./surface";

/**
 * Body text that means "this page has nothing", whatever the HTTP status claimed.
 *
 * Matched against rendered text, not markup, so it survives a redesign of the venue's
 * error page. Kept deliberately narrow: broad patterns like /error/ match legitimate pages
 * that merely mention the word.
 */
const SOFT_404 = [
  /transaction not found/i,
  /\bnot found\b/i,
  /doesn't exist|does not exist/i,
  /no results? found/i,
  /page you (are|were) looking for/i,
  // mayascan renders a missing transaction as "Oops,"; without this every dead Maya link would
  // read as healthy.
  /\boops\b/i,
];

/** Every outbound href the site renders — the exact inverse of the internal crawl. */
async function externalLinks(page: Page): Promise<{ href: string; from: string; text: string }[]> {
  const found: { href: string; from: string; text: string }[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({
          href: a.getAttribute("href") ?? "",
          text: (a.textContent ?? "").trim().slice(0, 60),
        }))
        .filter(({ href }) => /^https?:/i.test(href)),
    );
    for (const link of links) found.push({ ...link, from: route });
  }
  return found;
}

test.describe("outbound links", { tag: "@external" }, () => {
  test("every external link resolves to a real page, not a soft 404", async ({ page }) => {
    // Fixture data carries invented hashes, so a venue will correctly report never having
    // seen them. Only run the resolution half against a build wired to live data.
    test.skip(
      process.env.E2E_LIVE_DATA !== "1",
      "set E2E_LIVE_DATA=1 against a live-data build — fixture hashes 404 legitimately",
    );

    const links = await externalLinks(page);
    const seen = new Map<string, { from: string; text: string }>();
    for (const { href, from, text } of links) if (!seen.has(href)) seen.set(href, { from, text });

    const broken: string[] = [];
    for (const [href, { from, text }] of seen) {
      const response = await page.goto(href, { waitUntil: "networkidle" }).catch(() => null);
      const status = response?.status() ?? 0;
      const body = await page
        .locator("body")
        .innerText()
        .catch(() => "");

      if (status >= 400) {
        broken.push(`${href} -> HTTP ${status} (from ${from}, "${text}")`);
        continue;
      }
      const soft = SOFT_404.find((pattern) => pattern.test(body));
      if (soft) {
        broken.push(`${href} -> HTTP ${status} but the page reads "not found" (from ${from})`);
      }
    }
    expect(broken, `dead outbound links:\n${broken.join("\n")}`).toEqual([]);
  });

  test("the venue explorer still answers the URL shape we build", async ({ page }) => {
    // Runs without live data, because it tests the venue's *contract* rather than our rows:
    // a known-bad key must render its not-found, and the path must not have moved. If the
    // venue reorganises its URLs, `venueTransferUrl` needs updating and this is the signal.
    // A venue that stopped 404ing on a bogus key would mean the check above can no longer
    // tell a dead link from a live one — that is worth failing over too.
    const base = process.env.NEAR_INTENTS_EXPLORER_URL ?? "https://explorer.near-intents.org";

    const root = await page.goto(base, { waitUntil: "networkidle" }).catch(() => null);
    expect(root?.status(), `${base} is unreachable`).toBeLessThan(400);

    await page.goto(`${base}/transactions/${"0".repeat(64)}`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    expect(
      SOFT_404.some((pattern) => pattern.test(body)),
      "the venue no longer reports a bogus transaction as not-found; the soft-404 check above is now blind",
    ).toBe(true);
  });

  test("mayascan still resolves an inbound txID, and still refuses a bogus one", async ({
    page,
  }) => {
    /*
     * Maya links are keyed on the transfer id, which is the swap's inbound txID. Both halves are
     * asserted: if a real hash stops resolving every Maya link is dead, and if a bogus hash stops
     * 404ing the sweep above can no longer tell the two apart.
     *
     * A literal hash: a settled mainnet swap is immutable, and pinning a real one distinguishes
     * "the venue still indexes by this key" from "the venue still serves a page".
     */
    const base = process.env.MAYA_EXPLORER_URL ?? "https://www.mayascan.org";
    const real = "be6edbc1bd972e91775f0c5a3b07ea0975774ca37e5ee232f10ad6150700e2fd";

    await page.goto(`${base}/tx/${real}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const resolved = await page.locator("body").innerText();
    expect(
      SOFT_404.some((pattern) => pattern.test(resolved)),
      "a known-good Maya swap now reads as not-found; every Maya link on the site is dead",
    ).toBe(false);
    expect(resolved, "the resolved page does not look like a transaction").toMatch(/TRANSACTION/i);

    /*
     * Not an all-zeros hash: mayascan renders `0`×64 as a real page rather than a not-found, so it
     * is a useless negative control. A well-formed hash that is not a swap gets the real refusal.
     */
    const bogusHash = "deadbeef".repeat(8);
    await page.goto(`${base}/tx/${bogusHash}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const bogus = await page.locator("body").innerText();
    expect(
      SOFT_404.some((pattern) => pattern.test(bogus)),
      "mayascan no longer reports a bogus transaction as not-found; the soft-404 check is blind to it",
    ).toBe(true);
  });

  test("a zips.z.cash link still resolves to the ZIP it names", async ({ page }) => {
    // /zips links are number-derived (`zipCanonicalUrl`), never a string from the fetched
    // index, so the one thing worth checking live is that the canonical shape still resolves
    // to the ZIP it claims — a literal, well-known number rather than anything from our index.
    const response = await page
      .goto("https://zips.z.cash/zip-0213", { waitUntil: "networkidle" })
      .catch(() => null);
    expect(response?.status(), "zips.z.cash/zip-0213 is unreachable").toBeLessThan(400);
    const body = await page.locator("body").innerText();
    expect(body).toContain("Shielded Coinbase");
  });
});

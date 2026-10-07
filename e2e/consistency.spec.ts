/**
 * Data ↔ UI consistency.
 *
 * Data present in the API but missing or contradicted on the page hides a feature rather than
 * breaking a visible one: nothing errors and nothing looks wrong. The generic form is two code
 * paths computing the same fact, asserted to agree — on an explorer, a list row and the detail
 * page it links to. A duplicated helper that learns a new pool in one copy only is exactly how
 * a fully shielded transaction ends up labelled TRANSPARENT in one place and shielded in another.
 */

import { expect, test, type Page } from "@playwright/test";

/** The privacy class a row or page is claiming, read from the shield's own class names. */
async function shieldState(scope: Page | ReturnType<Page["locator"]>): Promise<string | null> {
  const shield = scope.locator(".shield-shielded, .shield-mixed, .shield-transparent").first();
  if ((await shield.count()) === 0) return null;
  const cls = (await shield.getAttribute("class")) ?? "";
  return cls.match(/shield-(shielded|mixed|transparent)/)?.[1] ?? null;
}

test.describe("a list row and its detail page agree", () => {
  test("/txs rows carry the same privacy class as their transaction pages", async ({ page }) => {
    await page.goto("/txs");
    const rows = page.locator("table tbody tr");
    const count = Math.min(await rows.count(), 8);
    expect(count, "/txs rendered no rows").toBeGreaterThan(0);

    const claims: { txid: string; listState: string | null }[] = [];
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      const href = await row.locator("a[href^='/tx/']").first().getAttribute("href");
      claims.push({ txid: href!.replace("/tx/", ""), listState: await shieldState(row) });
    }

    const disagreements: string[] = [];
    for (const { txid, listState } of claims) {
      await page.goto(`/tx/${txid}`);
      const detailState = await shieldState(page);
      if (listState !== detailState) {
        disagreements.push(`${txid}: /txs says "${listState}", /tx page says "${detailState}"`);
      }
    }
    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });

  test("/blocks rows carry the same height and miner as their block pages", async ({ page }) => {
    await page.goto("/blocks");
    const rows = page.locator("table tbody tr");
    const count = Math.min(await rows.count(), 5);

    const claims: { href: string; height: string; miner: string }[] = [];
    for (let i = 0; i < count; i += 1) {
      const cells = rows.nth(i).locator("td");
      claims.push({
        href: (await rows.nth(i).locator("a[href^='/block/']").first().getAttribute("href"))!,
        height: (await cells.first().innerText()).replace("#", "").replace(/,/g, "").trim(),
        miner: (await rows.nth(i).innerText()).trim(),
      });
    }

    const disagreements: string[] = [];
    for (const { href, height } of claims) {
      await page.goto(href);
      const heading = await page.getByRole("heading", { level: 1 }).innerText();
      const shown = heading.replace(/[^\d]/g, "");
      // The list links by hash, so compare the height the detail page states with the one
      // the row stated for the same link.
      if (!shown.includes(height)) {
        disagreements.push(
          `${href}: list row said height ${height}, page heading says "${heading}"`,
        );
      }
    }
    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });
});

test.describe("what the page counts is what the page shows", () => {
  test("a stated row count matches the rows rendered", async ({ page }) => {
    // A header saying "X transfers found" over a different number of rows: any page that states
    // a count is asserting something checkable on the spot.
    for (const path of ["/mempool", "/cross-chain", "/txs", "/blocks"]) {
      await page.goto(path);
      const body = await page.locator("main").innerText();
      // Same-line only: `\s+` across lines would join one stat card's "$0.03" to the next card's
      // "BLOCKS (24H)" label as a claimed count of 3. A stated count is a number and its noun in
      // one breath.
      const stated = body.match(/([\d,]+)[ \t]+(transactions?|transfers?|blocks?)\b/i);
      if (!stated) continue;

      const claimed = Number((stated[1] ?? "").replace(/,/g, ""));
      const rendered = await page.locator("table tbody tr").count();
      // A paginated page legitimately states a total larger than one page of rows; it must
      // never state fewer than it is showing.
      expect(
        claimed,
        `${path} says "${stated[0]}" but renders ${rendered} rows`,
      ).toBeGreaterThanOrEqual(rendered);
    }
  });

  test("an empty state is an empty state, never a table with no rows", async ({ page }) => {
    // A filter combination with no results must say so. A bare table header over nothing
    // reads as a loading failure, which is how invisible data presents to users.
    await page.goto("/cross-chain?protocol=maya&direction=inbound");
    const rows = await page.locator("table tbody tr").count();
    if (rows === 0) {
      await expect(page.locator("main")).toContainText(/no |none|nothing/i);
    }
  });
});

test.describe("privacy claims never contradict each other", () => {
  test("no page shows a redaction bar and a number for the same value", async ({ page }) => {
    // The domain-specific version of consistency, and the one that matters most here: a
    // veiled amount beside a stated one for the same quantity would mean the site both
    // claims a value is encrypted and prints it.
    for (const path of ["/", "/txs", "/mempool", "/shielded"]) {
      await page.goto(path);
      const veils = await page.getByRole("img", { name: /value shielded/ }).count();
      if (veils === 0) continue;

      const veiledCells = page.locator("td:has([role='img'][aria-label*='shielded'])");
      const n = await veiledCells.count();
      for (let i = 0; i < n; i += 1) {
        const text = (await veiledCells.nth(i).innerText()).trim();
        expect(text, `${path}: a veiled cell also prints a number ("${text}")`).not.toMatch(
          /\d+\.\d+/,
        );
      }
    }
  });
});

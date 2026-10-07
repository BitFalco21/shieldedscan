/**
 * Pagination algebra.
 *
 * A bare-id cursor compared against a non-unique `timestamp` sort returns an arbitrary slice on
 * every page past the first, and nothing on screen looks wrong. The invariant catches it
 * without knowing anything about cursors: walk the list, and the rows must form a strictly
 * ordered sequence with no repeats and no omissions.
 */

import { expect, test, type Page } from "@playwright/test";

const PAGES_TO_WALK = 4;

/**
 * The lists that paginate, each with the route prefix its own rows link to. The detail
 * prefix is not derivable from the list path — `/blocks` rows link to `/block/…` — so it
 * is stated rather than guessed.
 */
const LISTS = [
  { path: "/blocks", detail: "/block/" },
  { path: "/txs", detail: "/tx/" },
  { path: "/cross-chain", detail: "/cross-chain/" },
  // Keyset, served from the chain index; rows link to /tx/.
  { path: "/address/t1XWk29dAliceFixtureAddr000001", detail: "/tx/" },
] as const;

/**
 * A stable identity per row.
 *
 * 1. Not the rendered text. Hashes display elided (`cb248103…00000000`), so two different
 *    transactions can render an identical label — keying on what the reader sees invents
 *    duplicates and conceals real ones.
 * 2. Not simply the first link. A `/cross-chain` row links out to the addresses on both legs
 *    before it links to itself, and the same vault address appears on many transfers. The row's
 *    identity is the link back into the list's own section.
 */
async function rowKeys(page: Page, detailPrefix: string): Promise<string[]> {
  return page.locator("table tbody tr").evaluateAll(
    (rows, sectionPrefix) =>
      rows
        .map((row) => {
          const hrefs = Array.from(row.querySelectorAll("a[href]"), (a) =>
            a.getAttribute("href"),
          ).filter((h): h is string => h !== null);
          const own = hrefs.find((h) => h.startsWith(sectionPrefix));
          return own ?? hrefs[0] ?? row.querySelector("td")?.textContent?.trim() ?? "";
        })
        .filter((key) => key !== ""),
    detailPrefix,
  );
}

/** The first cell's text, for the lists whose sort key is displayed literally. */
async function rowLabels(page: Page): Promise<string[]> {
  return page
    .locator("table tbody tr")
    .evaluateAll((rows) => rows.map((r) => r.querySelector("td")?.textContent?.trim() ?? ""));
}

async function clickOlder(page: Page, detailPrefix: string): Promise<boolean> {
  const older = page.getByRole("link", { name: "Older page" });
  if ((await older.count()) === 0) return false;
  const before = (await rowKeys(page, detailPrefix))[0];
  await older.click();
  await expect
    .poll(async () => (await rowKeys(page, detailPrefix))[0], { timeout: 10_000 })
    .not.toBe(before);
  return true;
}

test.describe("walking a list never repeats or skips a row", () => {
  for (const { path, detail } of LISTS) {
    test(`${path} pages forward cleanly`, async ({ page }) => {
      await page.goto(path);
      const seen: string[] = [];

      for (let i = 0; i < PAGES_TO_WALK; i += 1) {
        const keys = await rowKeys(page, detail);
        expect(keys.length, `${path} page ${i + 1} rendered no rows`).toBeGreaterThan(0);
        seen.push(...keys);
        if (!(await clickOlder(page, detail))) break;
      }

      // A cursor that seeks on the wrong key re-serves rows it already showed.
      const duplicates = seen.filter((key, i) => seen.indexOf(key) !== i);
      expect(duplicates, `${path} served the same row twice: ${duplicates.join(", ")}`).toEqual([]);
    });
  }

  test("/blocks heights are strictly descending and contiguous across pages", async ({ page }) => {
    // Heights are dense, so this list has a stronger invariant available than the others:
    // any gap is a skipped block, and a skipped block is a page the reader can never reach.
    await page.goto("/blocks");
    const heights: number[] = [];

    for (let i = 0; i < PAGES_TO_WALK; i += 1) {
      const labels = await rowLabels(page);
      heights.push(...labels.map((k) => Number(k.replace("#", "").replace(/,/g, ""))));
      if (!(await clickOlder(page, "/block/"))) break;
    }

    expect(heights.every(Number.isFinite), "a height cell did not parse as a number").toBe(true);
    for (let i = 1; i < heights.length; i += 1) {
      const [previous, current] = [heights[i - 1] ?? NaN, heights[i] ?? NaN];
      expect(current, `height ${current} follows ${previous} — the list is not contiguous`).toBe(
        previous - 1,
      );
    }
  });

  test("paging forward then back returns the identical page", async ({ page }) => {
    // The round-trip property. An off-by-one in the cursor's boundary handling shows up
    // here and nowhere else: forward-then-back lands one row off, silently.
    for (const { path, detail } of LISTS) {
      await page.goto(path);
      const original = await rowKeys(page, detail);

      if (!(await clickOlder(page, detail))) continue;
      await page.getByRole("link", { name: "Newer page" }).click();
      await expect(page).toHaveURL(/after=/);

      expect(await rowKeys(page, detail), `${path} did not return to the same page`).toEqual(
        original,
      );
    }
  });

  test("both ends are reachable in one hop, and the ends really are the ends", async ({ page }) => {
    for (const { path, detail } of LISTS) {
      await page.goto(path);
      const head = await rowKeys(page, detail);

      const last = page.getByRole("link", { name: "Last page — oldest" });
      if ((await last.count()) === 0) continue;
      await last.click();
      await expect(page).toHaveURL(/after=/);

      // Nothing older than the oldest page.
      await expect(
        page.getByRole("link", { name: "Older page" }),
        `${path} offers an older page from the last page`,
      ).toHaveCount(0);
      const oldest = await rowKeys(page, detail);
      expect(oldest.length, `${path} last page is empty`).toBeGreaterThan(0);
      expect(oldest, `${path} last page is the same as the first`).not.toEqual(head);

      await page.getByRole("link", { name: "First page — newest" }).click();
      // Wait on the URL, not the click: these are client-side navigations, so reading the
      // table immediately races the render and returns the page we were leaving.
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect
        .poll(async () => (await rowKeys(page, detail))[0], { timeout: 10_000 })
        .toBe(head[0]);
      expect(await rowKeys(page, detail), `${path} did not return to the head`).toEqual(head);
      // And nothing newer than the newest.
      await expect(
        page.getByRole("link", { name: "Newer page" }),
        `${path} offers a newer page from the head`,
      ).toHaveCount(0);
    }
  });

  test("a tampered cursor is refused, never served as an arbitrary slice", async ({ page }) => {
    // A cursor is opaque above `data/`, so a hand-edited one must not silently decode into a
    // different position. Either the designed first page or a not-found is fine; a random
    // slice presented as page N is not.
    for (const path of [
      "/blocks?before=garbage",
      "/txs?before=%00%01",
      "/cross-chain?after=zzzz",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} produced a server error`).toBeLessThan(500);
      await expect(page.locator("main")).toBeVisible();
    }
  });
});

test.describe("offset-paginated pages", () => {
  // `/mempool` is the offset-paged list — a bounded snapshot, so its x-of-y is honest.
  const OFFSET_PAGES = ["/mempool"];

  for (const path of OFFSET_PAGES) {
    test(`${path} states an honest page count`, async ({ page }) => {
      await page.goto(path);
      const text = await page.locator("main").innerText();
      const label = text.match(/page\s+(\d+)\s+of\s+(\d+)/i);
      if (!label) return;
      const [current, total] = [Number(label[1]), Number(label[2])];
      expect(current, `${path} says page ${current} of ${total}`).toBeLessThanOrEqual(total);
      expect(current).toBeGreaterThan(0);
    });

    test(`${path} clamps a page number past the end`, async ({ page }) => {
      // A request for page 9999 must land on the last real page, not an empty table with
      // pagination controls implying more.
      await page.goto(`${path}${path.includes("?") ? "&" : "?"}page=9999`);
      await expect(page.locator("main")).toBeVisible();
      const rows = await page.locator("table tbody tr").count();
      if (rows === 0) {
        await expect(page.locator("main")).toContainText(/no |none|nothing/i);
      }
    });

    test(`${path} shows no row twice across its pages`, async ({ page }) => {
      await page.goto(path);
      const seen: string[] = [];
      for (let i = 1; i <= 3; i += 1) {
        const keys = await page
          .locator("table tbody tr")
          .evaluateAll((rows) =>
            rows.map(
              (r) =>
                r.querySelector("a[href]")?.getAttribute("href") ??
                r.querySelector("td")?.textContent?.trim() ??
                "",
            ),
          );
        if (keys.length === 0) break;
        seen.push(...keys.filter((k) => k !== ""));
        const next = page.getByRole("link", { name: /next/i });
        if ((await next.count()) === 0) break;
        await next.first().click();
        await expect(page.locator("main")).toBeVisible();
      }
      const duplicates = seen.filter((key, i) => seen.indexOf(key) !== i);
      expect(duplicates, `${path} repeated: ${duplicates.join(", ")}`).toEqual([]);
    });
  }
});

/**
 * Detail pages — the invariants that only hold if the page understood its own data.
 *
 * List pages are easy to test because a row is a row. A detail page states derived facts —
 * a miner, a fee, a privacy class, a neighbouring block — and each of those is a claim that
 * can be checked against something else on the same page or against the chain's own rules.
 *
 * Prev/next navigation gets particular attention because its two boundaries are where
 * explorers break: the tip has no next, the oldest block has no previous, and both are easy
 * to render as a link that goes nowhere.
 */

import { expect, test, type Page } from "@playwright/test";
import { MEMPOOL_TXID, SHIELDED_TXID, TIP_HEIGHT, TRANSPARENT_ADDR } from "./surface";

const mainText = (page: Page) => page.locator("main").innerText();

test.describe("block detail", () => {
  test("the heading names the height the URL asked for", async ({ page }) => {
    await page.goto(`/block/${TIP_HEIGHT}`);
    const heading = await page.getByRole("heading", { level: 1 }).innerText();
    expect(heading.replace(/[^\d]/g, "")).toContain(String(TIP_HEIGHT));
  });

  test("a block is reachable by hash and by height, and they agree", async ({ page }) => {
    // Two routes into the same row. If they disagree, one of them is looking up the wrong
    // block — the kind of thing that stays invisible until someone shares a link.
    await page.goto(`/block/${TIP_HEIGHT}`);
    const byHeight = await mainText(page);

    // Taken from an href the page offers as a block, not from the first 64-hex `title` on the
    // page: a block page is full of 64-hex values that are not block hashes — the merkle root,
    // every txid. The /blocks list links each row by hash, so that is the reliable source.
    await page.goto("/blocks");
    const hashLink = await page
      .locator("a[href^='/block/']")
      .evaluateAll((els) =>
        els
          .map((el) => (el.getAttribute("href") ?? "").replace("/block/", ""))
          .find((v) => /^[0-9a-f]{64}$/.test(v)),
      );
    if (!hashLink) return;

    await page.goto(`/block/${hashLink}`);
    const byHash = await mainText(page);
    // Compare the height line rather than the whole page: relative times ("18d ago") drift.
    expect(byHash).toContain(String(TIP_HEIGHT).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
    expect(byHeight).toContain(String(TIP_HEIGHT).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  });

  test("the tip has no next-block link", async ({ page }) => {
    // There is no block after the tip. A link to one is a promise the chain cannot keep.
    await page.goto(`/block/${TIP_HEIGHT}`);
    const nextHref = await page.locator(`a[href='/block/${TIP_HEIGHT + 1}']`).count();
    expect(nextHref, "the tip links to a block that does not exist").toBe(0);
  });

  test("prev/next actually move one block, in the right direction", async ({ page }) => {
    await page.goto(`/block/${TIP_HEIGHT}`);
    const prev = page.locator(`a[href='/block/${TIP_HEIGHT - 1}']`);
    if ((await prev.count()) === 0) return;
    await prev.first().click();
    await expect(page).toHaveURL(new RegExp(`/block/${TIP_HEIGHT - 1}$`));
    const heading = await page.getByRole("heading", { level: 1 }).innerText();
    expect(heading.replace(/[^\d]/g, "")).toContain(String(TIP_HEIGHT - 1));
  });

  test("the stated transaction count matches the transactions listed", async ({ page }) => {
    // One number on the page describing another thing on the same page. If the block header
    // says 4 and four rows render, the page understood its own data.
    await page.goto(`/block/${TIP_HEIGHT}`);
    const text = await mainText(page);
    const stated = text.match(/\bTXS?\b[\s\S]{0,20}?(\d[\d,]*)/i);
    if (!stated?.[1]) return;
    const claimed = Number(stated[1].replace(/,/g, ""));
    const rows = await page.locator("table tbody tr").count();
    if (rows === 0) return;
    expect(rows, `header says ${claimed} transactions, ${rows} rows rendered`).toBe(claimed);
  });

  test("the miner is a transparent address or an honest 'shielded'", async ({ page }) => {
    // Zcash has no miner field; it is derived from the coinbase. A coinbase carrying a
    // shielded bundle must say shielded rather than naming a funding stream as the miner.
    await page.goto(`/block/${TIP_HEIGHT}`);
    const text = await mainText(page);
    const miner = text.match(/MINER[\s\S]{0,60}/i)?.[0] ?? "";
    expect(
      /t[13][a-zA-Z0-9]{6,}|shielded|unknown/i.test(miner),
      `MINER reads "${miner.replace(/\s+/g, " ")}"`,
    ).toBe(true);
  });
});

test.describe("transaction detail", () => {
  test("the heading is the txid the URL asked for", async ({ page }) => {
    await page.goto(`/tx/${SHIELDED_TXID}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(SHIELDED_TXID.slice(0, 8));
  });

  test("a confirmed transaction links to the block that contains it", async ({ page }) => {
    await page.goto(`/tx/${SHIELDED_TXID}`);
    const blockLinks = await page.locator("a[href^='/block/']").count();
    expect(blockLinks, "a confirmed transaction does not link to its block").toBeGreaterThan(0);
  });

  test("a mempool transaction has no block link and says it is unconfirmed", async ({ page }) => {
    // `blockHeight` is null in the mempool. A page that linked to a block would be inventing
    // one, and a confirmation count would be inventing that too.
    await page.goto(`/tx/${MEMPOOL_TXID}`);
    await expect(page.getByText("Unconfirmed — in the mempool")).toBeVisible();
    await expect(page.locator("a[href^='/block/']")).toHaveCount(0);
  });

  test("the pools named in the summary are the pools shown as badges", async ({ page }) => {
    // Two renderings of the same fact. Drift here would make a private transaction read as
    // transparent.
    await page.goto(`/tx/${SHIELDED_TXID}`);
    const text = await mainText(page);
    const badges = await page
      .locator(".shield-shielded, .shield-mixed, .shield-transparent")
      .count();
    expect(badges, "no privacy indicator on a transaction page").toBeGreaterThan(0);
    // A page carrying a veil must not also describe itself as transparent.
    const veiled = await page.getByRole("img", { name: /value shielded/ }).count();
    if (veiled > 0) {
      expect(text, "a veiled transaction is labelled TRANSPARENT").not.toMatch(
        /TRANSPARENT — no standard-addressed outputs/,
      );
    }
  });
});

test.describe("address detail", () => {
  test("the heading is the address, in full and unelided", async ({ page }) => {
    // An address page whose title is truncated cannot be checked against what the visitor
    // pasted, which is the one thing they came to do.
    await page.goto(`/address/${TRANSPARENT_ADDR}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(TRANSPARENT_ADDR);
  });

  test("every listed transaction actually names this address", async ({ page }) => {
    // The strongest invariant available here: a row on an address page that does not involve
    // the address is a query bug, and it would look completely normal.
    await page.goto(`/address/${TRANSPARENT_ADDR}`);
    const rows = page.locator("table tbody tr");
    const count = Math.min(await rows.count(), 6);
    expect(count).toBeGreaterThan(0);

    const txids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const href = await rows.nth(i).locator("a[href^='/tx/']").first().getAttribute("href");
      if (href) txids.push(href.replace("/tx/", ""));
    }

    const missing: string[] = [];
    for (const txid of txids) {
      await page.goto(`/tx/${txid}`);
      const text = await mainText(page);
      // Either side may carry it, and it may be elided in a link — the title attribute
      // holds the full value, so check both.
      const titles = await page
        .locator("[title]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("title") ?? "").join(" "));
      if (!text.includes(TRANSPARENT_ADDR) && !titles.includes(TRANSPARENT_ADDR)) {
        missing.push(txid);
      }
    }
    expect(
      missing,
      `transactions listed on the address page that never mention it: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("the NET column is signed and never blank", async ({ page }) => {
    // Net change is arithmetic, not inference, so it is always knowable for a transparent
    // address. A blank cell here would mean the calculation failed silently.
    await page.goto(`/address/${TRANSPARENT_ADDR}`);
    // The column index is derived from the header, not hardcoded, so removing a column does not
    // silently retarget the assertion.
    const headers = await page.locator("table th").allTextContents();
    const netIndex = headers.findIndex((h) => h.trim() === "NET");
    expect(netIndex, `no NET column in ${headers.join("|")}`).toBeGreaterThanOrEqual(0);
    const rows = page.locator("table tbody tr");
    const count = await rows.count();
    for (let i = 0; i < Math.min(count, 10); i += 1) {
      const cells = rows.nth(i).locator("td");
      const netCell = (await cells.nth(netIndex).innerText()).trim();
      expect(netCell, `row ${i + 1} has an empty NET cell`).not.toBe("");
      expect(netCell, `row ${i + 1} NET reads "${netCell}"`).toMatch(/^[+−-]?[\d,]|^0$/);
    }
  });
});

test.describe("cross-chain detail", () => {
  test("both legs render with a chain and an amount", async ({ page }) => {
    await page.goto("/cross-chain/thor-8842");
    const text = await mainText(page);
    expect(text).toMatch(/ZEC/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("an unidentified token is labelled, never given the chain's ticker", async ({ page }) => {
    // A venue that never published a ticker gets a label. Calling an SPL token "SOL" would
    // be a confident lie about what moved.
    await page.goto("/cross-chain");
    const text = await mainText(page);
    for (const match of text.matchAll(/([A-Z]+)\s+asset\b/g)) {
      // The row says "<CHAIN> asset" — it must also say it is unidentified somewhere.
      expect(text, `"${match[0]}" appears without an unidentified-token note`).toMatch(
        /unidentified/i,
      );
    }
  });
});

test.describe("the flow arrow follows the reading direction", () => {
  test("points down where the panels stack, right where they sit side by side", async ({
    page,
  }) => {
    // The panels are flex-col until `lg`, so on a phone the reader scrolls down between the two
    // sides and the arrow must point down.
    //
    // Asserted on the CSS `rotate` property, not `transform`: Tailwind v4 emits the individual
    // rotate property, so a `transform` check reports "none" and passes whatever the class does.
    await page.goto("/txs");
    const href = await page.locator('tbody tr a[href^="/tx/"]').first().getAttribute("href");
    if (!href) test.skip(true, "no transaction rows to open");

    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(href!);
    const arrow = page.locator('span:text-is("⇒")').first();
    if ((await arrow.count()) === 0) test.skip(true, "this transaction has a single-sided flow");

    expect(await arrow.evaluate((el) => getComputedStyle(el).rotate)).toBe("90deg");
    // And the layout it is describing really is stacked.
    const panels = await page
      .locator("main .panel")
      .evaluateAll((els) => els.slice(0, 2).map((e) => e.getBoundingClientRect().y));
    expect(panels[1]).toBeGreaterThan(panels[0]!);

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(href!);
    expect(await arrow.evaluate((el) => getComputedStyle(el).rotate)).toBe("none");
  });
});

test.describe("a transaction row states each fact once", () => {
  test("TYPE names what happened and DIRECTION names where, on every list", async ({ page }) => {
    /*
     * TYPE and DIRECTION must answer different questions: the word is a kind, the cell beside it
     * is a path. FLOW stays retired as a label — the word now lives in TYPE.
     */
    for (const route of [
      "/txs",
      "/mempool",
      `/block/${TIP_HEIGHT}`,
      `/address/${TRANSPARENT_ADDR}`,
    ]) {
      await page.goto(route);
      const headers = (await page.locator("thead th").allTextContents()).map((h) => h.trim());
      expect(headers, `${route} lost its TYPE column`).toContain("TYPE");
      expect(headers, `${route} lost its DIRECTION column`).toContain("DIRECTION");
      expect(headers, `${route} still has a FLOW column`).not.toContain("FLOW");

      const type = headers.indexOf("TYPE");
      const direction = headers.indexOf("DIRECTION");
      const rows = page.locator("tbody tr");
      const count = Math.min(await rows.count(), 10);
      expect(count, `${route} rendered no rows to check`).toBeGreaterThan(0);

      for (let i = 0; i < count; i += 1) {
        const cells = rows.nth(i);
        /*
         * `innerText`, not `textContent`: the shield carries an SVG <title> saying "fully
         * shielded", which is a label for a screen reader rather than a word in the cell, and
         * reading it as one makes every TYPE value unrecognisable. Lowercased because the
         * chips are uppercased in CSS, which `innerText` reflects and the markup does not.
         */
        const kind = (
          await cells
            .locator("td")
            .nth(type)
            .evaluate((el: HTMLElement) => el.innerText)
        ).trim();
        const path = (
          await cells
            .locator("td")
            .nth(direction)
            .evaluate((el: HTMLElement) => el.innerText)
        )
          .trim()
          .toLowerCase();

        // One kind per row, from a closed vocabulary — never a pool name, which is the
        // other column's job.
        expect(
          ["COINBASE", "TRANSPARENT", "SHIELDING", "UNSHIELDING", "SHIELDED", "MIXED"],
          `${route} row ${i} has an unknown TYPE "${kind}"`,
        ).toContain(kind);

        // A coinbase's source end is MINED: `coinbase` there would repeat the pill's own word.
        if (kind === "COINBASE") {
          expect(path, `${route} row ${i} repeats COINBASE in DIRECTION`).not.toContain("coinbase");
          expect(path, `${route} row ${i} has no source end`).toContain("mined");
        }

        expect(path, `${route} row ${i} has an empty DIRECTION cell`).not.toBe("");
      }
    }
  });
});

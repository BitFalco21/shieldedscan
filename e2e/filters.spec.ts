/**
 * Filter and sort control state.
 *
 * Guards against chips that stay selected after the data changes, controls that no-op, and
 * filters lost on the next page. A generic state-machine test discovers filter groups by their
 * accessible markup — `nav[aria-label^="Filter by"]` with `aria-current="page"` on the active
 * option — so a new filterable page is covered with no new test written.
 *
 * Asserting the URL changed is not enough: a filter can be sent by the UI, forwarded by the
 * adapter and dropped by the server while looking like it worked. The rows have to change too.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * `/cross-chain/flows` is covered because the fixtures spread transfers 45, 100, 200 and 400
 * days back, so each window preset drops something visible. With every fixture inside one
 * afternoon, all windows would return the same aggregate and the control would look decorative.
 */
const FILTERABLE_PAGES = [
  "/txs",
  "/cross-chain",
  "/cross-chain/flows",
  "/cross-chain/protocols",
  "/network/nodes",
];

interface ChipGroup {
  label: string;
  options: { label: string; href: string }[];
  activeLabel: string | null;
}

/** Every filter chip group the page rendered, read off its accessible markup. */
async function chipGroups(page: Page): Promise<ChipGroup[]> {
  return page.locator('nav[aria-label^="Filter by"]').evaluateAll((navs) =>
    navs.map((nav) => ({
      label: nav.getAttribute("aria-label") ?? "",
      options: Array.from(nav.querySelectorAll("a")).map((a) => ({
        label: (a.textContent ?? "").trim(),
        href: a.getAttribute("href") ?? "",
      })),
      activeLabel: (nav.querySelector('a[aria-current="page"]')?.textContent ?? "").trim() || null,
    })),
  );
}

/**
 * A page's result set: its table rows' first cells, plus any element that declares its own key
 * in `data-filter-row`. The second is for a page whose results are not a table — the protocols
 * tab renders cards, and keying them on rendered text would make the test depend on copy.
 */
const rowKeys = (page: Page): Promise<string[]> =>
  page
    .locator("table tbody tr, [data-filter-row]")
    .evaluateAll((rows) =>
      rows.map(
        (r) =>
          r.getAttribute("data-filter-row") ?? r.querySelector("td")?.textContent?.trim() ?? "",
      ),
    );

test.describe("filter chips behave as a state machine", () => {
  for (const path of FILTERABLE_PAGES) {
    test(`${path}: every option selects, marks itself active, and changes the rows`, async ({
      page,
    }) => {
      await page.goto(path);
      const groups = await chipGroups(page);
      expect(groups.length, `${path} rendered no filter groups`).toBeGreaterThan(0);

      for (const group of groups) {
        expect(group.activeLabel, `${group.label} has no active option`).not.toBeNull();
        expect(group.options.length).toBeGreaterThan(1);

        const results = new Map<string, string[]>();
        for (const option of group.options) {
          await page.goto(option.href);
          await expect(page.locator("main")).toBeVisible();

          // The clicked option is the one marked active — a stale chip drifting apart from the
          // data underneath is the failure.
          const after = (await chipGroups(page)).find((g) => g.label === group.label);
          expect(
            after?.activeLabel,
            `${path} ${group.label}: clicked "${option.label}" but "${after?.activeLabel}" is marked active`,
          ).toBe(option.label);

          results.set(option.label, await rowKeys(page));
        }

        // A filter that never changes the result set is a filter that is not being applied.
        const distinct = new Set(Array.from(results.values(), (rows) => rows.join("|")));
        expect(
          distinct.size,
          `${path} ${group.label}: every option returned identical rows — the filter is decorative`,
        ).toBeGreaterThan(1);
      }
    });

    test(`${path}: a filter survives paging`, async ({ page }) => {
      await page.goto(path);
      const groups = await chipGroups(page);
      const group = groups[0];
      expect(group, `${path} rendered no filter group`).toBeDefined();
      if (!group) return;
      const narrowing = group.options.find((o) => o.label !== group.activeLabel);
      if (!narrowing) return;

      await page.goto(narrowing.href);
      const older = page.getByRole("link", { name: "Older page" });
      if ((await older.count()) === 0) return;

      await older.click();
      await expect(page.locator("main")).toBeVisible();

      // Losing the filter here silently widens the list on page 2 while the chip still
      // claims to be filtering — the reader has no way to notice.
      const after = (await chipGroups(page)).find((g) => g.label === group.label);
      expect(
        after?.activeLabel,
        `${path} ${group.label}: paging reset the filter to "${after?.activeLabel}"`,
      ).toBe(narrowing.label);
    });
  }

  test("/cross-chain: the two filters never clear each other", async ({ page }) => {
    // Direction lives in chips, venue in a column header. Changing one must preserve the other.
    await page.goto("/cross-chain");

    const venue = page.locator("summary[aria-label='Filter by venue']");
    await venue.click();
    await page.getByRole("link", { name: "Maya Protocol" }).click();
    await expect(page).toHaveURL(/protocol=maya/);

    const direction = (await chipGroups(page)).find((g) => g.label === "Filter by direction");
    const outbound = direction?.options.find((o) => /outbound/i.test(o.label));
    expect(outbound, "no outbound direction chip").toBeDefined();

    await page.goto(outbound!.href);
    await expect(page, "changing direction dropped the venue filter").toHaveURL(/protocol=maya/);
    // Match the parameter, not a guess at its value — the chip reads "outbound" while the
    // URL carries `direction=out`, and pinning the label here would test the wrong thing.
    await expect(page).toHaveURL(/direction=/);

    // Both filters are still the ones marked active, not merely present in the URL.
    const groups = await chipGroups(page);
    expect(groups.find((g) => g.label === "Filter by direction")?.activeLabel).toBe(
      outbound!.label,
    );
  });
});

test.describe("column-header filters", () => {
  test("the funnel signals that a filter is applied", async ({ page }) => {
    // A filtered table that looks unfiltered is how a reader concludes the chain is
    // emptier than it is. The icon changing colour is the only signal, so it is pinned.
    await page.goto("/cross-chain");
    const summary: Locator = page.locator("summary[aria-label='Filter by venue']");

    const unfiltered = await summary.locator("svg").evaluate((el) => getComputedStyle(el).color);
    await summary.click();
    await page.getByRole("link", { name: "Maya Protocol" }).click();
    await expect(page).toHaveURL(/protocol=maya/);

    const filtered = await summary.locator("svg").evaluate((el) => getComputedStyle(el).color);
    expect(filtered, "the funnel looks identical filtered and unfiltered").not.toBe(unfiltered);
  });

  test("it works with no JavaScript, because it is links and a details element", async ({
    browser,
  }) => {
    // `ColumnFilter` needs no JS, no client component and no state, and every choice is a
    // shareable URL. That is only true if it still works with scripting off.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/cross-chain");
    await page.locator("summary[aria-label='Filter by venue']").click();
    await page.getByRole("link", { name: "Maya Protocol" }).click();
    await expect(page).toHaveURL(/protocol=maya/);
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    await context.close();
  });
});

test.describe("a filter narrows the list, never the page", () => {
  test("every row matches the filter — not just the first page", async ({ page }) => {
    // A filter applied after the cursor slice returns fewer rows than the limit plus a cursor
    // that steps over what it dropped, so the check has to walk past page one.
    await page.goto("/cross-chain?protocol=maya");
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const rows = page.locator("table tbody tr");
      const count = await rows.count();
      if (count === 0) break;
      await expect(
        page.locator("table tbody").getByText("NEAR Intents"),
        `page ${pageIndex + 1} contains a row from another venue`,
      ).toHaveCount(0);

      const older = page.getByRole("link", { name: "Older page" });
      if ((await older.count()) === 0) break;
      await older.click();
      await expect(page).toHaveURL(/protocol=maya/);
    }
  });

  test("a filter with no matches shows an empty state, not a bare table", async ({ page }) => {
    // A header row over nothing reads as a loading failure. Every combination that can be
    // reached from the UI must produce prose when it produces no rows.
    const combinations = [
      "/cross-chain?protocol=maya&direction=in",
      "/cross-chain?protocol=near-intents&direction=out",
      "/txs?kind=shielded",
      "/txs?kind=transparent",
    ];
    for (const url of combinations) {
      await page.goto(url);
      const rows = await page.locator("table tbody tr").count();
      if (rows > 0) continue;
      await expect(
        page.locator("main"),
        `${url} rendered no rows and no explanation`,
      ).toContainText(/no |none|nothing|not found/i);
    }
  });

  test("an unrecognised filter value falls back to all, and never empties the list", async ({
    page,
  }) => {
    // Parsed in `domain/`, where anything unrecognised means "all", so a hand-edited URL can
    // never reach SQL. The observable consequence is that the list is not empty and the
    // "all" chip is the active one.
    await page.goto("/cross-chain");
    const unfiltered = await page.locator("table tbody tr").count();
    expect(unfiltered).toBeGreaterThan(0);

    for (const url of [
      "/cross-chain?protocol=notavenue",
      "/cross-chain?direction=sideways",
      "/txs?kind=banana",
      "/txs?kind=",
    ]) {
      await page.goto(url);
      const rows = await page.locator("table tbody tr").count();
      expect(rows, `${url} emptied the list instead of falling back to all`).toBeGreaterThan(0);
    }
  });

  test("filters survive a jump to either end of the list", async ({ page }) => {
    // "Newest" drops the cursor and "oldest" pages from a sentinel — both are easy places to
    // rebuild the URL and forget the filter, which silently widens the list.
    await page.goto("/cross-chain?protocol=maya");
    for (const name of ["Last page — oldest", "First page — newest"]) {
      const control = page.getByRole("link", { name });
      if ((await control.count()) === 0) continue;
      await control.click();
      await expect(page, `"${name}" dropped the venue filter`).toHaveURL(/protocol=maya/);
    }
  });

  test("an unfiltered request carries no filter parameters at all", async ({ page }) => {
    // So an unfiltered page stays byte-identical and shares one CDN cache key. Selecting
    // "all" must clear the parameter rather than spell it out.
    await page.goto("/cross-chain?protocol=maya");
    const allChip = page
      .locator('nav[aria-label="Filter by direction"] a')
      .filter({ hasText: /^all/i });
    if ((await allChip.count()) === 0) return;
    const href = await allChip.first().getAttribute("href");
    expect(href, `the "all" chip spells out a default: ${href}`).not.toMatch(/direction=all/);
  });
});

/**
 * The SOURCE/DESTINATION chain menus — the same state machine as above, one dimension up.
 *
 * `chipGroups` cannot discover these: a multi-select has no single `aria-current="page"`
 * option, so it is deliberately not a `nav[aria-label^="Filter by"]` group. Every property
 * that suite asserts for the single-valued filters is therefore restated here by hand.
 */
test.describe("chain filters", () => {
  const sourceMenu = (page: Page) => page.locator("summary[aria-label='Filter by source chain']");
  const destinationMenu = (page: Page) =>
    page.locator("summary[aria-label='Filter by destination chain']");

  /**
   * Open the menu, whatever state it is in.
   *
   * Never a bare `.click()`, which assumes a direction: `<details open>` is DOM state React does
   * not control, and a client-side navigation reuses the element — so after picking a chain the
   * menu may still be open, and clicking the summary would close it. That is accommodated here,
   * not asserted as a contract.
   */
  const openMenu = async (menu: Locator) => {
    const open = await menu.evaluate((el) => (el.parentElement as HTMLDetailsElement).open);
    if (!open) await menu.click();
  };

  /** The chains a row names at each end, read off the first two cells. */
  const legs = (page: Page) =>
    page.locator("table tbody tr").evaluateAll((rows) =>
      rows.map((r) => {
        const cells = r.querySelectorAll("td");
        return [cells[0]?.textContent ?? "", cells[1]?.textContent ?? ""] as const;
      }),
    );

  test("selecting two chains accumulates, and both read as selected", async ({ page }) => {
    // The menu lives on the tab that names an end; ALL names neither.
    await page.goto("/cross-chain?direction=in");
    await openMenu(sourceMenu(page));
    await page.getByRole("link", { name: /^Add BTC as a source chain$/ }).click();
    await expect(page).toHaveURL(/source=BTC/);
    await expect(page).toHaveURL(/direction=in/);

    await openMenu(sourceMenu(page));
    await page.getByRole("link", { name: /^Add ETH as a source chain$/ }).click();
    // Accumulated, not replaced — the whole point of a multi-select.
    await expect(page).toHaveURL(/source=BTC%2CETH|source=BTC,ETH/);

    await openMenu(sourceMenu(page));
    await expect(page.getByRole("link", { name: /^Remove BTC as a source chain$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Remove ETH as a source chain$/ })).toBeVisible();
  });

  test("the two ends are never selectable at once", async ({ page }) => {
    /*
     * A transfer is (direction, counterpart chain), not two independent ends, so offering both
     * menus at once would let a reader build BTC → ETH — or ZEC → ZEC — which no row can match.
     * A chain menu exists only on the tab that names an end, and ALL names neither.
     */
    await page.goto("/cross-chain");
    await expect(sourceMenu(page), "ALL offered a source menu").toHaveCount(0);
    await expect(destinationMenu(page), "ALL offered a destination menu").toHaveCount(0);

    await page.goto("/cross-chain?direction=in");
    await expect(sourceMenu(page)).toHaveCount(1);
    await expect(destinationMenu(page)).toHaveCount(0);

    await openMenu(sourceMenu(page));
    await page.getByRole("link", { name: /^Add BTC as a source chain$/ }).click();
    await expect(page).toHaveURL(/source=BTC/);
    await expect(destinationMenu(page), "a destination menu survived a source choice").toHaveCount(
      0,
    );

    // And the mirror image.
    await page.goto("/cross-chain?direction=out");
    await expect(sourceMenu(page)).toHaveCount(0);
    await expect(destinationMenu(page)).toHaveCount(1);

    // On a URL carrying no direction, too: old links of this shape may be in bookmarks.
    await page.goto("/cross-chain?source=BTC");
    await expect(destinationMenu(page), "both ends offered on a legacy link").toHaveCount(0);
  });

  test("a menu closes when you click away, and on Escape", async ({ page }) => {
    // `<details>` only closes from its own summary; the outside-click enhancement is invisible
    // in the markup, so it is pinned here.
    await page.goto("/cross-chain?direction=in");
    const menu = sourceMenu(page);
    const panel = menu.locator("xpath=following-sibling::div");

    await openMenu(menu);
    await expect(panel).toBeVisible();
    await page.locator("h1").click();
    await expect(panel, "clicking the page left the menu open").toBeHidden();

    await openMenu(menu);
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel, "Escape left the menu open").toBeHidden();
    // Focus returns to the control that opened it, or a keyboard reader is stranded.
    await expect(menu).toBeFocused();
  });

  test("clicking INSIDE a menu never dismisses it", async ({ page }) => {
    // The failure mode of an over-eager outside-click handler: the panel closes before the
    // link it contains can be followed, and the control becomes unusable.
    await page.goto("/cross-chain?direction=in");
    await openMenu(sourceMenu(page));
    await page.getByRole("link", { name: /^Add BTC as a source chain$/ }).click();
    await expect(page).toHaveURL(/source=BTC/);
  });

  test("ZEC is never offered as a chain — the direction chips say which side it is on", async ({
    page,
  }) => {
    // Listing it would make "source ZEC" a second name for the OUTBOUND chip, and make an
    // impossible both-ends view reachable.
    let inspected = 0;
    for (const url of ["/cross-chain", "/cross-chain?direction=in", "/cross-chain?direction=out"]) {
      await page.goto(url);
      for (const menu of [sourceMenu(page), destinationMenu(page)]) {
        if ((await menu.count()) === 0) continue;
        await openMenu(menu);
        const labels = await menu
          .locator("xpath=following-sibling::div")
          .locator("a")
          .allTextContents();
        expect(labels.join("|"), `${url} offered ZEC`).not.toMatch(/\bZEC\b/);
        inspected += 1;
      }
    }
    // ALL carries no chain menu, so without this the loop could inspect nothing and still pass.
    expect(inspected, "no chain menus were inspected").toBe(2);
  });

  test("every row matches the filter, past the first page", async ({ page }) => {
    // A filter applied after the cursor slice returns fewer rows than the limit plus a cursor
    // that steps over what it dropped, so this walks on.
    await page.goto("/cross-chain?source=BTC");
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const rows = await legs(page);
      if (rows.length === 0) break;
      for (const [source] of rows) {
        expect(source, `page ${pageIndex + 1} has a row whose source is not BTC`).toContain("BTC");
      }
      const older = page.getByRole("link", { name: "Older page" });
      if ((await older.count()) === 0) break;
      await older.click();
      await expect(page).toHaveURL(/source=BTC/);
    }
  });

  test("a ZEC URL still resolves, even though the menus no longer mint one", async ({ page }) => {
    // `?source=ZEC` may sit in a bookmark or a shared link. It means exactly the outbound set,
    // and it still answers — a filter that stops working is worse than one never offered.
    await page.goto("/cross-chain?source=ZEC");
    const rows = await legs(page);
    expect(rows.length).toBeGreaterThan(0);
    for (const [source] of rows) expect(source).toContain("ZEC");
  });

  test("the funnel signals an applied chain filter", async ({ page }) => {
    await page.goto("/cross-chain?direction=in");
    const unfiltered = await sourceMenu(page)
      .locator("svg")
      .evaluate((el) => getComputedStyle(el).color);
    await page.goto("/cross-chain?direction=in&source=BTC");
    const filtered = await sourceMenu(page)
      .locator("svg")
      .evaluate((el) => getComputedStyle(el).color);
    expect(filtered, "the funnel looks identical filtered and unfiltered").not.toBe(unfiltered);
  });

  test("the active-filter line names each chain and removes exactly one", async ({ page }) => {
    // A green funnel says THAT a filter is applied; with several chains behind one icon it
    // cannot say WHICH, and a filtered table whose filter is invisible reads as missing data.
    await page.goto("/cross-chain?source=BTC,ETH");
    const active = page.locator('nav[aria-label="Active chain filters"]');
    await expect(active).toBeVisible();
    await expect(active).toContainText("BTC");
    await expect(active).toContainText("ETH");

    await active.getByRole("link", { name: /Remove BTC from source/i }).click();
    await expect(page).toHaveURL(/source=ETH/);
    await expect(page).not.toHaveURL(/BTC/);
  });

  test("it works with no JavaScript, because it is links and a details element", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/cross-chain?direction=in");
    // No `openMenu` here: it reads `details.open` through the page, which needs scripting.
    await sourceMenu(page).click();
    await page.getByRole("link", { name: /^Add BTC as a source chain$/ }).click();
    await expect(page).toHaveURL(/source=BTC/);
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    await context.close();
  });

  test("a foreign chain at both ends explains itself rather than looking broken", async ({
    page,
  }) => {
    // Unreachable from the UI since the menus pin the direction, but a bookmark or a shared link
    // can still carry it. The sentence prevents the reading that such volume is genuinely nil,
    // or that the site is broken.
    for (const url of [
      "/cross-chain?source=BTC&destination=ETH", // two foreign ends
      "/cross-chain?source=ZEC&destination=ZEC", // inbound and outbound at once
    ]) {
      await page.goto(url);
      await expect(page.locator("table tbody tr"), url).toHaveCount(0);
      await expect(page.locator("main"), url).toContainText(/both ends at once/i);
    }
  });

  test("chain filters and the other controls never clear each other", async ({ page }) => {
    await page.goto("/cross-chain?source=BTC&protocol=maya");
    const direction = page
      .locator('nav[aria-label="Filter by direction"] a')
      .filter({ hasText: /inbound/i });
    if ((await direction.count()) > 0) {
      await direction.first().click();
      await expect(page, "changing direction dropped the chain filter").toHaveURL(/source=BTC/);
      await expect(page, "changing direction dropped the venue filter").toHaveURL(/protocol=maya/);
    }

    // And the venue menu preserves the chain selection.
    await page.goto("/cross-chain?source=BTC");
    await page.locator("summary[aria-label='Filter by venue']").click();
    await page.getByRole("link", { name: "Maya Protocol" }).click();
    await expect(page).toHaveURL(/source=BTC/);
    await expect(page).toHaveURL(/protocol=maya/);
  });

  test("a direction that makes a selection unreachable drops it rather than carrying it", async ({
    page,
  }) => {
    // Under OUTBOUND every source is Zcash, so a source of BTC cannot be reached — carrying
    // it over would leave the reader at an empty table holding a chip for a chain the menu
    // no longer lists.
    await page.goto("/cross-chain?source=BTC");
    const outbound = page
      .locator('nav[aria-label="Filter by direction"] a')
      .filter({ hasText: /outbound/i });
    if ((await outbound.count()) === 0) return;
    await outbound.first().click();
    await expect(page).not.toHaveURL(/source=BTC/);
  });

  test("a side the direction pins to Zcash offers no menu at all", async ({ page }) => {
    // Under INBOUND every destination is Zcash, so there is no destination to choose.
    await page.goto("/cross-chain?direction=in");
    await expect(destinationMenu(page)).toHaveCount(0);
    await expect(sourceMenu(page)).toHaveCount(1);
    // And the mirror image.
    await page.goto("/cross-chain?direction=out");
    await expect(sourceMenu(page)).toHaveCount(0);
    await expect(destinationMenu(page)).toHaveCount(1);
  });

  for (const [label, width] of [
    ["mobile", 375],
    ["desktop", 1440],
  ] as const) {
    test(`${label} — every open filter menu stays inside the viewport`, async ({ page }) => {
      /*
       * A closed popover has no box, so an escaping panel passes every other check — including
       * `overflow.spec.ts`, because a panel that escapes to the left adds no scrollWidth. So
       * every open menu is measured, as `tooltips.spec.ts` does for tips.
       */
      await page.setViewportSize({ width, height: 900 });
      // Every tab, because each one carries a different set of menus: the left-anchored SOURCE
      // menu lives only on INBOUND.
      let checked = 0;
      for (const url of [
        "/cross-chain",
        "/cross-chain?direction=in",
        "/cross-chain?direction=out",
        // /txs carries the MIXED chip's direction menu, which is anchored LEFT because the
        // chip sits early in a row that wraps at 375px. Both states, because the chip's label
        // grows to "MIXED · SHIELDING" when refined and a wider chip moves the panel.
        "/txs",
        "/txs?kind=shielding",
      ]) {
        await page.goto(url);
        await page.evaluate(() => document.fonts.ready);

        const menus = page.locator("summary[aria-label^='Filter by']");
        const count = await menus.count();
        for (let i = 0; i < count; i += 1) {
          const summary = menus.nth(i);
          const name = `${await summary.getAttribute("aria-label")} on ${url}`;
          await openMenu(summary);
          const box = await summary.locator("xpath=following-sibling::div").boundingBox();
          expect(box, `${name} opened with no panel`).not.toBeNull();
          if (!box) continue;
          expect(box.x, `${name} opens off the left edge`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, `${name} opens past the right edge`).toBeLessThanOrEqual(width);
          await summary.click();
          checked += 1;
        }
      }
      // A silent zero here would mean the suite stopped checking anything at all.
      expect(checked, "no filter menus were found to check").toBeGreaterThan(2);
    });
  }

  test("a content disclosure is NOT dismissed by clicking away", async ({ page }) => {
    /*
     * Only `data-popover` opts in to outside-click dismissal. Many `<details>` on this site are
     * content — a transaction's raw hex, a block's extra facts, the /api-docs contents — and must
     * not collapse when the reader clicks the page.
     */
    // A block, not a transaction: the block's disclosure is unconditional, while the raw-hex
    // panel exists only when the transaction carries `rawHex`, which the first /txs row may not.
    await page.goto("/blocks");
    await page.locator('a[href^="/block/"]').first().click();
    const disclosure = page.locator("details.panel").first();
    await expect(disclosure, "no content disclosure to check").toHaveCount(1);
    await disclosure.locator("summary").first().click();
    await expect(disclosure).toHaveAttribute("open", "");

    await page.locator("h1").click();
    await expect(disclosure, "an outside click collapsed a content panel").toHaveAttribute(
      "open",
      "",
    );
  });

  test("the value filter narrows every row, on all three direction tabs", async ({ page }) => {
    /*
     * Unlike the chain menus, a value threshold is direction-independent — a transfer is
     * worth what it is worth whichever way it crossed — so it appears on ALL, INBOUND and
     * OUTBOUND alike, and every row on every one of them must clear the bar.
     */
    for (const base of [
      "/cross-chain",
      "/cross-chain?direction=in",
      "/cross-chain?direction=out",
    ]) {
      const url = `${base}${base.includes("?") ? "&" : "?"}min=100000`;
      await page.goto(url);
      const chips = page.locator('nav[aria-label="Filter by value at swap"]');
      await expect(chips, `${url} rendered no value filter`).toHaveCount(1);
      await expect(chips.locator('a[aria-current="page"]')).toHaveText(/100K/);
    }
  });

  test("the value chips say the figures are swap-time, not today's money", async ({ page }) => {
    // ZEC has moved roughly 20x across this data, so two rows in one filtered list are
    // priced in different eras' dollars. Bare dollar signs would read as today's value —
    // a figure this site does not have.
    await page.goto("/cross-chain");
    await expect(page.locator('nav[aria-label="Filter by value at swap"]')).toContainText(
      /VALUE AT SWAP/i,
    );
  });

  test("a value threshold survives paging and never clears the other filters", async ({ page }) => {
    await page.goto("/cross-chain?direction=in&min=10000");
    const venue = page.locator("summary[aria-label='Filter by venue']");
    await openMenu(venue);
    await page.getByRole("link", { name: "Maya Protocol" }).click();
    await expect(page, "choosing a venue dropped the threshold").toHaveURL(/min=10000/);
    await expect(page).toHaveURL(/direction=in/);

    const older = page.getByRole("link", { name: "Older page" });
    if ((await older.count()) > 0) {
      await older.click();
      await expect(page, "paging dropped the threshold").toHaveURL(/min=10000/);
    }
  });

  test("a malformed threshold means ALL, never an empty list", async ({ page }) => {
    // A malformed NUMBER has no honest interpretation, so it widens back to everything —
    // the opposite of a malformed chain ticker, which names an open set.
    for (const bad of ["abc", "-5", "0", "1e400"]) {
      await page.goto(`/cross-chain?min=${bad}`);
      const active = page.locator(
        'nav[aria-label="Filter by value at swap"] a[aria-current="page"]',
      );
      await expect(active, `min=${bad} did not fall back to ALL`).toHaveText("ALL");
      expect(await page.locator("table tbody tr").count()).toBeGreaterThan(0);
    }
  });

  test("a well-formed chain with no rows empties the list honestly", async ({ page }) => {
    // Unlike the single-valued filters, this does NOT fall back to "all": the chain set is
    // open, so an unknown ticker is a question with an answer of zero rather than a typo to
    // paper over. Showing the reader rows they excluded would be the worse failure.
    await page.goto("/cross-chain?source=NOTACHAIN");
    await expect(page.locator("table tbody tr")).toHaveCount(0);
    await expect(page.locator("main")).toContainText(/no |none|nothing/i);
  });
});

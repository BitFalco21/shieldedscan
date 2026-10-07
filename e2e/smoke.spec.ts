import { expect, test, type Page } from "@playwright/test";

/** Fully shielded Orchard z->z transaction, from src/fixtures/transactions.ts. */
const SHIELDED_TXID = "a3f29c4e".padEnd(64, "0");
const TRANSPARENT_ADDR = "t1XWk29dAliceFixtureAddr000001";
const SHIELDED_ADDR = "zs1exampleshieldedsaplingaddressfixture0000000000000001";
/** Fully shielded Orchard z->z transaction still in the mempool, from src/fixtures/mempool.ts. */
const MEMPOOL_TXID = "dead01".padEnd(64, "0");

const ROUTES = [
  { path: "/", heading: "PRIVACY IS" },
  { path: "/blocks", heading: "Blocks" },
  { path: "/block/2481032", heading: "Block" },
  { path: "/txs", heading: "Transactions" },
  { path: "/shielded", heading: "The shielded pools" },
  { path: "/cross-chain", heading: "Cross-Chain" },
  { path: "/cross-chain/flows", heading: "Cross-Chain" },
  { path: "/cross-chain/protocols", heading: "Cross-Chain" },
  // The transfer page's h1 is the direction; the protocol lives in the route badge.
  { path: "/cross-chain/thor-8842", heading: "Inbound to Zcash" },
  { path: "/analytics", heading: "Network activity" },
  { path: "/mempool", heading: "Mempool" },
  { path: "/reorgs", heading: "Reorgs" },
  { path: "/search?q=hello%20world", heading: /doesn't look like anything/ },
  { path: `/tx/${SHIELDED_TXID}`, heading: SHIELDED_TXID },
  { path: `/tx/${MEMPOOL_TXID}`, heading: MEMPOOL_TXID },
  { path: `/address/${TRANSPARENT_ADDR}`, heading: TRANSPARENT_ADDR },
  { path: `/address/${SHIELDED_ADDR}`, heading: SHIELDED_ADDR },
];

/** Fail the test if the page logs an error — catches hydration mismatches. */
function failOnConsoleErrors(page: Page, errors: string[]) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
}

for (const route of ROUTES) {
  test(`${route.path} renders cleanly`, async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);

    await page.goto(route.path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(route.heading);
    await expect(page.locator("main")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("unknown routes render the designed 404, not a stack trace", async ({ page }) => {
  await page.goto("/definitely-not-a-page");
  await expect(page.getByText("NOT ON CHAIN")).toBeVisible();
});

test("/analytics is back, linked, and plotting a series", async ({ page }) => {
  // Reachable, linked from the nav, and actually rendering a chart.
  await page.goto("/analytics");
  await expect(page.getByText("NOT ON CHAIN")).toHaveCount(0);
  await expect(page.locator("main svg").first()).toBeVisible();

  // Reachable from the nav, inside the analytics group, labelled "network activity". Opening
  // the disclosure is part of the assertion: a collapsed `<details>` keeps its children in the
  // DOM, so checking presence alone would pass even if the group could never be opened.
  await page.goto("/");
  const group = page.locator("nav summary").filter({ hasText: "analytics" });
  await expect(group).toBeVisible();
  await group.click();
  await expect(page.locator('nav a[href="/analytics"]')).toBeVisible();
});

test("shielded transactions never show a fake amount", async ({ page }) => {
  // Where amounts appear beside shielded transactions, the shielded ones are redaction
  // bars — the home panel mixes both kinds in one column.
  await page.goto("/");
  await expect(page.getByRole("img", { name: /value shielded/ }).first()).toBeVisible();

  // A shielded row in /txs's VALUE column is a redaction bar, never a number. `values.spec.ts`
  // checks the column cell by cell; this is the smoke-level version.
  await page.goto("/txs");
  await expect(page.locator("table")).toBeVisible();
  const txHeaders = await page.locator("table th").allInnerTexts();
  expect(txHeaders).toContain("VALUE");
  await expect(page.getByRole("img", { name: /value shielded/ }).first()).toBeVisible();
});

test("the mobile nav opens, navigates and closes", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Navigation menu" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  // Scoped to #nav-menu: this test is about the mobile menu, and must not pass on some other
  // Shielded link elsewhere.
  await page.locator("#nav-menu").getByRole("link", { name: "Shielded" }).click();
  await expect(page).toHaveURL(/\/shielded$/);
});

test("a fully-shielded transaction shows the veil, never a fabricated amount", async ({ page }) => {
  await page.goto(`/tx/${SHIELDED_TXID}`);
  // Both sides of a z->z transaction are veiled — the copy must appear for spending and receiving.
  await expect(page.getByText(/hidden by design/).first()).toBeVisible();
  // There are no transparent inputs/outputs on this tx: no panel claiming to know a
  // recipient address or an exact amount for either side may render.
  await expect(page.getByText("INPUTS — TRANSPARENT")).toHaveCount(0);
  await expect(page.getByText("OUTPUTS — TRANSPARENT")).toHaveCount(0);
});

test("a shielded address page never presents a balance as if it were known", async ({ page }) => {
  await page.goto(`/address/${SHIELDED_ADDR}`);
  await expect(page.getByText(/everything is private/)).toBeVisible();
  await expect(page.getByText(/readable only by the key holder/)).toBeVisible();
  // No transparent-address style stat card (BALANCE/TOTAL RECEIVED/TOTAL SENT figures)
  // may appear on a shielded address page — those numbers don't exist.
  await expect(page.getByText("TOTAL RECEIVED")).toHaveCount(0);
  await expect(page.getByText("TOTAL SENT")).toHaveCount(0);
});

test("a mempool transaction shows the MEMPOOL breadcrumb and an unconfirmed status", async ({
  page,
}) => {
  await page.goto(`/tx/${MEMPOOL_TXID}`);
  await expect(page.getByText("MEMPOOL", { exact: true })).toBeVisible();
  await expect(page.getByText("Unconfirmed — in the mempool")).toBeVisible();
});

test("Ctrl+K opens the command palette and Enter navigates via real routing", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+K");
  const dialog = page.getByRole("dialog", { name: "Search the Zcash chain" });
  await expect(dialog).toBeVisible();

  const input = dialog.getByRole("searchbox", { name: "Search the Zcash chain" });
  await expect(input).toBeFocused();
  await input.fill("2481032");
  await expect(dialog.getByText("BLOCK HEIGHT")).toBeVisible();

  await input.press("Enter");
  await expect(page).toHaveURL(/\/block\/2481032$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Block");
});

test("the hero's blinking cursor opens the palette, as the ⌘K badge used to", async ({ page }) => {
  // The hero prompt's blinking block opens the palette. It looks decorative, so this pins its
  // job — otherwise the palette would be reachable from the homepage only by a shortcut with
  // nothing on screen naming it.
  await page.goto("/");
  await page.getByRole("button", { name: "Open the command palette" }).click();
  await expect(page.getByRole("dialog", { name: "Search the Zcash chain" })).toBeVisible();
});

test("the /cross-chain venue filter narrows the list and survives paging", async ({ page }) => {
  await page.goto("/cross-chain");
  const rows = () => page.locator("table tbody tr");
  const allCount = await rows().count();
  expect(allCount).toBeGreaterThan(0);

  // The control lives in the PROTOCOL column header, not above the table.
  await page.locator("summary[aria-label='Filter by venue']").click();
  await page.getByRole("link", { name: "Maya Protocol" }).click();
  await expect(page).toHaveURL(/protocol=maya/);

  // Every remaining row is that venue — the filter narrowed the list, not the page.
  const filtered = await rows().count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThanOrEqual(allCount);
  await expect(page.locator("table tbody").getByText("NEAR Intents")).toHaveCount(0);

  // And the pagination controls keep it: losing it here would silently widen the list on
  // the next page, which is the failure this asserts against.
  const older = page.getByRole("link", { name: "Older page" });
  if ((await older.count()) > 0) {
    await older.click();
    await expect(page).toHaveURL(/protocol=maya/);
  }
});

test("cursor pagination on /blocks pages older, then back to newer", async ({ page }) => {
  await page.goto("/blocks");
  const firstRowHeight = await page
    .locator("table tbody tr")
    .first()
    .locator("td")
    .first()
    .innerText();

  await page.getByRole("link", { name: "Older page" }).click();
  await expect(page).toHaveURL(/before=/);
  const olderRowHeight = await page
    .locator("table tbody tr")
    .first()
    .locator("td")
    .first()
    .innerText();
  const parseHeight = (text: string) => Number(text.replace("#", "").replace(/,/g, ""));
  expect(parseHeight(olderRowHeight)).toBeLessThan(parseHeight(firstRowHeight));

  await page.getByRole("link", { name: "Newer page" }).click();
  await expect(page).toHaveURL(/after=/);
  const backRowHeight = await page
    .locator("table tbody tr")
    .first()
    .locator("td")
    .first()
    .innerText();
  expect(backRowHeight).toBe(firstRowHeight);
});

test("/blocks jumps to the oldest page and back to the head in one hop each", async ({ page }) => {
  const firstHeight = () => page.locator("table tbody tr td").first().innerText();

  await page.goto("/blocks");
  const head = await firstHeight();

  await page.getByRole("link", { name: "Last page — oldest" }).click();
  // Wait on the URL, not the click: these are client-side navigations, so reading the
  // table straight after the click races the render.
  await expect(page).toHaveURL(/after=/);
  const oldest = await firstHeight();
  const parseHeight = (text: string) => Number(text.replace("#", "").replace(/,/g, ""));
  expect(parseHeight(oldest)).toBeLessThan(parseHeight(head));
  // The end of the list really is the end: there is nothing older to page to.
  await expect(page.getByRole("link", { name: "Older page" })).toHaveCount(0);

  await page.getByRole("link", { name: "First page — newest" }).click();
  await expect(page).toHaveURL(/\/blocks$/);
  expect(await firstHeight()).toBe(head);
});

test("filtering /txs by SHIELDED updates the URL and shows only shielded rows", async ({
  page,
}) => {
  await page.goto("/txs");
  await page.getByRole("link", { name: "SHIELDED", exact: true }).click();
  await expect(page).toHaveURL(/kind=shielded/);

  const rowCount = await page.locator("table tbody tr").count();
  expect(rowCount).toBeGreaterThan(0);
  await expect(page.locator("table tbody .shield-shielded")).toHaveCount(rowCount);
});

test("the sticky table header stays pinned and opaque as the page scrolls", async ({ page }) => {
  // From `lg` up the header sticks against the page, not an inner scroll region — see the note
  // in DataTable. Use a desktop viewport so the sticky path applies.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/blocks");
  const thead = page.locator("thead tr");

  const topBefore = await thead.evaluate((el) => el.getBoundingClientRect().top);
  expect(topBefore).toBeGreaterThan(0);

  await page.evaluate(() => window.scrollTo(0, 600));
  const topAfter = await thead.evaluate((el) => el.getBoundingClientRect().top);

  // A non-sticky header would have moved up by the full scroll delta and gone
  // off-screen; a sticky one pins at the top of the viewport.
  expect(topAfter).toBeLessThan(topBefore);
  expect(topAfter).toBeGreaterThanOrEqual(0);

  const bg = await thead.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg.startsWith("rgba") && bg.endsWith(", 0)")).toBe(false);
});

test("nothing scrolls horizontally on a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const route of ROUTES) {
    await page.goto(route.path);
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, `${route.path} overflows horizontally`).toBe(false);
  }
});

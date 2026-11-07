import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { DataExportCard } from "../src/domain";

/**
 * Zeno's download card, laid out in the console and in the bubble at a phone's width and a
 * desktop's: the card stays inside its column (a wide preview scrolls in its own box), the page
 * never scrolls sideways, both links are real links of a thumb's height, and axe passes. A
 * malformed card is dropped and the answer still lands.
 */

const AGENT_ON = process.env.NEXT_PUBLIC_AGENT_ENABLED === "1";
const AXE = join(process.cwd(), "node_modules/axe-core/axe.min.js");

interface AxeWindow {
  axe: { run: (el: Element) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> };
}

/** The widest card the tool builds over the fixture world: pool usage, 17 columns. */
const WIDE: DataExportCard = {
  v: 1,
  dataset: "pool-usage",
  path: "/v1/analytics/pool-usage",
  query: [
    ["pool", "orchard"],
    ["from", "2026-07-04"],
    ["to", "2026-08-04"],
    ["interval", "day"],
  ],
  fileName: "shieldedscan_pool-usage_from-2026-07-04_interval-day_pool-orchard_to-2026-08-04.csv",
  rows: 31,
  paged: false,
  truncated: false,
  readOnDownload: false,
  columns: [
    ["period_start", "day"],
    ["pool", "text"],
    ["txs", "int"],
    ["fully_shielded_txs", "int"],
    ["mixed_txs", "int"],
    ["coinbase_txs", "int"],
    ["shielding_txs", "int"],
    ["unshielding_txs", "int"],
    ["indeterminate_txs", "int"],
    ["sapling_spends", "int"],
    ["sapling_outputs", "int"],
    ["actions", "int"],
    ["joinsplits", "int"],
    ["notes_at_close", "int"],
    ["notes_created", "int"],
    ["close_day", "day"],
    ["close_height", "int"],
  ].map(([name, type]) => ({
    name: name!,
    type: type as DataExportCard["columns"][number]["type"],
  })),
  through: null,
  height: null,
  coverage: "partial",
  preview: [0, 1, 2].map((i) => [
    `2026-07-0${i + 1}`,
    "orchard",
    "1079",
    "230",
    "849",
    "0",
    "360",
    "489",
    "0",
    { absent: "nonexistent" },
    { absent: "nonexistent" },
    "2640",
    { absent: "nonexistent" },
    i === 1 ? { absent: "unmeasured" } : "50157099",
    "2640",
    `2026-07-0${i + 1}`,
    "3397652",
  ]),
};

const ADDRESS = "t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf";
const HISTORY: DataExportCard = {
  ...WIDE,
  dataset: "address-transactions-history",
  path: `/v1/addresses/${ADDRESS}/export`,
  query: [],
  fileName: `shieldedscan_address_${ADDRESS}.csv`,
  rows: 812,
  readOnDownload: true,
  columns: WIDE.columns.slice(0, 8),
  coverage: null,
  preview: [],
};

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

async function stubExport(page: Page, cards: readonly unknown[]) {
  await page.route("**/agent/ask", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        sse("delta", { text: "The file holds each day's Orchard transactions." }),
        ...cards.map((card) => sse("export", card)),
        sse("sources", { sources: [] }),
        sse("done", { stopReason: "complete" }),
      ].join(""),
    }),
  );
}

const card = (scope: Page | Locator, c: DataExportCard) =>
  scope.getByRole("figure", { name: `Data file ${c.fileName}` });

/** Elements reaching past `root`'s edges, except inside a scroll box, which clips them. */
const escaping = (root: Locator) =>
  root.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll("*"))
      .filter((child) => child.closest("[role=region]") === null || child.matches("[role=region]"))
      .filter((child) => {
        const r = child.getBoundingClientRect();
        return r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5);
      })
      .map((child) => `${child.tagName.toLowerCase()} "${(child.textContent ?? "").slice(0, 30)}"`);
  });

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function checkCard(page: Page, figure: Locator, c: DataExportCard) {
  await expect(figure).toBeVisible();
  expect(await escaping(figure)).toEqual([]);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  const csv = figure.getByRole("link", { name: /download csv/ });
  const json = figure.getByRole("link", { name: /open json/ });
  const query = new URLSearchParams(c.query);
  query.set("format", "csv");
  expect(await csv.getAttribute("href")).toMatch(
    new RegExp(`^https?://[^/]+${c.path.replace(/[/?.]/g, "\\$&")}\\?${query.toString()}$`),
  );
  expect(await csv.getAttribute("download")).toBe(c.fileName);
  expect(await json.getAttribute("href")).toMatch(/format=json$/);
  for (const link of [csv, json]) {
    const b = (await link.boundingBox())!;
    expect(b.height, "a thumb's height").toBeGreaterThanOrEqual(44);
  }
  await page.addScriptTag({ path: AXE });
  const violations = await figure.evaluate(async (el) =>
    (await (window as unknown as AxeWindow).axe.run(el)).violations.map((v) => v.id),
  );
  expect(violations).toEqual([]);
}

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

test.describe("Zeno's download card", () => {
  test.skip(!AGENT_ON, "NEXT_PUBLIC_AGENT_ENABLED is not set for this build");

  for (const viewport of VIEWPORTS) {
    test(`sits in the console at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await stubExport(page, [WIDE, HISTORY]);
      await page.goto("/ai-agent");
      await page.getByLabel(/Ask a question/i).fill("orchard transactions as csv");
      await page.getByRole("button", { name: "send" }).click();
      await checkCard(page, card(page, WIDE), WIDE);
      await checkCard(page, card(page, HISTORY), HISTORY);
      // The wide preview scrolls in its own box, which a keyboard can reach.
      const region = card(page, WIDE).getByRole("region");
      expect(await region.getAttribute("tabindex")).toBe("0");
      expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    });

    test(`sits in the bubble at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await stubExport(page, [WIDE]);
      await page.goto("/blocks");
      await page.getByRole("button", { name: "Ask Zeno about this page" }).click();
      const panel = page.getByRole("dialog", { name: "Ask Zeno" });
      await panel.getByRole("textbox").fill("orchard transactions as csv");
      await panel.getByRole("textbox").press("Enter");
      const figure = card(panel, WIDE);
      await checkCard(page, figure, WIDE);
      expect(await escaping(panel)).toEqual([]);
    });
  }

  test("drops a malformed card and still shows the answer", async ({ page }) => {
    await stubExport(page, [
      { ...WIDE, path: "https://evil.example/x.csv" },
      { ...WIDE, preview: [[1, 2]] },
      null,
    ]);
    await page.goto("/ai-agent");
    await page.getByLabel(/Ask a question/i).fill("orchard transactions as csv");
    await page.getByRole("button", { name: "send" }).click();
    await expect(page.getByText("The file holds each day's Orchard transactions.")).toBeVisible();
    await expect(page.getByRole("figure", { name: /^Data file/ })).toHaveCount(0);
  });
});

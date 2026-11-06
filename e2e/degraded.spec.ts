/**
 * Degrade, don't die, on a production build: one read failing costs its own section, the rest of
 * the page renders on the server as an ordinary 200, and the section offers a retry that works.
 * A page whose essential read fails still answers 500 through the error boundary. The server
 * fails a fixture read by name when the request carries `x-e2e-fault`
 * (`src/data/source-wrappers.ts`, enabled by `E2E_FAULTS=1` in the Playwright web server).
 */

import { expect, test, type Page } from "@playwright/test";
import { settleLayout, SHIELDED_TXID, TRANSPARENT_ADDR } from "./surface";

const SHOTS = process.env.DEGRADE_SHOTS_DIR;
/** The NU7 activation height (`e2e/nu7.spec.ts`). */
const NU7_HEIGHT = 3_543_405;

const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

interface Case {
  name: string;
  url: string;
  fault: string;
  /** The panel's sentence, which also proves it names the right section. */
  unavailable: RegExp;
  /** Something from the rest of the page that must still be there. */
  kept: (page: Page) => Promise<void>;
  /** 200 for a section; 500 where the failed read is essential (the error boundary). */
  status: 200 | 500;
  /** What the section shows once the read works again. */
  recovered?: (page: Page) => Promise<void>;
}

const CASES: Case[] = [
  {
    name: "txs-rows",
    url: "/txs?kind=transparent",
    fault: "listTransactions",
    status: 200,
    unavailable: /This page of transactions could not be read just now/,
    kept: async (page) => {
      await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Filter by privacy kind" })).toBeVisible();
      await expect(page.getByText("TOTAL TRANSACTIONS")).toBeVisible();
    },
    recovered: async (page) => {
      await expect(page.getByRole("table")).toBeVisible();
    },
  },
  {
    name: "address-history",
    url: `/address/${TRANSPARENT_ADDR}`,
    fault: "getAddressTransactions",
    status: 200,
    unavailable: /This address's history could not be read just now/,
    kept: async (page) => {
      await expect(page.getByText("BALANCE", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(TRANSPARENT_ADDR);
    },
    recovered: async (page) => {
      await expect(page.getByRole("table")).toBeVisible();
    },
  },
  {
    name: "address-subject",
    url: `/address/${TRANSPARENT_ADDR}`,
    fault: "getAddress",
    status: 200,
    unavailable: /This address could not be read just now/,
    kept: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toContainText(TRANSPARENT_ADDR);
    },
  },
  {
    name: "blocks-rows",
    url: "/blocks",
    fault: "listBlocks",
    status: 200,
    unavailable: /This page of blocks could not be read just now/,
    kept: async (page) => {
      await expect(page.getByRole("heading", { name: "Blocks" })).toBeVisible();
    },
  },
  {
    name: "tx-subject",
    url: `/tx/${SHIELDED_TXID}`,
    fault: "getTransaction",
    status: 200,
    unavailable: /This transaction could not be read just now/,
    kept: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toContainText(SHIELDED_TXID);
    },
  },
  {
    // The activation height before its block exists is a countdown; a failed read is not.
    name: "block-nu7-subject",
    url: `/block/${NU7_HEIGHT}`,
    fault: "getBlock",
    status: 200,
    unavailable: /This block could not be read just now/,
    kept: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toContainText(String(NU7_HEIGHT));
    },
  },
  {
    name: "home-panel",
    url: "/",
    fault: "listLatestBlocks",
    status: 200,
    unavailable: /The latest blocks could not be read just now/,
    kept: async (page) => {
      await expect(page.getByText("LATEST TRANSACTIONS")).toBeVisible();
    },
  },
  {
    // A page whose one read is essential: the error boundary, in its "didn't load" voice.
    name: "mempool-page",
    url: "/mempool",
    fault: "listMempool",
    status: 500,
    unavailable: /could not be read just now/,
    kept: async (page) => {
      await expect(page.getByRole("heading", { name: "This page didn't load" })).toBeVisible();
      await expect(page.getByText("SOMETHING BROKE")).toHaveCount(0);
    },
  },
];

/** Every element's right edge inside the viewport, or inside the scroll region that holds it. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

for (const c of CASES) {
  test.describe(`${c.name}: ${c.url} with ${c.fault} failing`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setExtraHTTPHeaders({ "x-e2e-fault": c.fault });
    });

    test(`answers ${c.status}`, async ({ request }) => {
      const res = await request.get(c.url, { headers: { "x-e2e-fault": c.fault } });
      expect(res.status()).toBe(c.status);
      // A degraded section is in the server's HTML, not only in what the browser builds.
      if (c.status === 200) expect(await res.text()).toContain("could not be read just now");
    });

    for (const size of WIDTHS) {
      test(`renders the rest of the page at ${size.name} width, with a reachable retry`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto(c.url);
        await settleLayout(page);
        await expect(page.getByText(c.unavailable)).toBeVisible();
        await c.kept(page);
        const retry = page.getByRole("button", { name: "Try again" }).first();
        await expect(retry).toBeVisible();
        const box = await retry.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        if (SHOTS) {
          await page.screenshot({ path: `${SHOTS}/${c.name}-${size.width}.png`, fullPage: true });
        }
      });
    }

    if (c.recovered) {
      const recovered = c.recovered;
      test("recovers in place when the read works again and the reader retries", async ({
        page,
      }) => {
        await page.goto(c.url);
        await settleLayout(page);
        await expect(page.getByText(c.unavailable)).toBeVisible();
        await page.setExtraHTTPHeaders({});
        await page.getByRole("button", { name: "Try again" }).first().click();
        await recovered(page);
        await expect(page.getByText(c.unavailable)).toHaveCount(0);
      });
    }
  });
}

test("a page that answered 500 keeps the reader's theme, though the head script never ran", async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.setItem("theme", "violet"));
  await page.setExtraHTTPHeaders({ "x-e2e-fault": "listMempool" });
  await page.goto("/mempool");
  await expect(page.getByRole("heading", { name: "This page didn't load" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "violet");
});

test("a degraded section is shared for the route's fresh window, like any render", async ({
  request,
}) => {
  // A response header cannot depend on the render; an honest section stored for seconds is the
  // accepted cost (`src/lib/edge-cache.ts`). Pinned so the trade stays visible.
  const res = await request.get("/txs", { headers: { "x-e2e-fault": "listTransactions" } });
  expect(res.status()).toBe(200);
  expect(res.headers()["netlify-cdn-cache-control"]).toBeDefined();
});

test("a healthy render is unaffected: 200, no fault, the full page", async ({ request }) => {
  const res = await request.get("/txs");
  expect(res.status()).toBe(200);
  expect(await res.text()).not.toContain("could not be read just now");
});

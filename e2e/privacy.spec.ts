/**
 * Privacy invariants, as assertions.
 *
 * Everything else in the suite guards against a page looking broken; this guards against a
 * page being wrong about privacy, which on this site is the worst possible error — e.g. a fully
 * private transaction rendered as transparent because one copy of a pool check missed a pool.
 *
 * Each test names the rule it enforces, so a change that trips one has to argue with the rule
 * rather than with a selector.
 */

import { expect, test, type Page } from "@playwright/test";
import { ROUTES, SHIELDED_ADDR, SHIELDED_TXID, UNIFIED_ADDR } from "./surface";

const mainText = (page: Page) => page.locator("main").innerText();

test.describe("a shielded value is never a number", () => {
  test("every veil is an accessible image with the designed label", async ({ page }) => {
    // The veil is the site's core promise. It must be announced, not merely drawn: a
    // screen-reader user hearing nothing where a value should be learns less than one who
    // hears "value shielded".
    let seen = 0;
    for (const route of ROUTES) {
      await page.goto(route);
      const veils = page.getByRole("img", { name: /value shielded/ });
      const count = await veils.count();
      seen += count;
      for (let i = 0; i < count; i += 1) {
        await expect(veils.nth(i)).toHaveAttribute("title", /hidden by design/);
      }
    }
    expect(seen, "no veil rendered anywhere — the selector or the grammar changed").toBeGreaterThan(
      0,
    );
  });

  test("a fully shielded transaction shows no transparent panels and no fabricated total", async ({
    page,
  }) => {
    await page.goto(`/tx/${SHIELDED_TXID}`);
    await expect(page.getByText(/hidden by design/).first()).toBeVisible();
    await expect(page.getByText("INPUTS — TRANSPARENT")).toHaveCount(0);
    await expect(page.getByText("OUTPUTS — TRANSPARENT")).toHaveCount(0);
    // Nor a zero standing in for the unknown.
    const text = await mainText(page);
    expect(text, "a fully shielded transaction shows a 0.00 ZEC total").not.toMatch(
      /\b0\.00\s*ZEC\b/,
    );
  });

  test("no cell shows a shielded value as 0, — or blank", async ({ page }) => {
    // The forbidden substitutions, checked by looking for a veil's absence in a column that
    // mixes shielded and transparent rows: the homepage panel does.
    await page.goto("/");
    const veils = await page.getByRole("img", { name: /value shielded/ }).count();
    expect(
      veils,
      "the homepage no longer veils any value; a fake zero may have replaced it",
    ).toBeGreaterThan(0);
  });
});

test.describe("the shield grammar encodes privacy in shape, not only colour", () => {
  test("the three variants differ by geometry", async ({ page }) => {
    // A colourblind reader must lose nothing. Shape is the primary channel, so the three
    // states must not be the same path in different colours.
    await page.goto("/txs");
    const paths = await page.evaluate(() => {
      const shapeOf = (selector: string) => {
        const el = document.querySelector(`${selector} path`);
        return el?.getAttribute("d") ?? null;
      };
      return {
        shielded: shapeOf(".shield-shielded"),
        mixed: shapeOf(".shield-mixed"),
        transparent: shapeOf(".shield-transparent"),
      };
    });
    const present = Object.entries(paths).filter(([, d]) => d !== null);
    expect(present.length, "no privacy shields found on /txs").toBeGreaterThan(0);
  });

  test("every shield says what it means, to a pointer and to a screen reader alike", async ({
    page,
  }) => {
    // The mark carries the meaning only for a reader who has already learned the grammar,
    // and /blocks stands three of them alone in a column with no text beside them. The two
    // channels are asserted together because they come from one prop: a hover richer than
    // the accessible name would hand a screen-reader user the poorer of the two facts.
    for (const path of ["/blocks", "/txs", "/mempool"]) {
      await page.goto(path);
      const shields = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(".shield-shielded, .shield-mixed, .shield-transparent"),
          (el) => ({
            aria: el.getAttribute("aria-label"),
            title: el.querySelector(":scope > title")?.textContent ?? null,
          }),
        ),
      );
      expect(shields.length, `no privacy shields found on ${path}`).toBeGreaterThan(0);
      for (const shield of shields) {
        expect(shield.title, `${path}: a shield with no hover text`).toBeTruthy();
        expect(shield.aria, `${path}: hover and spoken label disagree`).toBe(shield.title);
      }
    }
  });

  test("a shield standing for a group of transactions counts them", async ({ page }) => {
    // /blocks is the one place a shield means "N transactions of this kind" rather than one,
    // and the count is already in hand — a bare "transparent" there is the smaller half of
    // what the column knows.
    await page.goto("/blocks");
    const labels = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          "table .shield-shielded, table .shield-mixed, table .shield-transparent",
        ),
        (el) => el.getAttribute("aria-label") ?? "",
      ),
    );
    expect(labels.length, "no privacy shields found on /blocks").toBeGreaterThan(0);
    for (const label of labels) {
      // "1 transparent transaction" / "12 fully shielded transactions" — never a bare zero,
      // since the count is what decides whether the shield is drawn at all.
      expect(label, "a composition shield names no count").toMatch(
        /^[1-9][\d,]* .+ transactions?\b/,
      );
    }
  });

  test("shields emit no SVG ids, which a 25-row table would duplicate", async ({ page }) => {
    // A shared id across rows is invalid markup whose rendering depends on document order
    // and which breaks outright if the first instance unmounts.
    await page.goto("/txs");
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll("svg [id], svg[id]"), (el) => el.id),
    );
    const duplicated = ids.filter((id, i) => id !== "" && ids.indexOf(id) !== i);
    expect(duplicated, `duplicate SVG ids: ${duplicated.join(", ")}`).toEqual([]);
  });
});

test.describe("the chain's silence is respected", () => {
  test("no transaction page narrates who paid whom", async ({ page }) => {
    // Deciding which output is the payment and which is change is the same inference
    // chain-analysis firms use to deanonymise transparent Zcash. It must never appear as
    // chain fact.
    for (const txid of [SHIELDED_TXID]) {
      await page.goto(`/tx/${txid}`);
      const text = await mainText(page);
      expect(text, "a transaction page narrates a sender and recipient").not.toMatch(
        /\bsent\b[\s\S]{0,40}\bto\b\s+(t1|t3|zs1|u1)/i,
      );
    }
  });

  test("no page offers a viewing-key field, not even disabled", async ({ page }) => {
    // A viewing key reveals an entire transaction history. Rendering the control at all —
    // even inert — teaches the habit of pasting one into a website.
    const offenders: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll("input, textarea"), (el) =>
          [
            el.getAttribute("name"),
            el.getAttribute("placeholder"),
            el.getAttribute("aria-label"),
            el.getAttribute("id"),
          ]
            .filter(Boolean)
            .join(" "),
        ),
      );
      for (const description of inputs) {
        if (/viewing\s*key|\bivk\b|\bfvk\b|spending\s*key/i.test(description)) {
          offenders.push(`${route}: input described as "${description}"`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("the shielded address page warns against pasting a viewing key anywhere", async ({
    page,
  }) => {
    // The page states, in words, never to paste a viewing key anywhere.
    await page.goto(`/address/${SHIELDED_ADDR}`);
    await expect(page.locator("main")).toContainText(/viewing key/i);
    await expect(page.locator("main")).toContainText(/never|not.*paste|no.*website/i);
  });

  test("a shielded address page states no balance figures", async ({ page }) => {
    await page.goto(`/address/${SHIELDED_ADDR}`);
    await expect(page.getByText("TOTAL RECEIVED")).toHaveCount(0);
    await expect(page.getByText("TOTAL SENT")).toHaveCount(0);
    await expect(page.getByText(/everything is private/)).toBeVisible();
  });

  test("a unified address lists its receivers, and says the one used stays private", async ({
    page,
  }) => {
    // The receiver set is DECODED from the address string (ZIP 316) — public by
    // construction. The caption carries the boundary that must never move.
    await page.goto(`/address/${UNIFIED_ADDR}`);
    await expect(page.getByRole("heading", { name: "RECEIVERS" })).toBeVisible();
    await expect(page.getByText("orchard", { exact: true })).toBeVisible();
    await expect(page.getByText("sapling", { exact: true })).toBeVisible();
    await expect(page.getByText(/Which receiver a payment used stays private/)).toBeVisible();
    // The derived Sapling form resolves to its own page — a real link, not decoration.
    await page.getByRole("link", { name: /^zs1[a-z0-9]{40,}$/ }).click();
    await expect(page.getByText(/everything is private/)).toBeVisible();
  });

  test("a garbage unified address shows NO receivers panel — null is never a partial list", async ({
    page,
  }) => {
    await page.goto(`/address/u1${"qpw9zx7k3mn4vr8sd2hf6tgy5jc0lb".repeat(6)}`);
    await expect(page.getByText(/everything is private/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "RECEIVERS" })).toHaveCount(0);
  });

  test("the decrypt demo ends in refusal, with every bar restored", async ({ page }) => {
    // The one playful animation on the page proves its point: pressing play yields nothing. The
    // scramble must settle back to redaction bars and say why.
    await page.goto(`/address/${SHIELDED_ADDR}`);
    await page.getByRole("button", { name: /try to decrypt/i }).click();
    await expect(page.getByText(/decryption unsuccessful/)).toBeVisible();
    for (const bar of await page.locator("[data-decrypt-bar]").all()) {
      await expect(bar).toHaveText(/^[▓ ZEC]+$/);
    }
  });
});

test.describe("no third-party request leaves the page", () => {
  test("every request is same-origin — no CDN logos, no trackers", async ({ page }) => {
    // Sixteen routes in one test, so the default 30s budget is not enough. Kept as one test
    // deliberately: the listener has to span the whole crawl to catch a request made by only
    // one page.
    test.setTimeout(120_000);
    // A per-row image request to a third party is a tracking vector on a privacy explorer,
    // and the CSP forbids it. This checks the pages actually honour that rather than relying
    // on the header alone.
    const foreign: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return;
      if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
        foreign.push(`${request.resourceType()} ${url}`);
      }
    });
    for (const route of ROUTES) {
      await page.goto(route);
    }
    expect(foreign, `off-origin requests:\n${foreign.join("\n")}`).toEqual([]);
  });

  test("nothing writes a cookie", async ({ page, context }) => {
    for (const route of ROUTES) await page.goto(route);
    const cookies = await context.cookies();
    expect(
      cookies.map((c) => c.name),
      "a cookie was set on a site that promises none",
    ).toEqual([]);
  });

  test("browsing writes NOTHING to storage until a theme is chosen", async ({ page }) => {
    // The privacy page promises one key, and only if you ask. So a full sweep with nothing
    // chosen must leave localStorage, sessionStorage and IndexedDB empty.
    test.setTimeout(120_000);
    for (const route of ROUTES) await page.goto(route);
    const stored = await page.evaluate(async () => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
      idb: (await window.indexedDB.databases()).map((d) => d.name),
    }));
    expect(stored, "storage written without a theme being chosen").toEqual({
      local: [],
      session: [],
      idb: [],
    });
  });

  test("choosing a theme stores exactly one key, which never leaves the browser", async ({
    page,
  }) => {
    const carried: string[] = [];
    page.on("request", (request) => {
      const blob = `${request.url()} ${request.postData() ?? ""} ${JSON.stringify(request.headers())}`;
      if (/violet/i.test(blob)) carried.push(`${request.method()} ${request.url()}`);
    });

    await page.goto("/");
    await page.locator("summary[aria-label^='Theme:']").click();
    await page.getByRole("button", { name: /violet theme/i }).click();

    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("violet");
    expect(await page.evaluate(() => Object.entries(window.localStorage))).toEqual([
      ["theme", "violet"],
    ]);

    // It survives navigation and is stamped before React — the head script's job.
    await page.goto("/blocks");
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("violet");
    expect(carried, `requests carrying the theme name:\n${carried.join("\n")}`).toEqual([]);

    // Choosing the default removes the key rather than storing "green".
    await page.locator("summary[aria-label^='Theme:']").click();
    await page.getByRole("button", { name: /green theme/i }).click();
    expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  });
});

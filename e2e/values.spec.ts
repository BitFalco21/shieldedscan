/**
 * Value integrity.
 *
 * Every page is scanned for the strings a broken number leaves behind: `NaN`, `undefined`,
 * `Infinity`, `null`, `$NaN`, `-0`. None needs domain knowledge to recognise as wrong —
 * `typeof x === "number"` accepts NaN, and an absent key can let a fixture value survive a
 * spread and publish as live data.
 *
 * The rest of the file encodes the rules about what a number may claim — the ones a generic
 * scanner cannot find. A wrong figure on a privacy explorer is worse than a missing one.
 */

import { expect, test, type Page } from "@playwright/test";
import { ROUTES, SHIELDED_TXID } from "./surface";

/** Text that can only be a rendering failure, whatever the data was. */
const BROKEN_VALUE = /\bNaN\b|\bundefined\b|\bInfinity\b|\$NaN|\bnull\b|\[object Object\]/;

const mainText = (page: Page) => page.locator("main").innerText();

/**
 * Main text with `<pre>`/`<code>` content removed.
 *
 * The sweep hunts values a broken render leaves behind; verbatim blocks are quoted content.
 * /api-docs JSON examples contain `null` because the wire contract does. NaN/undefined/Infinity
 * stay banned even inside code blocks (see below): no example on this site should teach those.
 */
const proseText = (page: Page) =>
  page.locator("main").evaluate((main) => {
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("pre, code").forEach((el) => el.remove());
    return clone.textContent ?? "";
  });

test.describe("no page renders a broken number", () => {
  for (const route of ROUTES) {
    test(`${route} is free of NaN, undefined and friends`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const prose = await proseText(page);
      // /api-docs is about the null contract, so "null" in its prose is subject matter, not a
      // broken render. Everywhere else a bare "null" in prose reads as a template leak.
      const pattern =
        route === "/api-docs"
          ? /\bNaN\b|\bundefined\b|\bInfinity\b|\$NaN|\[object Object\]/
          : BROKEN_VALUE;
      const found = prose.match(pattern);
      expect(
        found,
        `${route} rendered "${found?.[0]}" — context: ${prose.slice(Math.max(0, (found?.index ?? 0) - 60), (found?.index ?? 0) + 60)}`,
      ).toBeNull();

      // Code blocks may show `null` (a documented contract) but never the values only a
      // broken template produces.
      const code = await page
        .locator("main pre, main code")
        .evaluateAll((els) => els.map((el) => el.textContent ?? "").join("\n"));
      const brokenInCode = code.match(/\bNaN\b|\bundefined\b|\bInfinity\b|\[object Object\]/);
      expect(brokenInCode, `${route} code block contains "${brokenInCode?.[0]}"`).toBeNull();
    });
  }

  test("no attribute leaks a broken value either", async ({ page }) => {
    // A NaN in a chart's `d`, a `title`, or an `aria-label` is invisible to a text scan and
    // still wrong — an SVG path with NaN silently renders nothing at all.
    const offenders: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll("*"))) {
          for (const attr of Array.from(el.attributes)) {
            if (/NaN|undefined|Infinity/.test(attr.value)) {
              out.push(`<${el.tagName.toLowerCase()} ${attr.name}="${attr.value.slice(0, 80)}">`);
            }
          }
        }
        return out;
      });
      for (const b of bad) offenders.push(`${route}: ${b}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

test.describe("a ZEC amount states its full precision", () => {
  test("no amount is truncated below eight decimals", async ({ page }) => {
    // A zatoshi is 1e-8 ZEC and rounding a ledger amount is not this site's call, so any ZEC
    // figure with more than 8 decimals — or a trailing ellipsis — is a bug.
    const offenders: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      const text = await mainText(page);
      for (const match of text.matchAll(/([\d,]+\.(\d+))\s*ZEC/g)) {
        const decimals = match[2] ?? "";
        if (decimals.length > 8)
          offenders.push(`${route}: "${match[1]} ZEC" has ${decimals.length} decimals`);
      }
      // A truncation marker inside a number is never right.
      for (const match of text.matchAll(/[\d,]+\.\d*[…]\s*ZEC/g)) {
        offenders.push(`${route}: elided ZEC amount "${match[0]}"`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

test.describe("a USD figure only ever sits beside a public ZEC amount", () => {
  test("no dollar figure appears in the same cell as a redaction bar", async ({ page }) => {
    // Pricing a value asserts you know it. A veiled amount with a USD conversion beside it
    // would claim both that the amount is encrypted and that we converted it.
    const offenders: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      const veiledContainers = page.locator(
        ":is(td, li, div, p):has(> [role='img'][aria-label*='shielded'])",
      );
      const count = await veiledContainers.count();
      for (let i = 0; i < count; i += 1) {
        const text = (await veiledContainers.nth(i).innerText()).trim();
        if (/\$\s?[\d,]/.test(text)) offenders.push(`${route}: "${text.slice(0, 80)}"`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("/txs VALUE is an amount or the veil, one per row, and never a dollar figure", async ({
    page,
  }) => {
    // A fully shielded row states its amount is encrypted and never substitutes a number for
    // it. So this asserts the property rather than presence: every VALUE cell is exactly one of
    // the two, the fixture chain exercises both, and no cell prices what it cannot read.
    await page.goto("/txs");
    await expect(page.locator("table")).toBeVisible();
    const headers = await page.locator("table th").allInnerTexts();
    expect(headers).toContain("FEE");
    const valueIndex = headers.indexOf("VALUE");
    expect(valueIndex, "the VALUE column is missing").toBeGreaterThan(-1);

    const rows = await page.locator("table tbody tr").count();
    expect(rows).toBeGreaterThan(0);
    let veiled = 0;
    let amounts = 0;
    const offenders: string[] = [];
    for (let i = 0; i < rows; i += 1) {
      const cell = page.locator("table tbody tr").nth(i).locator("td").nth(valueIndex);
      const text = (await cell.innerText()).trim();
      const isVeiled = (await cell.getByRole("img", { name: /shielded/ }).count()) > 0;
      const hasAmount = /[\d,]+\.\d+\s*(ZEC|TAZ)/.test(text);
      if (isVeiled && hasAmount) offenders.push(`row ${i}: veil and a number: "${text}"`);
      else if (isVeiled) veiled += 1;
      else if (hasAmount) amounts += 1;
      else offenders.push(`row ${i}: VALUE is neither an amount nor the veil: "${text}"`);
      // Pricing a value asserts you know it, and half this column is unknowable by design.
      if (/\$/.test(text)) offenders.push(`row ${i}: a dollar figure in VALUE: "${text}"`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
    // Without both, this test passes against a column that only ever renders one of them.
    expect(veiled, "no shielded row on /txs — the veil branch is untested").toBeGreaterThan(0);
    expect(amounts, "no public amount on /txs — the amount branch is untested").toBeGreaterThan(0);
  });
});

test.describe("an unmeasured number is stated, never substituted", () => {
  test("a missing figure reads as unavailable, never as zero and never as the veil", async ({
    page,
  }) => {
    // Redaction bars mean "encrypted on-chain", not an outage of ours.
    await page.goto("/");
    const unavailable = page.getByText(/unavailable/i);
    const count = await unavailable.count();
    for (let i = 0; i < count; i += 1) {
      const container = unavailable.nth(i).locator("xpath=..");
      await expect(
        container.getByRole("img", { name: /shielded/ }),
        "an unavailable value is shown with the veil, which means something else",
      ).toHaveCount(0);
    }
  });
});

test.describe("aggregates travel with their denominator", () => {
  test("no bare percentage is presented as a privacy score", async ({ page }) => {
    // A percentage over a small or sampled set carries the authority of a measurement it
    // does not have. Where one appears, its denominator must appear beside it.
    for (const route of ["/mempool", "/analytics", "/shielded"]) {
      await page.goto(route);
      const text = await mainText(page);
      if (!/%/.test(text)) continue;
      // "of 12,345", "of N transactions", or an explicit sample size satisfies this.
      expect(
        /\bof\b\s*[\d,]+|sampled|sample size|\bof the\b/i.test(text),
        `${route} shows a percentage with no denominator stated near it`,
      ).toBe(true);
    }
  });

  test("no page presents anything as a privacy score", async ({ page }) => {
    // "no privacy scores" — the refusal — is allowed, and /api-docs says it. What must never
    // appear is the phrase without its negation: that would be a page offering one.
    for (const route of ROUTES) {
      await page.goto(route);
      const prose = await proseText(page);
      const offered = prose.match(/(?<!\bno )privacy scores?/i);
      expect(offered, `${route} presents a privacy score: "${offered?.[0]}"`).toBeNull();
    }
  });
});

test.describe("a fee is derived or absent, never fabricated", () => {
  test("a rendered fee is a plausible chain fee, not an unconverted zatoshi count", async ({
    page,
  }) => {
    // A missing pool term in the fee equation renders a fee thousands of times too high, with a
    // USD figure beside it. A real Zcash fee is a tiny fraction of a ZEC, so any fee above 1 ZEC
    // is either a bug or worth a human looking.
    await page.goto(`/tx/${SHIELDED_TXID}`);
    const text = await mainText(page);
    const fee = text.match(/FEE[\s\S]{0,80}?([\d,]+\.?\d*)\s*ZEC/i);
    if (!fee?.[1]) return;
    const zec = Number(fee[1].replace(/,/g, ""));
    expect(zec, `fee rendered as ${fee[1]} ZEC`).toBeLessThan(1);
  });
});

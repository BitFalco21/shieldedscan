/**
 * Fee integrity — properties of the quantity rather than values on a fixture.
 *
 * A fee is what a sender pays a miner. It cannot be negative, and on Zcash it cannot plausibly
 * be thousands of ZEC — ZIP-317 makes the conventional fee 10,000 zat. A fee equation missing a
 * pool's term (e.g. Sprout's JoinSplit public values) produces exactly such a figure, so these
 * assertions hold over data nobody has written yet. The sweep reads rendered text, because what
 * a reader sees is the thing under test.
 */

import { expect, test, type Page } from "@playwright/test";
import { ROUTES, SPROUT_TXID } from "./surface";

/**
 * A fee above this is not a fee. ZIP-317's conventional fee is 10,000 zat (0.0001 ZEC) and the
 * largest legitimate mainnet fees are a few hundred thousand zat; a pool value balance leaking
 * into the fee shows up as hundreds or thousands of whole ZEC. 10 ZEC leaves four orders of
 * magnitude of headroom over anything real.
 */
const ABSURD_FEE_ZEC = 10;

/**
 * Every ZEC amount on the page that a fee label refers to.
 *
 * Text-based rather than selector-based: fees render through several components, and a
 * selector list kept in step with all of them would fail open.
 *
 * Attribution is forward and first-match. A look-behind window from each amount is wrong: the
 * transaction page renders `FEE 0.0001 ZEC ≈ <$0.01  PUBLIC VALUE 41,827.18126286 ZEC`, so any
 * window wide enough to reach a fee label from its own amount also reaches the next row's
 * amount. Taking the first amount after each fee label binds each label to the figure a reader
 * reads it against.
 *
 * `MAX_GAP` stops a label with no amount of its own (a "fee unknown" row) from adopting an
 * unrelated figure further down the page.
 */
const MAX_GAP = 24;

async function feeFigures(page: Page): Promise<{ context: string; zec: number }[]> {
  const text = await page.locator("main").innerText();
  const found: { context: string; zec: number }[] = [];
  for (const label of text.matchAll(/fees?\b/gi)) {
    const from = (label.index ?? 0) + label[0].length;
    const rest = text.slice(from, from + MAX_GAP + 24);
    const amount = /^[^\d\-]{0,24}?(-?[\d,]+\.?\d*)\s*ZEC/.exec(rest);
    if (!amount) continue;
    const zec = Number((amount[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(zec)) continue;
    const context = text.slice(label.index ?? 0, from + amount[0].length).replace(/\s+/g, " ");
    found.push({ context, zec });
  }
  return found;
}

/**
 * The FEES 24H `StatCard`, whole.
 *
 * `locator("div", { hasText: … })` also matches the innermost div — the micro-label alone — so
 * this anchors on the label and walks up to `.panel`, the card a reader sees.
 */
function feesCard(page: Page) {
  return page
    .locator(".panel")
    .filter({ hasText: /FEES 24H/ })
    .first();
}

test.describe("a fee is never negative and never absurd", () => {
  for (const route of ROUTES) {
    test(`${route} renders only plausible fees`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      for (const { context, zec } of await feeFigures(page)) {
        // The property: a fee is never negative.
        expect(zec, `${route} rendered a NEGATIVE fee — "${context}"`).toBeGreaterThanOrEqual(0);
        expect(
          zec,
          `${route} rendered an implausible fee, likely a pool value balance leaking into the fee equation — "${context}"`,
        ).toBeLessThan(ABSURD_FEE_ZEC);
      }
    });
  }
});

test.describe("the Sprout transaction specifically", () => {
  /**
   * Sprout pinned separately: it is the one pool publishing no bundle value balance, so its fee
   * depends on a term no other pool keeps. This keeps the case covered even if the sweep's
   * heuristics are later narrowed.
   */
  test("renders its real fee, not minus its own output", async ({ page }) => {
    await page.goto(`/tx/${SPROUT_TXID}`);
    const fees = await feeFigures(page);
    expect(fees.length, "the Sprout transaction page shows no fee at all").toBeGreaterThan(0);
    for (const { zec, context } of fees) {
      expect(zec, `Sprout fee wrong — "${context}"`).toBeGreaterThanOrEqual(0);
    }
    // The transparent output is 41,827.18126286 ZEC. A missing Sprout term renders exactly its
    // negation as the fee, so the output's digits must never appear inside a fee context.
    for (const { context } of fees) {
      expect(context, "the fee still mirrors the transparent output").not.toContain("41,827");
    }
  });

  test("does not claim a net shielded figure Sprout never published", async ({ page }) => {
    // `reportsValueBalance` excludes Sprout deliberately: it is shielded but publishes no
    // per-bundle balance, so gating a net figure on `hasShielded` alone would print a fabricated
    // 0.00 here.
    await page.goto(`/tx/${SPROUT_TXID}`);
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/NET TO SHIELDED\s*0\.00\b/);
  });
});

test.describe("an unknown fee says so", () => {
  test("a coinbase shows no fee rather than a zero", async ({ page }) => {
    // A coinbase has no fee at all — `computeFeeZat` returns null rather than 0, and the
    // page must not turn that back into a number the reader would take as measured.
    await page.goto("/blocks");
    await page.waitForLoadState("networkidle");
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/\bfee\s+0(\.0+)?\s*ZEC/i);
  });

  test("FEES 24H states a total, a labelled floor, or 'unavailable' — never a bare 0", async ({
    page,
  }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");
    const text = (await feesCard(page).innerText()).replace(/\s+/g, " ");

    // Exactly one of the three legitimate shapes, and nothing else.
    const complete = /across [\d.,KM]+ blocks/.test(text);
    const floor = /at least/.test(text) && /\d[\d.,KM]* of [\d.,KM]+ blocks/.test(text);
    const unmeasured = /unavailable/i.test(text);
    expect(complete || floor || unmeasured, `FEES 24H said something unrecognised: "${text}"`).toBe(
      true,
    );

    // A floor without its denominator is a real number making an unstated claim.
    if (/at least/.test(text)) {
      expect(text, "a floor must carry its denominator").toMatch(/of [\d.,KM]+ blocks/);
    }
    // Unmeasured must never be dressed as a measurement of zero.
    if (unmeasured) expect(text).not.toMatch(/\d\s*ZEC/);
  });

  test("never spends the Veil on a fee we could not measure", async ({ page }) => {
    // Redaction bars mean "encrypted on-chain, hidden by design". A fee we failed to derive
    // is our shortfall, not a privacy property of Zcash, and conflating the two would teach
    // visitors precisely the wrong thing about the chain.
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");
    await expect(feesCard(page).getByLabel(/value shielded/i)).toHaveCount(0);
  });
});

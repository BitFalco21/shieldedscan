import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { SHIELDED_TXID, VIEWPORTS, collectPageErrors, isOurError } from "./surface";

const AGENT_ON = process.env.NEXT_PUBLIC_AGENT_ENABLED === "1";
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * `/learn` — what only interaction can show. The whole-site sweeps cover the page at rest; this
 * file walks the practice simulator through both kinds of exchange, plays the guided run, and
 * holds the real checks to their contract against the fixture chain:
 *
 * - practice sends nothing anywhere and stores nothing;
 * - the common exchange refuses a shielded address and the reader switches to transparent;
 * - the real check finds a transaction, refuses a recovery phrase, and branches step 2;
 * - nothing scrolls sideways on a phone, mid-flow.
 */

const hint = (page: Page) => page.locator("#learn-modes [aria-live='polite']").first();

async function practiceRunOne(page: Page) {
  await page.locator("#learn-seed").click();
  await page.locator("#learn-buy").click();
  await page.locator("#learn-withdraw").click();
  await expect(page.getByText("Invalid address.")).toBeVisible();
  await page.locator("#learn-use-transparent").click();
  await page.locator("#learn-withdraw").click();
  await page.locator("#learn-shield").click();
  await page.locator("#learn-send").click();
}

test.describe("/learn", () => {
  test.beforeEach(async ({ page }) => {
    // Test blocks land at once, so the walk is about the flow rather than the clock.
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("practice: the common exchange, shield, send privately — with no network and no storage", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto("/learn");
    await page.waitForLoadState("networkidle");
    const requests: string[] = [];
    page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));

    await practiceRunOne(page);
    await expect(hint(page)).toContainText("Optional: send some back to the exchange");
    await expect(page.locator("#learn-ledger li")).toHaveCount(4);
    await expect(page.locator("#learn-knows")).toContainText(
      "moved 0.09985 ZEC into the shielded pool",
    );

    // The fully shielded send shows the site's own veil, never a number.
    const shieldedRow = page.locator("#learn-ledger li").first();
    await expect(shieldedRow.getByRole("img", { name: /value shielded/ })).toHaveCount(4);

    expect(requests, "practice must send nothing").toEqual([]);
    const stored = await page.evaluate(() => [
      ...Object.keys(localStorage),
      ...Object.keys(sessionStorage),
    ]);
    expect(stored).toEqual([]);
    expect(errors.filter(isOurError)).toEqual([]);
  });

  test("practice: an exchange that accepts shielded addresses needs no shielding step", async ({
    page,
  }) => {
    await page.goto("/learn");
    await practiceRunOne(page);
    await page
      .getByRole("button", { name: "try an exchange that accepts shielded addresses" })
      .click();
    await expect(page.getByText("Like Gemini, this one accepts shielded addresses.")).toBeVisible();
    await page.locator("#learn-buy").click();
    await page.locator("#learn-withdraw").click();
    await expect(hint(page)).toContainText("nothing to shield");
    await expect(page.locator("#learn-shield")).toHaveCount(0);
  });

  test("practice: shielding then unshielding the same amount warns about a round trip", async ({
    page,
  }) => {
    await page.goto("/learn");
    await page.locator("#learn-seed").click();
    await page.locator("#learn-buy").click();
    await page.locator("#learn-withdraw").click();
    await page.locator("#learn-use-transparent").click();
    await page.locator("#learn-withdraw").click();
    await page.locator("#learn-shield").click();
    await page.getByLabel("the exchange’s deposit address (t1…)").check();
    await page.locator("#learn-send").click();
    await expect(page.locator("#learn-knows")).toContainText("round trip");
  });

  test("first visit: Zeno greets the reader and offers the tour", async ({ page }) => {
    await page.goto("/learn");
    const coach = page.getByRole("region", { name: "Zeno, your guide" });
    await expect(coach.locator("[data-zeno]")).toBeVisible();
    await expect(hint(page)).toContainText("Hi, I’m Zeno");
    await expect(coach.getByRole("button", { name: "start the tour" })).toBeVisible();
    // Nothing has happened yet, so there is nothing to reset.
    await expect(page.getByRole("button", { name: "reset", exact: true })).toHaveCount(0);

    await coach.getByRole("button", { name: "or explore on my own" }).click();
    await expect(coach).toHaveCount(0);
    await page.locator("#learn-seed").click();
    await expect(hint(page)).toContainText("Buy some test ZEC");
    await expect(page.getByRole("button", { name: "guided tour" })).toBeVisible();
    await expect(page.getByRole("button", { name: "reset", exact: true })).toBeVisible();
  });

  test("the tour leads step by step: one button at a time, back and forward, and a choice at the end", async ({
    page,
  }) => {
    await page.goto("/learn");
    await page.getByRole("button", { name: "start the tour" }).click();
    const tour = page.getByRole("group", { name: "Guided tour" });
    await expect(tour).toBeVisible();
    const advance = () => tour.getByRole("button", { name: /^(next|finish)/ }).click();
    const back = tour.getByRole("button", { name: "back", exact: true });
    const arrowIn = (selector: string) => page.locator(`${selector} [data-tour-arrow]`);
    const rows = page.locator("#learn-ledger li");

    // It starts at the wallet, pointing at the one button to press, and back has nowhere to go.
    await expect(arrowIn("#learn-seed")).toBeVisible();
    await expect(back).toBeDisabled();
    await expect(tour.getByRole("button", { name: /^next/ })).toBeVisible();
    await advance();
    await expect(page.locator("#learn-seed")).toHaveCount(0); // pressed for the reader
    await expect(arrowIn("#learn-buy")).toBeVisible();
    await advance();
    await expect(arrowIn("#learn-withdraw")).toBeVisible();
    await advance();
    await expect(hint(page)).toContainText("Refused");
    await expect(arrowIn("#learn-use-transparent")).toBeVisible();
    await advance();
    await expect(arrowIn("#learn-withdraw")).toBeVisible();
    await advance();
    await expect(hint(page)).toContainText("It arrived");
    await expect(arrowIn("#learn-ledger-new")).toBeVisible();
    await expect(rows).toHaveCount(2);

    // Back is the moment before the press: the withdrawal has not happened yet.
    await back.click();
    await expect(arrowIn("#learn-withdraw")).toBeVisible();
    await expect(rows).toHaveCount(1);

    await advance();
    await expect(hint(page)).toContainText("It arrived");
    await advance();
    await expect(arrowIn("#learn-shield")).toBeVisible();
    await advance();
    await expect(hint(page)).toContainText("Shielded!");
    await expect(rows).toHaveCount(3);
    await advance();
    await expect(arrowIn("#learn-send")).toBeVisible();
    await advance();
    await expect(hint(page)).toContainText("Fully private");
    await expect(rows).toHaveCount(4);
    // Before leaving the practice: a real wallet will not look like this one.
    await advance();
    await expect(hint(page)).toContainText("every wallet shields its own way");
    await expect(page.locator("[data-tour-arrow]")).toHaveCount(0);

    await tour.getByRole("button", { name: /^finish/ }).click();
    await expect(hint(page)).toContainText("You did it!");
    await expect(tour).toHaveCount(0);
    const after = page.getByRole("group", { name: "After the tour" });
    await expect(after.getByRole("button", { name: "watch again" })).toBeVisible();
    await expect(after.getByRole("button", { name: "do it for real →" })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Zeno, your guide" })
        .locator("[data-zeno-expression='answered']"),
    ).toBeVisible();

    // Their own go starts fresh, with the tour one press away.
    await after.getByRole("button", { name: "try it yourself" }).click();
    await expect(rows).toHaveCount(0);
    await expect(page.getByRole("button", { name: "guided tour" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Zeno, your guide" })).toHaveCount(0);
  });

  test("pressing a button before the tour keeps Zeno's offer of it in sight", async ({ page }) => {
    await page.goto("/learn");
    // Straight past the welcome, as a curious reader does.
    await page.locator("#learn-buy").click();
    await expect(page.getByRole("region", { name: "Zeno, your guide" })).toHaveCount(0);
    const offer = page.getByRole("button", { name: "guided tour" });
    await expect(offer).toBeVisible();
    // The way back is the primary action, not a small grey button.
    await expect(offer).toHaveClass(/\bbtn-primary\b/);

    await offer.click();
    await expect(page.getByRole("group", { name: "Guided tour" })).toBeVisible();
    await expect(page.locator("#learn-seed [data-tour-arrow]")).toBeVisible();
    // The tour starts from the beginning, whatever the reader had done.
    await expect(page.locator("#learn-ledger li")).toHaveCount(0);
  });

  test("the tour waits for the reader: nothing moves until they press", async ({ page }) => {
    await page.goto("/learn");
    await page.getByRole("button", { name: "start the tour" }).click();
    await expect(page.locator("#learn-seed [data-tour-arrow]")).toBeVisible();
    await page.waitForTimeout(4_000);
    await expect(page.locator("#learn-seed [data-tour-arrow]")).toBeVisible();
    await expect(page.locator("#learn-ledger li")).toHaveCount(0);
  });

  test("pressing the control Zeno points at moves the tour on; any other press takes over", async ({
    page,
  }) => {
    await page.goto("/learn");
    await page.getByRole("button", { name: "start the tour" }).click();
    const tour = page.getByRole("group", { name: "Guided tour" });
    await expect(page.locator("#learn-seed [data-tour-arrow]")).toBeVisible();

    // The reader does what Zeno asked: the tour continues, exactly as if they had pressed next.
    await page.locator("#learn-seed").click();
    await expect(tour).toBeVisible();
    await expect(page.locator("#learn-buy [data-tour-arrow]")).toBeVisible();
    await page.locator("#learn-buy").click();
    await expect(tour).toBeVisible();
    await expect(page.locator("#learn-withdraw [data-tour-arrow]")).toBeVisible();
    await expect(page.locator("#learn-ledger li")).toHaveCount(1);

    // Something else entirely: the reader takes over where the tour was.
    await page.getByRole("button", { name: "receive" }).click();
    await expect(tour).toHaveCount(0);
    await expect(page.locator("#learn-ledger li")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "guided tour" })).toBeVisible();
  });

  test("on a phone, Zeno never covers what he points at, and nothing leaves its panel", async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/learn");
    await page.getByRole("button", { name: "start the tour" }).click();
    const tour = page.getByRole("group", { name: "Guided tour" });
    const coach = page.getByRole("region", { name: "Zeno, your guide" });
    const problems: string[] = [];
    for (let step = 0; step < 10; step++) {
      if (step > 0) await tour.getByRole("button", { name: /^next/ }).click();
      // Every step points at something; after a landing it waits for the block.
      const arrow = page.locator("[data-tour-arrow]");
      await expect(arrow).toBeVisible();
      await page.waitForTimeout(450); // the smooth scroll settles
      const found = await arrow.evaluate((el) => {
        const panel = el.closest(".panel");
        const a = el.getBoundingClientRect();
        const p = panel?.getBoundingClientRect();
        const box = document
          .querySelector('[aria-label="Zeno, your guide"]')
          ?.getBoundingClientRect();
        return {
          inside: p !== undefined && a.left >= p.left - 1 && a.right <= p.right + 1,
          clear: box !== undefined && a.bottom <= box.top && a.top >= 0,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      if (!found.inside) problems.push(`step ${step}: the arrow leaves its panel`);
      if (!found.clear)
        problems.push(`step ${step}: what Zeno points at is under his box or off screen`);
      if (found.scrollWidth !== VIEWPORTS.mobile.width) {
        problems.push(`step ${step}: the page scrolls sideways (${found.scrollWidth}px)`);
      }
    }
    await expect(coach).toBeVisible();
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("real: the address check runs in the browser and refuses a recovery phrase", async ({
    page,
  }) => {
    await page.goto("/learn");
    await page.getByRole("button", { name: "do it for real", exact: true }).click();
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));

    await page.getByRole("button", { name: "show an example" }).click();
    await expect(page.getByText("receivers inside this address")).toBeVisible();

    const box = page.locator("#learn-in-wallet");
    await box.fill(
      "abandon ability able about above absent absorb abstract absurd abuse access accident",
    );
    await page.getByRole("button", { name: "check" }).click();
    await expect(page.getByText("that looks like a recovery phrase")).toBeVisible();
    await expect(box).toHaveValue("");
    expect(requests, "the address check must not leave the browser").toEqual([]);
  });

  test("real: a pasted transaction is checked, and a wrong kind is caught", async ({ page }) => {
    await page.goto("/learn");
    await page.getByRole("button", { name: "do it for real", exact: true }).click();
    await page.getByRole("button", { name: "send privately" }).click();
    await page.locator("#learn-in-send").fill(SHIELDED_TXID);
    await page.getByRole("button", { name: "check" }).click();
    await expect(page.getByText(/found in block/)).toBeVisible();
    await expect(page.getByText("you and the recipient know")).toBeVisible();

    await page.getByRole("button", { name: "shield", exact: true }).click();
    await page.locator("#learn-in-shield").fill(SHIELDED_TXID);
    await page.getByRole("button", { name: "check" }).click();
    await expect(page.getByText("Not what this step expects.")).toBeVisible();
  });

  test("real: step 2's example is a real transaction from the chain", async ({ page }) => {
    await page.goto("/learn");
    await page.getByRole("button", { name: "do it for real", exact: true }).click();
    await page.getByRole("button", { name: "get ZEC" }).click();
    await page.getByRole("button", { name: "show an example" }).click();
    await expect(page.getByText("example · a real recent transaction")).toBeVisible();
    await expect(page.getByRole("link", { name: "open it on shieldedscan ↗" })).toHaveAttribute(
      "href",
      /^\/tx\/[0-9a-f]{64}$/,
    );
  });

  for (const viewport of Object.values(VIEWPORTS)) {
    test(`nothing scrolls sideways or escapes its panel mid-flow at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/learn");
      /** Every visible element inside a panel stays inside that panel's box. */
      const escapes = () =>
        page.evaluate(() => {
          const out: string[] = [];
          for (const panel of Array.from(document.querySelectorAll("#learn-modes .panel"))) {
            const box = panel.getBoundingClientRect();
            if (box.width === 0) continue;
            for (const el of Array.from(panel.querySelectorAll("*"))) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              if (r.right > box.right + 1 || r.left < box.left - 1) {
                out.push(
                  `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`,
                );
              }
            }
          }
          return out;
        });
      const widths: number[] = [];
      const offenders: string[] = [];
      const measure = async () => {
        widths.push(await page.evaluate(() => document.documentElement.scrollWidth));
        offenders.push(...(await escapes()));
      };

      await practiceRunOne(page);
      await measure();
      await page.getByRole("button", { name: "do it for real", exact: true }).click();
      await page.getByRole("button", { name: "show an example" }).click();
      await expect(page.getByText("receivers inside this address")).toBeVisible();
      await measure();
      await page.getByRole("button", { name: "get ZEC" }).click();
      await page.getByRole("button", { name: "show an example" }).click();
      await expect(page.getByText("example · a real recent transaction")).toBeVisible();
      await measure();
      await page.getByRole("button", { name: "done" }).click();
      await measure();

      expect(
        widths.every((w) => w === viewport.width),
        `scrollWidth ${widths.join(", ")}`,
      ).toBe(true);
      expect(offenders, offenders.join("\n")).toEqual([]);
    });
  }
});

test.describe("/learn — Zeno", () => {
  test.skip(!AGENT_ON, "NEXT_PUBLIC_AGENT_ENABLED is not set for this build");

  test("a step's question is answered in one press, and the drawer keeps the conversation", async ({
    page,
  }) => {
    const asked: string[] = [];
    await page.route("**/agent/ask", async (route) => {
      asked.push(route.request().postData() ?? "");
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body:
          sse("status", { state: "thinking" }) +
          sse("delta", { text: "A shielded address keeps the amount private." }) +
          sse("done", { stopReason: "complete" }),
      });
    });
    await page.goto("/learn");
    await page.getByRole("button", { name: "do it for real", exact: true }).click();
    const question = "What’s the difference between a shielded and a transparent address?";
    await page.getByRole("button", { name: `Ask Zeno: ${question}` }).click();

    const drawer = page.getByRole("dialog", { name: "Ask Zeno" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("never paste a viewing key or seed phrase")).toBeVisible();
    await expect(drawer.getByText("A shielded address keeps the amount private.")).toBeVisible();
    // One request, carrying the button's own question and the page it came from — nothing the
    // reader typed or pasted.
    expect(asked).toHaveLength(1);
    expect(JSON.parse(asked[0] ?? "{}")).toEqual({
      messages: [{ role: "user", content: question }],
      page: "learn",
    });
    await expect(drawer.getByRole("textbox")).toHaveValue("");

    await drawer.getByRole("button", { name: "Close Zeno" }).click();
    await expect(drawer).toBeHidden();
    await page.getByRole("button", { name: "ask zeno", exact: true }).click();
    await expect(drawer.getByText("A shielded address keeps the amount private.")).toBeVisible();
    expect(asked, "opening the drawer again asks nothing").toHaveLength(1);
  });

  test("a practice transaction can be explained, in words and without its test addresses", async ({
    page,
  }) => {
    const asked: string[] = [];
    await page.route("**/agent/ask", async (route) => {
      asked.push(route.request().postData() ?? "");
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body:
          sse("delta", { text: "Anyone can see the address that sent it and the amount." }) +
          sse("done", { stopReason: "complete" }),
      });
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/learn");
    await practiceRunOne(page);
    await expect(page.locator("#learn-ledger li")).toHaveCount(4);

    await page
      .locator("#learn-ledger li")
      .nth(2)
      .getByRole("button", { name: /explain this transaction/ })
      .click();
    const drawer = page.getByRole("dialog", { name: "Ask Zeno" });
    await expect(drawer.getByText("Anyone can see the address that sent it")).toBeVisible();
    const sent = JSON.parse(asked[0] ?? "{}") as { messages: { content: string }[]; page: string };
    expect(sent.page).toBe("learn");
    expect(sent.messages[0]?.content).toMatch(/^In the practice I withdrew 0\.10 ZEC/);
    expect(sent.messages[0]?.content).not.toMatch(/t1[A-Za-z0-9]{20,}|u1[a-z0-9]{20,}/);
  });

  test("while Zeno guides, his corner launcher steps aside", async ({ page }) => {
    await page.goto("/learn");
    const launcher = page.getByRole("button", { name: "ask zeno", exact: true });
    await expect(launcher).toBeVisible();
    await page.getByRole("button", { name: "start the tour" }).click();
    await expect(page.getByRole("group", { name: "Guided tour" })).toBeVisible();
    await expect(launcher).toHaveCount(0);
    await page
      .getByRole("group", { name: "Guided tour" })
      .getByRole("button", { name: "exit" })
      .click();
    await expect(launcher).toBeVisible();
  });

  test("a long answer opens at its question, not scrolled to its foot", async ({ page }) => {
    const paragraphs = Array.from(
      { length: 24 },
      (_, i) => `Paragraph ${i + 1} of a long answer about what shielding keeps private.`,
    ).join("\n\n");
    await page.route("**/agent/ask", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body:
          sse("status", { state: "thinking" }) +
          sse("delta", { text: paragraphs }) +
          sse("done", { stopReason: "complete" }),
      }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/learn");
    const question = "Why can’t anyone see a shielded payment?";
    await page.getByRole("button", { name: `Ask Zeno: ${question}` }).click();
    const drawer = page.getByRole("dialog", { name: "Ask Zeno" });
    await expect(
      drawer.getByText("Paragraph 24 of a long answer", { exact: false }),
    ).toBeAttached();
    await expect(drawer.getByRole("textbox")).toBeEnabled();

    // The pane is far shorter than the answer, so where it rests is the whole question.
    const pane = drawer.locator("[aria-live='polite']").locator("..");
    const asked = drawer.getByText(question, { exact: false }).first();
    const [paneBox, askedBox] = await Promise.all([pane.boundingBox(), asked.boundingBox()]);
    expect(paneBox && askedBox).toBeTruthy();
    if (paneBox && askedBox) {
      expect(askedBox.y).toBeGreaterThanOrEqual(paneBox.y);
      expect(askedBox.y + askedBox.height).toBeLessThanOrEqual(paneBox.y + paneBox.height);
    }
  });
});

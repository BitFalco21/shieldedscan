import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { SHIELDED_TXID, TIP_HEIGHT, TRANSPARENT_ADDR } from "./surface";

/**
 * Zeno's bubble: on every page but its exceptions, nothing loaded or sent until it is used, and a
 * real dialog once it is.
 *
 * Skipped unless the build enables the agent, which is the only build that mounts the bubble.
 */

const AGENT_ON = process.env.NEXT_PUBLIC_AGENT_ENABLED === "1";
const TX_PAGE = `/tx/${SHIELDED_TXID}`;
const PHONE = { width: 390, height: 844 };

/**
 * axe-core as `eslint-plugin-jsx-a11y` already installs it, injected as a script, so the suite
 * adds no dependency. If that plugin ever drops it, this path fails loudly rather than skipping.
 */
const AXE = join(process.cwd(), "node_modules/axe-core/axe.min.js");

interface AxeWindow {
  axe: {
    run: (
      el: Element,
      options?: unknown,
    ) => Promise<{ violations: { id: string; help: string; nodes: unknown[] }[] }>;
  };
}

const bubble = (page: Page) => page.getByRole("button", { name: "Ask Zeno about this page" });
const panel = (page: Page) => page.getByRole("dialog", { name: "Ask Zeno" });
const box = (page: Page) => panel(page).getByRole("textbox");

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

async function stubAgent(page: Page, answer: string): Promise<string[]> {
  const bodies: string[] = [];
  await page.route("**/agent/ask", async (route) => {
    bodies.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        sse("status", { state: "thinking" }),
        sse("delta", { text: answer }),
        sse("done", { stopReason: "complete" }),
      ].join(""),
    });
  });
  return bodies;
}

test.describe("Zeno's bubble", () => {
  test.skip(!AGENT_ON, "the agent is off in this build");

  test("is on a sample of pages, and absent where Zeno already is", async ({ page }) => {
    for (const path of [
      "/",
      "/blocks",
      TX_PAGE,
      `/block/${TIP_HEIGHT}`,
      `/address/${TRANSPARENT_ADDR}`,
      "/shielded",
      "/charts",
      "/privacy",
    ]) {
      await page.goto(path);
      await expect(bubble(page), path).toBeVisible();
    }
    for (const path of ["/ai-agent", "/learn"]) {
      await page.goto(path);
      await expect(bubble(page), path).toHaveCount(0);
    }
  });

  test("loads its code and asks nothing until it is used", async ({ page }) => {
    const asks: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/agent/ask")) asks.push(request.url());
    });
    // Script bodies, in arrival order. The panel's own sentence marks its chunk: chunk names are
    // hashed, so a URL cannot say which one it is.
    const scripts: string[] = [];
    page.on("response", async (response) => {
      if (!response.url().endsWith(".js")) return;
      scripts.push(await response.text().catch(() => ""));
    });
    const panelCode = (body: string) => body.includes("Puts the question in the box for you");

    await page.goto(TX_PAGE);
    await page.waitForLoadState("networkidle");
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.some(panelCode)).toBe(false);

    await bubble(page).click();
    await expect(panel(page)).toBeVisible();
    await expect.poll(() => scripts.some(panelCode)).toBe(true);
    await box(page).fill("is this shielded?");
    expect(asks).toEqual([]);

    const bodies = await stubAgent(page, "Yes, fully shielded.");
    await box(page).press("Enter");
    await expect(panel(page).getByText("Yes, fully shielded.")).toBeVisible();
    expect(bodies).toHaveLength(1);
    // The console's request shape: the question as typed, no page, nothing else.
    expect(JSON.parse(bodies[0]!)).toEqual({
      messages: [{ role: "user", content: "is this shielded?" }],
    });
  });

  test("opens and closes with the mouse, focus going in and coming back", async ({ page }) => {
    await page.goto(TX_PAGE);
    await bubble(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(box(page)).toBeFocused();
    await expect(bubble(page)).toBeHidden();

    await panel(page).getByRole("button", { name: "Close Zeno" }).click();
    await expect(panel(page)).toBeHidden();
    await expect(bubble(page)).toBeFocused();
  });

  test("opens and closes with the keyboard", async ({ page }) => {
    await page.goto(TX_PAGE);
    await bubble(page).focus();
    await page.keyboard.press("Enter");
    await expect(box(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(bubble(page)).toBeFocused();

    await page.keyboard.press("Space");
    await expect(box(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(bubble(page)).toBeFocused();
  });

  test("docks beside the page on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(TX_PAGE);
    const pill = await bubble(page).boundingBox();
    expect(pill).not.toBeNull();
    expect(1280 - (pill!.x + pill!.width)).toBeCloseTo(24, 0);
    expect(800 - (pill!.y + pill!.height)).toBeCloseTo(24, 0);
    expect(pill!.height).toBeCloseTo(56, 0);
    await expect(bubble(page).getByText("ZENO")).toBeVisible();

    await bubble(page).click();
    const rect = await panel(page).boundingBox();
    expect(rect!.width).toBeCloseTo(420, 0);
    expect(rect!.height).toBeCloseTo(620, 0);
    expect(1280 - (rect!.x + rect!.width)).toBeCloseTo(24, 0);
    // Not modal: the page beside it stays usable.
    await expect(panel(page)).toHaveAttribute("aria-modal", "false");
    await expect(page.locator("main")).not.toHaveAttribute("inert");
  });

  test("offers this page's questions; one naming the page's subject waits in the box", async ({
    page,
  }) => {
    await page.goto(TX_PAGE);
    await bubble(page).click();
    await expect(panel(page)).toContainText("on this page: tx a3f2…0000");
    const asks: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/agent/ask")) asks.push(r.url());
    });
    await panel(page)
      .getByRole("button", { name: /what happened in transaction/ })
      .click();
    await expect(box(page)).toHaveValue(`what happened in transaction ${SHIELDED_TXID}?`);
    await expect(box(page)).toBeFocused();
    expect(asks).toEqual([]);

    await box(page).fill("explain");
    await panel(page)
      .getByRole("button", { name: /add to question/ })
      .click();
    await expect(box(page)).toHaveValue(`explain transaction ${SHIELDED_TXID}`);
  });

  test("the box grows with a four-line question and never shows a scrollbar", async ({ page }) => {
    await page.goto(TX_PAGE);
    await bubble(page).click();
    const input = box(page);
    const oneLine = (await input.boundingBox())!.height;
    await input.fill("one\ntwo\nthree\nfour");
    await expect
      .poll(async () => (await input.boundingBox())!.height)
      .toBeGreaterThan(oneLine * 3.5);
    const { scrollHeight, clientHeight } = await input.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
    // Shift+Enter is a new line, not a send.
    await input.press("Shift+Enter");
    await expect(input).toHaveValue("one\ntwo\nthree\nfour\n");
    // Past six lines it stops growing, and only then scrolls.
    await input.fill(Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n"));
    await expect.poll(async () => (await input.boundingBox())!.height).toBeLessThan(oneLine * 6.5);
  });

  test("stays open with its conversation across pages, and ↗ carries it to the console", async ({
    page,
  }) => {
    await stubAgent(page, "Two transactions.");
    await page.goto("/blocks");
    await bubble(page).click();
    await box(page).fill("what happened in the latest block?");
    await box(page).press("Enter");
    await expect(panel(page).getByText("Two transactions.")).toBeVisible();

    // A client-side move to another page: the layout, and with it the panel, stays.
    await page.locator('main a[href^="/block/"]').first().click();
    await expect(page).toHaveURL(/\/block\//);
    await expect(panel(page).getByText("Two transactions.")).toBeVisible();

    await panel(page).getByRole("link", { name: "Continue in the full Zeno page" }).click();
    await expect(page).toHaveURL(/\/ai-agent$/);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByText("what happened in the latest block?")).toBeVisible();
    await expect(page.getByText("Two transactions.")).toBeVisible();
  });

  test("does not take focus back from the page when an answer lands", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Held until the test releases it, so focus can move while the answer is still coming.
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/agent/ask", async (route) => {
      await released;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse("delta", { text: "Done." }) + sse("done", { stopReason: "complete" }),
      });
    });
    await page.goto(TX_PAGE);
    await bubble(page).click();
    await box(page).fill("hello");
    await box(page).press("Enter");
    const outside = page.locator("main a").first();
    await outside.focus();
    release();
    await expect(panel(page).getByText("Done.")).toBeVisible();
    await expect(outside).toBeFocused();
  });

  test("stores nothing: no cookie and no browser storage", async ({ page, context }) => {
    await stubAgent(page, "Fine.");
    await page.goto(TX_PAGE);
    await bubble(page).click();
    await box(page).fill("hi");
    await box(page).press("Enter");
    await expect(panel(page).getByText("Fine.")).toBeVisible();
    expect(await context.cookies()).toEqual([]);
    const stored = await page.evaluate(() => localStorage.length + sessionStorage.length);
    expect(stored).toBe(0);
  });

  test("passes axe while open", async ({ page }) => {
    await page.goto(TX_PAGE);
    await bubble(page).click();
    await expect(box(page)).toBeFocused();
    await page.addScriptTag({ path: AXE });
    const violations = await page.evaluate(async () => {
      const { axe } = window as unknown as AxeWindow;
      const dialog = document.querySelector('[role="dialog"][aria-label="Ask Zeno"]')!;
      const result = await axe.run(dialog);
      return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
    });
    expect(violations).toEqual([]);
  });

  test("after the first answer, `clear` and the question are both in sight", async ({ page }) => {
    await stubAgent(page, "A long answer.\n\n".repeat(40));
    await page.goto(TX_PAGE);
    await bubble(page).click();
    await box(page).fill("tell me everything");
    await box(page).press("Enter");
    await expect(panel(page).getByText("A long answer.").first()).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "clear" })).toBeInViewport();
    await expect(panel(page).getByText("tell me everything")).toBeInViewport();
  });

  test("a second press while the panel loads gives up waiting", async ({ page }) => {
    // Hold every script after the page has loaded, so the panel's chunk cannot arrive.
    await page.goto(TX_PAGE);
    await page.waitForLoadState("networkidle");
    await page.route("**/*.js", () => {});
    await bubble(page).click();
    await expect(page.getByRole("status").filter({ hasText: "waking zeno" })).toBeVisible();
    await bubble(page).click();
    await expect(page.getByRole("status").filter({ hasText: "waking zeno" })).toHaveCount(0);
    await expect(bubble(page)).toHaveAttribute("aria-expanded", "false");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE, hasTouch: true });

    test("a round head-only button, and a sheet that fits the screen", async ({ page }) => {
      await page.goto(TX_PAGE);
      const round = await bubble(page).boundingBox();
      expect(round!.width).toBeCloseTo(60, 0);
      expect(round!.height).toBeCloseTo(60, 0);
      await expect(bubble(page).getByText("ZENO")).toBeHidden();

      const overflow = () =>
        page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(await overflow()).toBeLessThanOrEqual(0);

      await bubble(page).click();
      await expect(panel(page)).toBeFocused();
      expect(await overflow()).toBeLessThanOrEqual(0);
      const escaped = await panel(page).evaluate((root) => {
        const width = window.innerWidth;
        return Array.from(root.querySelectorAll("*"))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > width + 0.5 || r.left < -0.5);
          })
          .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").slice(0, 30)}"`);
      });
      expect(escaped).toEqual([]);
      const sheet = await panel(page).boundingBox();
      expect(sheet!.width).toBeCloseTo(PHONE.width, 0);
      expect(sheet!.height).toBeGreaterThan(PHONE.height * 0.8);
    });

    test("opening takes focus to the sheet, not the box, so no keyboard covers it", async ({
      page,
    }) => {
      await page.goto(TX_PAGE);
      await bubble(page).click();
      await expect(panel(page)).toBeFocused();
      await expect(box(page)).not.toBeFocused();
      await page.keyboard.press("Escape");
      await expect(panel(page)).toBeHidden();
      await expect(bubble(page)).toBeFocused();
    });

    test("the sheet is modal: the page behind it is inert until it closes", async ({ page }) => {
      await page.goto(TX_PAGE);
      await bubble(page).click();
      await expect(panel(page)).toHaveAttribute("aria-modal", "true");
      await expect(page.locator("main")).toHaveAttribute("inert");
      await panel(page).getByRole("button", { name: "Close Zeno" }).click();
      await expect(page.locator("main")).not.toHaveAttribute("inert");
      await expect(bubble(page)).toBeFocused();
    });

    test("every control in the sheet is a 44px target, before and after an answer", async ({
      page,
    }) => {
      const smallControls = () =>
        // Every control but the box itself; links inside an answer's prose are inline text.
        panel(page).evaluate((root) =>
          Array.from(root.querySelectorAll("button, summary, header a"))
            .filter((el) => el.getClientRects().length > 0)
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.height < 44 - 0.5)
            .map(({ el }) => el.getAttribute("aria-label") ?? el.textContent),
        );
      await stubAgent(page, "Fully shielded.");
      await page.goto(TX_PAGE);
      await bubble(page).click();
      await expect(panel(page)).toBeFocused();
      expect(await smallControls()).toEqual([]);

      await box(page).fill("is it shielded?");
      await box(page).press("Enter");
      await expect(panel(page).getByText("Fully shielded.")).toBeVisible();
      await expect(panel(page).getByRole("button", { name: "clear" })).toBeVisible();
      expect(await smallControls()).toEqual([]);
    });
  });
});

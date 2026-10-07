import { expect, test } from "@playwright/test";
import { VIEWPORTS, isOurError } from "./surface";

/**
 * `/pulse` — what only a mounted transport can show.
 *
 * The whole-site sweeps cover the page at rest (overflow, contrast, SVG well-formedness,
 * privacy, links). This file covers the half a static render cannot have, as far as a fixture
 * chain can honestly prove it.
 *
 * A fixture chain does not advance, so no block lands while anybody is watching: nothing here
 * proves a pulse travels, that a pending mark converts rather than doubling, or that reduced
 * motion draws a counter. What is provable is the page's shape and its refusals.
 *
 * The fixture tip is also weeks behind the wall clock, so every replay hour is outside the
 * route's 24-hour reach and comes back 400. That is the state the scrubber's hole-marking
 * exists for, so this file asserts the honest failure: the request is still hour-aligned, and
 * the transport says how many hours it could not read rather than drawing a quiet stretch.
 */

const HOUR = 3600;

test.describe("/pulse", () => {
  test("without JavaScript it is still the ledger: boxes, ribbons, the log — and no controls", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/pulse");

    // The stage: the six places value sits, drawn at the size of what they hold.
    for (const key of ["transparent", "lockbox", "mined", "ironwood", "orchard", "sapling"]) {
      await expect(page.locator(`[data-box="${key}"]`)).toHaveCount(1);
    }
    // The written record of the newest block's movements, which is what a reader who cannot
    // see marks arrive is left with.
    await expect(page.getByText("latest activity")).toBeVisible();
    expect(await page.locator("ol > li[data-block-hash]").count()).toBeGreaterThan(0);
    // The evidence beside the picture: real transparent outputs with their transaction ids.
    await expect(page.locator('a[href^="/tx/"]').first()).toBeVisible();
    // Both rulers, because a size on this page means nothing without its scale — stated in the
    // diagram's <desc> rather than printed or shown on hover.
    const stageTitle = page.locator("svg.pulse-stage-svg > desc");
    await expect(stageTitle).toContainText(/per 10 px²/);
    await expect(stageTitle).toContainText(/per 3 px/);
    await expect(page.locator(".pulse-rulers").getByText(/per 10 px²/)).toHaveCount(0);

    // No control that could not work: no transport, no scrubber, no window switch.
    await expect(page.locator(".pulse-controls")).toHaveCount(0);
    await expect(page.locator(".pulse-scrub")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "ribbon window" })).toHaveCount(0);
    await context.close();
  });

  test("with JavaScript the transport mounts, and replay reveals the scrubber and the speeds", async ({
    page,
  }) => {
    // Collected here rather than through `collectPageErrors`: that helper keeps a console
    // message's text, Chromium puts the failing URL only in its location, and the text of every
    // failed request is the same sentence.
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const { url } = message.location();
      errors.push(url ? `${message.text()} @ ${url}` : message.text());
    });
    page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/pulse");
    await page.waitForLoadState("networkidle");

    // Live is where the page starts, and it says so.
    const time = page.getByRole("group", { name: "time" });
    await expect(time.getByRole("button", { name: "● live" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // A viewport over data already on the page, so it is a button and not a URL.
    await expect(page.locator(".pulse-scrub")).toHaveCount(0);
    // Nothing may go wrong at all before the transport is touched: the live page is the one
    // every visitor lands on.
    expect(errors.filter(isOurError)).toEqual([]);

    await time.getByRole("button", { name: "◂ replay" }).click();
    await expect(page.locator(".pulse-scrub")).toBeVisible();
    const speeds = page.getByRole("group", { name: "speed" });
    await expect(speeds.getByRole("button", { name: "×10" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await speeds.getByRole("button", { name: "×600" }).click();
    await expect(speeds.getByRole("button", { name: "×600" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(speeds.getByRole("button", { name: "×10" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // The scrubber moves the clock the page prints, and the printed clock is seconds-ago.
    const scrub = page.locator(".pulse-scrub");
    await scrub.fill("1800");
    await expect(page.getByText(/0:30:00 ago/)).toBeVisible();

    // The ribbon window is the other viewport, and it is pressed-state too.
    const windows = page.getByRole("group", { name: "ribbon window" });
    await windows.getByRole("button", { name: "30d" }).click();
    await expect(windows.getByRole("button", { name: "30d" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The ruler must change with it: a ribbon's width means nothing without the window it was
    // summed over.
    await expect(page.locator("svg.pulse-stage-svg > desc")).toContainText("the last 30 days");

    // Replay hours outside the route's 24-hour reach answer 400 on a fixture chain — the only
    // failure this build may legitimately log. Narrow on purpose: `!e.includes("400")` would
    // excuse any error carrying those three digits — a block height, an amount, a txid fragment.
    const refusedHour = (e: string) => /\/api\/pulse\/window\b/.test(e) && /\b400\b/.test(e);
    expect(errors.filter(isOurError).filter((e) => !refusedHour(e))).toEqual([]);
  });

  test("every replay window it asks for is a whole aligned hour, and a refused one is MARKED", async ({
    page,
  }) => {
    const asked: URL[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.pathname === "/api/pulse/window") asked.push(url);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/pulse");
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("group", { name: "time" })
      .getByRole("button", { name: "◂ replay" })
      .click();

    await expect.poll(() => asked.length, { timeout: 10_000 }).toBeGreaterThan(0);
    for (const url of asked) {
      const from = Number(url.searchParams.get("from"));
      const to = Number(url.searchParams.get("to"));
      expect(Number.isInteger(from) && from % HOUR === 0, `unaligned from: ${from}`).toBe(true);
      expect(to - from, "a window is exactly one hour").toBe(HOUR);
    }

    // The fixture tip is weeks behind the wall clock, so the route refuses every hour. The
    // scrubber must then say the replay has holes: a quiet stretch a reader cannot tell from
    // an hour we could not read is the one failure the marking exists to prevent.
    const gap = page.locator("[data-pulse-gap] > span");
    await expect(gap).toContainText(/hours? unavailable/);
    // In the warning role — our outage — never the Veil's green.
    await expect(gap).toHaveClass(/\btext-warn\b/);
  });

  test("it reaches no other origin and stores nothing", async ({ page }) => {
    const offOrigin: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
        offOrigin.push(`${r.resourceType()} ${url}`);
      }
    });
    await page.goto("/pulse");
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("group", { name: "time" })
      .getByRole("button", { name: "◂ replay" })
      .click();
    await page.locator(".pulse-scrub").fill("600");
    await page.waitForTimeout(1_000);

    expect(offOrigin, "the stage must reach no other origin").toEqual([]);
    const stored = await page.evaluate(() => ({
      local: Object.keys(localStorage).filter((k) => k !== "theme"),
      session: Object.keys(sessionStorage),
    }));
    // Nothing is remembered: the transport is a viewport, not a preference.
    expect(stored).toEqual({ local: [], session: [] });
  });

  test("the stage is one labelled image, and no redaction stands in for an absence of ours", async ({
    page,
  }) => {
    await page.goto("/pulse");
    await page.waitForLoadState("networkidle");

    // A reader who cannot see it gets one sentence for the whole picture, not 40 marks.
    const stage = page.locator("svg.pulse-stage-svg");
    await expect(stage).toHaveAttribute("role", "img");
    const label = (await stage.getAttribute("aria-label")) ?? "";
    expect(label.length).toBeGreaterThan(40);

    // The Veil means encrypted on-chain and nothing else — not a figure we failed to read. So
    // the checkable property is a count: exactly the movements whose amount is encrypted carry a
    // bar, and nothing else does. The page marks those rows itself (`data-shielded`), so this
    // compares two numbers the page produced.
    const counts = await page.evaluate(() => ({
      bars: document.querySelectorAll(".redact").length,
      shieldedRows: document.querySelectorAll("li[data-shielded='true']").length,
      barsOutsideAShieldedRow: [...document.querySelectorAll(".redact")].filter(
        (el) => el.closest("li[data-shielded='true']") === null,
      ).length,
      // Every state that means "we could not read this" — none may carry a redaction mark of
      // either kind (`.pulse-veil` is the stage's form of the bar). This arm finds nothing when
      // every pool is present, so the count check above carries the test.
      redactionInsideAMarkedState: [...document.querySelectorAll(".redact, .pulse-veil")].filter(
        (el) => el.closest(".is-unavailable, .is-absent, .pulse-status") !== null,
      ).length,
    }));

    // A non-zero guard first: a count check both sides satisfy with zero proves nothing.
    expect(counts.shieldedRows, "the frame draws no fully shielded movement").toBeGreaterThan(0);
    expect(counts.bars).toBe(counts.shieldedRows);
    expect(counts.barsOutsideAShieldedRow, "a bar outside a shielded movement").toBe(0);
    expect(counts.redactionInsideAMarkedState).toBe(0);

    // Every redaction bar that IS drawn says what it means, in words.
    for (const bar of await page.locator(".redact").all()) {
      expect(await bar.getAttribute("aria-label")).toContain("shielded");
    }
  });

  test("the stage scrolls inside its own box; the page never scrolls sideways", async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/pulse");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the page itself must never scroll sideways").toBeLessThanOrEqual(0);

    // The picture is pushed rather than shrunk to two-pixel labels — and the hint that it can
    // be pushed is drawn from the same media query that creates the scroll.
    const stage = page.locator(".pulse-stage");
    const scrollable = await stage.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(scrollable, "the stage must be the thing that scrolls").toBeGreaterThan(0);
    await expect(page.locator(".pulse-scroll-hint")).toBeVisible();
  });

  test("under reduced motion the log is the record, and every row states its movement", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/pulse");
    await page.waitForLoadState("networkidle");

    // The preference reached the stage: the engine draws static marks, and `.is-still` says so.
    // Without this the emulateMedia call would be decoration.
    await expect(page.locator(".is-still")).toHaveCount(1);

    // A reader who asked not to see things move is not left reading marks. Each row carries
    // its own sentence, so nothing on it annotates something moving on the stage.
    const rows = page.locator("ol > li[data-block-hash]");
    expect(await rows.count()).toBeGreaterThan(0);
    const text = (await rows.first().innerText()).trim();
    expect(text.length).toBeGreaterThan(10);

    // And it never narrates a payment: choosing which output was the payment and which was
    // change is the inference this site refuses.
    const log = (await page.locator("ol").first().innerText()).toLowerCase();
    expect(log).not.toMatch(/sent .* to /);
  });
});

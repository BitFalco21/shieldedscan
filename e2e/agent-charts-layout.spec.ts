import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { PlottedChart } from "../src/domain";
import { CHART_CASES, chartFor } from "./agent-chart-cases";

/**
 * Zeno's charts, laid out: every catalogue series alone and the common combinations, as
 * `make_chart` builds them over the fixture world, at a phone's width and a desktop's. Geometry,
 * not pixels: tick and legend labels must not overlap or leave their frame, ticks must render at a
 * readable size, the page must not scroll sideways, and axe must pass on the chart and its table.
 *
 * No screenshot baselines: the fonts are the system's and the hover readout follows the pointer,
 * so a pixel diff would fail on a machine change rather than on a layout fault. The boxes below
 * are what a reader sees, measured the same way on any machine.
 */

const AGENT_ON = process.env.NEXT_PUBLIC_AGENT_ENABLED === "1";

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

/** Smallest rendered tick text, as a box height in CSS px (about 1.2× the font size). */
const MIN_TICK_BOX_PX = 10;

/**
 * axe-core as `eslint-plugin-jsx-a11y` already installs it: injected as a script, so the suite
 * adds no dependency. If that plugin ever drops it, this path fails loudly rather than skipping.
 */
const AXE = join(process.cwd(), "node_modules/axe-core/axe.min.js");

interface AxeWindow {
  axe: { run: (el: Element) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> };
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Ask once, with a stubbed stream carrying the chart, and return its figure. */
async function showChart(page: Page, chart: PlottedChart): Promise<Locator> {
  await page.route("**/agent/ask", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        sse("delta", { text: "Charted from the explorer's own series." }),
        sse("chart", chart),
        sse("sources", { sources: [] }),
        sse("done", { stopReason: "complete" }),
      ].join(""),
    }),
  );
  await page.goto("/ai-agent");
  await page.getByLabel(/Ask a question/i).fill("chart it");
  await page.getByRole("button", { name: "send" }).click();
  const figure = page.locator("figure").first();
  await expect(figure.locator("svg[role=img]")).toBeVisible();
  return figure;
}

/** Every label that overlaps another, leaves its frame, or renders too small to read. */
function layoutProblems(figure: Locator, minTickPx: number): Promise<string[]> {
  return figure.evaluate((fig, min) => {
    const out: string[] = [];
    const svg = fig.querySelector("svg[role=img]")!.getBoundingClientRect();
    const frame = fig.getBoundingClientRect();
    const boxes = (els: Element[]) =>
      els.map((e) => ({ text: (e.textContent ?? "").trim(), r: e.getBoundingClientRect() }));
    // Two labels on one line need a gap of about half a character, or "0 ZEC" and "2026-07-01"
    // read as one run; stacked lines may touch by half a pixel of antialiasing.
    const overlap = (a: DOMRect, b: DOMRect) =>
      a.left < b.right + 4 &&
      b.left < a.right + 4 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;
    const inside = (r: DOMRect, box: DOMRect) =>
      r.left >= box.left - 0.5 &&
      r.right <= box.right + 0.5 &&
      r.top >= box.top - 0.5 &&
      r.bottom <= box.bottom + 0.5;

    const ticks = boxes([...fig.querySelectorAll("text.chart-tick")]);
    const legend = boxes([...fig.querySelectorAll("ul > li")]);
    for (const [kind, group] of [
      ["tick", ticks],
      ["legend item", legend],
    ] as const) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (overlap(group[i]!.r, group[j]!.r)) {
            out.push(`${kind}s overlap or touch: "${group[i]!.text}" and "${group[j]!.text}"`);
          }
        }
      }
    }
    for (const t of ticks) {
      if (t.text === "") out.push("an empty tick label");
      if (!inside(t.r, svg)) out.push(`tick "${t.text}" leaves the chart`);
      if (t.r.height < min) out.push(`tick "${t.text}" renders ${t.r.height.toFixed(1)}px tall`);
    }
    for (const l of legend)
      if (!inside(l.r, frame)) out.push(`legend "${l.text}" leaves the figure`);
    return out;
  }, minTickPx);
}

test.describe("Zeno's charts lay out cleanly at phone and desktop widths", () => {
  test.skip(!AGENT_ON, "NEXT_PUBLIC_AGENT_ENABLED is not set for this build");

  for (const c of CHART_CASES) {
    test(c.name, async ({ page }) => {
      const chart = await chartFor(c);
      await page.setViewportSize(VIEWPORTS[0]);
      const figure = await showChart(page, chart);
      // The table opens inside the figure, so axe checks its scroll region too.
      await figure.getByRole("button", { name: "show table" }).click();
      await page.addScriptTag({ path: AXE });

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await expect(figure.getByRole("table")).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `${viewport.name}: the page scrolls sideways`).toBeLessThanOrEqual(0);
        const problems = await layoutProblems(figure, MIN_TICK_BOX_PX);
        expect(problems, `${viewport.name}:\n${problems.join("\n")}`).toEqual([]);
        const violations = await figure.evaluate(async (fig) => {
          const { axe } = window as unknown as AxeWindow;
          const result = await axe.run(fig);
          return result.violations.map((v) => `${v.id} (${v.nodes.length})`);
        });
        expect(violations, `${viewport.name}: axe`).toEqual([]);
      }
    });
  }
});

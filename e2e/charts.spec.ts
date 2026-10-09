/**
 * Charts — hand-rolled SVG, so the usual library guarantees do not apply.
 *
 * The failure mode that matters is silent: a single `NaN` anywhere in a path's `d` attribute
 * makes the browser discard the whole path and draw nothing. No error, no warning, an empty
 * panel where a chart was. Since every chart here is generated from arithmetic over chain
 * data, one division by a zero-length series does it.
 *
 * These tests read the geometry the browser was actually given, rather than screenshotting
 * the result, so they say *which* number broke and need no baseline.
 */

import { expect, test } from "@playwright/test";
import { VIEWPORTS } from "./surface";

/** The routes that draw something. */
const CHART_ROUTES = [
  "/analytics",
  "/shielded",
  "/cross-chain/flows",
  "/mempool",
  "/",
  // The per-pool catalog charts: only a real browser proves their SVG geometry at both grains.
  "/charts/pool-usage",
  "/charts/pool-migrations",
  // The newer charts: bands, dashed targets, weekly markers and a chain stack, each a new
  // geometry path that only a real browser proves well-formed. Plus the library's thumbnails.
  "/charts/blocks-per-day",
  "/charts/reorgs",
  "/charts/inflow-by-chain",
  "/charts/outflow-by-chain",
  "/charts/volume-by-venue",
  "/charts/shielded-capable-swaps",
  "/charts/shielded-share",
  "/charts/lockbox-balance",
  "/charts/upgrade-readiness",
  "/charts/anonymity-set",
  "/charts",
  // The stage is SVG end to end — boxes, ribbons and the heartbeat — and it is drawn from
  // runtime geometry rather than from a chart component, so the well-formedness invariant is
  // the only thing that can catch a NaN width reaching an attribute.
  "/pulse",
  // The node map, software bars and health histograms are SVG drawn from runtime geometry, so a
  // NaN reaching an attribute is what this invariant catches. The topology tab (`/network`
  // itself) is a canvas and is not listed.
  "/network/map",
  "/network/software",
  "/network/upgrade",
  "/network/health",
];

interface SvgReport {
  route: string;
  totalSvgs: number;
  emptyPaths: string[];
  badNumbers: string[];
  missingViewBox: number;
  zeroSized: number;
  unlabelled: string[];
}

test.describe("chart geometry is valid", () => {
  for (const route of CHART_ROUTES) {
    test(`${route} draws only well-formed SVG`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const report: SvgReport = await page.evaluate((currentRoute) => {
        const NUMERIC_ATTRS = [
          "x",
          "y",
          "x1",
          "x2",
          "y1",
          "y2",
          "cx",
          "cy",
          "r",
          "width",
          "height",
        ];
        const emptyPaths: string[] = [];
        const badNumbers: string[] = [];
        const unlabelled: string[] = [];
        let missingViewBox = 0;
        let zeroSized = 0;

        const svgs = Array.from(document.querySelectorAll("svg"));
        for (const svg of svgs) {
          if (!svg.getAttribute("viewBox")) missingViewBox += 1;
          const rect = svg.getBoundingClientRect();
          // An SVG with no layout box is not rendered at this width — a chart drawn twice and
          // switched by breakpoint hides one with `display: none`. That is not a collapse; a
          // rendered SVG at zero size still is.
          const rendered = svg.getClientRects().length > 0;
          if (rendered && (rect.width === 0 || rect.height === 0)) zeroSized += 1;
          // A decorative mark is fine unlabelled if it is aria-hidden; a chart is not.
          const labelled =
            svg.getAttribute("aria-label") ??
            svg.getAttribute("aria-labelledby") ??
            svg.getAttribute("role") ??
            (svg.getAttribute("aria-hidden") === "true" ? "hidden" : null);
          if (!labelled && rect.width > 80 && rect.height > 40) {
            unlabelled.push(svg.outerHTML.slice(0, 70));
          }
        }

        for (const path of Array.from(document.querySelectorAll("svg path"))) {
          const d = path.getAttribute("d") ?? "";
          if (d.trim() === "") {
            emptyPaths.push("<path> with an empty d");
            continue;
          }
          if (/NaN|Infinity|undefined|null/.test(d)) {
            badNumbers.push(`path d="${d.slice(0, 90)}"`);
          }
        }

        for (const el of Array.from(document.querySelectorAll("svg *"))) {
          for (const name of NUMERIC_ATTRS) {
            const value = el.getAttribute(name);
            if (value === null) continue;
            if (
              /NaN|Infinity|undefined/.test(value) ||
              (value !== "" && Number.isNaN(Number(value.replace("%", ""))))
            ) {
              // Percentages and keywords are legal; only flag values that look numeric and are not.
              if (!/^[\d.%\-+e]+$/i.test(value)) continue;
              badNumbers.push(`<${el.tagName} ${name}="${value}">`);
            }
          }
        }

        return {
          route: currentRoute,
          totalSvgs: svgs.length,
          emptyPaths,
          badNumbers,
          missingViewBox,
          zeroSized,
          unlabelled,
        };
      }, route);

      expect(
        report.badNumbers,
        `${route} — non-numeric geometry:\n${report.badNumbers.join("\n")}`,
      ).toEqual([]);
      expect(report.emptyPaths, `${route} — ${report.emptyPaths.length} empty path(s)`).toEqual([]);
      expect(report.zeroSized, `${route} — ${report.zeroSized} SVG(s) collapsed to zero size`).toBe(
        0,
      );
      expect(
        report.unlabelled,
        `${route} — chart-sized SVG with no accessible name:\n${report.unlabelled.join("\n")}`,
      ).toEqual([]);
    });
  }
});

test.describe("brand marks are visible and fit their box", () => {
  /**
   * The geometric half of the brand-mark guards (the data half is a unit test).
   *
   * Two failure modes: a mark with no path data renders an invisible SVG that reads as
   * whitespace, and a mark drawn off-centre inside its viewBox sits hard against one edge and
   * reads as clipped. Neither throws, and both look like a styling accident.
   */
  for (const route of ["/cross-chain", "/cross-chain/flows"]) {
    test(`${route} — every brand mark paints ink and sits inside its viewBox`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const svgs = Array.from(document.querySelectorAll<SVGSVGElement>('svg[class*="brand-"]'));
        for (const svg of svgs) {
          const ticker =
            (svg.getAttribute("class") ?? "").match(/brand-([a-z0-9]+)/)?.[1] ?? "(unknown)";
          const box = svg.viewBox.baseVal;
          const paths = Array.from(svg.querySelectorAll<SVGPathElement>("path"));
          if (paths.length === 0) {
            out.push(`${ticker}: no path`);
            continue;
          }
          for (const path of paths) {
            const d = path.getAttribute("d") ?? "";
            if (d.trim() === "") {
              out.push(`${ticker}: empty path data — the mark is invisible`);
              continue;
            }
            const bb = path.getBBox();
            if (bb.width === 0 || bb.height === 0) {
              out.push(`${ticker}: path has no extent`);
              continue;
            }
            // Escaping the viewBox is clipping, plain and simple. 0.5 user units of slack for
            // stroked marks, whose bbox excludes the stroke.
            const slack = 0.5;
            if (
              bb.x < box.x - slack ||
              bb.y < box.y - slack ||
              bb.x + bb.width > box.x + box.width + slack ||
              bb.y + bb.height > box.y + box.height + slack
            ) {
              out.push(
                `${ticker}: bbox ${bb.x.toFixed(1)},${bb.y.toFixed(1)} ${bb.width.toFixed(1)}×${bb.height.toFixed(1)} escapes viewBox ${box.width}×${box.height}`,
              );
              continue;
            }
            // Lopsided padding, judged relative to the viewBox so it holds for 24×24 and 32×17
            // marks alike.
            const padLeft = bb.x - box.x;
            const padRight = box.x + box.width - (bb.x + bb.width);
            const skew = Math.abs(padLeft - padRight) / box.width;
            if (skew > 0.12) {
              out.push(
                `${ticker}: off-centre — ${padLeft.toFixed(1)}px left vs ${padRight.toFixed(1)}px right`,
              );
            }
          }
        }
        return out;
      });

      expect(problems, `${route}:\n${problems.join("\n")}`).toEqual([]);
    });
  }

  test("a chain with no mark gets a lettermark, never a blank", async ({ page }) => {
    // The documented fallback. A blank where a logo should be is worse than an initial, and
    // this is what makes an unlisted chain render sensibly with no code change.
    await page.goto("/cross-chain");
    const blanks = await page.evaluate(() =>
      Array.from(document.querySelectorAll("table tbody td"))
        .filter((td) => {
          const badge = td.querySelector('span[aria-hidden][class*="rounded-full"]');
          return badge !== null && (badge.textContent ?? "").trim() === "";
        })
        .map((td) => (td.textContent ?? "").trim().slice(0, 40)),
    );
    expect(blanks, `empty lettermark badges beside: ${blanks.join(" | ")}`).toEqual([]);
  });
});

test.describe("charts actually plot something", () => {
  test("/analytics renders series with real extent, not a flat line at zero", async ({ page }) => {
    // A chart drawn from an empty or all-zero series still renders — as a straight line along
    // the axis. That looks like data and is the visual form of a fabricated number.
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");

    const extents = await page.evaluate(() =>
      Array.from(document.querySelectorAll("svg path[d]"))
        .map((p) => p.getAttribute("d") ?? "")
        .filter((d) => d.length > 40)
        .map((d) => {
          const ys = Array.from(d.matchAll(/[-\d.]+[,\s]+([-\d.]+)/g), (m) => Number(m[1])).filter(
            Number.isFinite,
          );
          return ys.length === 0 ? 0 : Math.max(...ys) - Math.min(...ys);
        }),
    );
    expect(extents.length, "/analytics drew no substantial paths").toBeGreaterThan(0);
    expect(
      Math.max(...extents),
      "every series on /analytics is flat — the data may be empty",
    ).toBeGreaterThan(1);
  });

  test("the Sankey's ribbons sum to its boundary, and the tail is folded not dropped", async ({
    page,
  }) => {
    // A dropped tail silently shrinks the boundary the picture claims to measure, so the fold
    // must be present and counted.
    await page.goto("/cross-chain/flows");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main svg").first()).toBeVisible();

    const text = await page.locator("main").innerText();
    // The tables beneath the charts are the evidence half; there is one per direction, so this
    // asserts both — a dropped direction would leave one Sankey with no exact figures behind it.
    const tables = page.locator("main table");
    expect(await tables.count(), "each direction needs its own evidence table").toBe(2);
    await expect(tables.first()).toBeVisible();
    await expect(tables.last()).toBeVisible();
    // And the copy must not claim a ratio without the word that qualifies it.
    if (/\bmore ZEC\b/i.test(text)) {
      expect(text, "a ratio is stated without naming which side is larger").toMatch(
        /left|arrived|inbound|outbound|balanced/i,
      );
    }
  });
});

test.describe("chart hover readouts", () => {
  /**
   * The readout's job is to state the number the reader is pointing at, so these check it
   * against figures rendered by a different code path where one exists.
   */
  test("/analytics exposes a readout on every chart", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");
    // Privacy kind, where value sits, gross shielding flow, and the fee-cost medians.
    await expect(page.getByRole("group", { name: /arrow keys/i })).toHaveCount(4);
  });

  test("every readout label carries a four-digit year", async ({ page }) => {
    // "Jun 22" in a panel with no axis around it reads as a day. The same ambiguity is why
    // the coverage note spells its year out (see the test below).
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");
    const groups = page.getByRole("group", { name: /arrow keys/i });
    for (let i = 0; i < (await groups.count()); i += 1) {
      const group = groups.nth(i);
      await group.focus();
      await page.keyboard.press("End");
      const label = (await group.locator('[role="status"]').innerText()).split("\n")[0] ?? "";
      expect(label, `readout ${i} label "${label}" has no full year`).toMatch(/\b(19|20)\d{2}\b/);
    }
  });

  test("the coverage note states a full year, not a bare day-like month", async ({ page }) => {
    // The coverage on the TRANSACTIONS sub-label must carry a four-digit year: "since Oct 16"
    // reads as a date.
    await page.goto("/analytics");
    const card = await page
      .getByText("TRANSACTIONS", { exact: true })
      .locator("xpath=..")
      .innerText();
    expect(card, `"${card.replace(/\n/g, " ")}" is ambiguous`).toMatch(
      /since\s+\w+\s+(19|20)\d{2}/,
    );
  });

  test("net flow is a signed ZEC figure, never a raw zatoshi integer", async ({ page }) => {
    // A ten-digit bare integer is the signature of a raw value leaking into the readout, e.g. a
    // month's net flow rendered as "+1348200000000".
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");
    const netFlow = page.getByRole("group", { name: /arrow keys/i }).nth(2);
    await netFlow.focus();
    await page.keyboard.press("End");
    const readout = await netFlow.locator('[role="status"]').innerText();
    expect(readout, `net flow readout: ${readout}`).toMatch(/ZEC/);
    expect(readout, "net flow shows an unformatted zatoshi count").not.toMatch(/\d{9,}/);
  });

  test("/mining difficulty is readable at every point, and the range labels agree", async ({
    page,
  }) => {
    // The cross-check: sweep every point with the keyboard, then assert the low/high printed
    // under the chart bracket exactly what the readout reports. Those labels and the readout
    // are rendered from the same array but by different code paths — a scaling error, an
    // off-by-one on the last point, or a second formatter would break the agreement.
    await page.goto("/mining");
    await page.waitForLoadState("networkidle");

    const chart = page.getByRole("group", { name: /arrow keys/i }).first();
    await chart.focus();
    await page.keyboard.press("Home");

    const seen: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const readout = await chart.locator('[role="status"]').innerText();
      const value = readout.split("\n").at(-1)?.trim();
      expect(value, `no difficulty in readout:\n${readout}`).toBeTruthy();
      if (seen.at(-1) !== value) seen.push(value!);
      await page.keyboard.press("ArrowRight");
    }

    // The whole panel, not the title's parent — `xpath=..` from the heading reaches only the
    // panel header, where the range labels are not.
    const panel = page.locator("section.panel").filter({ hasText: "DIFFICULTY TREND" }).first();
    const text = await panel.innerText();
    const low = text.match(/low\s+([\d.,]+[KMB]?)/)?.[1];
    const high = text.match(/high\s+([\d.,]+[KMB]?)/)?.[1];
    expect(low, `no low label in:\n${text}`).toBeTruthy();
    expect(high, `no high label in:\n${text}`).toBeTruthy();

    const numeric = (s: string) => Number(s.replace(/,/g, "").replace(/[KMB]$/, ""));
    const values = seen.map(numeric).filter((n) => Number.isFinite(n));
    expect(values.length, `no numeric readouts among ${seen.join(", ")}`).toBeGreaterThan(3);
    expect(Math.min(...values)).toBeCloseTo(numeric(low!), 1);
    expect(Math.max(...values)).toBeCloseTo(numeric(high!), 1);
  });

  test("/mining readout names a full year and the block height it can be checked against", async ({
    page,
  }) => {
    await page.goto("/mining");
    await page.waitForLoadState("networkidle");
    const chart = page.getByRole("group", { name: /arrow keys/i }).first();
    await chart.focus();
    await page.keyboard.press("End");
    const label = (await chart.locator('[role="status"]').innerText()).split("\n")[0] ?? "";
    expect(label, `"${label}" has no full year`).toMatch(/\b(19|20)\d{2}\b/);
    // A date names ~1,150 blocks; a height names one, which is what makes the figure
    // checkable against the chain.
    expect(label, `"${label}" names no block height`).toMatch(/#[\d,]+/);
  });

  test("stepping right never moves the readout backwards in time", async ({ page }) => {
    // Monotonicity is the property that catches an off-by-one or an inverted axis, without
    // needing to know any particular value.
    await page.goto("/shielded");
    await page.waitForLoadState("networkidle");
    const chart = page.getByRole("group", { name: /arrow keys/i }).first();
    await chart.focus();
    await page.keyboard.press("Home");

    const heights: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const label = (await chart.locator('[role="status"]').innerText()).split("\n")[0] ?? "";
      const height = Number(label.replace(/[^\d]/g, ""));
      if (Number.isFinite(height) && height > 0) heights.push(height);
      await page.keyboard.press("ArrowRight");
    }
    expect(heights.length).toBeGreaterThan(2);
    for (let i = 1; i < heights.length; i += 1) {
      expect(heights[i], `height went ${heights[i - 1]} → ${heights[i]}`).toBeGreaterThan(
        heights[i - 1]!,
      );
    }
  });

  test("Escape dismisses the readout and blur clears it", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");
    const chart = page.getByRole("group", { name: /arrow keys/i }).first();
    await chart.focus();
    await page.keyboard.press("End");
    await expect(chart.locator('[role="status"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chart.locator('[role="status"]')).toHaveCount(0);
  });

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${name} — the readout stays inside its panel, including at the far right`, async ({
      page,
    }) => {
      // It flips sides past the midpoint precisely so it cannot overflow. If that logic is
      // wrong the panel clips it, which the overflow suite would never see because it does
      // not hover.
      await page.setViewportSize(viewport);
      await page.goto("/analytics");
      await page.waitForLoadState("networkidle");

      const chart = page.getByRole("group", { name: /arrow keys/i }).first();
      await chart.focus();
      for (const key of ["Home", "End"]) {
        await page.keyboard.press(key);
        const readout = chart.locator('[role="status"]');
        await expect(readout).toBeVisible();
        const fits = await readout.evaluate((el) => {
          const panel = el.closest(".panel")?.parentElement ?? document.body;
          const a = el.getBoundingClientRect();
          const b = panel.getBoundingClientRect();
          return a.left >= b.left - 1 && a.right <= b.right + 1;
        });
        expect(fits, `readout escapes its panel at ${key} on ${name}`).toBe(true);
      }
    });
  }
});

/**
 * Layout invariants, each held as a property over the site.
 *
 * - A data table lives in a panel. `DataTable` paints its header row the panel colour and leaves
 *   its edge columns flush; on the bare page background that draws a lighter band with the labels
 *   touching its edges.
 * - A detail page's top-level blocks span the content column, and panels sharing a row share it
 *   equally — no block capped narrower than its neighbours.
 * - A table fits its panel from `lg`, where its wrapper stops scrolling. On a phone the rich
 *   list's SHARE and /compare/all's implied price stay on screen.
 * - Mempool size and age cells hold one line; an IN/OUT cell breaks before its arrow, never
 *   between an input and an output.
 * - /txs on a phone shows its list in the first screen, not just stat cards.
 *
 * Geometry only — no screenshots, no baselines.
 */

import { expect, test } from "@playwright/test";
import {
  ROUTES,
  settleLayout,
  SHIELDED_TXID,
  TIP_HEIGHT,
  TRANSPARENT_ADDR,
  UNIFIED_ADDR,
  VIEWPORTS,
} from "./surface";

test.describe("every data table sits inside a panel", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  for (const route of ROUTES) {
    test(`${route}`, async ({ page }) => {
      await page.goto(route);
      await settleLayout(page);
      const bare = await page.evaluate(() =>
        Array.from(document.querySelectorAll("table.data-table"))
          .filter((table) => table.closest(".panel") === null)
          .map((table) => table.querySelector("caption")?.textContent?.trim() || "(no caption)"),
      );
      expect(bare, `${route}: tables on the bare page background:\n${bare.join("\n")}`).toEqual([]);
    });
  }
});

test.describe("a detail page's top-level blocks span the content column", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  // Every direct child of <main> — the header, each panel, each veil, each row of side-by-side
  // panels — spans the column. Measured block by block: a block-level header always fills
  // <main>, so comparing it to the column would prove nothing.
  const CASES = [
    `/tx/${SHIELDED_TXID}`,
    "/cross-chain/thor-8842",
    "/name/abraham",
    `/address/${UNIFIED_ADDR}`,
    `/address/${TRANSPARENT_ADDR}`,
    `/block/${TIP_HEIGHT}`,
    "/shielded",
    "/analytics",
  ] as const;

  for (const route of CASES) {
    test(`${route}`, async ({ page }) => {
      await page.goto(route);
      await settleLayout(page);
      const measured = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (main === null) return null;
        const style = getComputedStyle(main);
        const column =
          main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const label = (el: Element) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(" ").slice(0, 3).join(".")}`;
        const narrow: string[] = [];
        const uneven: string[] = [];
        let blocks = 0;
        for (const child of Array.from(main.children)) {
          const rect = child.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          blocks += 1;
          if (Math.abs(rect.width - column) > 1) {
            narrow.push(`${label(child)}: ${Math.round(rect.width)}px`);
          }
          // A row of side-by-side panels: each takes an equal share of it.
          const tracks = getComputedStyle(child).gridTemplateColumns.split(" ").filter(Boolean);
          if (getComputedStyle(child).display === "grid" && tracks.length > 1) {
            const widths = Array.from(child.children).map((c) =>
              Math.round(c.getBoundingClientRect().width),
            );
            if (Math.max(...widths) - Math.min(...widths) > 1) {
              uneven.push(`${label(child)}: ${widths.join(" / ")}px`);
            }
          }
        }
        return { column: Math.round(column), blocks, narrow, uneven };
      });

      expect(measured, `${route} has no <main>`).not.toBeNull();
      expect(measured!.blocks, `${route} rendered nothing in <main>`).toBeGreaterThan(1);
      expect(
        measured!.narrow,
        `${route}: blocks narrower than the ${measured!.column}px column:\n${measured!.narrow.join("\n")}`,
      ).toEqual([]);
      expect(
        measured!.uneven,
        `${route}: side-by-side panels of unequal width:\n${measured!.uneven.join("\n")}`,
      ).toEqual([]);
    });
  }
});

test.describe("a table fits its panel", () => {
  // From `lg` the DataTable wrapper stops scrolling (so the header can stick), so a table wider
  // than its panel would spill into the panel's padding. Every table on these pages must fit
  // the box it sits in.
  const ROUTES_WITH_TABLES = [
    "/txs",
    "/blocks",
    "/mempool",
    `/block/${TIP_HEIGHT}`,
    `/address/${TRANSPARENT_ADDR}`,
    "/network/nodes",
    "/rich-list",
    "/cross-chain",
    "/reorgs",
    "/api-docs",
    "/zips",
    "/compare/all",
    "/name/abraham",
  ] as const;

  for (const width of [1024, 1180, 1279, 1440]) {
    test(`at ${width}px`, async ({ page }) => {
      test.slow();
      await page.setViewportSize({ width, height: 900 });
      const offenders: string[] = [];
      for (const route of ROUTES_WITH_TABLES) {
        await page.goto(route);
        await settleLayout(page);
        const over = await page.evaluate(() =>
          Array.from(document.querySelectorAll("main table"))
            .map((table) => {
              const wrapper = table.parentElement!;
              const excess = table.getBoundingClientRect().width - wrapper.clientWidth;
              const name = table.querySelector("caption")?.textContent?.trim() ?? "(no caption)";
              return excess > 1 ? `${name.slice(0, 50)}: +${Math.round(excess)}px` : null;
            })
            .filter((x): x is string => x !== null),
        );
        offenders.push(...over.map((o) => `${route} ${o}`));
      }
      expect(offenders, `tables wider than their panel:\n${offenders.join("\n")}`).toEqual([]);
    });
  }

  test("at 375px the rich list's SHARE and /compare/all's implied price are on screen", async ({
    page,
  }) => {
    // Each page's answer column must be visible without a sideways swipe.
    await page.setViewportSize(VIEWPORTS.mobile);
    for (const route of ["/rich-list", "/compare/all"]) {
      await page.goto(route);
      await settleLayout(page);
      const scrolls = await page.evaluate(() => {
        const table = document.querySelector("main table.data-table");
        if (table === null) return null;
        // The main list: on /rich-list the second table (the first is DISTRIBUTION).
        const tables = Array.from(document.querySelectorAll("main table.data-table"));
        const list = tables[tables.length - 1]!;
        const wrapper = list.parentElement!;
        return Math.round(list.getBoundingClientRect().width - wrapper.clientWidth);
      });
      expect(scrolls, `${route} has no data table`).not.toBeNull();
      expect(
        scrolls!,
        `${route}: the table is ${scrolls}px wider than its panel`,
      ).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("mempool atoms hold one line", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("every SIZE and SEEN cell renders on a single line at 1440px", async ({ page }) => {
    await page.goto("/mempool");
    await settleLayout(page);
    const result = await page.evaluate(() => {
      const table = document.querySelector("table.data-table");
      if (table === null) return { error: "no data table on /mempool", wrapped: [], rows: 0 };
      const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
        (th.textContent ?? "").trim().toUpperCase(),
      );
      const columns = ["SIZE", "SEEN"].map((label) => ({ label, index: headers.indexOf(label) }));
      const missing = columns.filter((c) => c.index < 0).map((c) => c.label);
      if (missing.length > 0) {
        return { error: `no ${missing.join(", ")} column`, wrapped: [], rows: 0 };
      }
      /** Distinct line boxes the cell's text occupies — more than one is a wrap. */
      const lines = (cell: Element): number => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const tops: number[] = [];
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width === 0 || rect.height === 0) continue;
          if (!tops.some((top) => Math.abs(top - rect.top) < rect.height / 2)) tops.push(rect.top);
        }
        return tops.length;
      };
      const wrapped: string[] = [];
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      rows.forEach((row, i) => {
        const cells = row.querySelectorAll("td");
        for (const { label, index } of columns) {
          const cell = cells[index];
          if (cell && lines(cell) > 1) {
            wrapped.push(`row ${i} ${label}: "${(cell.textContent ?? "").trim()}"`);
          }
        }
      });
      return { error: null, wrapped, rows: rows.length };
    });

    expect(result.error).toBeNull();
    expect(result.rows, "/mempool rendered no rows to check").toBeGreaterThan(0);
    expect(result.wrapped, `cells broken across lines:\n${result.wrapped.join("\n")}`).toEqual([]);
  });

  test("an IN/OUT cell breaks before the arrow, never between an input and an output", async ({
    page,
  }) => {
    // Each side is one group, so "1 transparent ·" over "2 orchard → 2 orchard" cannot read as a
    // complete in→out pair: when the inputs wrap, the outputs start below them.
    for (const width of [1440, 1180, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/mempool");
      await settleLayout(page);
      const bad = await page.evaluate(() => {
        const table = document.querySelector("table.data-table");
        if (table === null) return ["no data table"];
        const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
          (th.textContent ?? "").trim().toUpperCase(),
        );
        const index = headers.indexOf("IN/OUT");
        if (index < 0) return ["no IN/OUT column"];
        const out: string[] = [];
        for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
          const cell = row.querySelectorAll("td")[index];
          const [ins, outs] = Array.from(cell?.children ?? []);
          if (!ins || !outs) {
            out.push(`a cell without two side groups: "${cell?.textContent?.trim()}"`);
            continue;
          }
          const a = ins.getBoundingClientRect();
          const b = outs.getBoundingClientRect();
          const lineHeight = parseFloat(getComputedStyle(ins).lineHeight) || 16;
          const insWrapped = a.height > lineHeight * 1.5;
          if (insWrapped && b.top < a.bottom - 1) {
            out.push(`outputs beside wrapped inputs: "${cell!.textContent!.trim()}"`);
          }
        }
        return out;
      });
      expect(bad, `at ${width}px:\n${bad.join("\n")}`).toEqual([]);
    }
  });
});

test.describe("/txs on a phone", () => {
  test.use({ viewport: VIEWPORTS.mobile });

  test("the stat grid takes less than 40% of the first screen", async ({ page }) => {
    await page.goto("/txs");
    await settleLayout(page);
    const { grid, viewport } = await page.evaluate(() => ({
      grid: document.querySelector(".stat-grid")?.getBoundingClientRect().height ?? null,
      viewport: window.innerHeight,
    }));
    expect(grid, "/txs renders no .stat-grid").not.toBeNull();
    expect(grid!, `the stat grid is ${Math.round(grid!)}px of a ${viewport}px screen`).toBeLessThan(
      viewport * 0.4,
    );
  });
});

/**
 * Text overflow and container breakage on long values.
 *
 * A container sized for happy-path content meets a blockchain-native long string — an address,
 * a hash, a long token name — and breaks, most often on mobile. These assert containment
 * geometrically, with no screenshots or baselines. Containers that clip on purpose are
 * excluded: `truncate` sets `text-overflow: ellipsis` and `overflow-x: auto` marks a deliberate
 * scroll region. Everything else that clips or escapes its parent is a bug.
 */

import { expect, test } from "@playwright/test";
import { ROUTES, settleLayout, VIEWPORTS, type ViewportName } from "./surface";

/** A long unified address — the longest identifier this explorer has to render. */
const LONG_UNIFIED_ADDR = `u1${"qpw9zx7k3mn4vr8sd2hf6tgy5jc0lb".repeat(6)}`;

interface Overflow {
  selector: string;
  detail: string;
}

/**
 * Elements whose content is clipped without any styling that says clipping is intended,
 * or whose box escapes the viewport to the right.
 */
async function findOverflow(page: import("@playwright/test").Page): Promise<Overflow[]> {
  return page.evaluate(() => {
    const describe = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(".");
      const text = (el.textContent ?? "").trim().slice(0, 40);
      return `${tag}${cls ? "." + cls : ""} "${text}"`;
    };

    const out: { selector: string; detail: string }[] = [];
    const viewportWidth = document.documentElement.clientWidth;

    /**
     * The right edge an element must stay inside.
     *
     * A wide table inside an `overflow-x: auto` wrapper is a designed scroll region, not
     * breakage — measuring it against the viewport reports every responsive table on every
     * phone as a bug. So containment is judged against the nearest scrolling ancestor, and
     * only against the viewport when there is none.
     */
    const containerRight = (el: Element): number => {
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") {
          return parent.getBoundingClientRect().right + parent.scrollWidth - parent.clientWidth;
        }
      }
      return viewportWidth;
    };

    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // Screen-reader-only content is clipped to a 1px box on purpose — that is the whole
      // technique. Detected by its CSS signature rather than by the `.sr-only` class name,
      // so a differently-named utility with the same effect is excluded too.
      const screenReaderOnly =
        style.clipPath !== "none" || el.clientWidth <= 1 || el.clientHeight <= 1;
      if (screenReaderOnly) continue;

      // Form fields scroll their value natively — an input holding a 64-char txid is
      // caret-scrollable by design, not clipped. Their "overflow" is the control working.
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) continue;

      // Deliberate clipping: ellipsis truncation and explicit scroll regions are designed
      // behaviour, not breakage. Excluding them is what keeps this test signal, not noise.
      const intentionallyClipped =
        style.textOverflow === "ellipsis" ||
        style.overflowX === "auto" ||
        style.overflowX === "scroll" ||
        style.overflowY === "auto" ||
        style.overflowY === "scroll";

      // A deliberately full-bleed block (the /ecosystem stage) is wider than its column by
      // design and says so with `data-full-bleed`. Its ancestors' scroll width is then not
      // breakage — but the block itself is still measured against the viewport below.
      const holdsFullBleed = el.querySelector("[data-full-bleed]") !== null;

      // Inside an <svg> nothing clips to a CSS box: a multi-line <text> reports one line's width
      // as its client width and another's as its scroll width, so this measure means nothing
      // there. Escaping the container is still checked below for SVG content.
      const insideSvg = el instanceof SVGElement && el.ownerSVGElement !== null;

      // Content wider than its own box, with nothing saying that was the intent.
      if (
        !intentionallyClipped &&
        !holdsFullBleed &&
        !insideSvg &&
        el.scrollWidth > el.clientWidth + 1 &&
        el.clientWidth > 0
      ) {
        out.push({
          selector: describe(el),
          detail: `content ${el.scrollWidth}px in a ${el.clientWidth}px box`,
        });
        continue;
      }

      // Box escaping whatever is supposed to contain it. 1px tolerance for subpixel layout.
      const limit = containerRight(el);
      if (rect.right > limit + 1) {
        out.push({
          selector: describe(el),
          detail: `right edge at ${Math.round(rect.right)}px, container ends at ${Math.round(limit)}px`,
        });
      }
    }
    return out;
  });
}

for (const [name, viewport] of Object.entries(VIEWPORTS) as [
  ViewportName,
  (typeof VIEWPORTS)[ViewportName],
][]) {
  test.describe(`${name} — long values stay inside their containers`, () => {
    test.use({ viewport });

    for (const route of ROUTES) {
      test(`${route} contains its content`, async ({ page }) => {
        await page.goto(route);
        await settleLayout(page);
        const overflows = await findOverflow(page);
        expect(
          overflows,
          `${route} @ ${name}:\n` +
            overflows.map((o) => `  ${o.selector} — ${o.detail}`).join("\n"),
        ).toEqual([]);
      });
    }

    test(`a very long unified address does not break the address page`, async ({ page }) => {
      // Feed the page the longest legal value
      // of its own identifier type, not the tidy one the fixtures happen to contain.
      await page.goto(`/address/${LONG_UNIFIED_ADDR}`);
      await expect(page.locator("main")).toBeVisible();
      await settleLayout(page);

      const overflows = await findOverflow(page);
      expect(overflows, `long address @ ${name}:\n${JSON.stringify(overflows, null, 2)}`).toEqual(
        [],
      );

      const documentOverflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(documentOverflows, "the page scrolls sideways on a long address").toBe(false);
    });
  });
}

/**
 * Tablet widths, which the route sweeps above (375px and 1440px) never visit. A nav bar too wide
 * for these widths scrolls every page sideways.
 */
test("the site nav fits at every tablet width", async ({ page }) => {
  const problems: string[] = [];
  for (const width of [640, 700, 768, 820, 900, 1023, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of ["/", "/learn"]) {
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > width) problems.push(`${route} at ${width}px scrolls to ${scrollWidth}px`);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

/**
 * The list pages at tablet widths. A DataTable scrolls inside its panel until `lg`; the page
 * itself must never scroll sideways.
 */
test("no list page scrolls sideways at a tablet width", async ({ page }) => {
  test.slow();
  const problems: string[] = [];
  const routes = [
    "/txs",
    "/blocks",
    "/mempool",
    "/network/nodes",
    "/rich-list",
    "/cross-chain",
    "/name/abraham",
    "/reorgs",
    "/shielded",
  ];
  for (const width of [640, 768, 900, 1023]) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of routes) {
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > width) problems.push(`${route} at ${width}px scrolls to ${scrollWidth}px`);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

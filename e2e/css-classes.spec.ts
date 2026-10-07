/**
 * Every class a page renders has a rule in the stylesheet that page loaded.
 *
 * A class with no rule renders as nothing, silently — e.g. a token never exposed to Tailwind, so
 * its utility draws in the inherited colour. It typechecks, lints and renders; a missing rule has
 * no symptom but its absence. So this reads the CSSOM the browser built (utilities, components,
 * every media and layer block) and fails on any class in the DOM that no selector names.
 *
 * A class may exist only as a hook — for a test, a script or a sibling selector — and those are
 * listed below by name with the reason, so the list cannot grow into a blanket exemption.
 */

import { expect, test } from "@playwright/test";
import { ROUTES, VIEWPORTS } from "./surface";

/** Hook classes that intentionally carry no rule of their own. */
const HOOKS = new Map<string, string>([
  ["eco-map", "EcosystemPage.test.tsx selects the stage's nodes through it"],
  ["pulse-layer", "PulseStage.test.tsx pins the layer the motion engine draws into"],
  ["pulse-pending-layer", "PulseStage.test.tsx pins the mempool layer"],
  ["net-sparkline-box", "NetworkShell.test.tsx reads the sparkline's caption through it"],
]);

test.describe("every rendered class has a CSS rule", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("across the route surface", async ({ page }) => {
    test.slow();
    const missing = new Map<string, Set<string>>();
    const seenHooks = new Set<string>();
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const unruled = await page.evaluate(() => {
        const ruled = new Set<string>();
        const unescape = (raw: string) =>
          raw
            .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) =>
              String.fromCodePoint(parseInt(hex, 16)),
            )
            .replace(/\\(.)/g, "$1");
        const visit = (rules: CSSRuleList) => {
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule) {
              for (const m of rule.selectorText.matchAll(
                /\.((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w-])+)/g,
              )) {
                ruled.add(unescape(m[1]!));
              }
            }
            const nested = (rule as CSSGroupingRule).cssRules;
            if (nested) visit(nested);
          }
        };
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            visit(sheet.cssRules);
          } catch {
            // A cross-origin sheet cannot be read; this site loads none.
          }
        }
        const used = new Set<string>();
        for (const el of Array.from(document.querySelectorAll("[class]"))) {
          // An SVG element's `className` is an object; the attribute is the string.
          for (const c of (el.getAttribute("class") ?? "").split(/\s+/)) if (c) used.add(c);
        }
        return Array.from(used).filter((c) => !ruled.has(c));
      });
      for (const c of unruled) {
        if (HOOKS.has(c)) {
          seenHooks.add(c);
          continue;
        }
        if (!missing.has(c)) missing.set(c, new Set());
        missing.get(c)!.add(route);
      }
    }
    const report = Array.from(missing).map(
      ([c, routes]) => `${c}  (${Array.from(routes).slice(0, 3).join(", ")})`,
    );
    expect(report, `classes with no CSS rule:\n${report.join("\n")}`).toEqual([]);
    // A hook nobody renders any more is an exemption for nothing: drop it from the list.
    const stale = Array.from(HOOKS.keys()).filter((c) => !seenHooks.has(c));
    expect(stale, `HOOKS entries no page renders: ${stale.join(", ")}`).toEqual([]);
  });
});

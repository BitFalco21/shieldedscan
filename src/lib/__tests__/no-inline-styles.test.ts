import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The inline-style gate. `style={{}}` is not permitted in `src/` so colour and spacing cannot
 * bypass the token layer. The one exception is `ChartHover`, whose two uses position a
 * crosshair and readout at a pointer-derived percentage: geometry no utility class can
 * express. This test makes that exception a count rather than a blanket permission.
 */

const SRC = path.join(process.cwd(), "src");

/** Every `style={{` in `src/`, as "path:line" strings. */
function inlineStyleSites(): string[] {
  try {
    // -r recursive, -n line numbers, -F so the braces are literal rather than a pattern.
    // `__tests__` is excluded: this file contains its own search string, and test files ship
    // no UI.
    const out = execFileSync("grep", ["-rnF", "--exclude-dir=__tests__", "style={{", SRC], {
      encoding: "utf8",
    });
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(SRC.length + 1));
  } catch {
    // grep exits 1 when it matches nothing, which would be a perfectly good outcome here.
    return [];
  }
}

describe("inline styles", () => {
  it("appear in exactly two places, both in ChartHover", () => {
    const sites = inlineStyleSites();
    const files = new Set(sites.map((s) => s.split(":")[0]));
    expect(
      [...files],
      "a new inline style appeared — styling goes through Tailwind tokens; " +
        "if this is runtime GEOMETRY inside an SVG, use an attribute instead (see SupplyBreakdownPanel)",
    ).toEqual(["components/ChartHover.tsx"]);
    expect(sites, `expected 2 sites, found ${sites.length}:\n${sites.join("\n")}`).toHaveLength(2);
  });

  it("carry only geometry — never a colour or a spacing token", () => {
    // A `background` or `color` slipped onto one of the two allowed lines would pass the
    // count while bypassing the design system.
    const banned = /\b(color|background|border|font|fill|stroke|padding|gap)\b/i;
    for (const site of inlineStyleSites()) {
      expect(site, `an inline style set appearance, not position: ${site}`).not.toMatch(banned);
    }
  });
});

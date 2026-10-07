import { describe, expect, it } from "vitest";
import { THEMES, TOKEN_RECIPES, cssOklch } from "@/lib/theme";
import { readStylesheet } from "@/__tests__/read-stylesheet";

/**
 * The stylesheet derives every colour from `--h`:
 *
 * 1. No colour literal outside the `:root` fallbacks; component classes go through
 *    `oklch(… var(--h) / α)`, or a theme would ship partly green.
 * 2. The `oklch()` declarations for the base tokens match the recipe table the contrast test
 *    measures, so the CSS and the test cannot drift apart.
 */

const css = readStylesheet();

/** The `:root { … }` block that carries the tokens, and everything after it. */
const rootEnd = css.indexOf("\n}\n", css.indexOf(":root {"));
const afterRoot = css.slice(rootEnd);

describe("globals.css derives every colour from --h", () => {
  it("carries no accent or canvas colour literal outside :root and the @supports fallback", () => {
    const withoutFallback = afterRoot.replace(
      /@supports not \(color: oklch\([^)]*\)\)\s*\{[\s\S]*?\n\}/,
      "",
    );
    const literals = withoutFallback.match(
      /rgba\(\s*43,\s*255,\s*100[^)]*\)|rgba\(\s*5,\s*8,\s*5[^)]*\)|rgba\(\s*242,\s*255,\s*245[^)]*\)|#2bff64|#17a344|#0f4d24|#d9ffe4|#f2fff5|#7fbf93|#5f8f70|#050805|#0a120a/gi,
    );
    expect(literals ?? [], `literals outside :root:\n${(literals ?? []).join("\n")}`).toEqual([]);
  });

  for (const [token, recipe] of Object.entries(TOKEN_RECIPES)) {
    it(`declares --${recipe.cssName} from the recipe table (${token})`, () => {
      expect(css).toContain(`--${recipe.cssName}: ${cssOklch(recipe)};`);
    });
  }

  it("declares a hex fallback for every base token inside an @supports-not block", () => {
    // Next's minifier folds duplicate custom-property declarations to the last one, so the hex
    // fallback lives in an `@supports not` block: a browser without oklch() gets green.
    const block = css.match(/@supports not \(color: oklch\([^)]*\)\)\s*\{([\s\S]*?)\n\}/);
    expect(block, "no `@supports not (color: oklch(…))` fallback block").not.toBeNull();
    for (const recipe of Object.values(TOKEN_RECIPES)) {
      expect(block![1], `--${recipe.cssName} has no hex fallback`).toMatch(
        new RegExp(`--${recipe.cssName}: #[0-9a-f]{6};`),
      );
    }
  });

  it("declares each base token exactly once in :root — the oklch form", () => {
    // Two declarations of one property in a block is what the minifier folded; the fallback
    // lives in its own @supports block instead.
    const root = css.slice(css.indexOf(":root {"), rootEnd);
    for (const recipe of Object.values(TOKEN_RECIPES)) {
      const n = (root.match(new RegExp(`^  --${recipe.cssName}: `, "gm")) ?? []).length;
      expect(n, `--${recipe.cssName} declared ${n} times in :root`).toBe(1);
    }
  });

  it("sets --h for every non-default theme through data-theme on the root", () => {
    for (const theme of THEMES.filter((t) => !t.isDefault)) {
      expect(css).toMatch(
        new RegExp(`:root\\[data-theme="${theme.id}"\\]\\s*\\{\\s*--h:\\s*${theme.hue};`),
      );
    }
  });

  it("paints a swatch for EVERY theme in that theme's own accent, default included", () => {
    // The nav's swatches show each theme's own hue: the green one stays green under violet.
    // `--swatch-h` per theme is the one place a hue is written twice, so it is pinned. The dot
    // uses --green-dim's recipe, not the hot accent.
    expect(css).toMatch(/\.theme-swatch\s*\{[^}]*oklch\(0\.626 0\.175 [^)]*var\(--swatch-h\)/);
    for (const theme of THEMES) {
      expect(css).toMatch(
        new RegExp(
          `\\.theme-swatch\\[data-theme="${theme.id}"\\]\\s*\\{\\s*--swatch-h:\\s*${theme.hue};`,
        ),
      );
    }
  });

  it("declares the default hue on :root", () => {
    const def = THEMES.find((t) => t.isDefault)!;
    expect(css).toMatch(new RegExp(`--h:\\s*${def.hue};`));
  });
});

import { describe, expect, it } from "vitest";
import { contrastRatio, oklchToSrgb, srgbToHex } from "../oklch";
import { DEFAULT_THEME, THEMES, TOKEN_RECIPES, deriveTokens, themeById } from "../theme";

/**
 * A theme is one number: the accent hue. These tests make that safe:
 *
 * - at the default hue the derivation reproduces the Phosphor hex values, so moving from
 *   literals to `oklch(L C var(--h))` changed nothing a reader can see;
 * - for every theme, every content token clears WCAG AA against the derived panel, so adding
 *   a theme to THEMES cannot ship an unreadable site.
 */

/** The Phosphor green tokens as hex literals. */
const PHOSPHOR_GREEN_HEX = {
  bg: "#050805",
  panel: "#0a120a",
  green: "#2bff64",
  greenDim: "#17a344",
  greenFaint: "#0f4d24",
  ink: "#d9ffe4",
  inkBright: "#f2fff5",
  inkDim: "#7fbf93",
  inkFaint: "#5f8f70",
} as const;

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);

describe("the derivation at the default hue reproduces Phosphor green", () => {
  const derived = deriveTokens(themeById(DEFAULT_THEME).hue);

  for (const [token, hex] of Object.entries(PHOSPHOR_GREEN_HEX)) {
    it(`--${token} comes back as ${hex} within one step per channel`, () => {
      const rgb = oklchToSrgb(derived[token as keyof typeof derived]!);
      for (let i = 0; i < 3; i++) {
        // OKLCH round-trips are exact to well under a step, but the recipe's L/C values are
        // rounded to three decimals.
        expect(Math.abs(rgb[i]! - channel(hex, i))).toBeLessThanOrEqual(2);
      }
    });
  }
});

describe("every theme clears WCAG AA against its own panel", () => {
  const CONTENT_TOKENS = ["ink", "inkBright", "inkDim", "inkFaint", "greenDim"] as const;

  for (const theme of THEMES) {
    const t = deriveTokens(theme.hue);
    const panel = oklchToSrgb(t.panel);

    for (const token of CONTENT_TOKENS) {
      it(`${theme.id}: --${token} ≥ 4.5:1 on --panel`, () => {
        expect(contrastRatio(oklchToSrgb(t[token]), panel)).toBeGreaterThanOrEqual(4.5);
      });
    }

    it(`${theme.id}: --green (accent, never body text) ≥ 3:1 on --panel`, () => {
      expect(contrastRatio(oklchToSrgb(t.green), panel)).toBeGreaterThanOrEqual(3);
    });

    it(`${theme.id}: --green-faint is decorative and STAYS below AA, so nobody promotes it to text`, () => {
      expect(contrastRatio(oklchToSrgb(t.greenFaint), panel)).toBeLessThan(3);
    });
  }
});

describe("the recipe table is the single source", () => {
  it("names exactly the nine base tokens", () => {
    expect(Object.keys(TOKEN_RECIPES).sort()).toEqual(
      [
        "bg",
        "green",
        "greenDim",
        "greenFaint",
        "ink",
        "inkBright",
        "inkDim",
        "inkFaint",
        "panel",
      ].sort(),
    );
  });

  it("holds lightness and chroma fixed across hues — only the hue moves", () => {
    const a = deriveTokens(146);
    const b = deriveTokens(305);
    for (const k of Object.keys(TOKEN_RECIPES) as (keyof typeof TOKEN_RECIPES)[]) {
      expect(a[k].l).toBe(b[k].l);
      expect(a[k].c).toBe(b[k].c);
      expect(b[k].h - a[k].h).toBeCloseTo(305 - 146, 6);
    }
  });

  it("has a default theme that exists and a violet theme at hue 305", () => {
    expect(THEMES.some((t) => t.id === DEFAULT_THEME)).toBe(true);
    expect(themeById("violet").hue).toBe(305);
  });

  it("renders a hex the CSS fallback can use", () => {
    expect(srgbToHex(oklchToSrgb(deriveTokens(146).green))).toMatch(/^#[0-9a-f]{6}$/);
  });
});

/**
 * The Phosphor palette as literal hex, for the one renderer that cannot read the tokens.
 *
 * Every other surface takes its colour from `globals.css` CSS variables. The transaction share
 * card is rendered by satori, with no stylesheet, custom property or cascade, so colours arrive
 * as values.
 *
 * These are the green theme's values: brand assets stay green whatever a reader has chosen,
 * and a scraper has no theme to read.
 *
 * `og-tokens.test.ts` asserts every value matches the `@supports not (color: oklch(...))` hex
 * fallback block in `globals.css`, so the card cannot drift from the site.
 */
export const OG = {
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

/** The token name in `globals.css` for each key above, so the test can name what drifted. */
export const OG_TOKEN_NAMES: Record<keyof typeof OG, string> = {
  bg: "--bg",
  panel: "--panel",
  green: "--green",
  greenDim: "--green-dim",
  greenFaint: "--green-faint",
  ink: "--ink",
  inkBright: "--ink-bright",
  inkDim: "--ink-dim",
  inkFaint: "--ink-faint",
};

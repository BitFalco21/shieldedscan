import type { Oklch } from "./oklch";

/**
 * A theme is one number.
 *
 * Every colour token in `globals.css` is `oklch(L C var(--h))` with L and C fixed; a theme sets
 * `--h` and nothing else. This module is the single source for the recipes, the theme list and
 * the storage key. `globals-literals.test.ts` checks the CSS against it and
 * `theme-contrast.test.ts` proves every theme's contrast, so adding a theme is one entry in
 * `THEMES`.
 */

export interface Theme {
  /** The `data-theme` value and the stored value. Absent attribute means the default. */
  id: string;
  /** Visible label: the word for the colour, lowercase — "green", not "phosphor green". */
  label: string;
  /** OKLCH accent hue in degrees. */
  hue: number;
  /** Exactly one theme is the default; it stamps no attribute and stores no key. */
  isDefault?: true;
}

export const THEMES: readonly Theme[] = [
  // P1 phosphor, the CRT the design system is named after.
  { id: "green", label: "green", hue: 146, isDefault: true },
  // Clear of red (25°, negative deltas) and amber (75°, chart series and the testnet banner).
  { id: "violet", label: "violet", hue: 305 },
  // P7 phosphor, the blue-white tube. Clear of red (25°) and amber (75°).
  { id: "ice", label: "ice", hue: 230 },
  // P3 phosphor, and Zcash's own gold. Under this accent `--series` and `--warn` are remapped
  // in the [data-theme="amber"] block so chart series and warnings stay distinct from links;
  // semantic-tokens.test.ts forbids reaching for --amber directly. Clear of red (25°) by 53°.
  { id: "amber", label: "amber", hue: 78 },
];

export const DEFAULT_THEME = THEMES.find((t) => t.isDefault)!.id;

/** The one key this site writes to a visitor's browser. Disclosed on /privacy. */
export const THEME_STORAGE_KEY = "theme";

export function themeById(id: string): Theme {
  const t = THEMES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown theme: ${id}`);
  return t;
}

export interface TokenRecipe {
  /** The CSS custom property name, without the dashes. */
  cssName: string;
  /** OKLCH lightness, fixed across themes. */
  l: number;
  /** OKLCH chroma, fixed across themes. */
  c: number;
  /**
   * Hue offset from `--h`. The ink family sits a few degrees warmer than the accent in the
   * original palette; the offset is kept rather than flattened so green stays exactly green.
   */
  dh: number;
}

/**
 * Measured from the original hex palette, three decimals. At hue 146 these reproduce #050805, #0a120a, #2bff64, #17a344, #0f4d24, #d9ffe4, #f2fff5,
 * #7fbf93 and #5f8f70 to within a step per channel — `theme-contrast.test.ts` asserts it.
 */
export const TOKEN_RECIPES = {
  bg: { cssName: "bg", l: 0.128, c: 0.011, dh: 0 },
  panel: { cssName: "panel", l: 0.171, c: 0.02, dh: 0 },
  green: { cssName: "green", l: 0.874, c: 0.252, dh: 0.6 },
  greenDim: { cssName: "green-dim", l: 0.626, c: 0.175, dh: 2 },
  greenFaint: { cssName: "green-faint", l: 0.371, c: 0.092, dh: 4 },
  ink: { cssName: "ink", l: 0.966, c: 0.053, dh: 5 },
  inkBright: { cssName: "ink-bright", l: 0.988, c: 0.019, dh: 0 },
  inkDim: { cssName: "ink-dim", l: 0.749, c: 0.091, dh: 6 },
  inkFaint: { cssName: "ink-faint", l: 0.607, c: 0.07, dh: 7 },
} as const satisfies Record<string, TokenRecipe>;

export type TokenName = keyof typeof TOKEN_RECIPES;

/** Every base token as an absolute OKLCH colour, for a given accent hue. */
export function deriveTokens(hue: number): Record<TokenName, Oklch> {
  const out = {} as Record<TokenName, Oklch>;
  for (const [name, r] of Object.entries(TOKEN_RECIPES) as [TokenName, TokenRecipe][]) {
    out[name] = { l: r.l, c: r.c, h: hue + r.dh };
  }
  return out;
}

/** The exact `oklch()` expression `globals.css` must declare for a recipe. */
export function cssOklch(r: TokenRecipe): string {
  const hue = r.dh === 0 ? "var(--h)" : `calc(var(--h) + ${r.dh})`;
  return `oklch(${r.l} ${r.c} ${hue})`;
}

/* ------------------------------------------------------------------------------------------
   The runtime side: a minimal external store over `<html data-theme>`. Kept out of the
   component so it never mutates the document itself (the React compiler's lint forbids it),
   and so the boot script, the switch and tests agree that the attribute is the current theme.
   ------------------------------------------------------------------------------------------ */

const listeners = new Set<() => void>();

/** The theme the document currently wears; the default when no known attribute is stamped. */
export function readStampedTheme(): string {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const stamped = document.documentElement.dataset.theme;
  return stamped && THEMES.some((t) => t.id === stamped) ? stamped : DEFAULT_THEME;
}

/** `useSyncExternalStore` subscription: fires after every `applyTheme`. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Stamps (or, for the default, removes) the attribute and persists the same way, so choosing
 * the default stores nothing. Returns whether the choice was kept; a storage that throws still
 * switches the page, and the caller says so.
 */
export function applyTheme(id: string): { persisted: boolean } {
  const isDefault = id === DEFAULT_THEME;
  if (isDefault) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
  let persisted = true;
  try {
    if (isDefault) window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    persisted = false;
  }
  for (const l of listeners) l();
  return { persisted };
}

/**
 * The inline `<head>` script that stamps `data-theme` before first paint, so a reader who
 * chose violet never sees a green flash. Kept under 400 bytes because it runs on every page
 * view. Only a known theme id is written to the attribute, so a hand-edited key cannot inject
 * anything; a storage that throws is swallowed and the page renders the default.
 */
export const THEME_BOOT_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `if(t&&${JSON.stringify(THEMES.filter((t) => !t.isDefault).map((t) => t.id))}.indexOf(t)>-1)` +
  `document.documentElement.dataset.theme=t}catch(e){}`;

import type { SkyPalette } from "./sky-draw";

/**
 * The sky's colours, read from the page's own CSS tokens at mount and again whenever the theme
 * changes — a canvas cannot take a class, so this is how the one canvas here still follows
 * `--h`. Every entry names a token `globals.css` declares; nothing is a literal.
 */
export function readSkyPalette(root: Element): SkyPalette {
  const css = getComputedStyle(root);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    panel: v("--panel", "#0a120a"),
    green: v("--green", "#2bff64"),
    greenDim: v("--green-dim", "#17a344"),
    ink: v("--ink", "#d9ffe4"),
    inkDim: v("--ink-dim", "#7fbf93"),
    inkFaint: v("--ink-faint", "#5f8f70"),
    inkBright: v("--ink-bright", "#f2fff5"),
    flow1: v("--flow-1", "#e3b341"),
    flow2: v("--flow-2", "#4c8dff"),
    flow5: v("--flow-5", "#9d7bff"),
    zakura: v("--brand-zakura", "#fd6798"),
    zcashd: v("--brand-zcashd", "#f4b728"),
  };
}

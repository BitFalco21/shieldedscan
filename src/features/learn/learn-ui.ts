/**
 * The learning page's few control styles, named once so the practice simulator and the real
 * guide cannot drift apart. Tokens only: every colour here follows the reader's hue theme.
 */

/*
 * The site's two button treatments (`.btn-primary`, `.btn-secondary` in globals.css), at this
 * page's larger type, so there is one primary look rather than several hand-copied ones.
 */

/** A secondary action. */
export const BTN = "btn btn-secondary text-sm";

/** The one thing to do next. */
export const BTN_PRIMARY = "btn btn-primary text-sm";

/** A pressed toggle in a group, like the mode switch and the wallet's receive/send. */
export const BTN_ON = "btn btn-primary text-sm";

/** The guided run's highlight: an outline ring, never a glow (the glow budget is spent elsewhere). */
export const RING = "ring-2 ring-green ring-offset-2 ring-offset-bg";

/**
 * A panel stepping back while the tour points somewhere else. Opacity alone, so nothing moves and
 * the panel stays readable; the transition is the only motion, and reduced motion removes it.
 */
export const PANEL_FADE = "transition-opacity duration-300";
export const DIMMED = "opacity-40";

/** A boxed group inside a panel: balances, an address, a list of facts. */
export const BOX = "rounded border border-edge-faint bg-bg/40 px-3 py-2";

/** A small uppercase tag that may wrap: for a long label like "example · a real recent transaction". */
export const CHIP_WRAP = "microlabel inline-block rounded-sm border px-1.5 py-px";

/** A short uppercase tag that stays on one line: "test", "you", "exchange", a kind. */
export const CHIP = `${CHIP_WRAP} whitespace-nowrap`;

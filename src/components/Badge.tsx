import type { ReactNode } from "react";

/**
 * The tones a badge may take. Named for what they mean on this site, not for their colours:
 *
 * - `accent` — the privacy green at full strength: a shielded pool in current use, a state in
 *   force (a completed crossing, the name's current registration).
 * - `dim` — the accent a step back: the previous shielded protocol.
 * - `outline` — neutral ink on the standard edge: a label that states a kind, not a privacy.
 * - `neutral` — neutral ink on the faint edge: transparent, issuance, an ordinary action.
 * - `faint` — the quietest readable ink: legacy (Sprout), or a state no longer in force.
 * - `bright` — the brightest neutral ink on the standard edge: a label that must read loudly
 *   without spending a colour — a fact-check verdict, a chain this site does not index.
 * - `filled` — the accent on its wash: the one filled pill, the HTTP method heading an endpoint.
 * - `warn` — the warning role (amber by default, remapped under the amber theme).
 *
 * Every text tone clears WCAG AA on the panel; `green-faint` is deliberately absent.
 */
export type BadgeTone =
  "accent" | "dim" | "outline" | "neutral" | "faint" | "bright" | "filled" | "warn" | "hue";

/**
 * A categorical hue from the flow palette, for a badge whose job is telling several kinds apart
 * at a glance (the Zcash-name history's actions). Used with `tone="hue"`; the text and a 40%
 * border both take the hue. `flow-palette-scope.test.ts` lists every file allowed to pass one.
 */
export type BadgeHue = `flow-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

/** The size every badge shares. Exported so a test can pin that pills agree. */
export const BADGE_BASE =
  "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] leading-4 tracking-[0.14em] whitespace-nowrap uppercase";

const TONE: Record<BadgeTone, string> = {
  accent: "border-edge text-green",
  dim: "border-edge-faint text-green-dim",
  outline: "border-edge text-ink-dim",
  neutral: "border-edge-faint text-ink-dim",
  faint: "border-edge-faint text-ink-faint",
  bright: "border-edge text-ink-bright",
  filled: "border-edge bg-green-wash-strong font-bold text-green",
  warn: "border-warn-edge text-warn",
  // The colour comes from `hue`; without one the badge falls back to neutral ink.
  hue: "border-current/40",
};

export interface BadgeProps {
  tone: BadgeTone;
  /** Required with `tone="hue"`, ignored otherwise. */
  hue?: BadgeHue;
  /** A dashed edge: something not (yet) settled — a pending crossing, a chain not indexed here. */
  dashed?: boolean;
  /** A mark drawn before the label — a shield, a status glyph, a chain logo. At most 14px. */
  icon?: ReactNode;
  title?: string;
  /**
   * Layout only — a margin, a `data-*`-driven hook. Never a colour, size or padding: those are
   * the point of this component.
   */
  className?: string;
  children: ReactNode;
}

/**
 * The one pill on the site. Every pill is a `Badge` — no caller composes `BADGE_BASE` with its
 * own colours, which is how a tone escapes the list above.
 *
 * One size: 10px uppercase, 0.14em tracking, a 16px line, 2px/6px padding and a 4px radius,
 * so every badge is 22px tall and any two in one row line up. `leading-4` is load-bearing: a
 * badge otherwise inherits its container's line height (a table cell's 20px, a sentence's 32px)
 * and grows with it.
 */
export function Badge({
  tone,
  hue,
  dashed = false,
  icon,
  title,
  className = "",
  children,
}: BadgeProps) {
  const colour = tone !== "hue" ? TONE[tone] : `${TONE.hue} ${hue ?? "text-ink-dim"}`;
  return (
    <span
      title={title}
      className={[BADGE_BASE, dashed ? "border-dashed" : "", colour, className]
        .filter(Boolean)
        .join(" ")}
    >
      {icon}
      {children}
    </span>
  );
}

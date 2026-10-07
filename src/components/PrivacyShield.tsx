import type { Transaction } from "@/domain";
import { txKind } from "@/domain";

export type PrivacyVariant = "shielded" | "transparent" | "mixed";

export function privacyVariantFor(tx: Transaction): PrivacyVariant {
  const kind = txKind(tx);
  if (kind === "shielded") return "shielded";
  if (kind === "mixed") return "mixed";
  return "transparent";
}

/**
 * The shield outline. A 24-unit box, point down.
 *
 * Exported because the transaction share card draws the same silhouette through satori, which
 * reads no classes and renders no React component; one geometry keeps the two in step.
 */
export const SHIELD =
  "M12 2.4 L20 5.7 L20 12.2 C20 16.9 12 21.4 12 21.4 C12 21.4 4 16.9 4 12.2 L4 5.7 Z";

/**
 * The left half of exactly the same silhouette, filled to mark a mixed transaction.
 *
 * A separate path rather than a `clipPath` or gradient: both need an `id`, and a 25-row table
 * would emit 25 elements sharing it — invalid markup whose rendering depends on document order.
 */
export const SHIELD_LEFT = "M12 2.4 L4 5.7 L4 12.2 C4 16.9 12 21.4 12 21.4 Z";

const variantClass: Record<PrivacyVariant, string> = {
  shielded: "shield-shielded",
  transparent: "shield-transparent",
  mixed: "shield-mixed",
};

/** The kind itself, as a phrase that can sit inside a longer sentence. */
const variantWord: Record<PrivacyVariant, string> = {
  shielded: "fully shielded",
  transparent: "transparent",
  mixed: "mixed",
};

/** What "mixed" means to a reader who has not learned the grammar this shield encodes. */
const MIXED_GLOSS = "partly shielded";

const variantLabel: Record<PrivacyVariant, string> = {
  shielded: variantWord.shielded,
  transparent: variantWord.transparent,
  mixed: `${variantWord.mixed} — ${MIXED_GLOSS}`,
};

/**
 * "3 fully shielded transactions" — the same vocabulary, carrying a count, for places where a
 * shield stands for a group of transactions. Derived from `variantWord` so the two cannot drift.
 */
export function privacyCountLabel(variant: PrivacyVariant, count: number): string {
  const phrase = `${count.toLocaleString("en-US")} ${variantWord[variant]} transaction${
    count === 1 ? "" : "s"
  }`;
  return variant === "mixed" ? `${phrase} — ${MIXED_GLOSS}` : phrase;
}

export interface PrivacyShieldProps {
  variant: PrivacyVariant;
  /**
   * What this shield stands for here — spoken and hovered alike. Defaults to the variant's
   * own name, which is the right answer wherever one shield marks one transaction.
   *
   * One prop for both channels on purpose: a hover that says more than the accessible name
   * would leave a screen-reader user with the poorer of the two facts.
   */
  label?: string;
}

/**
 * The privacy grammar, in ink: a shield filled fully (shielded), half (mixed), or not at
 * all (transparent).
 *
 * A shield is the word the protocol itself uses, so the silhouette carries the meaning before
 * the fill does. Colour is a redundant channel, never the only one: green means privacy in
 * this palette, so a transparent transaction gets neutral ink and a shielded one the accent,
 * but shape alone carries the message for a colourblind reader.
 *
 * `role="img"` with a spoken label, because the shape is the content; it is also used where no
 * text label follows.
 *
 * The same sentence rides in an SVG `<title>` for pointer users. `<title>` rather than
 * `InfoTip`: it needs no focusable button per table row, cannot escape the viewport, and is
 * inert markup. The root `<svg>` is hit-tested across its whole box, so even an unfilled
 * transparent shield answers a hover in its middle.
 */
export function PrivacyShield({ variant, label }: PrivacyShieldProps) {
  const text = label ?? variantLabel[variant];
  return (
    <svg
      role="img"
      aria-label={text}
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 shrink-0 ${variantClass[variant]}`}
    >
      <title>{text}</title>
      {variant === "mixed" ? <path d={SHIELD_LEFT} fill="currentColor" /> : null}
      <path
        d={SHIELD}
        fill={variant === "shielded" ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

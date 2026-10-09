/**
 * The inks of a chart whose three lines are ranked: privacy kinds from private to public, the
 * largest miners from one address to ten, upgrade readiness from ready to behind. The accent
 * draws the first; the other two differ from it, and from each other, in lightness as well as
 * hue, so the lines stay apart for a colour-blind reader and on a dim screen. One table, so
 * "Mixed" is the same colour on every chart and on /analytics.
 */
export const RANKED_LINES = ["text-green", "text-line-2", "text-line-3"] as const;

/** A fourth line beside a ranked three, measuring something else: apart from all of them. */
export const BESIDE_RANKED_LINE = "text-line-4";

/** The privacy kinds in those inks. */
export const KIND_CLASSES = {
  shielded: RANKED_LINES[0],
  mixed: RANKED_LINES[1],
  transparent: RANKED_LINES[2],
} as const;

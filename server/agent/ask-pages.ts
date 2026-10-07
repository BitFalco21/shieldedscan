/**
 * The pages of this site a question may say it was asked from. A closed set, checked by the input
 * gate: an unknown value is refused, never ignored, so a caller cannot silently land somewhere it
 * did not ask to be.
 *
 * Kept free of imports so the gate can use it without pulling the site guide into every validator.
 */
export const ASK_PAGES = ["learn"] as const;

export type AskPage = (typeof ASK_PAGES)[number];

export function isAskPage(value: unknown): value is AskPage {
  return typeof value === "string" && (ASK_PAGES as readonly string[]).includes(value);
}

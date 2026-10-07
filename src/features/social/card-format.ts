/**
 * The stamp and footer strings the alert cards share, so a swap card and a boundary card read
 * identically where they say the same thing.
 */

/**
 * "04 AUG 2026": the UTC day of the event. A chain event has no fixed posting hour, so the stamp
 * carries no time of day and no timezone.
 */
export function formatCardDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000)
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
    .toUpperCase();
}

/**
 * The elided txid a card's footer prints: 10 leading characters, an ellipsis, 6 trailing. Not
 * `lib/format.ts`'s `shortHash`, which elides symmetrically; a card is a static image with no
 * CSS truncation, so the exact string matters. The full hash travels in the post text.
 */
export function elideCardTxid(txid: string): string {
  return `${txid.slice(0, 10)}…${txid.slice(-6)}`;
}

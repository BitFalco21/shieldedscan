import type { NetClient, uptimeTier } from "@/domain";

/**
 * Which CSS class carries which meaning on the node map. Classes, never colours: every rule
 * lives in `globals.css` under `/network`, so the map follows the theme and `src/` keeps its
 * no-inline-style rule. The four families are the four lenses.
 */

/** A client's tint: its own mark's colour, or faint ink for a client this site does not know. */
export function clientToneClass(client: NetClient): string {
  switch (client) {
    case "Zebra":
      return "net-client-zebra";
    case "Zakura":
      return "net-client-zakura";
    case "zcashd":
      return "net-client-zcashd";
    default:
      return "net-client-other";
  }
}

/** Zebra's bars are drawn in stripes rather than a colour — a zebra is black and white. */
export function isStripedClient(client: NetClient): boolean {
  return client === "Zebra";
}

/** How many hosting networks get a colour of their own; the rest are faint ink. */
export const NET_ASN_SLOTS = 5;

/** The slot class for a network's rank (0 = largest), or the neutral one past the slots. */
export function asnSlotClass(rank: number | null): string {
  return rank !== null && rank < NET_ASN_SLOTS ? `net-asn-${rank + 1}` : "net-asn-other";
}

/** A crawls-answered tier (`uptimeTier`) as a `color` class, for bars and legend swatches. */
export function tierToneClass(tier: ReturnType<typeof uptimeTier>): string {
  return tier === null ? "net-tier-none" : `net-tier-${tier}`;
}

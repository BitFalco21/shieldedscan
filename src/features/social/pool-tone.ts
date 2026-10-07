import type { PoolName } from "@/domain/pool";
import { POOL_INK } from "@/components/PoolBadge";

/**
 * Ink weight per pool on the social cards — `PoolBadge`'s own ramp (strength of the
 * cryptography, not decoration), applied at a card's larger type sizes.
 */
export const POOL_TONE: Readonly<Record<PoolName, string>> = POOL_INK;

/**
 * The same weighting as a `data-tone` value, for the boundary card's own CSS.
 *
 * A card that styles its pool name through a component class (`.card-boundary-pool`)
 * cannot also take a Tailwind colour utility for it without one overriding the other, so
 * the tone travels as an attribute the stylesheet reads. Derived from the table above by
 * NAME rather than restated, so the two forms cannot disagree about a pool.
 */
export function poolToneAttr(pool: PoolName): "full" | "dim" | "faint" {
  if (POOL_TONE[pool] === "text-green-dim") return "dim";
  if (POOL_TONE[pool] === "text-ink-faint") return "faint";
  return "full";
}

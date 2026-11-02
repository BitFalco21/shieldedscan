import type { SupplyBreakdown, ValuePoolName } from "@/domain";
import { isFiniteNumber } from "@/lib/finite";

/**
 * The wire guard for `/api/supply`, the all-pools view's live read.
 *
 * Every row is checked, not only the envelope: one malformed balance would put a wrong figure
 * in the bar and every total that sums it, so a payload with one is refused whole and the page
 * keeps the block it already shows.
 */

/** The endpoint's own name for itself, echoed and checked. */
export const SUPPLY_LIVE_KIND = "supply-live";

export interface SupplyLivePayload {
  kind: typeof SUPPLY_LIVE_KIND;
  supply: SupplyBreakdown;
}

function parsePoolRow(value: unknown): { pool: ValuePoolName; balanceZat: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.pool !== "string" || !isFiniteNumber(row.balanceZat)) return null;
  // An unknown name passes through: the view shows it under its own name rather than drop it.
  return { pool: row.pool as ValuePoolName, balanceZat: row.balanceZat };
}

export function parseSupplyLive(body: unknown): SupplyBreakdown | null {
  if (typeof body !== "object" || body === null) return null;
  const envelope = body as Record<string, unknown>;
  if (envelope.kind !== SUPPLY_LIVE_KIND) return null;
  const supply = envelope.supply;
  if (typeof supply !== "object" || supply === null) return null;
  const s = supply as Record<string, unknown>;
  if (!isFiniteNumber(s.height) || !Array.isArray(s.pools)) return null;
  // `undefined` is not a null: an absent key means a shape this build does not know.
  if (s.nsmZat !== null && !isFiniteNumber(s.nsmZat)) return null;
  const pools = s.pools.map(parsePoolRow);
  if (pools.some((p) => p === null)) return null;
  return {
    height: s.height,
    nsmZat: s.nsmZat,
    pools: pools.filter((p) => p !== null),
  };
}

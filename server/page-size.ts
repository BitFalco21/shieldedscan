/**
 * The single ceiling on how many rows a list request may ask for.
 *
 * A page size is capped so one request cannot ask for a million rows; a page number is never
 * capped, because that would make everything past page 100 unreachable (see `chain-routes.ts`).
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Bound a requested page size to `[1, MAX_PAGE_SIZE]`. A non-finite request (a missing or
 * malformed query parameter) takes `fallback`, which is itself bounded, so a caller cannot pass
 * an uncapped default through the second argument.
 */
export function clampPageSize(requested: number | undefined, fallback = MAX_PAGE_SIZE): number {
  const n = requested !== undefined && Number.isFinite(requested) ? requested : fallback;
  return Math.min(Math.max(1, Math.floor(n)), MAX_PAGE_SIZE);
}

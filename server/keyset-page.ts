import type { SeekDirection } from "@/data/cursor";

/** One page of a keyset read, in newest-first order, with the cursors on either side of it. */
export interface KeysetSlice<T> {
  rows: T[];
  /** Resumes older rows; null when the read reached the oldest end. */
  nextCursor: string | null;
  /** Resumes newer rows; null on the first page, or when the read reached the newest end. */
  prevCursor: string | null;
}

/**
 * Turn the rows of a keyset query into a page and its cursors.
 *
 * `fetched` is the query's result in scan order, read with `LIMIT limit + 1`: the extra row says
 * whether more lie beyond the page in the direction travelled. An `after` read scans ascending
 * from its seek row to reach the nearest newer rows, so its slice is reversed back to newest
 * first. The side the read came from is known to hold rows whenever a cursor led here, so only
 * the far side depends on the overfetch.
 */
export function keysetSlice<T>(
  fetched: readonly T[],
  limit: number,
  direction: SeekDirection | null,
  cursorOf: (row: T) => string,
): KeysetSlice<T> {
  const hasMore = fetched.length > limit;
  const rows = fetched.slice(0, limit);
  if (direction === "after") rows.reverse();
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) {
    return { rows, nextCursor: null, prevCursor: null };
  }
  const moreOlder = direction === "after" ? true : hasMore;
  const moreNewer = direction === "after" ? hasMore : direction === "before";
  return {
    rows,
    nextCursor: moreOlder ? cursorOf(last) : null,
    prevCursor: moreNewer ? cursorOf(first) : null,
  };
}

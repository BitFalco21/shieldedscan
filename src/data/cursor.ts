/**
 * Cursor encoding for keyset pagination.
 *
 * A cursor is an opaque base64url token carrying the full sort-key tuple `(sortKey, id)` of
 * the boundary row, so an adapter can translate `before`/`after` straight into a composite
 * range scan (`WHERE (sort_col, id_col) < ($sortKey, $id) ...`) without first looking up
 * the row.
 *
 * `before`/`after` come from the URL and are untrusted: `decodeCursor` never throws.
 * Anything malformed — wrong shape, invalid base64, empty, or absurdly long — resolves to
 * `null`, which callers treat as the first page. A sort key out of range for its column is
 * equally unusable: use `decodeCursorForColumn` wherever the key is bound into SQL.
 */

import type { CursorQuery } from "./source";

const MAX_CURSOR_LENGTH = 1024;

/** The query string every keyset list endpoint takes: `limit`, plus whichever cursor is set. */
export function cursorSearchParams(query: CursorQuery): URLSearchParams {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.before) params.set("before", query.before);
  if (query.after) params.set("after", query.after);
  return params;
}

/** Encodes a sort-key tuple as an opaque cursor token. */
export function encodeCursor(sortKey: string | number, id: string): string {
  return Buffer.from(`${sortKey}|${id}`, "utf8").toString("base64url");
}

/**
 * A cursor before the oldest row any list can hold, so paging `after` it lands on the
 * final page. `after` is an ascending seek from the cursor everywhere, so an origin below
 * every row walks in from the other end of the same index — an "oldest" control with no
 * `COUNT(*)`, no offset and no extra query parameter.
 *
 * Heights and unix timestamps are non-negative, so no real row can hold `-1`.
 */
export const ORIGIN_CURSOR = encodeCursor(-1, "0");

/** Decodes a cursor token back into its sort-key tuple, or `null` if it isn't one. */
export function decodeCursor(raw: string): { sortKey: string; id: string } | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) {
    return null;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const separator = decoded.indexOf("|");
  if (separator === -1) {
    return null;
  }

  const sortKey = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (sortKey.length === 0 || id.length === 0) {
    return null;
  }

  return { sortKey, id };
}

/**
 * The largest sort key an `INTEGER` column can hold — `block.height`,
 * `tx_transparent_io.block_height`.
 */
export const INT4_SORT_KEY_MAX = 2_147_483_647;

/**
 * The largest sort key to accept for a `BIGINT` column — `tx.timestamp`,
 * `crosschain_transfer.timestamp`, `reorg_event.detected_at`, `reorg_event.id`.
 *
 * `Number.MAX_SAFE_INTEGER` rather than `2^63 − 1`: a cursor is minted and read as a JS
 * number, so a larger value cannot be one this system produced. The comparison must also be
 * exact — the literal `9_223_372_036_854_775_807` rounds up in float64, so `key > INT8_MAX`
 * would let the boundary value through into an overflow.
 */
export const INT8_SORT_KEY_MAX = Number.MAX_SAFE_INTEGER;

/**
 * Decodes a cursor and resolves its sort key to a number the target column can hold, or
 * `null` ("no cursor, first page") for anything unusable.
 *
 * A well-shaped cursor carrying `9999999999` is too large for an `INTEGER` column, and
 * Postgres answers an out-of-range bind parameter with an error rather than an empty page —
 * a hand-edited URL would return HTTP 500. Range is therefore checked here, once, rather
 * than in each adapter.
 *
 * The floor is `ORIGIN_CURSOR`'s −1, not 0: paging `after` that sentinel is how the
 * "oldest" control reaches the far end of the index.
 */
export function decodeCursorForColumn(
  raw: string | undefined,
  max: number,
): { sortKey: number; id: string } | null {
  if (raw === undefined) return null;
  const decoded = decodeCursor(raw);
  if (!decoded) return null;
  const sortKey = Number(decoded.sortKey);
  if (!Number.isFinite(sortKey)) return null;
  if (sortKey < -1 || sortKey > max) return null;
  return { sortKey, id: decoded.id };
}

/** The sort-key tuple a cursor carries: the column the list is ordered by, plus the id tiebreak. */
export interface SortKey {
  sortKey: number;
  id: string;
}

/**
 * Compares two sort keys in the order the lists below sort their arrays: descending by
 * `sortKey`, then descending by `id` for equal keys — the in-memory equivalent of a SQL
 * row-value comparison `(a.sortKey, a.id)` vs `(b.sortKey, b.id)`.
 *
 * The tiebreak direction matters. `id DESC` is what makes the SQL form a plain row-value
 * comparison, `WHERE (sort_col, id_col) < ($sortKey, $id)`, served by a matching composite
 * index; an ascending tiebreak needs `WHERE sort_col < $ts OR (sort_col = $ts AND id_col >
 * $id)` and a mixed-direction index. Timestamps do tie, and a cursor minted under one
 * ordering and spent against the other silently skips or repeats rows inside a tied group.
 */
function compareSortKeys(a: SortKey, b: SortKey): number {
  return b.sortKey - a.sortKey || b.id.localeCompare(a.id);
}

/** Parses a cursor token into a `SortKey`, or `null` if it is missing, malformed, or unusable. */
function parseCursor(raw: string | undefined): SortKey | null {
  if (raw === undefined) return null;
  const decoded = decodeCursor(raw);
  if (!decoded) return null;
  const sortKey = Number(decoded.sortKey);
  if (!Number.isFinite(sortKey)) return null;
  return { sortKey, id: decoded.id };
}

/**
 * Keyset pagination over a pre-sorted (newest-first) array. `keyOf` returns the full
 * sort-key tuple `(sortKey, id)` for an item, because for every list except blocks the id
 * alone carries no ordering information. Comparisons use `compareSortKeys` rather than
 * array position, so a cursor that matches no row (stale, or hypothetical) still resolves
 * to the correct position by inequality, like a database range scan.
 *
 * An unknown or undecodable cursor falls back to the first page, never an error or an empty
 * page.
 */
export function cursorSlice<T>(
  sortedNewestFirst: T[],
  keyOf: (item: T) => SortKey,
  query: { before?: string; after?: string; limit: number },
): { items: T[]; nextCursor: string | null; prevCursor: string | null } {
  const limit = Math.min(Math.max(1, Math.floor(query.limit)), 100);
  const length = sortedNewestFirst.length;

  const beforeKey = parseCursor(query.before);
  const afterKey = parseCursor(query.after);

  let start = 0;
  let end = Math.min(limit, length);

  if (beforeKey) {
    // First item that sorts strictly after the cursor — i.e. strictly older.
    const index = sortedNewestFirst.findIndex(
      (item) => compareSortKeys(beforeKey, keyOf(item)) < 0,
    );
    start = index === -1 ? length : index;
    end = Math.min(start + limit, length);
  } else if (afterKey) {
    // First item at-or-older-than the cursor: everything before it is strictly newer.
    // Bounding `end` (not just clamping `start`) keeps `after` from overrunning into rows the
    // cursor excludes.
    const index = sortedNewestFirst.findIndex(
      (item) => compareSortKeys(keyOf(item), afterKey) >= 0,
    );
    end = index === -1 ? length : index;
    start = Math.max(0, end - limit);
  }

  const items = sortedNewestFirst.slice(start, end);
  const last = items[items.length - 1];
  const first = items[0];
  const lastKey = last ? keyOf(last) : null;
  const firstKey = first ? keyOf(first) : null;
  return {
    items,
    nextCursor: end < length && lastKey ? encodeCursor(lastKey.sortKey, lastKey.id) : null,
    prevCursor: start > 0 && firstKey ? encodeCursor(firstKey.sortKey, firstKey.id) : null,
  };
}

/** Which way a keyset page walks from its seek row. */
export type SeekDirection = "before" | "after";

/**
 * Resolve a `CursorQuery`'s `before`/`after` pair into one seek position and direction.
 *
 * If both are given, `before` wins: the newest-first lists treat a forward cursor as the
 * common case, and the public `/v1` surface rejects the pair before it reaches an adapter.
 *
 * `max` is the column's ceiling (`INT4_SORT_KEY_MAX` / `INT8_SORT_KEY_MAX`); a cursor out of
 * range or malformed is `null`, never an error and never an empty page.
 */
export function seekFromCursors(
  query: { before?: string; after?: string },
  max: number,
): { seek: { sortKey: number; id: string }; direction: SeekDirection } | null {
  const before = decodeCursorForColumn(query.before, max);
  if (before) return { seek: before, direction: "before" };
  const after = decodeCursorForColumn(query.after, max);
  if (after) return { seek: after, direction: "after" };
  return null;
}

/**
 * The live feed's state machine, as pure functions.
 *
 * Everything that decides what a reader sees lives here, testable without a timer, network or
 * DOM; the polling hook is plumbing.
 *
 * A cursored list grows and never truncates. `/blocks` and `/txs` page "older" with a keyset
 * cursor derived from the last row shown, so dropping rows off the bottom would leave them above
 * the cursor and below the page, reachable from no page at all. `grow` mode therefore stops at
 * the cap and says so; `window` mode may truncate because the homepage panels carry no cursor.
 */

/**
 * How many rows a cursored list may grow by before it stops and says so. Bounds a long-open
 * tab's DOM: at ~48 blocks an hour this is about an hour of watching.
 */
export const LIVE_ROW_CAP = 50;

/** How many observed tips to remember. Comfortably past any plausible reorg depth. */
const TIP_HISTORY = 128;

export interface LiveList<T> {
  /** Rows added since the server render, newest first. */
  rows: T[];
  /** Ids that arrived on the most recent merge, so a "new" marker clears on the next poll. */
  freshIds: string[];
  status: LiveStatus;
}

/**
 * `capped` and `reorganised` both mean the list has stopped tracking the chain: one is our own
 * bound, the other the chain changing underneath the page.
 */
export type LiveStatus = "live" | "capped" | "reorganised";

export const EMPTY_LIVE_LIST: LiveList<never> = { rows: [], freshIds: [], status: "live" };

export interface MergeOptions<T> {
  idOf: (row: T) => string;
  /** Height for blocks, timestamp for transactions and transfers. Higher is newer. */
  sortKeyOf: (row: T) => number;
  /**
   * The sort key of the newest row the page already shows. A row is an arrival only if it sorts
   * strictly above this; absence from `knownIds` is not enough, because the poll's window of
   * newest rows can be larger than the list it feeds, and the surplus is older than the page.
   * A tie is refused: transactions in one block share a timestamp, so a tie is older in list order.
   */
  floor: number;
  /** Ids the server pass already rendered. Rows here are not "new" and must not be added. */
  knownIds: ReadonlySet<string>;
  /** Maximum live rows. What happens at the ceiling is `mode`'s business. */
  cap: number;
  /**
   * `grow` — a cursored list: stop at the cap, never truncate. See the header.
   * `window` — a fixed-size panel with no cursor: drop the oldest to make room.
   */
  mode: "grow" | "window";
  /**
   * Whether rows added by this merge are flagged as newly arrived. Off for the first poll after
   * a page load, which reconciles against possibly minutes-old cached HTML: its rows are absent
   * from the render but did not arrive while anyone was watching. Defaults to on.
   */
  markFresh?: boolean;
}

/**
 * Fold one poll's rows into the live list. `incoming` is newest-first and overlaps previous
 * polls by design (the endpoint returns the newest N each time), so deduplication is the
 * common path.
 */
export function mergeLiveRows<T>(
  current: LiveList<T>,
  incoming: readonly T[],
  { idOf, sortKeyOf, knownIds, floor, cap, mode, markFresh = true }: MergeOptions<T>,
): LiveList<T> {
  const seen = new Set(knownIds);
  for (const held of current.rows) seen.add(idOf(held));

  // Rows already merged raise the bar as well as the server's: without this a row accepted on
  // one poll could be re-accepted after the cap evicted it in window mode.
  const newestHeld = Math.max(floor, ...current.rows.map(sortKeyOf));

  const additions = incoming.filter(
    (candidate) => !seen.has(idOf(candidate)) && sortKeyOf(candidate) > newestHeld,
  );

  if (mode === "window") {
    const rows = [...additions, ...current.rows].slice(0, cap);
    const kept = new Set(rows.map(idOf));
    return {
      rows,
      freshIds: markFresh ? additions.map(idOf).filter((id) => kept.has(id)) : [],
      status: "live",
    };
  }

  const room = Math.max(0, cap - current.rows.length);
  const taken = additions.slice(0, room);
  const rows = [...taken, ...current.rows];
  return {
    rows,
    freshIds: markFresh ? taken.map(idOf) : [],
    // Capped as soon as there is no room left, before any arrival can be silently missed.
    status: taken.length < additions.length || rows.length >= cap ? "capped" : "live",
  };
}

/**
 * Throw away everything the live layer accumulated, because the chain contradicted it. The
 * status keeps the page from reading as "nothing new has happened".
 */
export function discardOnReorg<T>(): LiveList<T> {
  return { rows: [], freshIds: [], status: "reorganised" };
}

export interface TipRef {
  height: number;
  hash: string;
}

/** Record an observed tip, keeping a bounded history (it lives as long as the tab). */
export function rememberTip(seen: ReadonlyMap<number, string>, tip: TipRef): Map<number, string> {
  const next = new Map(seen);
  next.set(tip.height, tip.hash);
  if (next.size > TIP_HISTORY) {
    // Oldest by HEIGHT, not by insertion: a reorg re-reports a height already present, which
    // would otherwise move it to the end and evict a newer one instead.
    const byHeight = [...next.keys()].sort((a, b) => a - b);
    for (const height of byHeight.slice(0, next.size - TIP_HISTORY)) next.delete(height);
  }
  return next;
}

/**
 * True when a height we have already observed now reports a different hash. Depth-1 reorgs
 * are routine and happen at the tip, so the tip alone is a sufficient signal for every feed.
 * An unseen height is not evidence of anything, so it returns false.
 */
export function reorgDetected(seen: ReadonlyMap<number, string>, tip: TipRef): boolean {
  const known = seen.get(tip.height);
  return known !== undefined && known !== tip.hash;
}

export interface DisplayOptions<T> {
  idOf: (row: T) => string;
  sortKeyOf: (row: T) => number;
  /** Hold the list to this many rows. Omit for a cursored list, which grows. */
  size?: number;
}

/**
 * The rows a surface renders: live arrivals and the server pass, as one ordered list.
 *
 * Sorting here is a guarantee rather than a tidy-up: with order enforced at render, a merge bug
 * can only cost a missing row, never a scrambled list. A tie keeps live above server, since the
 * sort is stable and a live row at the same key (common within one block) arrived later.
 */
export function displayRows<T>(
  live: readonly T[],
  server: readonly T[],
  { idOf, sortKeyOf, size }: DisplayOptions<T>,
): T[] {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const row of [...live, ...server]) {
    const id = idOf(row);
    // A row can appear in both halves for one poll after the server re-renders; show it once.
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(row);
  }
  rows.sort((a, b) => sortKeyOf(b) - sortKeyOf(a));
  return size === undefined ? rows : rows.slice(0, size);
}

/**
 * Only the transactions the payload's own blocks list can account for.
 *
 * The blocks list is coalesced on a short window server-side while transactions are read fresh,
 * so a poll can carry a block's transactions before the block. Those are withheld until the
 * block arrives, so the panels never contradict each other. `null` heights are withheld too
 * (defensive; confirmed lists never produce one).
 */
export function consistentTransactions<T extends { blockHeight: number | null }>(
  transactions: readonly T[],
  newestBlockHeight: number | null,
): T[] {
  if (newestBlockHeight === null) return [];
  return transactions.filter((t) => t.blockHeight !== null && t.blockHeight <= newestBlockHeight);
}

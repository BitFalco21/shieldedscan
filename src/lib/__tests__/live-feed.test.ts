import { describe, expect, it } from "vitest";
import {
  EMPTY_LIVE_LIST,
  consistentTransactions,
  displayRows,
  type LiveList,
  discardOnReorg,
  mergeLiveRows,
  reorgDetected,
  rememberTip,
} from "../live-feed";

/**
 * The live layer's correctness lives in these pure functions, so the invariants are pinned
 * here rather than in a component test.
 *
 * The most important is the growth rule. `/blocks` and `/txs` carry a keyset cursor derived
 * from the last row on the page, so dropping rows off the bottom to make room at the top
 * would make those rows reachable from no page at all. Growing the page keeps the cursor
 * valid, which is why "grow" mode never truncates and stops at the cap instead.
 *
 * Several tests assert an absence (no fresh rows, no reorg, still live) and would pass
 * against a stub that does nothing. Each is paired with a test of the opposite case; only
 * the pair pins the property, so keep both halves.
 */

interface Row {
  id: string;
  /** Height for blocks, timestamp for the other two. Higher is newer. */
  key: number;
}

const row = (id: string, key = 0): Row => ({ id, key });
const idOf = (r: Row) => r.id;
const sortKeyOf = (r: Row) => r.key;
const ids = (list: LiveList<Row>) => list.rows.map(idOf);

/** `mergeLiveRows` with the two options every test would otherwise repeat. */
function merge(
  current: LiveList<Row>,
  incoming: Row[],
  options: {
    known?: string[];
    cap?: number;
    mode?: "grow" | "window";
    floor?: number;
  } = {},
): LiveList<Row> {
  return mergeLiveRows(current, incoming, {
    idOf,
    sortKeyOf,
    knownIds: new Set(options.known ?? []),
    cap: options.cap ?? 50,
    mode: options.mode ?? "grow",
    // Below every test row unless a test says otherwise, so the cases about deduplication and
    // capping are unaffected by the recency floor.
    floor: options.floor ?? Number.NEGATIVE_INFINITY,
  });
}

describe("mergeLiveRows", () => {
  it("prepends a row the page has not shown", () => {
    const next = merge(EMPTY_LIVE_LIST, [row("b")], { known: ["a"] });

    expect(ids(next)).toEqual(["b"]);
  });

  it("ignores a row the server pass already rendered", () => {
    const next = merge(EMPTY_LIVE_LIST, [row("a")], { known: ["a"] });

    expect(ids(next)).toEqual([]);
  });

  it("ignores a row an earlier poll already merged", () => {
    // The poll returns the newest 10 every time, so consecutive polls overlap heavily. A
    // duplicated row is what `e2e/pagination.spec.ts` treats as a failure, and it would be
    // indistinguishable on screen from the chain genuinely containing the same block twice.
    const first = merge(EMPTY_LIVE_LIST, [row("b")], { known: ["a"] });
    const second = merge(first, [row("b")], { known: ["a"] });

    expect(ids(second)).toEqual(["b"]);
  });

  it("keeps newest-first order when several arrive in one poll", () => {
    const next = merge(EMPTY_LIVE_LIST, [row("d", 4), row("c", 3), row("b", 2)], {
      known: ["a"],
    });

    expect(ids(next)).toEqual(["d", "c", "b"]);
  });

  it("puts the newest poll's rows above the previous poll's", () => {
    const first = merge(EMPTY_LIVE_LIST, [row("b", 2)], { known: ["a"] });
    const second = merge(first, [row("c", 3)], { known: ["a"] });

    expect(ids(second)).toEqual(["c", "b"]);
  });

  it("marks only the rows from the latest merge as fresh", () => {
    // The "new" marker has to clear, or every row accumulated over an hour keeps claiming to
    // have just arrived.
    const first = merge(EMPTY_LIVE_LIST, [row("b", 2)], { known: ["a"] });
    const second = merge(first, [row("c", 3)], { known: ["a"] });

    expect(first.freshIds).toEqual(["b"]);
    expect(second.freshIds).toEqual(["c"]);
  });

  it("reports no fresh rows when a poll brings nothing new", () => {
    const first = merge(EMPTY_LIVE_LIST, [row("b")], { known: ["a"] });
    const second = merge(first, [row("b")], { known: ["a"] });

    expect(second.freshIds).toEqual([]);
  });

  describe("the recency floor — what counts as ARRIVED", () => {
    it("refuses a row that is older than everything on screen", () => {
      // The poll returns the newest ten blocks while the homepage panel shows eight, so two
      // are older than the whole page. They are not in `knownIds`, and prepending them would
      // put the oldest blocks above the tip.
      const next = merge(EMPTY_LIVE_LIST, [row("older", 5)], { floor: 10 });

      expect(ids(next)).toEqual([]);
    });

    it("accepts a row newer than everything on screen", () => {
      const next = merge(EMPTY_LIVE_LIST, [row("newer", 11)], { floor: 10 });

      expect(ids(next)).toEqual(["newer"]);
    });

    it("refuses a row that TIES with the newest on screen", () => {
      // Transactions in one block share a timestamp, so a tie means "same block, further down
      // the list" — older in list order, not newer. Rejecting is conservative and correct: it
      // appears on the next reload rather than jumping to the top.
      const next = merge(EMPTY_LIVE_LIST, [row("tied", 10)], { floor: 10 });

      expect(ids(next)).toEqual([]);
    });

    it("takes only the newer rows out of a mixed poll", () => {
      const next = merge(EMPTY_LIVE_LIST, [row("new", 12), row("old", 3)], { floor: 10 });

      expect(ids(next)).toEqual(["new"]);
    });

    it("raises the floor as rows arrive, so one poll's rows do not re-enter", () => {
      const first = merge(EMPTY_LIVE_LIST, [row("a", 11)], { floor: 10 });
      // A later poll still carries height 11; it is neither newer than what we hold nor absent.
      const second = merge(first, [row("a", 11), row("b", 12)], { floor: 10 });

      expect(ids(second)).toEqual(["b", "a"]);
    });
  });

  it("adds rows without marking them when told not to mark", () => {
    // The first poll after a page load reconciles against a prerendered, CDN-cached page whose
    // HTML may be minutes old. Those rows must be added, but they did not arrive while anyone
    // was watching, so marking them "new" would make the mark meaningless.
    const next = mergeLiveRows(EMPTY_LIVE_LIST, [row("b"), row("c")], {
      idOf,
      sortKeyOf,
      knownIds: new Set<string>(),
      cap: 50,
      mode: "grow",
      floor: Number.NEGATIVE_INFINITY,
      markFresh: false,
    });

    expect(ids(next)).toEqual(["b", "c"]);
    expect(next.freshIds).toEqual([]);
  });

  describe("grow mode — a cursored list", () => {
    it("stops at the cap rather than dropping rows off the bottom", () => {
      // The page's "older" cursor still points below the original last row, so a row dropped
      // above it would appear on no page at all.
      const full = merge(EMPTY_LIVE_LIST, [row("c", 3), row("b", 2)], { cap: 2 });
      const next = merge(full, [row("d", 4)], { cap: 2 });

      expect(ids(next)).toEqual(["c", "b"]);
    });

    it("says it is capped rather than looking live and silently ignoring the chain", () => {
      const full = merge(EMPTY_LIVE_LIST, [row("c", 3), row("b", 2)], { cap: 2 });
      const next = merge(full, [row("d", 4)], { cap: 2 });

      expect(next.status).toBe("capped");
    });

    it("takes as many rows as fit when a poll would cross the cap", () => {
      const one = merge(EMPTY_LIVE_LIST, [row("b", 2)], { cap: 2 });
      const next = merge(one, [row("d", 4), row("c", 3)], { cap: 2 });

      expect(ids(next)).toEqual(["d", "b"]);
      expect(next.status).toBe("capped");
    });
  });

  describe("window mode — a fixed-size homepage panel", () => {
    it("drops the oldest live row to make room", () => {
      // Safe here and only here: the panels carry no cursor, so nothing becomes unreachable.
      const full = merge(EMPTY_LIVE_LIST, [row("c", 3), row("b", 2)], { cap: 2, mode: "window" });
      const next = merge(full, [row("d", 4)], { cap: 2, mode: "window" });

      expect(ids(next)).toEqual(["d", "c"]);
    });

    it("stays live rather than reporting itself capped", () => {
      const full = merge(EMPTY_LIVE_LIST, [row("c", 3), row("b", 2)], { cap: 2, mode: "window" });
      const next = merge(full, [row("d", 4)], { cap: 2, mode: "window" });

      expect(next.status).toBe("live");
    });
  });
});

describe("reorgDetected", () => {
  const seen = rememberTip(new Map(), { height: 100, hash: "aaa" });

  it("is false for a tip that extends what we have seen", () => {
    expect(reorgDetected(seen, { height: 101, hash: "bbb" })).toBe(false);
  });

  it("is false for the same tip reported again", () => {
    expect(reorgDetected(seen, { height: 100, hash: "aaa" })).toBe(false);
  });

  it("is true when a height we saw now reports a different hash", () => {
    // Depth-1 reorgs are routine on Zcash (~1.6/day). Leaving the orphaned block on screen as
    // current would be a confident wrong claim on a site that publishes /reorgs.
    expect(reorgDetected(seen, { height: 100, hash: "zzz" })).toBe(true);
  });

  it("is false at a height we have never seen", () => {
    expect(reorgDetected(seen, { height: 99, hash: "zzz" })).toBe(false);
  });
});

describe("discardOnReorg", () => {
  it("drops every accumulated row", () => {
    // The rows above a reorged tip may include the orphaned block itself. Keeping them would
    // render a block that is no longer on the chain as the newest one on the page.
    expect(discardOnReorg<Row>().rows).toEqual([]);
  });

  it("reports the reason rather than looking like an ordinary empty list", () => {
    expect(discardOnReorg<Row>().status).toBe("reorganised");
  });
});

describe("rememberTip", () => {
  it("records a tip so a later contradiction is detectable", () => {
    const seen = rememberTip(new Map(), { height: 7, hash: "aaa" });

    expect(seen.get(7)).toBe("aaa");
  });

  it("keeps a bounded history rather than growing for the life of the tab", () => {
    let seen = new Map<number, string>();
    for (let height = 0; height < 500; height++) {
      seen = rememberTip(seen, { height, hash: `h${height}` });
    }

    expect(seen.size).toBeLessThanOrEqual(128);
    // The newest must survive the trim — it is the one a reorg contradicts first.
    expect(seen.get(499)).toBe("h499");
  });
});

describe("displayRows", () => {
  const opts = { idOf, sortKeyOf };

  it("orders strictly newest-first regardless of how the halves arrived", () => {
    // Out-of-order heights are self-evidently wrong to a reader, worse than the list not
    // updating at all.
    const out = displayRows([row("live", 5)], [row("s1", 9), row("s2", 7)], opts);

    expect(out.map(idOf)).toEqual(["s1", "s2", "live"]);
  });

  it("drops a row present in both halves rather than showing it twice", () => {
    const dupe = row("same", 9);
    const out = displayRows([dupe], [dupe, row("s2", 7)], opts);

    expect(out.map(idOf)).toEqual(["same", "s2"]);
  });

  it("holds a panel to the size the server rendered", () => {
    const out = displayRows([row("a", 9)], [row("b", 8), row("c", 7)], { ...opts, size: 2 });

    expect(out.map(idOf)).toEqual(["a", "b"]);
  });

  it("leaves a cursored list unbounded when given no size", () => {
    const out = displayRows([row("a", 9)], [row("b", 8), row("c", 7)], opts);

    expect(out).toHaveLength(3);
  });

  it("keeps live rows above server rows on a TIE", () => {
    // Transactions in one block share a timestamp. A live row at the same key arrived later, so
    // it belongs above; `Array.prototype.sort` is stable, which is what makes this hold.
    const out = displayRows([row("live", 5)], [row("server", 5)], opts);

    expect(out.map(idOf)).toEqual(["live", "server"]);
  });
});

describe("consistentTransactions", () => {
  const tx = (id: string, blockHeight: number | null) => ({ txid: id, blockHeight });

  it("withholds a transaction from a block the payload does not carry", () => {
    // The blocks list is request-coalesced on a 20 s window while transactions are read fresh,
    // so one payload can carry a transaction from a block the blocks list does not show yet.
    // It is withheld until the next poll, when both arrive together.
    const kept = consistentTransactions([tx("a", 101), tx("b", 100)], 100);

    expect(kept.map((t) => t.txid)).toEqual(["b"]);
  });

  it("keeps everything when the blocks list is current", () => {
    const kept = consistentTransactions([tx("a", 100), tx("b", 99)], 100);

    expect(kept).toHaveLength(2);
  });

  it("withholds a transaction with NO height rather than guessing", () => {
    // Unattributable to any block the payload carries, so it cannot be shown as consistent
    // with them. The confirmed-transaction list never produces one; this is defensive.
    const kept = consistentTransactions([tx("a", null)], 100);

    expect(kept).toEqual([]);
  });

  it("withholds everything when there are no blocks to be consistent with", () => {
    const kept = consistentTransactions([tx("a", 100)], null);

    expect(kept).toEqual([]);
  });
});

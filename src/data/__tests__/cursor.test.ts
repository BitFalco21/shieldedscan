import { describe, expect, it } from "vitest";
import { txKind } from "@/domain";
import {
  INT4_SORT_KEY_MAX,
  INT8_SORT_KEY_MAX,
  ORIGIN_CURSOR,
  cursorSearchParams,
  decodeCursor,
  decodeCursorForColumn,
  encodeCursor,
  seekFromCursors,
} from "../cursor";
import { fixtureDataSource } from "../fixture-source";

/**
 * The fixture adapter must behave exactly like an index seek
 * (`WHERE key < $cursor ORDER BY key DESC LIMIT n`) — no repeats, no gaps — so the UI is
 * the same against fixtures and against Postgres.
 */

/** Small limit on purpose: forces multiple pages even over a short fixture list. */
const SMALL_LIMIT = 3;
/** Guards against an infinite loop if a bug makes nextCursor never settle to null. */
const MAX_PAGES = 200;

describe("listBlocks cursor pagination", () => {
  it("first page: prevCursor is null, nextCursor is the last item's key", async () => {
    const page = await fixtureDataSource.listBlocks({ limit: SMALL_LIMIT });
    expect(page.prevCursor).toBeNull();
    const last = page.items[page.items.length - 1];
    expect(last).toBeDefined();
    expect(page.nextCursor).toBe(encodeCursor(last!.height, last!.hash));
  });

  it("paging forward with before visits every block exactly once, in order, with no gaps", async () => {
    const full = await fixtureDataSource.listBlocks({ limit: 100 });
    expect(full.nextCursor).toBeNull(); // sanity: fixtures fit in one 100-row page

    const visited: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await fixtureDataSource.listBlocks({ before: cursor, limit: SMALL_LIMIT });
      visited.push(...page.items.map((b) => String(b.height)));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    expect(visited).toEqual(full.items.map((b) => String(b.height)));
  });

  it("last page: nextCursor is null", async () => {
    let page = await fixtureDataSource.listBlocks({ limit: SMALL_LIMIT });
    for (let i = 0; i < MAX_PAGES && page.nextCursor !== null; i++) {
      page = await fixtureDataSource.listBlocks({ before: page.nextCursor, limit: SMALL_LIMIT });
    }
    expect(page.nextCursor).toBeNull();
    expect(page.items.length).toBeGreaterThan(0);
  });

  it("paging back with after from the last page returns to the first page's exact items", async () => {
    const first = await fixtureDataSource.listBlocks({ limit: SMALL_LIMIT });

    let last = first;
    for (let i = 0; i < MAX_PAGES && last.nextCursor !== null; i++) {
      last = await fixtureDataSource.listBlocks({ before: last.nextCursor, limit: SMALL_LIMIT });
    }

    let back = last;
    for (let i = 0; i < MAX_PAGES && back.prevCursor !== null; i++) {
      back = await fixtureDataSource.listBlocks({ after: back.prevCursor, limit: SMALL_LIMIT });
    }

    expect(back.items.map((b) => b.height)).toEqual(first.items.map((b) => b.height));
    expect(back.prevCursor).toBeNull();
  });

  it("an unknown/garbage before cursor returns the first page, not an error or an empty page", async () => {
    const first = await fixtureDataSource.listBlocks({ limit: SMALL_LIMIT });
    const garbage = await fixtureDataSource.listBlocks({
      before: "not-a-real-cursor-\0\0",
      limit: SMALL_LIMIT,
    });
    expect(garbage.items.map((b) => b.height)).toEqual(first.items.map((b) => b.height));
    expect(garbage.prevCursor).toBeNull();
  });

  it("an unknown/garbage after cursor also returns the first page", async () => {
    const first = await fixtureDataSource.listBlocks({ limit: SMALL_LIMIT });
    const garbage = await fixtureDataSource.listBlocks({
      after: "totally-stale-cursor",
      limit: SMALL_LIMIT,
    });
    expect(garbage.items.map((b) => b.height)).toEqual(first.items.map((b) => b.height));
  });

  it("limit is clamped to a sane range for both 0 and 10_000", async () => {
    const zero = await fixtureDataSource.listBlocks({ limit: 0 });
    expect(zero.items.length).toBe(1);

    const huge = await fixtureDataSource.listBlocks({ limit: 10_000 });
    expect(huge.items.length).toBeGreaterThan(0);
    expect(huge.items.length).toBeLessThanOrEqual(100);
  });
});

describe("listTransactions cursor pagination", () => {
  it("paging forward with before visits every transaction exactly once, in order", async () => {
    const full = await fixtureDataSource.listTransactions({ limit: 100 }, "all");
    expect(full.nextCursor).toBeNull();

    const visited: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await fixtureDataSource.listTransactions(
        { before: cursor, limit: SMALL_LIMIT },
        "all",
      );
      visited.push(...page.items.map((t) => t.txid));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    expect(visited).toEqual(full.items.map((t) => t.txid));
  });

  it("an unknown cursor returns the first page", async () => {
    const first = await fixtureDataSource.listTransactions({ limit: SMALL_LIMIT }, "all");
    const garbage = await fixtureDataSource.listTransactions(
      { before: "garbage", limit: SMALL_LIMIT },
      "all",
    );
    expect(garbage.items.map((t) => t.txid)).toEqual(first.items.map((t) => t.txid));
  });

  it("a filtered (kind=shielded) list paginates consistently: only shielded txs, each exactly once", async () => {
    const visited: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await fixtureDataSource.listTransactions(
        { before: cursor, limit: SMALL_LIMIT },
        "shielded",
      );
      for (const tx of page.items) {
        expect(txKind(tx)).toBe("shielded");
      }
      visited.push(...page.items.map((t) => t.txid));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    // No repeats.
    expect(new Set(visited).size).toBe(visited.length);
    expect(visited.length).toBeGreaterThan(0);

    // Same order as filtering the unfiltered, fully-paged list ourselves.
    const full = await fixtureDataSource.listTransactions({ limit: 100 }, "all");
    const expectedShielded = full.items.filter((t) => txKind(t) === "shielded").map((t) => t.txid);
    expect(visited).toEqual(expectedShielded);
  });
});

describe("listCrossChainTransfers cursor pagination", () => {
  it("first page: prevCursor is null, nextCursor is the last item's key", async () => {
    const page = await fixtureDataSource.listCrossChainTransfers({ limit: SMALL_LIMIT });
    expect(page.prevCursor).toBeNull();
    const last = page.items[page.items.length - 1];
    expect(last).toBeDefined();
    expect(page.nextCursor).toBe(encodeCursor(last!.timestamp, last!.id));
  });

  it("paging forward with before visits every transfer exactly once, in order", async () => {
    const full = await fixtureDataSource.listCrossChainTransfers({ limit: 100 });
    expect(full.nextCursor).toBeNull();

    const visited: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await fixtureDataSource.listCrossChainTransfers({
        before: cursor,
        limit: SMALL_LIMIT,
      });
      visited.push(...page.items.map((t) => t.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    expect(visited).toEqual(full.items.map((t) => t.id));
  });

  it("an unknown cursor returns the first page", async () => {
    const first = await fixtureDataSource.listCrossChainTransfers({ limit: SMALL_LIMIT });
    const garbage = await fixtureDataSource.listCrossChainTransfers({
      before: "not-a-real-transfer-id",
      limit: SMALL_LIMIT,
    });
    expect(garbage.items.map((t) => t.id)).toEqual(first.items.map((t) => t.id));
  });
});

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a sort-key tuple", () => {
    expect(decodeCursor(encodeCursor(2_481_032, "block-hash-abc"))).toEqual({
      sortKey: "2481032",
      id: "block-hash-abc",
    });
    expect(decodeCursor(encodeCursor(1_753_500_000, "aa07"))).toEqual({
      sortKey: "1753500000",
      id: "aa07",
    });
  });

  it("returns null for garbage, empty, and very long input", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not-a-real-cursor")).toBeNull();
    expect(decodeCursor("x".repeat(5000))).toBeNull();
  });
});

/**
 * A cursor's sort key is bound into SQL, so being well-shaped is not enough: it must also
 * fit the column it is compared against, or Postgres errors and a hand-edited URL returns
 * HTTP 500 instead of the first page. `BIGINT` keysets: `/v1/transactions`,
 * `/v1/crosschain/transfers`, `/v1/reorgs`; `INTEGER`: `/v1/addresses/{a}/transactions`.
 *
 * These assert the property: anything a column cannot hold is "no cursor", while the
 * ORIGIN_CURSOR sentinel (−1) survives, because it is what makes the "oldest" control work.
 */
describe("decodeCursorForColumn — range is part of being usable", () => {
  it("accepts a key the column can hold, as a number", () => {
    expect(decodeCursorForColumn(encodeCursor(3_437_121, "abc"), INT4_SORT_KEY_MAX)).toEqual({
      sortKey: 3_437_121,
      id: "abc",
    });
    expect(decodeCursorForColumn(encodeCursor(1_785_000_000, "aa07"), INT8_SORT_KEY_MAX)).toEqual({
      sortKey: 1_785_000_000,
      id: "aa07",
    });
  });

  it("rejects a key past INTEGER, which is the address keyset's sort column", () => {
    expect(
      decodeCursorForColumn(encodeCursor(9_999_999_999, "deadbeef"), INT4_SORT_KEY_MAX),
    ).toBeNull();
    // The exact boundary is usable; one past it is not.
    expect(
      decodeCursorForColumn(encodeCursor(INT4_SORT_KEY_MAX, "x"), INT4_SORT_KEY_MAX),
    ).not.toBeNull();
    expect(
      decodeCursorForColumn(encodeCursor(INT4_SORT_KEY_MAX + 1, "x"), INT4_SORT_KEY_MAX),
    ).toBeNull();
  });

  it("rejects a key past the BIGINT ceiling, including the float64 boundary trap", () => {
    // Well-shaped and finite (`Number` gives 1e22) — rejected for range, not for shape.
    expect(
      decodeCursorForColumn(encodeCursor("9999999999999999999999", "x"), INT8_SORT_KEY_MAX),
    ).toBeNull();
    expect(
      decodeCursorForColumn(encodeCursor(INT8_SORT_KEY_MAX, "x"), INT8_SORT_KEY_MAX),
    ).not.toBeNull();
    expect(
      decodeCursorForColumn(encodeCursor(INT8_SORT_KEY_MAX + 1, "x"), INT8_SORT_KEY_MAX),
    ).toBeNull();
    // `2^63 − 1` rounds up in float64, so a naive `> 2^63 − 1` test would let this through into
    // an int8 overflow.
    expect(
      decodeCursorForColumn(encodeCursor("9223372036854775807", "x"), INT8_SORT_KEY_MAX),
    ).toBeNull();
  });

  it("still passes the ORIGIN_CURSOR sentinel, so the oldest page stays reachable", () => {
    expect(decodeCursorForColumn(ORIGIN_CURSOR, INT4_SORT_KEY_MAX)).toEqual({
      sortKey: -1,
      id: "0",
    });
    expect(decodeCursorForColumn(ORIGIN_CURSOR, INT8_SORT_KEY_MAX)).toEqual({
      sortKey: -1,
      id: "0",
    });
  });

  it("rejects a key below the sentinel, non-numeric keys, and missing input", () => {
    expect(decodeCursorForColumn(encodeCursor(-2, "x"), INT8_SORT_KEY_MAX)).toBeNull();
    expect(decodeCursorForColumn(encodeCursor("NaN", "x"), INT8_SORT_KEY_MAX)).toBeNull();
    expect(decodeCursorForColumn(encodeCursor("Infinity", "x"), INT8_SORT_KEY_MAX)).toBeNull();
    expect(decodeCursorForColumn(undefined, INT8_SORT_KEY_MAX)).toBeNull();
    expect(decodeCursorForColumn("not-a-real-cursor", INT8_SORT_KEY_MAX)).toBeNull();
  });
});

/**
 * Equal timestamps are the case a bare-id cursor cannot express: two transactions in
 * the fixture share `ts(TIP_HEIGHT)` (the coinbase and two "interesting" txs), and two
 * more pairs share `ts(TIP_HEIGHT - 1)` / `ts(TIP_HEIGHT - 5)`. A single-column cursor
 * on `txid` alone would have no way to place these relative to their shared timestamp;
 * this proves the tuple cursor gets every tie right with no repeats and no gaps.
 */
describe("listTransactions cursor pagination with equal timestamps", () => {
  it("paging one-by-one (limit: 1) visits every transaction exactly once, matching the full sort", async () => {
    const full = await fixtureDataSource.listTransactions({ limit: 100 }, "all");
    expect(full.nextCursor).toBeNull();

    // Sanity: the fixture actually exercises the tie case this test is for.
    const timestamps = full.items.map((t) => t.timestamp);
    expect(new Set(timestamps).size).toBeLessThan(timestamps.length);

    const visited: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await fixtureDataSource.listTransactions({ before: cursor, limit: 1 }, "all");
      expect(page.items.length).toBe(1);
      visited.push(...page.items.map((t) => t.txid));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    expect(new Set(visited).size).toBe(visited.length);
    expect(visited).toEqual(full.items.map((t) => t.txid));
  });
});

describe("listBlocks after cursor near the head", () => {
  it("a cursor at the 5th-newest item returns exactly the 4 strictly-newer items, not `limit`", async () => {
    const full = await fixtureDataSource.listBlocks({ limit: 100 });
    const fifthNewest = full.items[4];
    expect(fifthNewest).toBeDefined();

    const cursor = encodeCursor(fifthNewest!.height, fifthNewest!.hash);
    const page = await fixtureDataSource.listBlocks({ after: cursor, limit: 25 });

    expect(page.items.length).toBe(4);
    expect(page.items.map((b) => b.height)).toEqual(full.items.slice(0, 4).map((b) => b.height));
  });
});

describe("ORIGIN_CURSOR — the oldest page in one hop", () => {
  it("lands on the final page of blocks, with no older page beyond it", async () => {
    const all = await fixtureDataSource.listBlocks({ limit: 100 });
    const oldest = await fixtureDataSource.listBlocks({ after: ORIGIN_CURSOR, limit: 25 });

    // The last 25 of the full list, still newest-first within the page.
    expect(oldest.items.map((b) => b.height)).toEqual(all.items.slice(-25).map((b) => b.height));
    expect(oldest.nextCursor).toBeNull();
    expect(oldest.prevCursor).not.toBeNull();
  });

  it("lands on the final page of transactions, where the sort key is not unique", async () => {
    const all = await fixtureDataSource.listTransactions({ limit: 100 }, "all");
    const oldest = await fixtureDataSource.listTransactions(
      { after: ORIGIN_CURSOR, limit: 25 },
      "all",
    );

    expect(oldest.items.map((t) => t.txid)).toEqual(all.items.slice(-25).map((t) => t.txid));
    expect(oldest.nextCursor).toBeNull();
  });

  it("is a key no real row can hold, so it never collides with one", () => {
    const decoded = decodeCursor(ORIGIN_CURSOR);
    expect(decoded).not.toBeNull();
    expect(Number(decoded!.sortKey)).toBeLessThan(0);
  });
});

describe("seekFromCursors", () => {
  it("returns null with no cursor at all", () => {
    expect(seekFromCursors({}, INT8_SORT_KEY_MAX)).toBeNull();
  });
  it("prefers before over after when both are given", () => {
    const r = seekFromCursors(
      { before: encodeCursor(10, "a"), after: encodeCursor(20, "b") },
      INT8_SORT_KEY_MAX,
    );
    expect(r).toEqual({ seek: { sortKey: 10, id: "a" }, direction: "before" });
  });
  it("falls through to after when before is malformed or out of range", () => {
    expect(
      seekFromCursors({ before: "garbage", after: encodeCursor(20, "b") }, INT8_SORT_KEY_MAX),
    ).toEqual({ seek: { sortKey: 20, id: "b" }, direction: "after" });
    expect(
      seekFromCursors(
        { before: encodeCursor(9_999_999_999, "x"), after: encodeCursor(20, "b") },
        INT4_SORT_KEY_MAX,
      ),
    ).toEqual({ seek: { sortKey: 20, id: "b" }, direction: "after" });
  });
  it("accepts the origin sentinel as an after cursor", () => {
    expect(seekFromCursors({ after: ORIGIN_CURSOR }, INT4_SORT_KEY_MAX)).toEqual({
      seek: { sortKey: -1, id: "0" },
      direction: "after",
    });
  });
});

describe("cursorSearchParams", () => {
  it("always sends the limit and only the cursors that are set", () => {
    expect(cursorSearchParams({ limit: 25 }).toString()).toBe("limit=25");
    expect(cursorSearchParams({ limit: 25, before: "abc" }).toString()).toBe("limit=25&before=abc");
    expect(cursorSearchParams({ limit: 10, after: "x y" }).toString()).toBe("limit=10&after=x+y");
  });
});

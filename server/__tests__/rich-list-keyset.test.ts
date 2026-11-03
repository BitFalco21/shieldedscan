import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Hono } from "hono";
import { networkRoutes } from "../network-routes";
import { v1Routes } from "../v1/routes";
import { MemoryStorePort } from "../crosschain-store";
import type { CursorPage } from "@/data/source";

/**
 * The rich list's keyset, at the HTTP boundary, against a real database.
 *
 * The list descends the balance and ascends the address (the tiebreak the keyset index stores
 * and `rank` is numbered by). A row-value predicate `(balance_zat, address) < ($2, $3)` descends
 * both columns, which agrees everywhere except on a tie, where it re-serves the addresses above
 * the boundary and skips the ones below it. A skipped holder appears on no page at all.
 *
 * A tie at a page boundary is the whole test: with distinct balances the broken predicate passes
 * every assertion, so the fixture carries a deliberate tie and pages are sized to land inside it.
 *
 * Needs a real database (the property is SQL semantics). Skips without TEST_DATABASE_URL:
 *
 *   docker run -d --name rl-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_USER=explorer \
 *     -e POSTGRES_DB=explorer -p 15433:5432 postgres:17
 *   TEST_DATABASE_URL=postgres://explorer:test@localhost:15433/explorer \
 *     npx vitest run server/__tests__/rich-list-keyset.test.ts
 *
 * Every address here is lowercase so the ordering of a tie group does not depend on the
 * database's collation.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createTestDatabase(url: string): Promise<string> {
  const name = "explorer_rich_keyset_test";
  const admin = new Pool({ connectionString: withDatabase(url, "postgres"), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return withDatabase(url, name);
}

interface Entry {
  address: string;
  balanceZat: number;
  rank: number;
}

describeDb("rich list keyset, over a tie at the page boundary", () => {
  let app: Hono;
  let pool: Pool;

  /**
   * Five addresses, three of them tied. At `limit = 3` the first page ends INSIDE the tie
   * group, on `t1ccc` — so `t1bbb` sits above the boundary and `t1ddd` below it, and the
   * broken predicate reaches for the wrong one of the two.
   */
  const ROWS: Array<[string, number]> = [
    ["t1aaa", 300],
    ["t1bbb", 200],
    ["t1ccc", 200],
    ["t1ddd", 200],
    ["t1eee", 100],
  ];
  const EXPECTED_ORDER = ["t1aaa", "t1bbb", "t1ccc", "t1ddd", "t1eee"];
  /** The height the balances were computed at — never the tip. See the test that pins it. */
  const RICH_LIST_HEIGHT = 3_400_001;

  async function page(query: string): Promise<CursorPage<Entry>> {
    const response = await app.request(`/chain/rich-list${query}`);
    expect(response.status).toBe(200);
    return (await response.json()) as CursorPage<Entry>;
  }

  beforeAll(async () => {
    const url = await createTestDatabase(DATABASE_URL!);
    pool = new Pool({ connectionString: url, max: 2 });
    await pool.query(`CREATE TABLE chain_address_balance (
        address      TEXT PRIMARY KEY,
        balance_zat  BIGINT NOT NULL,
        received_zat BIGINT NOT NULL,
        first_height INTEGER NOT NULL,
        last_height  INTEGER NOT NULL,
        tx_count     BIGINT)`);
    for (const [address, balance] of ROWS) {
      await pool.query(
        `INSERT INTO chain_address_balance
           (address, balance_zat, received_zat, first_height, last_height)
         VALUES ($1, $2, $2, 1, 1)`,
        [address, balance],
      );
    }
    // The refresh's own watermark. Deliberately unlike any plausible tip, so a route that
    // substituted the chain height for it would fail rather than coincide.
    await pool.query(`CREATE TABLE chain_rich_list_meta (
        computed_height  INTEGER NOT NULL,
        unattributed_zat BIGINT NOT NULL)`);
    await pool.query("INSERT INTO chain_rich_list_meta VALUES ($1, 79800000000)", [
      RICH_LIST_HEIGHT,
    ]);
    // The halving source is untouched by these routes; only the rich-list ones are exercised.
    app = networkRoutes({} as never, url);
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Ranks are counted against the balances the same response shows, so a holder that grows is
   * ranked where it now stands. The table has no `rank` column here: nothing may read one.
   */
  describe("counting ranks", () => {
    it("starts a rank seek at the rank asked for", async () => {
      const body = await page("?fromRank=3&limit=3");
      expect(body.items.map((i) => i.rank)).toEqual([3, 4, 5]);
      expect(body.items.map((i) => i.address)).toEqual(["t1ccc", "t1ddd", "t1eee"]);
      expect(body.nextCursor).toBeNull();
    });

    it("answers a rank past the end with an empty page", async () => {
      expect((await page("?fromRank=6&limit=3")).items).toEqual([]);
    });

    it("numbers a page forward and back from where it stands", async () => {
      const first = await page("?limit=2");
      const second = await page(`?limit=2&before=${encodeURIComponent(first.nextCursor!)}`);
      expect(second.items.map((i) => i.rank)).toEqual([3, 4]);
      const third = await page(`?limit=2&before=${encodeURIComponent(second.nextCursor!)}`);
      expect(third.items.map((i) => i.rank)).toEqual([5]);
      // Backward from the last page: a page short of the top, whose head is not the first row
      // counted.
      const back = await page(`?limit=2&after=${encodeURIComponent(third.prevCursor!)}`);
      expect(back.items.map((i) => [i.address, i.rank])).toEqual([
        ["t1ccc", 3],
        ["t1ddd", 4],
      ]);
    });

    it("ranks a holder that grew where it now stands", async () => {
      await pool.query("UPDATE chain_address_balance SET balance_zat = 9999 WHERE address = $1", [
        "t1eee",
      ]);
      try {
        const body = await page("?limit=5");
        expect(body.items.map((i) => i.address)).toEqual([
          "t1eee",
          "t1aaa",
          "t1bbb",
          "t1ccc",
          "t1ddd",
        ]);
        expect(body.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5]);
        expect((await page("?fromRank=1&limit=1")).items[0]!.address).toBe("t1eee");
      } finally {
        await pool.query("UPDATE chain_address_balance SET balance_zat = 100 WHERE address = $1", [
          "t1eee",
        ]);
      }
    });

    it("counts from the cursor's position after the row there has gone", async () => {
      const first = await page("?limit=3");
      // The first page ends on `t1ccc`, which spends out before the reader pages on.
      await pool.query("DELETE FROM chain_address_balance WHERE address = 't1ccc'");
      try {
        const second = await page(`?limit=3&before=${encodeURIComponent(first.nextCursor!)}`);
        expect(second.items.map((i) => [i.address, i.rank])).toEqual([
          ["t1ddd", 3],
          ["t1eee", 4],
        ]);
      } finally {
        await pool.query(
          `INSERT INTO chain_address_balance
             (address, balance_zat, received_zat, first_height, last_height)
           VALUES ('t1ccc', 200, 200, 1, 1)`,
        );
      }
    });
  });

  it("serves every address exactly once when paging forward through a tie", async () => {
    const seen: string[] = [];
    let query = "?limit=3";
    for (let guard = 0; guard < 10; guard += 1) {
      const body = await page(query);
      seen.push(...body.items.map((i) => i.address));
      if (!body.nextCursor) break;
      query = `?limit=3&before=${encodeURIComponent(body.nextCursor)}`;
    }
    // Order and multiplicity together: a duplicate and a skip cancel out in a bare count,
    // and the broken predicate produced exactly one of each.
    expect(seen).toEqual(EXPECTED_ORDER);
  });

  it("skips no address, which is the half a reader cannot see", async () => {
    const first = await page("?limit=3");
    const second = await page(`?limit=3&before=${encodeURIComponent(first.nextCursor!)}`);
    const shown = new Set([...first.items, ...second.items].map((i) => i.address));
    // `t1ddd` is the row the row-value comparison drops: below the boundary in the list's
    // order, above it in a comparison that descends the address too.
    expect(shown.has("t1ddd")).toBe(true);
    expect(second.items.map((i) => i.address)).not.toContain("t1ccc");
  });

  it("pages backwards to exactly the page it came from", async () => {
    const first = await page("?limit=3");
    const second = await page(`?limit=3&before=${encodeURIComponent(first.nextCursor!)}`);
    const back = await page(`?limit=3&after=${encodeURIComponent(second.prevCursor!)}`);
    expect(back.items.map((i) => i.address)).toEqual(first.items.map((i) => i.address));
  });

  it("numbers rank in the order the pages actually serve", async () => {
    const body = await page("?limit=5");
    expect(body.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(body.items.map((i) => i.address)).toEqual(EXPECTED_ORDER);
  });

  /**
   * The same property on the public surface. Both routes call `loadRichListPage`, and this holds
   * `/v1` to it: a page that quietly omits an address is well-formed, so the omission is
   * undetectable from outside.
   */
  it("serves the public list through the same keyset, ties and all", async () => {
    const v1 = v1Routes({ store: new MemoryStorePort(), pool, enabledProtocols: {} });
    const seen: string[] = [];
    let query = "?limit=3";
    for (let guard = 0; guard < 10; guard += 1) {
      const response = await v1.request(`/v1/rich-list${query}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as CursorPage<Entry> & { height: number };
      seen.push(...body.items.map((i) => i.address));
      if (!body.nextCursor) break;
      query = `?limit=3&cursor=${encodeURIComponent(body.nextCursor)}`;
    }
    expect(seen).toEqual(EXPECTED_ORDER);
  });

  it("dates the public page by the height the balances cover, not the tip", async () => {
    const v1 = v1Routes({ store: new MemoryStorePort(), pool, enabledProtocols: {} });
    const body = (await (await v1.request("/v1/rich-list?limit=1")).json()) as { height: number };
    // Seeded as the follower writes it. The tip can be above this whenever ingestion trails, and
    // stamping the tip would date the balances to a height they were never computed at.
    expect(body.height).toBe(RICH_LIST_HEIGHT);
  });
});

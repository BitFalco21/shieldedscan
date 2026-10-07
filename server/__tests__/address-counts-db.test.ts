import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REORG_DEPTH } from "../follow";
import type { Pacer } from "../job-pacer";
import {
  ADDRESS_COUNT_RANGE_SQL,
  AddressCountTracker,
  LIVE_TAIL_MAX_BLOCKS,
  addressRangeEnd,
  appendAddressRange,
  appliedHeight,
  applyAddressRange,
  foldAddressLog,
  logAppliedHeight,
  lifetimeTxCount,
  readAddressTxCount,
} from "../address-counts";

/**
 * `address_tx_count` against a real Postgres: counts over disjoint ranges add up to the count over
 * their union, a range is never applied twice, the blocks above the watermark are counted live,
 * a count is withheld while the table is too far behind to answer cheaply, and the one lifetime
 * reader falls back to the rich list until then.
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/address-counts-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_address_counts_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const pacer = (): Pacer => ({
  preflight: async () => {},
  afterUnit: async () => "continue",
  stats: { sleptMs: 0, stallSamples: 0, maxBlocksBehind: 0 },
});

describeDb("address_tx_count", () => {
  let pool: Pool;

  /** A block at `height` holding one transaction with these io rows. */
  async function block(
    height: number,
    ios: Array<{ io: "in" | "out"; address: string | null }>,
    kind: "transparent" | "mixed" | "coinbase" | "shielded" = "transparent",
  ): Promise<void> {
    await pool.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
       VALUES ($1, $2, $3, $4, 1000, 1)`,
      [
        height,
        `h${height}-`.padEnd(64, "0"),
        `p${height}-`.padEnd(64, "0"),
        1_700_000_000 + height,
      ],
    );
    const txid = `tx${height}-`.padEnd(64, "0");
    await pool.query(
      `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version)
       VALUES ($1, $2, $3, $4, $5, 200, 5)`,
      [txid, height, 1_700_000_000 + height, kind === "coinbase", kind],
    );
    for (const [ordinal, io] of ios.entries()) {
      await pool.query(
        `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
         VALUES ($1, $2, $3, $4, 1000, $5)`,
        [txid, io.io, ordinal, io.address, height],
      );
    }
  }

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));
  });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE address_tx_count, address_tx_count_state, address_tx_count_log, address_tx_count_log_state, chain_address_balance, tx_transparent_io, tx, block CASCADE",
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("adds disjoint ranges to the count over their union, a transaction once per address", async () => {
    // tA spends and receives its own change in block 1: ONE transaction, not two.
    await block(1, [
      { io: "in", address: "tA" },
      { io: "out", address: "tB" },
      { io: "out", address: "tA" },
    ]);
    await block(2, [{ io: "out", address: "tA" }], "coinbase");
    await block(
      3,
      [
        { io: "in", address: "tB" },
        { io: "out", address: null },
      ],
      "mixed",
    );
    await block(4, [], "shielded");

    expect(await applyAddressRange(pool, 0, 2, 1)).toBe(2);
    expect(await applyAddressRange(pool, 3, 4, 2)).toBe(1);
    const { rows } = await pool.query(
      "SELECT address, tx_count FROM address_tx_count ORDER BY address",
    );
    expect(rows).toEqual([
      { address: "tA", tx_count: 2 },
      { address: "tB", tx_count: 2 },
    ]);
    expect(await appliedHeight(pool)).toBe(4);
  });

  it("refuses a range that does not start exactly at the watermark, so nothing counts twice", async () => {
    await block(1, [{ io: "out", address: "tA" }]);
    await block(2, [{ io: "out", address: "tA" }]);
    expect(await applyAddressRange(pool, 0, 1, 1)).toBe(1);
    // The same range again, and one that would skip height 2's predecessor: both refused.
    expect(await applyAddressRange(pool, 0, 1, 2)).toBeNull();
    expect(await applyAddressRange(pool, 3, 3, 2)).toBeNull();
    const { rows } = await pool.query("SELECT tx_count FROM address_tx_count WHERE address = 'tA'");
    expect(rows[0]?.tx_count).toBe(1);
  });

  it("counts the blocks above the watermark live, so a count is exact through the newest block", async () => {
    await block(1, [{ io: "out", address: "tA" }]);
    await applyAddressRange(pool, 0, 1, 1);
    await block(2, [
      { io: "in", address: "tA" },
      { io: "out", address: "tC" },
    ]);
    await block(3, [{ io: "out", address: "tA" }]);

    expect(await readAddressTxCount(pool, "tA")).toBe(3);
    // Seen only above the watermark: the live part alone answers.
    expect(await readAddressTxCount(pool, "tC")).toBe(1);
    // Never seen at all, once the table is caught up: a measured zero.
    expect(await readAddressTxCount(pool, "tNever")).toBe(0);
  });

  it("states no count before the table has started or while it is far behind the tip", async () => {
    await block(1, [{ io: "out", address: "tA" }]);
    expect(await readAddressTxCount(pool, "tA")).toBeNull();
    await applyAddressRange(pool, 0, 1, 1);
    await block(LIVE_TAIL_MAX_BLOCKS + 2, [{ io: "out", address: "tA" }]);
    expect(await readAddressTxCount(pool, "tA")).toBeNull();
  });

  it("waits for another backfill before starting one of its own", async () => {
    for (let h = 1; h <= REORG_DEPTH + 1_200; h += 600) {
      await block(h, [{ io: "out", address: "tA" }]);
    }
    let ready = false;
    const tracker = new AddressCountTracker({
      pool,
      pacer,
      log: () => undefined,
      ready: async () => ready,
    });
    expect(await tracker.refresh()).toEqual({ applied: 0, aborted: false });
    expect(await appliedHeight(pool)).toBeNull();
    ready = true;
    expect((await tracker.refresh()).applied).toBeGreaterThan(1_000);
  });

  it("backfills to the reorg depth below the tip in one pass, and resumes from the watermark", async () => {
    for (let h = 1; h <= REORG_DEPTH + 30; h += 1) {
      await block(h, [{ io: "out", address: h % 2 === 0 ? "tEven" : "tOdd" }]);
    }
    const tracker = new AddressCountTracker({ pool, pacer, log: () => undefined });
    const first = await tracker.refresh();
    expect(first.aborted).toBe(false);
    // Genesis (no block) through tip - depth.
    expect(await appliedHeight(pool)).toBe(30);
    expect(await tracker.refresh()).toEqual({ applied: 0, aborted: false });
    // Exact through the tip regardless: the stored 30 blocks plus the live hundred.
    expect(await readAddressTxCount(pool, "tEven")).toBe(Math.floor((REORG_DEPTH + 30) / 2));
  });
  it("answers every route's lifetime count from the table, and from the rich list until it can", async () => {
    // tFunded still holds a balance; tEmptied spent everything, so the rich list dropped it.
    await block(1, [{ io: "out", address: "tFunded" }]);
    await block(2, [
      { io: "out", address: "tEmptied" },
      { io: "out", address: "tFunded" },
    ]);
    await block(3, [{ io: "in", address: "tEmptied" }]);
    await pool.query(
      `INSERT INTO chain_address_balance (address, balance_zat, received_zat, first_height, last_height, tx_count)
       VALUES ('tFunded', 2000, 2000, 1, 2, 2)`,
    );

    // Not started: the rich list answers for the funded address, and nothing for the emptied one —
    // a null, our gap, never a zero.
    expect(await lifetimeTxCount(pool, "tFunded")).toBe(2);
    expect(await lifetimeTxCount(pool, "tEmptied")).toBeNull();

    // Caught up: the table answers both, the emptied address included, and agrees with the list.
    await applyAddressRange(pool, 0, 3, 1);
    expect(await lifetimeTxCount(pool, "tFunded")).toBe(2);
    expect(await lifetimeTxCount(pool, "tEmptied")).toBe(2);
  });
  it("sizes a range by the transactions it holds, and lets one dense block be a range", async () => {
    // (tx_count, shielded): the work is the transactions with a transparent side, at least one a
    // block (the coinbase).
    const shape: Array<[number, number]> = [
      [10, 0],
      [10, 4],
      [3, 3],
      [50, 0],
      [5, 0],
    ];
    for (const [i, [n, shielded]] of shape.entries()) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count, shielded_tx_count)
         VALUES ($1, $2, $3, $4, 1000, $5, $6)`,
        [
          i + 1,
          `h${i + 1}-`.padEnd(64, "0"),
          `p${i + 1}-`.padEnd(64, "0"),
          1_700_000_000 + i,
          n,
          shielded,
        ],
      );
    }
    // Non-shielded per block: 10, 6, 1, 50, 5 — cumulative 10, 16, 17, 67, 72.
    expect(await addressRangeEnd(pool, 1, 5, 17)).toEqual({ to: 3, txs: 17 });
    // The first block alone is over budget: it is still a range, of one block.
    expect(await addressRangeEnd(pool, 1, 5, 5)).toEqual({ to: 1, txs: 10 });
    // The block cap bounds a range the budget would let run further.
    expect(await addressRangeEnd(pool, 2, 4, 1_000)).toEqual({ to: 4, txs: 57 });
  });

  it("shrinks a range that failed, so a pass never retries the same range forever", async () => {
    for (let h = 1; h <= REORG_DEPTH + 300; h += 1) {
      await block(h, [{ io: "out", address: h % 2 === 0 ? "tEven" : "tOdd" }]);
    }
    const ranges: Array<[number, number]> = [];
    let failNext = true;
    // The real pool, but the first range statement fails as a statement timeout would.
    const faulty = new Proxy(pool, {
      get(target, prop) {
        if (prop === "connect") {
          return async () => {
            const client = (await target.connect()) as PoolClient & Record<string, unknown>;
            const query = client.query.bind(client);
            const release = client.release.bind(client);
            client.query = (async (sql: unknown, params?: unknown[]) => {
              if (sql === ADDRESS_COUNT_RANGE_SQL) {
                ranges.push([params![0] as number, params![1] as number]);
                if (failNext) {
                  failNext = false;
                  throw new Error("canceling statement due to statement timeout");
                }
              }
              return query(sql as string, params);
            }) as never;
            client.release = ((err?: Error | boolean) => {
              client.query = query as never;
              client.release = release as never;
              return release(err);
            }) as never;
            return client;
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Pool;
    const tracker = new AddressCountTracker({
      pool: faulty,
      pacer,
      log: () => undefined,
      rangeTxs: 1_000,
    });

    await expect(tracker.refresh()).rejects.toThrow(/statement timeout/);
    // Rolled back whole, the watermark's first row with it: nothing counted, nothing started.
    expect(await appliedHeight(pool)).toBeNull();
    expect(ranges[0]).toEqual([0, 300]);

    // The retry starts a quarter the size, and the pass still reaches the reorg depth.
    await tracker.refresh();
    expect(ranges[1]).toEqual([0, 250]);
    expect(await appliedHeight(pool)).toBe(300);
    expect(await readAddressTxCount(pool, "tEven")).toBe(Math.floor((REORG_DEPTH + 300) / 2));
  });
  /** The count a direct walk of the io table gives, through `h`: the oracle every path must equal. */
  async function direct(address: string, h: number): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(DISTINCT txid)::int AS n FROM tx_transparent_io WHERE address = $1 AND block_height <= $2",
      [address, h],
    );
    return rows[0]!.n;
  }
  /**
   * Blocks `from`..`to`, one transparent transaction each, built set-wise (a statement per table,
   * not per row). `tEvery` is in every block, `tSeventh` in every seventh, `tOnce<h>` in one; with
   * `everyOnly`, each block pays `tEvery` alone.
   */
  async function chain(to: number, from = 1, everyOnly = false): Promise<void> {
    await pool.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
       SELECT h, rpad('h' || h || '-', 64, '0'), rpad('p' || h || '-', 64, '0'), 1700000000 + h, 1000, 1
         FROM generate_series($1::int, $2::int) h`,
      [from, to],
    );
    await pool.query(
      `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version)
       SELECT rpad('tx' || h || '-', 64, '0'), h, 1700000000 + h, false, 'transparent', 200, 5
         FROM generate_series($1::int, $2::int) h`,
      [from, to],
    );
    await pool.query(
      `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
       SELECT rpad('tx' || h || '-', 64, '0'), 'out', 0, 'tEvery', 1000, h
         FROM generate_series($1::int, $2::int) h
       UNION ALL
       SELECT rpad('tx' || h || '-', 64, '0'), 'out', 1,
              CASE WHEN h % 7 = 0 THEN 'tSeventh' ELSE 'tOnce' || h END, 1000, h
         FROM generate_series($1::int, $2::int) h WHERE NOT $3
       UNION ALL
       SELECT rpad('tx' || h || '-', 64, '0'), 'in', 2, 'tEvery', 1000, h
         FROM generate_series($1::int, $2::int) h WHERE h % 2 = 0 AND NOT $3`,
      [from, to, everyOnly],
    );
  }

  it("backfills through the log and folds it once, every count exact", async () => {
    await chain(REORG_DEPTH + 1_500);
    const tracker = new AddressCountTracker({ pool, pacer, log: () => undefined, rangeTxs: 300 });
    await tracker.refresh();
    expect(await appliedHeight(pool)).toBe(1_500);
    // Folded: no log, no log watermark, and one row per address.
    expect(await logAppliedHeight(pool)).toBeNull();
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM address_tx_count_log")).rows[0].n,
    ).toBe(0);
    const dupes = await pool.query(
      "SELECT count(*)::int AS n FROM (SELECT address FROM address_tx_count GROUP BY address HAVING count(*) > 1) d",
    );
    expect(dupes.rows[0].n).toBe(0);
    for (const a of ["tEvery", "tSeventh", "tOnce1", "tOnce1500"]) {
      const { rows } = await pool.query(
        "SELECT tx_count FROM address_tx_count WHERE address = $1",
        [a],
      );
      expect(rows[0]?.tx_count, a).toBe(await direct(a, 1_500));
    }
    // And the primary key survived the swap under its own name.
    const pk = await pool.query(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'address_tx_count'::regclass AND contype = 'p'",
    );
    expect(pk.rows[0]?.conname).toBe("address_tx_count_pkey");
  });

  it("resumes from the table's watermark when a crash empties the log", async () => {
    await chain(REORG_DEPTH + 1_500);
    // A pass the pacer stops after two ranges: the log holds them, the table nothing.
    let units = 0;
    const stopping = (): Pacer => ({
      preflight: async () => {},
      afterUnit: async () => (++units >= 2 ? "abort" : "continue"),
      stats: { sleptMs: 0, stallSamples: 0, maxBlocksBehind: 0 },
    });
    const tracker = new AddressCountTracker({
      pool,
      pacer: stopping,
      log: () => undefined,
      rangeTxs: 300,
    });
    expect((await tracker.refresh()).aborted).toBe(true);
    expect(await logAppliedHeight(pool)).toBeGreaterThan(0);
    expect(await appliedHeight(pool)).toBeNull();

    // A crash truncates both unlogged tables together.
    await pool.query("TRUNCATE address_tx_count_log, address_tx_count_log_state");

    const fresh = new AddressCountTracker({ pool, pacer, log: () => undefined, rangeTxs: 300 });
    await fresh.refresh();
    expect(await appliedHeight(pool)).toBe(1_500);
    // Nothing doubled and nothing lost.
    for (const a of ["tEvery", "tSeventh", "tOnce2", "tOnce1499"]) {
      const { rows } = await pool.query(
        "SELECT tx_count FROM address_tx_count WHERE address = $1",
        [a],
      );
      expect(rows[0]?.tx_count, a).toBe(await direct(a, 1_500));
    }
  });

  it("folds the log on top of the counts the table already holds", async () => {
    await chain(200);
    // The table counted heights 0..200 by upsert, as a caught-up tracker does.
    expect(await applyAddressRange(pool, 0, 200, 1)).toBeGreaterThan(0);
    await chain(REORG_DEPTH + 1_500, 201, true);
    const tracker = new AddressCountTracker({ pool, pacer, log: () => undefined, rangeTxs: 300 });
    await tracker.refresh();
    expect(await appliedHeight(pool)).toBe(1_500);
    expect(await readAddressTxCount(pool, "tEvery")).toBe(
      await direct("tEvery", REORG_DEPTH + 1_500),
    );
    expect(await readAddressTxCount(pool, "tSeventh")).toBe(await direct("tSeventh", 200));
  });

  it("refuses a log range that would overlap or skip the table or the log", async () => {
    await chain(50);
    expect(await applyAddressRange(pool, 0, 10, 1)).toBeGreaterThan(0);
    // A log must begin right after the table.
    expect(await appendAddressRange(pool, 5, 20)).toBe(false);
    expect(await appendAddressRange(pool, 12, 20)).toBe(false);
    expect(await appendAddressRange(pool, 11, 20)).toBe(true);
    // And then continue exactly where it stands.
    expect(await appendAddressRange(pool, 11, 30)).toBe(false);
    expect(await appendAddressRange(pool, 21, 30)).toBe(true);
    expect(await foldAddressLog(pool, 2)).toBe(30);
    expect(await appliedHeight(pool)).toBe(30);
    expect(await foldAddressLog(pool, 3)).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExchangeMember } from "@/domain";
import { REORG_DEPTH } from "../follow";
import type { Pacer } from "../job-pacer";
import {
  RESERVE_LIVE_TAIL_MAX_DAYS,
  ReserveTracker,
  applyReserveChunk,
  loadReserveRows,
  pruneReserveAddresses,
  readReserveStates,
  reconcileReserves,
} from "../exchange-reserves";

/**
 * `address_balance_daily` against a real Postgres: each day is read at its highest block, only
 * days past the reorg depth are stored, the days above are computed live, a stored balance carried
 * to the rich list's height equals the rich list's, and an address added later catches up alone.
 *
 *   TEST_DATABASE_URL=postgres://explorer:test@127.0.0.1:55432/explorer \
 *     npx vitest run server/__tests__/exchange-reserves-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_exchange_reserves_test";

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

/** 2020-01-01T00:00:00Z. Blocks are an hour apart: 24 to a day, day `n` holding 24n..24n+23. */
const BASE = 1_577_836_800;
const DAY = 86_400;
const dayOf = (n: number) => BASE + n * DAY;

const MEMBERS: ExchangeMember[] = [
  { address: "tA", exchange: "binance" },
  { address: "tB", exchange: "kraken" },
];

describeDb("address_balance_daily", () => {
  let pool: Pool;

  /** Blocks `0..tip`, an hour apart. */
  async function chain(tip: number): Promise<void> {
    await pool.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
       SELECT h, lpad(h::text, 64, 'a'), lpad(h::text, 64, 'p'), $2::bigint + h * 3600, 1000, 1
         FROM generate_series(0, $1::int) h`,
      [tip, BASE],
    );
  }

  let n = 0;
  /** One transaction at `height` paying `out` to addresses and spending `in` from them. */
  async function tx(
    height: number,
    ios: Array<{ io: "in" | "out"; address: string | null; value: number | null }>,
  ): Promise<void> {
    const txid = `t${(n += 1)}-${height}`.padEnd(64, "0");
    await pool.query(
      `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version)
       VALUES ($1, $2, $3, false, 'transparent', 200, 5)`,
      [txid, height, BASE + height * 3600],
    );
    for (const [ordinal, io] of ios.entries()) {
      await pool.query(
        `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [txid, io.io, ordinal, io.address, io.value, height],
      );
    }
  }

  /** The rich list as the follower keeps it: every address's balance, at `height`. */
  async function richList(height: number): Promise<void> {
    await pool.query("DELETE FROM chain_address_balance");
    await pool.query(
      `INSERT INTO chain_address_balance (address, balance_zat, received_zat, first_height, last_height)
       SELECT address, sum(CASE io WHEN 'out' THEN coalesce(value_zat, 0) ELSE -coalesce(value_zat, 0) END),
              0, min(block_height), max(block_height)
         FROM tx_transparent_io WHERE address IS NOT NULL AND block_height <= $1
        GROUP BY address
       HAVING sum(CASE io WHEN 'out' THEN coalesce(value_zat, 0) ELSE -coalesce(value_zat, 0) END) > 0`,
      [height],
    );
    await pool.query(
      `INSERT INTO chain_rich_list_meta (id, computed_height) VALUES (TRUE, $1)
       ON CONFLICT (id) DO UPDATE SET computed_height = EXCLUDED.computed_height`,
      [height],
    );
  }

  const tracker = (members = MEMBERS, chunkBlocks = 60) =>
    new ReserveTracker({ pool, network: "mainnet", members, pacer, log: () => {}, chunkBlocks });

  const stored = async (address: string) =>
    (
      await pool.query<{ day: number; balance_zat: number; close_height: number }>(
        `SELECT EXTRACT(EPOCH FROM day)::bigint AS day, balance_zat, close_height
           FROM address_balance_daily WHERE address = $1 ORDER BY day`,
        [address],
      )
    ).rows.map((r) => [(r.day - BASE) / DAY, r.balance_zat, r.close_height]);

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
      `TRUNCATE address_balance_daily, address_balance_daily_state, chain_address_balance,
                chain_rich_list_meta, tx_transparent_io, tx, block CASCADE`,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("stores each final day at its highest block, from first use, and nothing within reorg depth", async () => {
    // 20 days of blocks: day 19 ends at 479. Final heights reach 479 - 100 = 379, inside day 15.
    await chain(479);
    await tx(30, [{ io: "out", address: "tA", value: 1_000 }]); // day 1
    await tx(31, [
      { io: "in", address: "tA", value: 400 },
      { io: "out", address: "tB", value: 400 },
    ]);
    await tx(75, [{ io: "out", address: "tA", value: null }]); // a NULL counts nothing
    await tx(100, [{ io: "in", address: "tB", value: 400 }]); // day 4: tB empties

    const result = await tracker().refresh();
    expect(result.aborted).toBe(false);
    // Days 1..14 complete for tA (day 15 continues above the final height), from day 1 on.
    const a = await stored("tA");
    expect(a[0]).toEqual([1, 600, 47]);
    expect(a.at(-1)).toEqual([14, 600, 359]);
    expect(a).toHaveLength(14);
    // tB: first used day 1, emptied day 4, rows carry on at 0.
    const b = await stored("tB");
    expect(b.slice(0, 4).map(([d, bal]) => [d, bal])).toEqual([
      [1, 400],
      [2, 400],
      [3, 400],
      [4, 0],
    ]);
    expect(b).toHaveLength(14);
    const states = await readReserveStates(pool, ["tA", "tB"]);
    expect(states.map((s) => s.throughHeight)).toEqual([359, 359]);
    expect(359).toBeLessThanOrEqual(479 - REORG_DEPTH);

    // A second pass with nothing new writes nothing.
    expect((await tracker().refresh()).days).toBe(0);
  });

  it("waits for a day's close to settle, so a block stamped back across midnight is not lost", async () => {
    await chain(479);
    // Block 50 is mined after day 2 began (48) but stamped 23:30 on day 1: day 1's close is 50.
    await pool.query("UPDATE block SET timestamp = $1 WHERE height = 50", [dayOf(1) + 84_600]);
    await tx(30, [{ io: "out", address: "tA", value: 1_000 }]);
    await tx(50, [{ io: "out", address: "tA", value: 5 }]);
    // A chunk ending at 49 has seen day 2 begin, but not the block that reopens day 1.
    await tracker(MEMBERS, 50).refresh();
    const a = await stored("tA");
    expect(a[0]).toEqual([1, 1_005, 50]);
  });

  it("computes the days above the watermark live, today's through the newest block", async () => {
    await chain(479);
    await tx(30, [{ io: "out", address: "tA", value: 1_000 }]);
    await tx(470, [{ io: "in", address: "tA", value: 250 }]); // day 19, above the final height
    await tracker().refresh();

    const read = await loadReserveRows(pool, ["tA", "tB"]);
    const a = read.rows.filter((r) => r.address === "tA");
    expect(a.at(-1)).toEqual({
      address: "tA",
      day: dayOf(19),
      balanceZat: 750,
      closeHeight: 479,
    });
    expect(a.map((r) => (r.day - BASE) / DAY)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(read.computedThrough.get("tA")).toBe(dayOf(19));
    expect(read.tipHeight).toBe(479);
    // tB never used: no rows, and known through the same day.
    expect(read.rows.some((r) => r.address === "tB")).toBe(false);
    expect(read.computedThrough.get("tB")).toBe(dayOf(19));
  });

  it("holds every stored balance, carried to the rich list's height, equal to the rich list's", async () => {
    await chain(479);
    await tx(30, [{ io: "out", address: "tA", value: 1_000 }]);
    await tx(31, [
      { io: "in", address: "tA", value: 400 },
      { io: "out", address: "tB", value: 400 },
    ]);
    await tx(420, [{ io: "out", address: "tB", value: 77 }]); // above the watermark
    await tracker().refresh();
    await richList(479);

    const rows = await reconcileReserves(pool, ["tA", "tB"]);
    expect(rows).toEqual([
      { address: "tA", height: 479, stored: 600, expected: 600, lastRow: 600, stateBalance: 600 },
      { address: "tB", height: 479, stored: 477, expected: 477, lastRow: 400, stateBalance: 400 },
    ]);

    // A balance the tracker got wrong is a mismatch the check reports.
    await pool.query(
      "UPDATE address_balance_daily_state SET balance_zat = 601 WHERE address = 'tA'",
    );
    const broken = await reconcileReserves(pool, ["tA"]);
    expect(broken[0]!.stored).not.toBe(broken[0]!.expected);
  });

  it("catches an address added later up from genesis while the others wait", async () => {
    await chain(479);
    await tx(30, [{ io: "out", address: "tA", value: 1_000 }]);
    await tx(50, [{ io: "out", address: "tC", value: 5 }]);
    await tracker().refresh();
    const before = await stored("tA");

    await tracker([...MEMBERS, { address: "tC", exchange: "gemini" }]).refresh();
    expect(await stored("tA")).toEqual(before);
    const c = await stored("tC");
    expect(c[0]).toEqual([2, 5, 71]);
    expect(c.at(-1)).toEqual([14, 5, 359]);
    const states = await readReserveStates(pool, ["tA", "tB", "tC"]);
    expect(new Set(states.map((s) => s.throughHeight))).toEqual(new Set([359]));
  });

  it("refuses a chunk whose watermark moved, writing nothing", async () => {
    await chain(479);
    await tracker().refresh();
    const states = await readReserveStates(pool, ["tA", "tB"]);
    const stale = states.map((s) => ({ ...s, throughHeight: s.throughHeight - 24 }));
    const ok = await applyReserveChunk(
      pool,
      stale,
      [{ address: "tA", day: dayOf(14), balanceZat: 9, closeHeight: 359 }],
      { height: 383, day: dayOf(15) },
      1,
    );
    expect(ok).toBe(false);
    expect(await stored("tA")).toEqual([]);
  });

  it("gives an address stored more than the live tail's days behind no live days, and says so", async () => {
    // Stored through day 0; the final height (tip - 100) is the first block of day 4.
    await chain(4 * 24 + REORG_DEPTH);
    await pool.query(
      `INSERT INTO address_balance_daily_state (address, through_height, through_day, balance_zat, updated_at)
       VALUES ('tA', 23, '2020-01-01', 0, 1)`,
    );
    expect(RESERVE_LIVE_TAIL_MAX_DAYS).toBe(3);
    const read = await loadReserveRows(pool, ["tA"]);
    expect(read.rows).toEqual([]);
    expect(read.computedThrough.get("tA")).toBe(dayOf(0));
    expect(read.beyondLiveTail).toEqual(["tA"]);

    // With the final height on day 3, it is read live.
    await pool.query("DELETE FROM block WHERE height > $1", [3 * 24 + 23 + REORG_DEPTH]);
    const near = await loadReserveRows(pool, ["tA"]);
    expect(near.beyondLiveTail).toEqual([]);
    expect(near.computedThrough.get("tA")).toBe(dayOf(8));
  });

  it("reads today live at mainnet's 25-second pace, well past 2,000 blocks into the day", async () => {
    // Two days of 25-second blocks: 3,456 a day. Stored through day 0 (its close is 3,455); the
    // newest block is 14:00 on day 1, 2,017 blocks above the watermark.
    const tip = 3_456 + 14 * 144;
    await pool.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
       SELECT h, lpad(h::text, 64, 'a'), lpad(h::text, 64, 'p'), $2::bigint + h * 25, 1000, 1
         FROM generate_series(0, $1::int) h`,
      [tip, BASE],
    );
    await pool.query(
      `INSERT INTO address_balance_daily_state
         (address, through_height, through_day, balance_zat, first_day, updated_at)
       VALUES ('tA', 3455, '2020-01-01', 1000, '2020-01-01', 1)`,
    );
    const txid = "t25s".padEnd(64, "0");
    await pool.query(
      `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version)
       VALUES ($1, 5000, $2, false, 'transparent', 200, 5)`,
      [txid, BASE + 5000 * 25],
    );
    await pool.query(
      `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
       VALUES ($1, 'out', 0, 'tA', 7, 5000)`,
      [txid],
    );
    const read = await loadReserveRows(pool, ["tA"]);
    expect(read.beyondLiveTail).toEqual([]);
    expect(read.rows).toEqual([
      { address: "tA", day: dayOf(1), balanceZat: 1_007, closeHeight: tip },
    ]);
    expect(read.computedThrough.get("tA")).toBe(dayOf(1));
  });

  it("drops the state and rows of an address taken off the list, in one pass", async () => {
    await chain(479);
    await tx(30, [{ io: "out", address: "tA", value: 1_000 }]);
    await tx(50, [{ io: "out", address: "tC", value: 5 }]);
    await tracker([...MEMBERS, { address: "tC", exchange: "gemini" }]).refresh();
    expect((await stored("tC")).length).toBeGreaterThan(0);
    const before = await stored("tA");

    await tracker().refresh();
    expect(await stored("tC")).toEqual([]);
    expect((await readReserveStates(pool, ["tC"])).length).toBe(0);
    expect(await stored("tA")).toEqual(before);

    // An empty list prunes nothing: a misconfigured list must not empty the table.
    await tracker([]).refresh();
    expect(await stored("tA")).toEqual(before);
    expect(await pruneReserveAddresses(pool, [])).toBe(0);
    expect(await stored("tA")).toEqual(before);
    expect((await readReserveStates(pool, ["tA", "tB"])).length).toBe(2);
  });

  it("does nothing off mainnet: the labels are mainnet addresses", async () => {
    await chain(479);
    await tx(30, [{ io: "out", address: "tA", value: 1_000 }]);
    const t = new ReserveTracker({
      pool,
      network: "testnet",
      members: MEMBERS,
      pacer,
      log: () => {},
      chunkBlocks: 60,
    });
    expect(await t.refresh()).toEqual({ days: 0, aborted: false });
    expect(await readReserveStates(pool, ["tA", "tB"])).toEqual([]);
  });

  it("retries a failed chunk smaller, then grows back after a success", async () => {
    await chain(479);
    await tx(30, [{ io: "out", address: "tA", value: 1_000 }]);
    let failNext = true;
    const flaky = {
      query: (text: string, values?: unknown[]) => {
        if (failNext && text.includes("tx_transparent_io")) {
          failNext = false;
          return Promise.reject(new Error("canceling statement due to statement timeout"));
        }
        return pool.query(text, values);
      },
      connect: () => pool.connect(),
    } as unknown as Pool;
    const t = new ReserveTracker({
      pool: flaky,
      network: "mainnet",
      members: MEMBERS,
      pacer,
      log: () => {},
      chunkBlocks: 60,
      minChunkBlocks: 1,
    });
    await expect(t.refresh()).rejects.toThrow(/statement timeout/);
    expect(t.chunkBlocks).toBe(15);
    const result = await t.refresh();
    expect(result.aborted).toBe(false);
    expect(t.chunkBlocks).toBe(60);
    expect((await stored("tA")).at(-1)).toEqual([14, 1_000, 359]);
  });
});

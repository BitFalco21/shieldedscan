import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addressActivityWindow } from "../address-activity";

/**
 * One address over a period: the windowed totals, against a real database. Two properties are
 * invisible to a fake: a day window resolves to the right height range through `block`'s
 * timestamps, and the row cap cuts on a height boundary so a transaction is never counted with
 * half its value.
 *
 * The fixture puts a transaction outside each edge of the tested window, so an off-by-one at
 * either boundary changes a figure rather than merely a count.
 *
 * Skips without TEST_DATABASE_URL and creates its own database.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_address_activity_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const ADDR = "t1AddrUnderTest0000000000000000000";
const OTHER = "t1SomebodyElse00000000000000000000";
const T = (c: string) => c.repeat(64);

const DAY = 86_400;
/** 2026-07-01T00:00:00Z. Every height below is stamped relative to this. */
const JUL_1 = Date.parse("2026-07-01T00:00:00Z") / 1000;
const AUG_1 = Date.parse("2026-08-01T00:00:00Z") / 1000;

interface Row {
  txid: string;
  io: "in" | "out";
  address: string;
  value: number | null;
  height: number;
}

/**
 * Blocks, and the day each one falls on. The two edge blocks are the point:
 *
 *   h 90  — 30 June, the day BEFORE the window. Its transaction must not be counted.
 *   h 100 — 1 July, the window's first day.
 *   h 150 — 10 July.
 *   h 200 — 20 July.
 *   h 300 — 31 July, the window's LAST day (the window is half-open at 1 August).
 *   h 400 — 1 August, the first day OUTSIDE. Must not be counted.
 */
const BLOCKS: { height: number; timestamp: number }[] = [
  { height: 90, timestamp: JUL_1 - DAY },
  { height: 100, timestamp: JUL_1 },
  { height: 150, timestamp: JUL_1 + 9 * DAY },
  { height: 200, timestamp: JUL_1 + 19 * DAY },
  { height: 300, timestamp: JUL_1 + 30 * DAY },
  { height: 400, timestamp: AUG_1 },
];

/**
 * What each transaction contributes to a July window for ADDR:
 *
 *  - `a` (h 90)  — 9,000 received, OUTSIDE (June). Counting it is the low-edge failure.
 *  - `b` (h 100) — 5,000 received. Also pays OTHER, whose row must be ignored entirely.
 *  - `c` (h 150) — spends 30,000, takes 10,000 change → contributes 10,000 received and
 *                  30,000 sent, and ONE transaction rather than two rows.
 *  - `d` (h 200) — an unresolved input (NULL value) beside a 1,000 receipt: the NULL adds
 *                  nothing, the same rule the balance SQL follows.
 *  - `e` (h 300) — 50,000 received, on the window's last day.
 *  - `f` (h 400) — 7,000 received, OUTSIDE (August). Counting it is the high-edge failure.
 *
 * July totals: 4 transactions, received 66,000, sent 30,000, net 36,000.
 */
const ROWS: Row[] = [
  { txid: T("a"), io: "out", address: ADDR, value: 9_000, height: 90 },
  { txid: T("b"), io: "out", address: ADDR, value: 5_000, height: 100 },
  { txid: T("b"), io: "out", address: OTHER, value: 95_000, height: 100 },
  { txid: T("c"), io: "in", address: ADDR, value: 30_000, height: 150 },
  { txid: T("c"), io: "out", address: ADDR, value: 10_000, height: 150 },
  { txid: T("d"), io: "in", address: ADDR, value: null, height: 200 },
  { txid: T("d"), io: "out", address: ADDR, value: 1_000, height: 200 },
  { txid: T("e"), io: "out", address: ADDR, value: 50_000, height: 300 },
  { txid: T("f"), io: "out", address: ADDR, value: 7_000, height: 400 },
];

describeDb("one address over a period", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB), max: 1 });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    // The API's own tables too, as in production: the lifetime count reads `address_tx_count`.
    await pool.query(readFileSync("server/schema.sql", "utf8"));
    for (const b of BLOCKS) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, $4, 1000, 1)`,
        [b.height, `h${b.height}`.padEnd(64, "0"), `p${b.height}`.padEnd(64, "0"), b.timestamp],
      );
    }
    for (const txid of [...new Set(ROWS.map((r) => r.txid))]) {
      const row = ROWS.find((r) => r.txid === txid)!;
      const block = BLOCKS.find((b) => b.height === row.height)!;
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version)
         VALUES ($1, $2, $3, false, 'transparent', 200, 4)`,
        [txid, row.height, block.timestamp],
      );
    }
    const ordinals = new Map<string, number>();
    for (const r of ROWS) {
      const key = `${r.txid}:${r.io}`;
      const ordinal = ordinals.get(key) ?? 0;
      ordinals.set(key, ordinal + 1);
      await pool.query(
        `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [r.txid, r.io, ordinal, r.address, r.value, r.height],
      );
    }
    await pool.query(
      `INSERT INTO chain_address_balance (address, balance_zat, received_zat, first_height, last_height, tx_count)
       VALUES ($1, 43000, 73000, 90, 400, 6)`,
      [ADDR],
    );
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  const july = () => addressActivityWindow(pool, ADDR, JUL_1, AUG_1);

  it("counts one transaction per txid, not one per index row", async () => {
    // `c` contributes two rows — a spend and its change — and is ONE transaction.
    expect((await july()).txCount).toBe(4);
  });

  it("totals received and sent separately, and nets them exactly", async () => {
    const out = await july();
    expect(out.receivedZat).toBe(66_000);
    expect(out.sentZat).toBe(30_000);
    expect(out.netZat).toBe(36_000);
  });

  /*
   * The half-open edges, which are where a window silently answers a different question. June's
   * 9,000 and August's 7,000 are both outside; either one leaking in changes `receivedZat` as
   * well as the count, so this cannot pass on an off-by-one at either end.
   */
  it("excludes the day before and the day after", async () => {
    const out = await july();
    expect(out.fromHeight).toBe(100);
    expect(out.toHeight).toBe(300);
    expect(out.receivedZat).not.toBe(66_000 + 9_000);
    expect(out.receivedZat).not.toBe(66_000 + 7_000);
  });

  it("reports the heights the address actually appears at, inside the window", async () => {
    const out = await july();
    expect(out.firstHeight).toBe(100);
    expect(out.lastHeight).toBe(300);
  });

  it("ignores rows belonging to another address in the same transaction", async () => {
    // OTHER's 95,000 sits in `b`. Including it would be the worst failure here: value that
    // merely passed near the address reported as the address's own receipt.
    expect((await july()).receivedZat).toBe(66_000);
  });

  it("adds nothing for an unresolved input, matching the balance SQL", async () => {
    // `d`'s NULL input must not become a 0-valued spend that inflates `sentZat`'s row count or
    // a NaN that poisons the total.
    const out = await july();
    expect(out.sentZat).toBe(30_000);
    expect(Number.isFinite(out.netZat)).toBe(true);
  });

  it("carries the lifetime count beside the windowed one", async () => {
    // The denominator a reader needs: 4 of this address's 6 transactions were in July.
    expect((await july()).lifetimeTxCount).toBe(6);
  });

  it("answers a window the chain never reached with zeroes, not an error", async () => {
    // A measurement — the chain has no block there — and distinguishable from a failed read by
    // being a well-formed payload with null heights.
    const out = await addressActivityWindow(
      pool,
      ADDR,
      Date.parse("2030-01-01T00:00:00Z") / 1000,
      Date.parse("2030-02-01T00:00:00Z") / 1000,
    );
    expect(out.fromHeight).toBeNull();
    expect(out.txCount).toBe(0);
    expect(out.complete).toBe(true);
  });

  it("answers for an address with no rows in the window", async () => {
    const out = await addressActivityWindow(pool, "t1NeverSeen000000000000000000000", JUL_1, AUG_1);
    expect(out.txCount).toBe(0);
    expect(out.netZat).toBe(0);
    expect(out.lifetimeTxCount).toBeNull();
  });

  /*
   * THE CAP, and why it cuts on a height boundary. With room for 2 rows the walk overflows
   * inside height 150 — `c`'s spend and its change — and a mid-height cut would sum one of them
   * without the other, reporting a net change that never happened. Every row at or below the
   * overflow height goes instead, so the answer is short but every figure in it is whole.
   */
  it("cuts on a height boundary when the cap bites, and says what it covered", async () => {
    // Room for 3 rows fetches h300, h200, h200 and then ONE of h150's pair — so the overflow
    // lands inside `c`, whose spend and change are at the same height. Heights 300 and 200
    // survive; 150 is dropped entirely rather than half-counted.
    const out = await addressActivityWindow(pool, ADDR, JUL_1, AUG_1, 3);
    expect(out.complete).toBe(false);
    expect(out.coversFromHeight).toBe(200);
    expect(out.txCount).toBe(2);
    expect(out.receivedZat).toBe(51_000);
    expect(out.sentZat).toBe(0);
  });

  it("still reports the requested range when capped, so the shortfall is visible", async () => {
    const out = await addressActivityWindow(pool, ADDR, JUL_1, AUG_1, 3);
    // The window asked for is unchanged; `coversFromHeight` is what says the figures are short.
    expect(out.fromHeight).toBe(100);
    expect(out.toHeight).toBe(300);
    expect(out.coversFromHeight).toBeGreaterThan(out.fromHeight!);
  });

  /*
   * The failure the boundary rule exists to prevent, asserted directly. `c` spends 30,000 and
   * takes 10,000 back at one height. A mid-height cut would fetch its spend without its change
   * and report 30,000 sent against 0 received for that transaction — a net movement that never
   * happened, with nothing in the figure to reveal it.
   */
  it("never reports half of a transaction", async () => {
    const out = await addressActivityWindow(pool, ADDR, JUL_1, AUG_1, 3);
    expect(out.sentZat).toBe(0);
    expect(out.receivedZat).toBe(51_000);
  });
});

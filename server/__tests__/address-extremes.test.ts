import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { publicValueZat } from "@/domain";
import type { Transaction } from "@/domain";
import { addressValueExtremes } from "../address-extremes";

/**
 * Per-address value extrema, and the properties they stand on.
 *
 * Two quantities kept apart: the winning transaction's `netChangeZat` and `publicValueZat` differ
 * in the fixture, so an implementation that conflates them fails.
 *
 * SQL/domain parity: `wholeTxPublicValueZat`'s SQL must agree with the domain `publicValueZat`
 * row by row, including the outputs-sum-to-zero fallback.
 *
 * The window cuts on a height boundary: an overflowing fetch must never compute a net change over
 * half a transaction's rows. A two-row transaction sits exactly at the boundary, so a mid-height
 * cut produces a wrong figure rather than a missing one.
 *
 * Needs a real database; skips without TEST_DATABASE_URL and creates its own.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const TEST_DB = "explorer_address_extremes_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const ADDR = "t1AddrUnderTest0000000000000000000";
const OTHER = "t1SomebodyElse00000000000000000000";

/** One io row, in the terms the table stores. */
interface Row {
  txid: string;
  io: "in" | "out";
  address: string;
  value: number | null;
  height: number;
}

const T = (c: string) => c.repeat(64);

/**
 * The history, oldest first. What each transaction is for:
 *
 *  - `a` (h 100): ADDR receives 5,000 — but the tx also pays OTHER 95,000, so the whole
 *    transaction's public value (100,000) differs from ADDR's net change (5,000).
 *  - `b` (h 150): ADDR spends 30,000 and takes 10,000 change → net −20,000, the largest sent.
 *    Its outputs sum to 10,000+20,000=30,000, so publicValue is 30,000 ≠ |−20,000|.
 *  - `c`/`d` (h 200, 210): a TIE — both net +7,000 — so neither may be named.
 *  - `e` (h 300): ADDR receives 50,000, the unique largest received.
 *  - `f` (h 300): an unresolved input (NULL value) beside a real 1,000 receipt — the NULL
 *    contributes nothing, exactly as in the balance SQL.
 *  - `g` (h 310, two rows): sits at the window boundary in the windowed test.
 */
const ROWS: Row[] = [
  { txid: T("a"), io: "out", address: ADDR, value: 5_000, height: 100 },
  { txid: T("a"), io: "out", address: OTHER, value: 95_000, height: 100 },
  { txid: T("b"), io: "in", address: ADDR, value: 30_000, height: 150 },
  { txid: T("b"), io: "out", address: ADDR, value: 10_000, height: 150 },
  { txid: T("b"), io: "out", address: OTHER, value: 20_000, height: 150 },
  { txid: T("c"), io: "out", address: ADDR, value: 7_000, height: 200 },
  { txid: T("d"), io: "out", address: ADDR, value: 7_000, height: 210 },
  { txid: T("e"), io: "out", address: ADDR, value: 50_000, height: 300 },
  { txid: T("f"), io: "in", address: ADDR, value: null, height: 300 },
  { txid: T("f"), io: "out", address: ADDR, value: 1_000, height: 300 },
  { txid: T("9"), io: "out", address: ADDR, value: 2_000, height: 310 },
  { txid: T("9"), io: "in", address: ADDR, value: 1_500, height: 310 },
];

/** `b` as a domain Transaction, for the parity check on the fallback-free branch. */
function txB(): Transaction {
  return {
    txid: T("b"),
    blockHeight: 150,
    timestamp: 1_700_000_000,
    isCoinbase: false,
    transparentInputs: [{ address: ADDR, valueZat: 30_000, prevTxid: null, prevVout: null }],
    transparentOutputs: [
      { address: ADDR, valueZat: 10_000 },
      { address: OTHER, valueZat: 20_000 },
    ],
    sapling: null,
    orchard: null,
    ironwood: null,
    sprout: null,
    feeZat: 10_000,
    sizeBytes: 200,
  } as unknown as Transaction;
}

describeDb("per-address value extrema", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    // max 1, so the BEGIN/ROLLBACK bracketing in tests below stays on one connection.
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB), max: 1 });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    // The API's own tables too, as in production: the lifetime count reads `address_tx_count`.
    await pool.query(readFileSync("server/schema.sql", "utf8"));
    const heights = [...new Set(ROWS.map((r) => r.height))];
    for (const h of heights) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, 1700000000, 1000, 1)`,
        [h, `h${h}`.padEnd(64, "0"), `p${h}`.padEnd(64, "0")],
      );
    }
    const txids = [...new Set(ROWS.map((r) => r.txid))];
    for (const txid of txids) {
      const height = ROWS.find((r) => r.txid === txid)!.height;
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version)
         VALUES ($1, $2, 1700000000, false, 'transparent', 200, 4)`,
        [txid, height],
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
      `INSERT INTO chain_address_balance
              (address, balance_zat, received_zat, first_height, last_height, tx_count)
       VALUES ($1, 1, 1, 100, 310, 7)`,
      [ADDR],
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("finds both extremes exactly, and keeps the two quantities apart", async () => {
    const result = await addressValueExtremes(pool, ADDR);
    expect(result.complete).toBe(true);
    expect(result.txCount).toBe(7);
    expect(result.considered).toBe(7);
    expect(result.fromHeight).toBe(100);

    // Unique largest receipt: named, with the WHOLE transaction's value beside it.
    expect(result.largestReceived).toMatchObject({
      netChangeZat: 50_000,
      count: 1,
      txid: T("e"),
      blockHeight: 300,
      publicValueZat: 50_000,
    });

    // Largest sent: net −20,000, but the transaction MOVED 30,000 — the two quantities differ,
    // which is what makes a conflating implementation fail here.
    expect(result.largestSent).toMatchObject({
      netChangeZat: -20_000,
      count: 1,
      txid: T("b"),
      publicValueZat: 30_000,
    });
    expect(result.largestSent!.publicValueZat).not.toBe(Math.abs(result.largestSent!.netChangeZat));
    // And the SQL twin agrees with the domain function on the same transaction.
    expect(result.largestSent!.publicValueZat).toBe(publicValueZat(txB()));
  });

  it("refuses to name a tie", async () => {
    // Shrink the window so `e` (the unique winner) falls outside it: rows at heights 310 and
    // 300 fill 5 rows; a window of 9 keeps everything except nothing — instead build the tie
    // view by asking over a fresh address-free check: simplest is to delete `e` in a savepoint.
    await pool.query("BEGIN");
    try {
      await pool.query("DELETE FROM tx_transparent_io WHERE txid = $1", [T("e")]);
      const result = await addressValueExtremes(pool, ADDR);
      expect(result.largestReceived).toMatchObject({
        netChangeZat: 7_000,
        count: 2,
        txid: null,
        blockHeight: null,
        publicValueZat: null,
      });
    } finally {
      await pool.query("ROLLBACK");
    }
  });

  it("cuts an overflowing window on a height boundary, never mid-transaction", async () => {
    // 12 rows; a window of 4 fetches 5 rows: heights 310 (2 rows) and 300 (3 rows) — the 5th
    // row is at 300, so the whole of height 300 must be dropped. A mid-height cut would keep
    // part of `f` or `e` and compute a wrong net change; the correct answer covers height 310
    // alone.
    const result = await addressValueExtremes(pool, ADDR, 4);
    expect(result.complete).toBe(false);
    expect(result.txCount).toBe(7); // the true lifetime count still travels with the window
    expect(result.considered).toBe(1);
    expect(result.fromHeight).toBe(310);
    expect(result.largestReceived).toMatchObject({ netChangeZat: 500, txid: T("9") });
    expect(result.largestSent).toBeNull();
  });

  it("answers an unknown address with nulls, never zeros", async () => {
    const result = await addressValueExtremes(pool, "t1NeverSeen");
    expect(result.txCount).toBeNull();
    expect(result.considered).toBe(0);
    expect(result.complete).toBe(true);
    expect(result.fromHeight).toBeNull();
    expect(result.largestReceived).toBeNull();
    expect(result.largestSent).toBeNull();
  });

  it("matches the domain publicValueZat on the outputs-sum-to-zero fallback", async () => {
    // A transaction whose outputs sum to zero: the value is its INPUTS — the branch a naive
    // transcription drops.
    await pool.query("BEGIN");
    try {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES (500, $1, $2, 1700000000, 1000, 1)`,
        ["h500".padEnd(64, "0"), "p500".padEnd(64, "0")],
      );
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version)
         VALUES ($1, 500, 1700000000, false, 'transparent', 200, 4)`,
        [T("0")],
      );
      for (const [i, row] of (
        [
          ["in", ADDR, 80_000],
          ["out", ADDR, 0],
        ] as const
      ).entries()) {
        await pool.query(
          `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
           VALUES ($1, $2, $3, $4, $5, 500)`,
          [T("0"), row[0], i, row[1], row[2]],
        );
      }
      const result = await addressValueExtremes(pool, ADDR);
      // Net −80,000 beats b's −20,000, so it is the new largest sent; its public value falls
      // back to the inputs, because its outputs sum to zero.
      expect(result.largestSent).toMatchObject({
        netChangeZat: -80_000,
        txid: T("0"),
        publicValueZat: 80_000,
      });
    } finally {
      await pool.query("ROLLBACK");
    }
  });
});

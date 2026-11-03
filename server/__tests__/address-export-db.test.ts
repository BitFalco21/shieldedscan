import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readAddressBatch, type AddressTxRow } from "../v1/export/address-walk";

/**
 * The address export's walk against a real database: batches cut on height boundaries, so every
 * transaction arrives once and whole however small the batch, a height denser than a batch read
 * whole, an unresolved input left unknown, and nothing above the tip the export began at.
 *
 * Needs a real database; skips without TEST_DATABASE_URL and creates its own.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_address_export_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const ADDR = "t1ExportUnderTest000000000000000000";
const OTHER = "t1SomebodyElse00000000000000000000";
const T = (c: string) => c.repeat(64);

interface Row {
  txid: string;
  io: "in" | "out";
  address: string;
  value: number | null;
  height: number;
}

/**
 * Heights 100–400. What each transaction tests:
 *  - `a`, `b` share height 100: two transactions in one block, ordered by txid.
 *  - `c` (h 200): a consolidation, four inputs from ADDR and change back, denser than a batch.
 *  - `d` (h 300): an input with no resolved value, so sent and net are unknown.
 *  - `e` (h 300): paid OTHER only — not ADDR's, never exported.
 *  - `f` (h 400): above the tip the export began at.
 */
const ROWS: Row[] = [
  { txid: T("b"), io: "out", address: ADDR, value: 700, height: 100 },
  { txid: T("a"), io: "out", address: ADDR, value: 1_000, height: 100 },
  { txid: T("a"), io: "out", address: OTHER, value: 9_000, height: 100 },
  ...[0, 1, 2, 3].map((): Row => ({
    txid: T("c"),
    io: "in",
    address: ADDR,
    value: 500,
    height: 200,
  })),
  { txid: T("c"), io: "out", address: ADDR, value: 1_200, height: 200 },
  { txid: T("c"), io: "out", address: OTHER, value: 700, height: 200 },
  { txid: T("d"), io: "in", address: ADDR, value: null, height: 300 },
  { txid: T("d"), io: "out", address: ADDR, value: 50, height: 300 },
  { txid: T("e"), io: "out", address: OTHER, value: 1, height: 300 },
  { txid: T("f"), io: "out", address: ADDR, value: 5, height: 400 },
];

describeDb("the address export's walk", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB), max: 2 });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    for (const h of [...new Set(ROWS.map((r) => r.height))]) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, $4, 1000, 1)`,
        [h, `h${h}`.padEnd(64, "0"), `p${h}`.padEnd(64, "0"), 1_700_000_000 + h],
      );
    }
    for (const txid of [...new Set(ROWS.map((r) => r.txid))]) {
      const height = ROWS.find((r) => r.txid === txid)!.height;
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version, fee_zat)
         VALUES ($1, $2, $3, false, 'transparent', 200, 4, $4)`,
        [txid, height, 1_700_000_000 + height, txid === T("d") ? null : 1_000],
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
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** The whole walk, batch by batch, as the export runs it. */
  async function walk(ioRows: number, tip = 300) {
    const rows: AddressTxRow[] = [];
    const starts: number[] = [];
    let above = -1;
    for (let i = 0; i < 50; i += 1) {
      starts.push(above);
      const batch = await readAddressBatch(pool, ADDR, above, tip, ioRows);
      rows.push(...batch.rows);
      if (batch.done) return { rows, starts };
      above = batch.through;
    }
    throw new Error("the walk did not finish");
  }

  const EXPECTED = [
    { txid: T("a"), blockHeight: 100, receivedZat: 1_000, sentZat: 0, feeZat: 1_000 },
    { txid: T("b"), blockHeight: 100, receivedZat: 700, sentZat: 0, feeZat: 1_000 },
    { txid: T("c"), blockHeight: 200, receivedZat: 1_200, sentZat: 2_000, feeZat: 1_000 },
    { txid: T("d"), blockHeight: 300, receivedZat: 50, sentZat: null, feeZat: null },
  ];

  it("gives every transaction once and whole, whatever the batch size", async () => {
    for (const ioRows of [1, 2, 3, 5, 100]) {
      const { rows } = await walk(ioRows);
      expect(
        rows.map(({ txid, blockHeight, receivedZat, sentZat, feeZat }) => ({
          txid,
          blockHeight,
          receivedZat,
          sentZat,
          feeZat,
        })),
        `batches of ${ioRows}`,
      ).toEqual(EXPECTED);
    }
  });

  it("reads a height denser than a batch whole, and moves past it", async () => {
    const { starts } = await walk(2);
    // Height 200 holds six of ADDR's rows; batches of two still arrive at 300 after it.
    expect(starts).toContain(200);
    expect(starts.filter((s) => s === 200)).toHaveLength(1);
  });

  it("carries each transaction's time and kind from the index", async () => {
    const { rows } = await walk(100);
    expect(rows[0]).toMatchObject({ timestamp: 1_700_000_100, kind: "transparent" });
  });

  it("stops at the tip it was given", async () => {
    const { rows } = await walk(100, 400);
    expect(rows.at(-1)!.txid).toBe(T("f"));
    const { rows: bounded } = await walk(100, 300);
    expect(bounded.map((r) => r.txid)).not.toContain(T("f"));
  });
});

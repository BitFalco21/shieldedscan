// server/__tests__/zns-tx-heights.test.ts
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChainIndexStore } from "../chain-index-store";

/**
 * The two index reads the ZNS tracker publishes names through, against the real schema (an
 * in-memory path runs no SQL). A name rests on `txBlocks`: a transaction missing here, or present
 * only in the mempool, must not be reported at any height.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_zns_tx_heights_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const txid = (n: number): string => n.toString(16).padStart(64, "0");

describeDb("ChainIndexStore.txBlocks and tipHeight", () => {
  let pool: Pool;
  let store: ChainIndexStore;

  beforeAll(async () => {
    const admin = new Pool({
      connectionString: withDatabase(DATABASE_URL as string, "postgres"),
      max: 1,
    });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL as string, TEST_DB) });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    store = new ChainIndexStore(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("reports an empty index as no tip, never zero", async () => {
    expect(await store.tipHeight()).toBeNull();
    expect(await store.txBlocks([txid(1)])).toEqual(new Map());
  });

  it("returns the height of each confirmed transaction, and nothing for a missing or mempool one", async () => {
    for (const h of [100, 101]) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, 1700000000 + $1, 1000, 1)`,
        [h, txid(1000 + h), txid(1000 + h - 1)],
      );
    }
    await pool.query(
      `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, version, kind, size_bytes)
       VALUES ($1, 100, 1700000100, false, 5, 'shielded', 500),
              ($2, 101, 1700000101, false, 5, 'shielded', 500),
              ($3, NULL, 1700000102, false, 5, 'shielded', 500)`,
      [txid(1), txid(2), txid(3)],
    );
    const blocks = await store.txBlocks([txid(1), txid(2), txid(3), txid(4)]);
    expect(blocks).toEqual(
      new Map([
        [txid(1), { height: 100, timestamp: 1700000100 }],
        [txid(2), { height: 101, timestamp: 1700000101 }],
      ]),
    );
    expect(await store.tipHeight()).toBe(101);
  });
});

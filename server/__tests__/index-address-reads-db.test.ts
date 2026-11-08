import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChainIndexStore } from "../chain-index-store";
import { PostgresChainStore } from "../postgres-chain-store";

/**
 * The index reads an API without a node answers a block, a search and an address from, against a
 * real database: what each returns, and that the address reads seek `io_address_idx` rather than
 * scan the ledger.
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/index-address-reads-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_index_address_reads_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const A = `t1${"a".repeat(33)}`;
const txid = (n: number) => String(n).padStart(64, "0");

describeDb("ChainIndexStore address and hash reads", () => {
  let pool: Pool;
  let index: ChainIndexStore;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    await new PostgresChainStore(pool, { trackSyncState: false }).applySchema(
      "./server/schema-chain.sql",
    );
    for (const h of [1, 2, 3]) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, $4, 100, 1)`,
        [h, `b${h}`.padEnd(64, "0"), `b${h - 1}`.padEnd(64, "0"), 1_000 + h],
      );
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, version, size_bytes, kind)
         VALUES ($1, $2, $3, false, 4, 100, 'transparent')`,
        [txid(h), h, 1_000 + h],
      );
    }
    // A is paid 500 at 1, spends it at 2 with 350 back as change, and spends that at 3.
    const io = [
      [txid(1), "out", 0, 500, 1],
      [txid(2), "in", 0, 500, 2],
      [txid(2), "out", 0, 350, 2],
      [txid(3), "in", 0, 350, 3],
    ];
    for (const [id, side, ordinal, value, height] of io) {
      await pool.query(
        `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, side, ordinal, A, value, height],
      );
    }
    await pool.query(
      "INSERT INTO chain_rich_list_meta (id, unattributed_zat, computed_height) VALUES (true, 0, 3)",
    );
    index = new ChainIndexStore(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("finds a block's height by its hash, and nothing for another hash", async () => {
    expect(await index.blockHeightByHash("b2".padEnd(64, "0"))).toBe(2);
    expect(await index.blockHeightByHash(txid(2))).toBeNull();
  });

  it("states the height the balances cover beside a row, or no row", async () => {
    expect(await index.addressBalance(A)).toEqual({ computedHeight: 3, held: null });
    await pool.query(
      `INSERT INTO chain_address_balance (address, balance_zat, received_zat, first_height, last_height)
       VALUES ('t1held', 70, 100, 1, 2)`,
    );
    expect(await index.addressBalance("t1held")).toEqual({
      computedHeight: 3,
      held: { balanceZat: 70, receivedZat: 100 },
    });
  });

  it("sums received and sent up to a height, and says when the walk stopped short", async () => {
    expect(await index.addressIoTotals(A, 3, 100)).toEqual({
      rows: 4,
      receivedZat: 850,
      sentZat: 850,
    });
    expect(await index.addressIoTotals(A, 2, 100)).toEqual({
      rows: 3,
      receivedZat: 850,
      sentZat: 500,
    });
    expect((await index.addressIoTotals(A, 3, 2)).rows).toBe(3);
    expect(await index.addressIoTotals("t1none", 3, 100)).toEqual({
      rows: 0,
      receivedZat: 0,
      sentZat: 0,
    });
  });

  it("lists an address's txids newest block first, once each", async () => {
    expect(await index.addressTxids(A, 10)).toEqual([txid(3), txid(2), txid(1)]);
    expect(await index.addressTxids(A, 1)).toEqual([txid(3)]);
  });

  it("the address walk can seek io_address_idx", async () => {
    const client = await pool.connect();
    try {
      await client.query("SET enable_seqscan = off");
      const { rows } = await client.query<{ "QUERY PLAN": string }>(
        `EXPLAIN SELECT io, value_zat FROM tx_transparent_io
          WHERE address = $1 AND block_height <= $2 LIMIT $3`,
        [A, 3, 10],
      );
      expect(rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain("io_address_idx");
    } finally {
      await client.query("RESET enable_seqscan");
      client.release();
    }
  });
});

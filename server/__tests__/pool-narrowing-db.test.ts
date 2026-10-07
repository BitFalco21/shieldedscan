import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POOL_NAMES } from "@/domain";
import { ChainIndexStore } from "../chain-index-store";
import { POOL_USED_SQL } from "../pool-sql";

/**
 * The `?pool=` and `?from=`/`?to=` narrowing, and `heightAtOrBefore`, against a real Postgres (an
 * in-memory path runs no SQL). It also proves that each `POOL_USED_SQL` predicate is one the
 * planner can match to its partial index.
 *
 *   docker run -d --name pgtest -e POSTGRES_PASSWORD=test -e POSTGRES_DB=explorer \
 *     -p 55432:5432 postgres:17
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/pool-narrowing-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_pool_narrowing_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const D0 = 1_780_000_000 - (1_780_000_000 % 86_400); // a UTC midnight
const D1 = D0 + 86_400;
const D2 = D1 + 86_400;

interface Row {
  txid: string;
  height: number | null;
  ts: number;
  kind: string;
  direction?: string;
  sprout?: number;
  saplingSpends?: number;
  saplingOutputs?: number;
  orchard?: number;
  ironwood?: number;
}

const tx = (c: string): string => c.repeat(64);

const ROWS: Row[] = [
  { txid: tx("1"), height: 100, ts: D0 + 100, kind: "shielded", orchard: 2 },
  {
    txid: tx("2"),
    height: 101,
    ts: D0 + 200,
    kind: "mixed",
    direction: "shielding",
    saplingOutputs: 1,
  },
  // A migration: both pools carry a bundle, so it belongs to both lists.
  { txid: tx("3"), height: 102, ts: D1 + 100, kind: "shielded", orchard: 2, ironwood: 2 },
  { txid: tx("4"), height: 103, ts: D1 + 200, kind: "transparent" },
  { txid: tx("5"), height: 104, ts: D2 + 50, kind: "mixed", direction: "unshielding", sprout: 1 },
  // A ZIP-213 coinbase paying into Sapling: spends none, outputs one — the case "spends > 0"
  // alone would miss.
  { txid: tx("6"), height: 105, ts: D2 + 60, kind: "coinbase", saplingOutputs: 1 },
  // In the mempool: carries a bundle, has no height, and must never appear in a chain list.
  { txid: tx("7"), height: null, ts: D2 + 70, kind: "shielded", orchard: 1 },
];

describeDb("pool and window narrowing on the chain index", () => {
  let pool: Pool;
  let store: ChainIndexStore;

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
    for (const r of ROWS) {
      if (r.height !== null) {
        await pool.query(
          `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
           VALUES ($1, $2, $3, $4, 1000, 1) ON CONFLICT DO NOTHING`,
          [r.height, `h${r.height}`.padEnd(64, "0"), `p${r.height}`.padEnd(64, "0"), r.ts],
        );
      }
      // A bundle is whole or absent (the schema's `*_bundle_whole` checks), so an unused pool is
      // NULL across its columns, never zeros.
      const sapling = r.saplingSpends !== undefined || r.saplingOutputs !== undefined;
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, direction, size_bytes,
                         version, sprout_joinsplits, sapling_spends, sapling_outputs,
                         sapling_value_balance_zat, orchard_actions, orchard_value_balance_zat,
                         ironwood_actions, ironwood_value_balance_zat)
         VALUES ($1, $2, $3, $4, $5, $6, 200, 5, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          r.txid,
          r.height,
          r.ts,
          r.kind === "coinbase",
          r.kind,
          r.direction ?? null,
          r.sprout ?? null,
          sapling ? (r.saplingSpends ?? 0) : null,
          sapling ? (r.saplingOutputs ?? 0) : null,
          sapling ? 0 : null,
          r.orchard ?? null,
          r.orchard !== undefined ? 0 : null,
          r.ironwood ?? null,
          r.ironwood !== undefined ? 0 : null,
        ],
      );
    }
    // Out-of-order miner timestamps, for `heightAtOrBefore`: 201 is stamped BEFORE its parent.
    for (const [height, ts] of [
      [200, 5_000],
      [201, 4_990],
      [202, 5_010],
    ] as const) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, $4, 1000, 0)`,
        [height, `h${height}`.padEnd(64, "0"), `p${height}`.padEnd(64, "0"), ts],
      );
    }
    store = new ChainIndexStore(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  const ids = async (
    kind: Parameters<ChainIndexStore["listChainTransactions"]>[0],
    narrow: Parameters<ChainIndexStore["listChainTransactions"]>[2],
    limit = 25,
  ) => (await store.listChainTransactions(kind, { limit }, narrow)).items.map((t) => t.txid[0]);

  it("lists the transactions that used each pool, newest first, never a mempool row", async () => {
    expect(await ids("all", { pool: "orchard" })).toEqual(["3", "1"]);
    expect(await ids("all", { pool: "ironwood" })).toEqual(["3"]);
    expect(await ids("all", { pool: "sapling" })).toEqual(["6", "2"]);
    expect(await ids("all", { pool: "sprout" })).toEqual(["5"]);
  });

  it("combines a pool with a kind and with a direction", async () => {
    expect(await ids("shielded", { pool: "orchard" })).toEqual(["3", "1"]);
    expect(await ids("coinbase", { pool: "sapling" })).toEqual(["6"]);
    expect(await ids("shielding", { pool: "sapling" })).toEqual(["2"]);
    expect(await ids("unshielding", { pool: "sprout" })).toEqual(["5"]);
    expect(await ids("unshielding", { pool: "sapling" })).toEqual([]);
  });

  it("bounds the list to a half-open window of days, with or without a pool", async () => {
    expect(await ids("all", { fromTs: D1, toTs: D2 })).toEqual(["4", "3"]);
    expect(await ids("all", { fromTs: D1, toTs: D2, pool: "orchard" })).toEqual(["3"]);
    expect(await ids("all", { fromTs: D2 })).toEqual(["6", "5"]);
    expect(await ids("all", { toTs: D1 })).toEqual(["2", "1"]);
  });

  it("pages a narrowed list without skipping or repeating a row", async () => {
    const first = await store.listChainTransactions("all", { limit: 1 }, { pool: "orchard" });
    expect(first.items.map((t) => t.txid[0])).toEqual(["3"]);
    const second = await store.listChainTransactions(
      "all",
      { limit: 1, before: first.nextCursor! },
      { pool: "orchard" },
    );
    expect(second.items.map((t) => t.txid[0])).toEqual(["1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("narrows one block's transactions by pool", async () => {
    const at102 = async (p: (typeof POOL_NAMES)[number]) =>
      (await store.listBlockTransactions(102, { limit: 25 }, { pool: p })).items.map(
        (t) => t.txid[0],
      );
    expect(await at102("ironwood")).toEqual(["3"]);
    expect(await at102("orchard")).toEqual(["3"]);
    expect(await at102("sapling")).toEqual([]);
  });

  it("each pool's predicate is one the planner matches to that pool's partial index", async () => {
    const client = await pool.connect();
    try {
      await client.query("SET enable_seqscan = off");
      for (const name of POOL_NAMES) {
        const { rows } = await client.query<{ "QUERY PLAN": string }>(
          `EXPLAIN SELECT timestamp, txid FROM tx
            WHERE block_height IS NOT NULL AND ${POOL_USED_SQL[name]}
            ORDER BY timestamp DESC, txid DESC LIMIT 2`,
        );
        expect(rows.map((r) => r["QUERY PLAN"]).join("\n"), name).toContain(
          `tx_pool_${name}_keyset_idx`,
        );
      }
    } finally {
      await client.query("RESET enable_seqscan");
      client.release();
    }
  });

  it("finds an address's first and last block, with their times, from the address index", async () => {
    for (const [txid, height, ordinal] of [
      [tx("1"), 100, 0],
      [tx("5"), 104, 0],
    ] as const) {
      await pool.query(
        `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
         VALUES ($1, 'out', $2, 't1extent', 5000, $3)`,
        [txid, ordinal, height],
      );
    }
    expect(await store.addressActivityExtent("t1extent")).toEqual({
      first: { height: 100, timestamp: D0 + 100 },
      last: { height: 104, timestamp: D2 + 50 },
    });
    expect(await store.addressActivityExtent("t1nobody")).toEqual({ first: null, last: null });
  });

  it("finds the highest block stamped at or before an instant, out-of-order stamps included", async () => {
    expect(await store.heightAtOrBefore(5_000)).toBe(201);
    expect(await store.heightAtOrBefore(4_995)).toBe(201);
    expect(await store.heightAtOrBefore(5_010)).toBe(202);
    expect(await store.heightAtOrBefore(4_000)).toBeNull();
  });
});

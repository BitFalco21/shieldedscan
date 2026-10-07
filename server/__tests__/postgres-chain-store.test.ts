import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBlock } from "@/data/chain/parse";
import type { RpcBlock } from "@/data/chain/rpc-types";
import { PostgresChainStore } from "../postgres-chain-store";
import realBlock from "@/data/chain/__fixtures__/block-3426950.json";
import ironwoodBlock from "@/data/chain/__fixtures__/block-3428150.json";

/**
 * Integration test for the chain store: the parts only a real database can prove.
 *
 *  - Input resolution: `getblock` gives a `vin` no address and no value, so inputs are filled in
 *    from previously stored outputs via a SQL join.
 *  - Fee derivation ordering: fees need resolved input totals, so they are computed after
 *    resolution inside the same transaction; the wrong order yields NULLs that look like
 *    legitimately unknown fees.
 *  - Cascade on rollback: one DELETE on `block` must take its transactions and I/O with it.
 *
 * Skips without TEST_DATABASE_URL, same as `postgres-store.test.ts`:
 *
 *   TEST_DATABASE_URL=postgres://explorer:<pw>@localhost:15432/explorer \
 *     npx vitest run server/__tests__/postgres-chain-store.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const template = realBlock as unknown as RpcBlock;

/** The real capture re-stamped to a height, with a linking hash chain. */
function blockAt(height: number): RpcBlock {
  return {
    ...template,
    height,
    hash: `chaintest-${height}`.padEnd(64, "0"),
    previousblockhash: `chaintest-${height - 1}`.padEnd(64, "0"),
  };
}

/**
 * A block whose transactions spend outputs created by `producer`, so resolution has
 * something real to find. Rewrites each input to point at output 0 of the producer's first
 * transaction.
 */
function spendingBlock(height: number, producerTxid: string): RpcBlock {
  const base = blockAt(height);
  return {
    ...base,
    tx: base.tx.map((tx, i) => ({
      ...tx,
      txid: `spend${height}-${i}`.padEnd(64, "0"),
      vin: tx.vin.map((vin) =>
        vin.coinbase !== undefined ? vin : { ...vin, txid: producerTxid, vout: 0 },
      ),
    })),
  };
}

describeDb("PostgresChainStore", () => {
  const store = new PostgresChainStore(DATABASE_URL);
  // Heights far above the real chain, so this can run against the live database without
  // colliding with anything the follower has ingested.
  const BASE = 9_000_000;

  beforeAll(async () => {
    await store.applySchema("./server/schema-chain.sql");
    await store.rollbackAbove(BASE - 1);
  });

  afterAll(async () => {
    await store.rollbackAbove(BASE - 1);
    await store.close();
  });

  it("applies its schema idempotently", async () => {
    // Re-running must be a no-op; the file is applied on every boot.
    await expect(store.applySchema("./server/schema-chain.sql")).resolves.toBeUndefined();
  });

  it("ingests a block and advances the sync state", async () => {
    const parsed = parseBlock(blockAt(BASE));
    await store.ingestBlock(parsed);

    expect(await store.getSyncState()).toEqual({
      tipHeight: BASE,
      tipHash: parsed.block.hash,
    });
    expect(await store.hashAt(BASE)).toBe(parsed.block.hash);
  });

  it("is idempotent — re-ingesting the same block changes nothing", async () => {
    const parsed = parseBlock(blockAt(BASE));
    await store.ingestBlock(parsed);
    await store.ingestBlock(parsed);
    expect(await store.getSyncState()).toEqual({
      tipHeight: BASE,
      tipHash: parsed.block.hash,
    });
  });

  it("stores the pool totals for all six pools", async () => {
    await store.ingestBlock(parseBlock(blockAt(BASE)));
    const row = await query<{
      transparent_pool_zat: number | null;
      sapling_pool_zat: number | null;
      ironwood_pool_zat: number | null;
    }>(
      `SELECT transparent_pool_zat, sapling_pool_zat, ironwood_pool_zat
         FROM block WHERE height = $1`,
      [BASE],
    );
    expect(row?.transparent_pool_zat).toBeGreaterThan(0);
    expect(row?.sapling_pool_zat).toBeGreaterThan(0);
    // NULL, not 0: the node reports ironwood `monitored: false` pre-activation, and a
    // stored zero would be a claim it never made.
    expect(row?.ironwood_pool_zat).toBeNull();
  });

  it("records the domain-signed pool flows from the node's own deltas", async () => {
    await store.ingestBlock(parseBlock(blockAt(BASE)));
    const row = await query<{ sapling_flow_zat: number; orchard_flow_zat: number }>(
      "SELECT sapling_flow_zat, orchard_flow_zat FROM block WHERE height = $1",
      [BASE],
    );
    expect(row?.sapling_flow_zat).toBe(2_250_874_631);
    expect(row?.orchard_flow_zat).toBe(30_425_428);
  });

  it("leaves fees NULL when inputs cannot be resolved", async () => {
    // Nothing below BASE exists, so every input points at an output we do not hold. The
    // honest answer is "unknown", never a partial sum.
    await store.ingestBlock(parseBlock(blockAt(BASE)));
    const row = await query<{ unknown_fees: number; total_fee_zat: number | null }>(
      `SELECT COUNT(*) FILTER (WHERE fee_zat IS NULL AND NOT is_coinbase)::int AS unknown_fees,
              (SELECT total_fee_zat FROM block WHERE height = $1) AS total_fee_zat
         FROM tx WHERE block_height = $1`,
      [BASE],
    );
    expect(row?.unknown_fees).toBeGreaterThan(0);
    expect(row?.total_fee_zat).toBeNull();
  });

  it("resolves inputs against previously-stored outputs and then derives the fee", async () => {
    const producer = parseBlock(blockAt(BASE));
    await store.ingestBlock(producer);
    const producerTxid = producer.transactions.find((t) => t.outputs.length > 0)?.txid;
    expect(producerTxid).toBeDefined();

    await store.ingestBlock(parseBlock(spendingBlock(BASE + 1, producerTxid!)));

    const row = await query<{ resolved: number; unresolved: number }>(
      `SELECT COUNT(*) FILTER (WHERE value_zat IS NOT NULL)::int AS resolved,
              COUNT(*) FILTER (WHERE value_zat IS NULL)::int     AS unresolved
         FROM tx_transparent_io WHERE io = 'in' AND block_height = $1`,
      [BASE + 1],
    );
    // The join found the outputs: this is the property no fake can demonstrate.
    expect(row?.resolved).toBeGreaterThan(0);

    const fee = await query<{ with_fee: number }>(
      `SELECT COUNT(*) FILTER (WHERE fee_zat IS NOT NULL)::int AS with_fee
         FROM tx WHERE block_height = $1`,
      [BASE + 1],
    );
    // Fees exist only if derivation ran *after* resolution, in the same transaction.
    expect(fee?.with_fee).toBeGreaterThan(0);
  });

  it("cascades transactions and I/O away on rollback", async () => {
    await store.ingestBlock(parseBlock(blockAt(BASE)));
    await store.ingestBlock(parseBlock(blockAt(BASE + 1)));

    await store.rollbackAbove(BASE);

    expect(await store.hashAt(BASE + 1)).toBeNull();
    expect((await store.getSyncState())?.tipHeight).toBe(BASE);
    const orphans = await query<{ txs: number; ios: number }>(
      `SELECT (SELECT COUNT(*)::int FROM tx WHERE block_height = $1) AS txs,
              (SELECT COUNT(*)::int FROM tx_transparent_io WHERE block_height = $1) AS ios`,
      [BASE + 1],
    );
    expect(orphans?.txs).toBe(0);
    expect(orphans?.ios).toBe(0);
  });

  it("clears the sync state when rolled back past everything", async () => {
    await store.ingestBlock(parseBlock(blockAt(BASE)));
    await store.rollbackAbove(BASE - 1);
    expect(await store.getSyncState()).toBeNull();
  });

  it("stores the ironwood bundle on every transaction that carries one", async () => {
    // The Ironwood bundle must be stored: `tx` needs ironwood columns and #writeTransactions must
    // write the bundle parse.ts carries, or every post-NU6.3 row loses its ironwood balance.
    //
    // block-3428150 is a real captured Ironwood block (six migrations), restamped into the test
    // height range the way blockAt() restamps the template block.
    const base = ironwoodBlock as unknown as RpcBlock;
    const restamped: RpcBlock = {
      ...base,
      height: BASE,
      hash: `chaintest-${BASE}`.padEnd(64, "0"),
      previousblockhash: `chaintest-${BASE - 1}`.padEnd(64, "0"),
    };
    const parsed = parseBlock(restamped);
    const withBundle = parsed.transactions.filter((t) => t.ironwood !== null);
    expect(withBundle.length).toBe(6); // the fixture's own count; 0 would test nothing

    await store.ingestBlock(parsed);

    for (const tx of withBundle) {
      const row = await query<{
        ironwood_actions: number | null;
        ironwood_value_balance_zat: number | null;
      }>("SELECT ironwood_actions, ironwood_value_balance_zat FROM tx WHERE txid = $1", [tx.txid]);
      expect(row?.ironwood_actions, tx.txid).toBe(tx.ironwood!.actions);
      expect(row?.ironwood_value_balance_zat, tx.txid).toBe(tx.ironwood!.valueBalanceZat);
    }

    // And the complement: a pre-NU6.3 transaction stores NULL, not a fabricated zero.
    const preIronwood = parseBlock(blockAt(BASE + 1));
    await store.ingestBlock(preIronwood);
    const nulls = await query<{ fabricated: number }>(
      `SELECT COUNT(*) FILTER (WHERE ironwood_actions IS NOT NULL
                                  OR ironwood_value_balance_zat IS NOT NULL)::int AS fabricated
         FROM tx WHERE block_height = $1`,
      [BASE + 1],
    );
    expect(nulls?.fabricated).toBe(0);
  });

  it("rejects a half-written ironwood bundle at the constraint", async () => {
    // The CHECK is the storage-level mirror of `IronwoodBundle | null`: both columns or
    // neither. A writer that sets one half has confused "no bundle" with "empty bundle",
    // and the database refuses rather than storing the ambiguity.
    await store.ingestBlock(parseBlock(blockAt(BASE)));
    const someTxid = (
      await query<{ txid: string }>("SELECT txid FROM tx WHERE block_height = $1 LIMIT 1", [BASE])
    )?.txid;
    expect(someTxid).toBeDefined();

    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    try {
      await expect(
        pool.query("UPDATE tx SET ironwood_actions = 2 WHERE txid = $1", [someTxid]),
      ).rejects.toThrow(/ironwood_bundle_whole/);
    } finally {
      await pool.end();
    }
  });

  describe("received_at — the follower's own arrival observation", () => {
    const receivedAt = async (height: number) =>
      (
        await query<{ received_at: string | null }>(
          "SELECT received_at FROM block WHERE height = $1",
          [height],
        )
      )?.received_at ?? null;

    it("stays NULL by default — a backfiller's write time is not an arrival", async () => {
      await store.ingestBlock(parseBlock(blockAt(BASE + 20)));
      expect(await receivedAt(BASE + 20)).toBeNull();
    });

    it("is stamped with the wall clock when the store observes arrivals", async () => {
      const stamping = new PostgresChainStore(DATABASE_URL, { stampReceivedAt: true });
      try {
        const before = Math.floor(Date.now() / 1000);
        await stamping.ingestBlock(parseBlock(blockAt(BASE + 21)));
        const after = Math.ceil(Date.now() / 1000);
        const stamp = Number(await receivedAt(BASE + 21));
        expect(stamp).toBeGreaterThanOrEqual(before);
        expect(stamp).toBeLessThanOrEqual(after);
      } finally {
        await stamping.close();
      }
    });

    it("a re-ingest of the SAME block never erases or moves the stamp", async () => {
      // The backfiller closing the seam re-upserts rows the follower already stamped; its
      // NULL must not win. First-seen is the observation — a later stamp is not it either.
      const stamping = new PostgresChainStore(DATABASE_URL, { stampReceivedAt: true });
      try {
        await stamping.ingestBlock(parseBlock(blockAt(BASE + 22)));
        const first = await receivedAt(BASE + 22);
        expect(first).not.toBeNull();
        await store.ingestBlock(parseBlock(blockAt(BASE + 22)));
        expect(await receivedAt(BASE + 22)).toBe(first);
        await stamping.ingestBlock(parseBlock(blockAt(BASE + 22)));
        expect(await receivedAt(BASE + 22)).toBe(first);
      } finally {
        await stamping.close();
      }
    });

    it("a DIFFERENT block at the same height takes the new writer's value", async () => {
      // A same-height overwrite means the row now describes another block; keeping the old
      // stamp would date a block by when its orphaned rival arrived.
      const stamping = new PostgresChainStore(DATABASE_URL, { stampReceivedAt: true });
      try {
        await stamping.ingestBlock(parseBlock(blockAt(BASE + 23)));
        expect(await receivedAt(BASE + 23)).not.toBeNull();
        const rival = { ...blockAt(BASE + 23), hash: `rival-${BASE + 23}`.padEnd(64, "0") };
        await store.ingestBlock(parseBlock(rival));
        expect(await receivedAt(BASE + 23)).toBeNull();
      } finally {
        await stamping.close();
      }
    });
  });

  /** Small query helper; the store deliberately exposes no escape hatch. */
  async function query<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[],
  ): Promise<T | undefined> {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    try {
      const { rows } = await pool.query<T>(sql, params);
      return rows[0];
    } finally {
      await pool.end();
    }
  }
});

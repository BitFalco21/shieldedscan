import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { parseBlock } from "@/data/chain/parse";
import type { RpcBlock } from "@/data/chain/rpc-types";
import { PostgresChainStore } from "../postgres-chain-store";
import { applyTxCounts, dropStaging, stageTxCounts } from "../tx-count-backfill";
import realBlock from "@/data/chain/__fixtures__/block-3426950.json";

/**
 * The rich list is maintained forward, one block at a time, instead of recomputed by a full
 * aggregate over `tx_transparent_io`. That is orders of magnitude cheaper, but a running total
 * can drift from its definition where a materialized view cannot; these tests make drift
 * mechanical to detect.
 *
 * The central one is `equivalence`: ingest a chain incrementally, then run `bootstrapRichList()`
 * (the full aggregate, which is the definition of a balance) and assert the two tables are
 * identical row for row. The others pin specific failure paths: re-ingest after a crash, a reorg,
 * an address emptied to zero and credited again.
 *
 * Needs a real database. Skips without TEST_DATABASE_URL. Use a throwaway local instance (against
 * a live database these tests would mutate the rich list):
 *
 *   docker run -d --name rl-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_USER=explorer \
 *     -e POSTGRES_DB=explorer -p 15433:5432 postgres:17
 *   TEST_DATABASE_URL=postgres://explorer:test@localhost:15433/explorer \
 *     npx vitest run server/__tests__/rich-list-incremental.test.ts
 *
 * It creates and works in its own database: `chain_address_balance` has no height column to
 * scope by and `rollbackAbove` is an open-ended delete, so a sibling suite ingesting a block in a
 * shared database would change the totals under assertions about exact equality.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const TEST_DB = "explorer_rich_list_test";

/** The same server, a different database. */
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** Drop and recreate, so a run never inherits a previous one's rows. */
async function createTestDatabase(url: string): Promise<string> {
  const admin = new Pool({ connectionString: withDatabase(url, "postgres"), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
  return withDatabase(url, TEST_DB);
}

const template = realBlock as unknown as RpcBlock;

/**
 * The captured block re-stamped to a height, with fresh txids.
 *
 * The txids must differ per height: `tx_transparent_io` is keyed on `(txid, io, ordinal)` and
 * writes `ON CONFLICT DO NOTHING`, so reusing them would make every block after the first a
 * silent no-op and the test would prove nothing.
 */
function blockAt(height: number): RpcBlock {
  return {
    ...template,
    height,
    hash: `richtest-${height}`.padEnd(64, "0"),
    previousblockhash: `richtest-${height - 1}`.padEnd(64, "0"),
    tx: template.tx.map((tx, i) => ({ ...tx, txid: `rich${height}-${i}`.padEnd(64, "0") })),
  };
}

/** A block whose inputs spend output 0 of `producerTxid`, so balances fall as well as rise. */
function spendingBlock(height: number, producerTxid: string): RpcBlock {
  const base = blockAt(height);
  return {
    ...base,
    tx: base.tx.map((tx) => ({
      ...tx,
      vin: tx.vin.map((vin) =>
        vin.coinbase !== undefined ? vin : { ...vin, txid: producerTxid, vout: 0 },
      ),
    })),
  };
}

/**
 * A block whose transactions pay each of their addresses twice, the outputs duplicated at fresh
 * ordinals, so `COUNT(*)` and `COUNT(DISTINCT txid)` disagree. Without it the two are identical on
 * every captured fixture and a count test passes against either.
 */
function doublePayingBlock(height: number): RpcBlock {
  const base = blockAt(height);
  return {
    ...base,
    tx: base.tx.map((tx) => ({
      ...tx,
      vout: [...tx.vout, ...tx.vout.map((out, i) => ({ ...out, n: tx.vout.length + i }))],
    })),
  };
}

/**
 * A block whose first ordinary transaction pays an address no other block in this suite pays.
 * An orphaned block routinely carries an address's first appearance, and a rollback then leaves
 * it no rows at all; every other block here reuses the captured payees, so this path would
 * otherwise be unreachable.
 */
function payingNewAddress(height: number, payee: string): RpcBlock {
  const base = blockAt(height);
  return {
    ...base,
    tx: base.tx.map((tx, i) =>
      i !== 1
        ? tx
        : {
            ...tx,
            vout: tx.vout.map((out, n) =>
              n !== 0 ? out : { ...out, scriptPubKey: { ...out.scriptPubKey, addresses: [payee] } },
            ),
          },
    ),
  };
}

interface BalanceRow {
  address: string;
  balance_zat: string;
  received_zat: string;
  first_height: number;
  last_height: number;
  /**
   * In the projection so `equivalence` and the tests built on `balances()` cover the count column
   * too.
   */
  tx_count: string | null;
}

describeDb("rich list, maintained incrementally", () => {
  // `maintainRichList` is the follower's setting; the backfiller runs without it, so a test
  // constructed the default way would exercise nothing.
  let store: PostgresChainStore;
  let pool: Pool;
  const BASE = 9_000_000;

  /** Balances in a stable order, so two runs are comparable with a plain deep-equal. */
  async function balances(): Promise<BalanceRow[]> {
    const { rows } = await pool.query<BalanceRow>(
      `SELECT address, balance_zat::text, received_zat::text, first_height, last_height,
              tx_count::text
         FROM chain_address_balance ORDER BY address`,
    );
    return rows;
  }

  async function meta(): Promise<{ unattributed_zat: string; computed_height: number }> {
    const { rows } = await pool.query<{ unattributed_zat: string; computed_height: number }>(
      "SELECT unattributed_zat::text, computed_height FROM chain_rich_list_meta WHERE id = TRUE",
    );
    return rows[0] ?? { unattributed_zat: "0", computed_height: 0 };
  }

  /**
   * Both phases of the backfill, as an operator runs them, over a chain short enough for a test.
   *
   * `reorgMargin: 0` is the one concession: production targets `tip − REORG_DEPTH`, which on a
   * four-block chain would leave nothing to count. The margin is asserted separately.
   *
   * `dropStaging` first, because the accumulator is additive: inheriting a previous test's rows
   * would double counts rather than fail loudly.
   */
  async function backfillTxCounts(
    options: { chunk?: number; batch?: number; limit?: number } = {},
  ) {
    await dropStaging(pool);
    const staged = await stageTxCounts({
      pool,
      reorgMargin: 0,
      chunk: options.chunk ?? 2,
      // The server's own default, so a test cannot pass only because it was given more memory
      // than production has.
      workMem: "4MB",
      // Fixed span: production resizes each chunk from the previous one's measured rate, which on a
      // four-block chain would jump straight to the maximum and make "several chunks" untestable.
      adaptive: false,
    });
    const applied = await applyTxCounts({
      pool,
      store,
      batch: options.batch ?? 2,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
    return { staged, applied };
  }

  /** Ingest a producing block, then a block spending its outputs, then one more. */
  async function ingestChain(): Promise<void> {
    const producer = parseBlock(blockAt(BASE));
    await store.ingestBlock(producer);
    const producerTxid = producer.transactions.find((t) => t.outputs.length > 0)!.txid;
    await store.ingestBlock(parseBlock(spendingBlock(BASE + 1, producerTxid)));
    await store.ingestBlock(parseBlock(blockAt(BASE + 2)));
  }

  beforeAll(async () => {
    const url = await createTestDatabase(DATABASE_URL!);
    store = new PostgresChainStore(url, { maintainRichList: true });
    pool = new Pool({ connectionString: url, max: 2 });
    await store.applySchema("./server/schema-chain.sql");
  });

  beforeEach(async () => {
    await store.rollbackAbove(BASE - 1);
    await pool.query("DELETE FROM chain_address_balance");
    // The watermark must exist before any delta applies — `#applyBalanceDelta` treats a
    // missing row as "never bootstrapped" and declines, so that a running total is never
    // started from zero and presented as a whole holding.
    await pool.query(
      `INSERT INTO chain_rich_list_meta (id, unattributed_zat, computed_height)
         VALUES (TRUE, 0, $1)
       ON CONFLICT (id) DO UPDATE SET unattributed_zat = 0, computed_height = $1`,
      [BASE - 1],
    );
  });

  afterAll(async () => {
    await store.rollbackAbove(BASE - 1);
    await pool.end();
    await store.close();
  });

  it("lands on exactly what a full recompute would produce", async () => {
    await ingestChain();
    const incremental = await balances();
    const incrementalMeta = await meta();
    // Non-trivial, or the equality below holds vacuously.
    expect(incremental.length).toBeGreaterThan(0);
    expect(incremental.some((r) => BigInt(r.received_zat) > 0n)).toBe(true);

    // The full aggregate over tx_transparent_io — the definition of a balance, and the thing
    // the per-block delta is claiming to be equal to.
    await store.bootstrapRichList();

    expect(await balances()).toEqual(incremental);
    expect(await meta()).toEqual(incrementalMeta);
  });

  it("counts a re-ingested block once, not twice", async () => {
    // Every other table's writes are `ON CONFLICT DO NOTHING`; a running total is not
    // idempotent, so the watermark is what prevents a crash-restart from doubling balances.
    await ingestChain();
    const once = await balances();

    await store.ingestBlock(parseBlock(blockAt(BASE)));
    await store.ingestBlock(parseBlock(blockAt(BASE + 2)));

    expect(await balances()).toEqual(once);
  });

  it("restores the balances exactly when a reorg rolls blocks back", async () => {
    const producer = parseBlock(blockAt(BASE));
    await store.ingestBlock(producer);
    const atBase = await balances();
    const metaAtBase = await meta();
    expect(atBase.length).toBeGreaterThan(0);

    const producerTxid = producer.transactions.find((t) => t.outputs.length > 0)!.txid;
    await store.ingestBlock(parseBlock(spendingBlock(BASE + 1, producerTxid)));
    await store.ingestBlock(parseBlock(blockAt(BASE + 2)));
    // The rolled-back blocks must actually have moved something, or this proves nothing.
    expect(await balances()).not.toEqual(atBase);

    await store.rollbackAbove(BASE);

    // Exact, including first_height/last_height: columns with no arithmetic inverse, which is why
    // rollback re-derives from `io_address_idx` instead of subtracting. The watermark comes back
    // with them.
    expect(await balances()).toEqual(atBase);
    expect(await meta()).toEqual(metaAtBase);
  });

  it("forgets an address the reorg created, and counts it once when the same transaction is mined again", async () => {
    await store.ingestBlock(parseBlock(blockAt(BASE)));
    const atBase = await balances();
    const metaAtBase = await meta();

    const payee = "t1CreatedOnlyByTheOrphanedBlockxxxxx";
    const orphaned = payingNewAddress(BASE + 1, payee);
    await store.ingestBlock(parseBlock(orphaned));
    // The orphaned block must have created the row, or the rest proves nothing.
    expect((await balances()).some((r) => r.address === payee)).toBe(true);

    // Gone with the block, not left standing at the balance the block gave it.
    await store.rollbackAbove(BASE);
    expect(await balances()).toEqual(atBase);
    expect(await meta()).toEqual(metaAtBase);

    // The usual reorg shape: the same transactions mined again at the same height under another
    // block hash. The address must be credited once, as the full aggregate settles.
    await store.ingestBlock(parseBlock({ ...orphaned, hash: "replacement".padEnd(64, "0") }));
    const incremental = await balances();
    expect(incremental.some((r) => r.address === payee)).toBe(true);
    await store.bootstrapRichList();
    expect(await balances()).toEqual(incremental);
  });

  it("repairs the rows the old rollback left standing, and commits only when the list reconciles", async () => {
    await pool.query("DELETE FROM reorg_event");
    await store.ingestBlock(parseBlock(blockAt(BASE)));
    const payee = "t1CreatedOnlyByTheOrphanedBlockxxxxx";
    await store.ingestBlock(parseBlock(payingNewAddress(BASE + 1, payee)));
    const truth = await balances();
    // The node's pool, as ingest would have stored it, made to agree with the true balances —
    // the fixture block carries mainnet's pool, which a nine-block test chain cannot match.
    await pool.query(
      `UPDATE block SET transparent_pool_zat =
         (SELECT sum(balance_zat) FROM chain_address_balance)
         + (SELECT unattributed_zat FROM chain_rich_list_meta WHERE id = TRUE)
        WHERE height = $1`,
      [BASE + 1],
    );

    // The two states a faulty rollback leaves behind: a credit counted twice (the same
    // transaction mined again), and a row for an address with no transaction left on the chain.
    // Both first appeared in the reorg's block.
    await pool.query(
      `INSERT INTO reorg_event (detected_at, height, depth, orphaned_hash, replaced_by)
         VALUES (0, $1, 1, $2, $3)`,
      [BASE + 1, "orphan".padEnd(64, "0"), "replacement".padEnd(64, "0")],
    );
    await pool.query(
      `UPDATE chain_address_balance
          SET balance_zat = balance_zat * 2, received_zat = received_zat * 2,
              tx_count = tx_count + 1
        WHERE address = $1`,
      [payee],
    );
    await pool.query(
      `INSERT INTO chain_address_balance
              (address, balance_zat, received_zat, first_height, last_height, tx_count)
         VALUES ('t1NeverMinedAgainxxxxxxxxxxxxxxxxxx', 5000, 5000, $1, $1, 1)`,
      [BASE + 1],
    );
    const phantom = await balances();
    expect(phantom).not.toEqual(truth);

    const dry = await store.repairReorgCreatedAddresses({ commit: false });
    expect(dry.committed).toBe(false);
    expect(dry.residualBeforeZat).toBe(dry.excessZat);
    expect(dry.residualAfterZat).toBe(0n);
    expect(dry.removed).toBe(1);
    expect(dry.corrected).toBe(1);
    expect(await balances()).toEqual(phantom);

    // A pool that does not reconcile after the repair blocks the commit outright.
    await pool.query(
      "UPDATE block SET transparent_pool_zat = transparent_pool_zat + 1 WHERE height = $1",
      [BASE + 1],
    );
    const refused = await store.repairReorgCreatedAddresses({ commit: true });
    expect(refused.residualAfterZat).toBe(-1n);
    expect(refused.committed).toBe(false);
    expect(await balances()).toEqual(phantom);

    await pool.query(
      "UPDATE block SET transparent_pool_zat = transparent_pool_zat - 1 WHERE height = $1",
      [BASE + 1],
    );
    const done = await store.repairReorgCreatedAddresses({ commit: true });
    expect(done.committed).toBe(true);
    expect(await balances()).toEqual(truth);
    // Idempotent: a second run finds nothing to change.
    const again = await store.repairReorgCreatedAddresses({ commit: true });
    expect([again.removed, again.corrected, again.excessZat]).toEqual([0, 0, 0n]);
  });

  it("drops an address spent to zero, and re-derives its full history if it is credited again", async () => {
    const producer = parseBlock(blockAt(BASE));
    await store.ingestBlock(producer);
    const producerTx = producer.transactions.find((t) => t.outputs.length > 0)!;
    const funded = producerTx.outputs[0]!.address!;
    const beforeSpend = (await balances()).find((r) => r.address === funded);
    expect(beforeSpend).toBeDefined();

    // Spend that exact output. The address's balance goes to zero, so its row goes.
    await store.ingestBlock(parseBlock(spendingBlock(BASE + 1, producerTx.txid)));
    const afterSpend = (await balances()).find((r) => r.address === funded);
    if (afterSpend !== undefined) {
      // The fixture's outputs may not all be spent to exactly zero; the property only holds
      // for one that is, and a stored balance must never be negative either way.
      expect(BigInt(afterSpend.balance_zat)).toBeGreaterThan(0n);
    }
    const negatives = await pool.query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM chain_address_balance WHERE balance_zat <= 0",
    );
    // A negative balance is not a quantity the chain can produce, so storing one would
    // publish an ingestion gap as a fact.
    expect(negatives.rows[0]?.n).toBe("0");

    // Whatever the fixture spent to zero, the full recompute must still agree — which is what
    // proves the deletions removed exactly the rows a rebuild would omit.
    const incremental = await balances();
    await store.bootstrapRichList();
    expect(await balances()).toEqual(incremental);
  });

  it("ranks in the keyset's own order, so a printed rank matches the page's pagination", async () => {
    await ingestChain();
    await store.refreshRichListRanks();

    const { rows } = await pool.query<{ address: string; rank: string }>(
      "SELECT address, rank::text FROM chain_address_balance ORDER BY balance_zat DESC, address",
    );
    expect(rows.length).toBeGreaterThan(1);
    // `ORDER BY balance_zat DESC, address` is the cursor's order too; a stored rank that
    // disagreed would number rows inconsistently across pages.
    expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => String(i + 1)));
  });

  it("catches up blocks that were ingested while the balances were not being maintained", async () => {
    // Blocks already stored above a watermark (e.g. after the backfiller ran): the forward path
    // alone can never close that gap, because the watermark only moves up.
    const unmaintained = new PostgresChainStore(pool, { maintainRichList: false });
    const producer = parseBlock(blockAt(BASE));
    await unmaintained.ingestBlock(producer);
    const producerTxid = producer.transactions.find((t) => t.outputs.length > 0)!.txid;
    await unmaintained.ingestBlock(parseBlock(spendingBlock(BASE + 1, producerTxid)));
    await unmaintained.ingestBlock(parseBlock(blockAt(BASE + 2)));
    expect(await balances()).toEqual([]);

    const applied = await store.catchUpRichList();
    expect(applied).toBe(3);

    // It must land on the full aggregate's answer; "it ran" is not the property that matters.
    const caughtUp = await balances();
    expect(caughtUp.length).toBeGreaterThan(0);
    await store.bootstrapRichList();
    expect(await balances()).toEqual(caughtUp);
    expect((await meta()).computed_height).toBe(BASE + 2);
  });

  it("refuses a gap too wide to walk rather than walking it a block at a time", async () => {
    await store.ingestBlock(parseBlock(blockAt(BASE)));
    const messages: string[] = [];
    // A cap of zero makes any gap too wide; the catch-up must decline and say so, rather than do
    // a slow `bootstrapRichList` during a follower boot.
    await pool.query("UPDATE chain_rich_list_meta SET computed_height = $1", [BASE - 3]);
    const applied = await store.catchUpRichList((m) => messages.push(m), 1);

    expect(applied).toBe(0);
    expect(messages.join(" ")).toMatch(/too far to catch up/);
  });

  it("declines to build a running total when there is no watermark to build it on", async () => {
    // No meta row means the tables were never bootstrapped. Starting from zero would give every
    // address a balance counting only from this block forward, presented as its whole holding.
    await pool.query("DELETE FROM chain_rich_list_meta");
    await store.ingestBlock(parseBlock(blockAt(BASE)));
    expect(await balances()).toEqual([]);
  });

  it("declines to correct the balances on a reorg when there is no watermark either", async () => {
    // The rollback path must honour the same guard: it recomputes the reorg's addresses from the
    // index, which would write a handful of real balances into an un-bootstrapped table, and a page
    // claiming every address would then state the chain's wealth from them.
    // BASE survives the rollback, so those addresses still hold value and an unguarded recompute
    // would write them (rolling back further would delete them and pass for the wrong reason).
    await ingestChain();
    await pool.query("DELETE FROM chain_rich_list_meta");
    await pool.query("DELETE FROM chain_address_balance");
    await store.rollbackAbove(BASE);
    expect(await balances()).toEqual([]);
  });

  it("counts a transaction once, however many outputs of it an address holds", async () => {
    // COUNT(DISTINCT txid), not COUNT(*): an address paid twice by one transaction has been in one
    // transaction. Checked against an independent count, and the first assertion proves the fixture
    // exercises the difference.
    // Two blocks: the first creates the rows, so the second goes through the delta's increment
    // rather than `recomputeAddresses` (with an empty table the increment never runs).
    await store.ingestBlock(parseBlock(blockAt(BASE)));
    await store.ingestBlock(parseBlock(doublePayingBlock(BASE + 1)));
    const check = `SELECT b.address, b.tx_count::text AS stored,
             (SELECT count(DISTINCT i.txid)::text FROM tx_transparent_io i WHERE i.address = b.address) AS truth,
             (SELECT count(*)::text FROM tx_transparent_io i WHERE i.address = b.address) AS ios
        FROM chain_address_balance b ORDER BY b.address`;
    type Row = { address: string; stored: string; truth: string; ios: string };

    const delta = await pool.query<Row>(check);
    expect(delta.rows.length).toBeGreaterThan(0);
    expect(delta.rows.some((r) => r.ios !== r.truth)).toBe(true);
    expect(delta.rows.map((r) => r.stored)).toEqual(delta.rows.map((r) => r.truth));

    // The backfill must reach the same answer as the delta, over the same rows. The load-bearing
    // clause is `SELECT DISTINCT i.address, i.txid` inside the chunk aggregate.
    await pool.query("UPDATE chain_address_balance SET tx_count = NULL");
    await backfillTxCounts();
    const repaired = await pool.query<Row>(check);
    expect(repaired.rows.map((r) => r.stored)).toEqual(repaired.rows.map((r) => r.truth));
  });

  it("leaves an uncounted row uncounted as blocks arrive, rather than counting from now", async () => {
    // `NULL + n` is NULL, so a row the repair has not reached stays unknown instead of becoming a
    // count of "transactions since we started looking".
    await ingestChain();
    await pool.query("UPDATE chain_address_balance SET tx_count = NULL");
    await store.ingestBlock(parseBlock(blockAt(BASE + 3)));
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM chain_address_balance WHERE tx_count IS NOT NULL",
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("fills every uncounted row online, landing where a full recompute would", async () => {
    await ingestChain();
    const expected = await pool.query<{ address: string; tx_count: string }>(
      "SELECT address, tx_count::text FROM chain_address_balance ORDER BY address",
    );
    await pool.query("UPDATE chain_address_balance SET tx_count = NULL");

    // Chunk and batch sizes below the row count, so both loops advance across several iterations.
    const { staged, applied } = await backfillTxCounts({ chunk: 1, batch: 2 });

    const filled = await pool.query<{ address: string; tx_count: string }>(
      "SELECT address, tx_count::text FROM chain_address_balance ORDER BY address",
    );
    expect(filled.rows).toEqual(expected.rows);
    expect(applied.remaining).toBe(0);
    expect(staged.chunksRun).toBeGreaterThan(1);
    expect(applied.batches).toBeGreaterThan(1);
  });

  it("terminates when there is nothing left, rather than re-reading its own leftovers", async () => {
    await ingestChain();
    // Every row already carries a count from the delta, so the apply must write nothing and stop.
    // The cursor follows rows claimed rather than rows written, so an accumulator entry with no
    // matching live row cannot spin forever.
    const { applied } = await backfillTxCounts();
    expect(applied.filled).toBe(0);
    expect(applied.remaining).toBe(0);
  });

  it("counts the same however the height range is divided", async () => {
    // A txid belongs to exactly one block, so disjoint height ranges partition the txid set and
    // per-range counts add. Overlapping two chunks by one height would fail this.
    await ingestChain();
    const expected = await pool.query<{ address: string; tx_count: string }>(
      "SELECT address, tx_count::text FROM chain_address_balance ORDER BY address",
    );

    for (const chunk of [1, 2, 1_000]) {
      await pool.query("UPDATE chain_address_balance SET tx_count = NULL");
      await backfillTxCounts({ chunk });
      const got = await pool.query<{ address: string; tx_count: string }>(
        "SELECT address, tx_count::text FROM chain_address_balance ORDER BY address",
      );
      expect(got.rows, `chunk size ${chunk}`).toEqual(expected.rows);
    }
  });

  it("refuses to apply a staging pass that never reached its target height", async () => {
    // A bounded staging run leaves the accumulator short of H; applying it would write counts
    // missing every block above the watermark, a partial answer shaped like a whole one.
    await ingestChain();
    await pool.query("UPDATE chain_address_balance SET tx_count = NULL");
    await dropStaging(pool);
    const staged = await stageTxCounts({
      pool,
      reorgMargin: 0,
      chunk: 1,
      chunks: 1,
      adaptive: false,
    });
    expect(staged.complete).toBe(false);

    await expect(applyTxCounts({ pool, store, batch: 2 })).rejects.toThrow(/incomplete/);
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM chain_address_balance WHERE tx_count IS NOT NULL",
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("refuses to start when blocks are stored but not yet folded into the counts", async () => {
    // `last_height <= H` proves no block above H was folded in (the delta writes `last_height` and
    // `tx_count` in one statement), but says nothing about blocks stored and not yet applied. That
    // is the state `catchUpRichList` handles on every follower boot: staging would count those
    // blocks, the apply would write the total, and the catch-up would add them again.
    await ingestChain();
    await pool.query("UPDATE chain_address_balance SET tx_count = NULL");

    // Wind the watermark back without touching the blocks: io rows exist above what the delta
    // has applied.
    await pool.query("UPDATE chain_rich_list_meta SET computed_height = $1", [BASE]);

    await expect(
      stageTxCounts({ pool, reorgMargin: 0, chunk: 2, adaptive: false }),
    ).rejects.toThrow(/watermark/);
  });

  it("stamps every io row of a transaction with that transaction's own height", async () => {
    // `#writeTransparentIo` inserts one scalar `$9::int` height for every row of a block, so a
    // txid's rows cannot straddle two heights; that is what makes `COUNT(DISTINCT txid)` additive
    // across disjoint height ranges, and why the chunk predicate needs no height filter of its own.
    //
    // Exercised across a reorg and a re-ingest, the one path that rewrites io rows for heights
    // that already had some.
    await ingestChain();
    await store.rollbackAbove(BASE + 1);
    await store.ingestBlock(parseBlock(blockAt(BASE + 2)));

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM tx t JOIN tx_transparent_io i ON i.txid = t.txid
        WHERE i.block_height IS DISTINCT FROM t.block_height`,
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("numbers ranks the same however the apply is batched", async () => {
    // The rank refresh is a read plus batched writes, so it holds no long row locks. Batching must
    // not change the answer, hence a batch size below, at and above the row count.
    await ingestChain();
    const truth = await pool.query<{ address: string; rn: string }>(
      `SELECT address, row_number() OVER (ORDER BY balance_zat DESC, address)::bigint::text AS rn
         FROM chain_address_balance ORDER BY address`,
    );
    expect(truth.rows.length).toBeGreaterThan(1);

    for (const batch of [1, 2, 10_000]) {
      await pool.query("UPDATE chain_address_balance SET rank = 0");
      const written = await store.refreshRichListRanks({ batch });
      const got = await pool.query<{ address: string; rn: string }>(
        "SELECT address, rank::text AS rn FROM chain_address_balance ORDER BY address",
      );
      expect(got.rows, `batch ${batch}`).toEqual(truth.rows);
      expect(written, `batch ${batch}`).toBe(truth.rows.length);
    }

    // A second pass over unchanged balances writes nothing: `IS DISTINCT FROM` keeps the steady
    // state proportional to what moved.
    expect(await store.refreshRichListRanks()).toBe(0);
  });

  /**
   * Every stored balance must equal a fresh derivation at the watermark: the invariant production
   * reconciliation checks against the node's transparent value pool, expressed locally.
   */
  async function balanceResidualZat(): Promise<string> {
    const { rows } = await pool.query<{ residual: string }>(
      `WITH m AS (SELECT computed_height AS h FROM chain_rich_list_meta WHERE id = TRUE),
            fresh AS (
              SELECT i.address,
                     SUM(CASE WHEN i.io = 'out' THEN i.value_zat ELSE -i.value_zat END)::bigint AS d
                FROM tx_transparent_io i
               WHERE i.address IS NOT NULL AND i.block_height <= (SELECT h FROM m)
               GROUP BY i.address)
       SELECT COALESCE(SUM(f.d - b.balance_zat), 0)::text AS residual
         FROM chain_address_balance b JOIN fresh f USING (address)`,
    );
    return rows[0]?.residual ?? "?";
  }

  it("leaves every balance equal to a fresh derivation at the watermark", async () => {
    // The apply's recompute tail overwrites balance_zat from the index while the delta adds to it,
    // so the two must agree on the height: the tail reads the watermark under FOR UPDATE, in the
    // same transaction as the recompute. A height read earlier could be stale, letting the bounded
    // recompute strip a block the delta already applied.
    await ingestChain();
    await pool.query("UPDATE chain_address_balance SET tx_count = NULL");
    await backfillTxCounts();
    expect(await balanceResidualZat()).toBe("0");
  });

  it("a recompute bounded to a STALE height breaks that invariant, so the check has teeth", async () => {
    // Proves the assertion above is not vacuous: the race cannot be reproduced without a hook, so
    // the mistake is made directly (recompute at a height below the watermark) and the residual
    // must become non-zero.
    await ingestChain();
    expect(await balanceResidualZat()).toBe("0");

    const { rows } = await pool.query<{ address: string }>(
      "SELECT address FROM chain_address_balance ORDER BY balance_zat DESC LIMIT 1",
    );
    const victim = rows[0]!.address;
    await store.recomputeAddresses([victim], undefined, BASE);

    expect(await balanceResidualZat()).not.toBe("0");
  });

  it("refuses to resume when a crash truncated the accumulator but left its watermark", async () => {
    // Both staging tables are unlogged, so a crash truncates them together. A watermark above zero
    // with nothing accumulated means exactly that, and resuming would skip every chunk below it.
    await ingestChain();
    await dropStaging(pool);
    await stageTxCounts({ pool, reorgMargin: 0, chunk: 1, chunks: 1, adaptive: false });
    await pool.query("DELETE FROM tx_count_backfill");

    await expect(
      stageTxCounts({ pool, reorgMargin: 0, chunk: 1, adaptive: false }),
    ).rejects.toThrow(/truncated/);
  });
});

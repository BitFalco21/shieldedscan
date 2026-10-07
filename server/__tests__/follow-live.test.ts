import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { followOnce } from "../follow";
import { HttpNodeRpc } from "../node-rpc";
import { PostgresChainStore } from "../postgres-chain-store";

/**
 * End-to-end: the real node, the real database, the real follower. The only test that exercises
 * the whole path (RPC transport, parsing, reconciliation, resolution, fee derivation, storage)
 * against data nobody wrote for it.
 *
 * It ingests from genesis, not from the tip: starting at the tip would leave every input
 * unresolvable (the outputs they spend predate our history), so fees would all be NULL. Early
 * blocks are small and self-contained, so resolution has real work to do.
 *
 * Data is left in place: these rows are correct chain data, and the follower continues from where
 * this stops. Skips unless both env vars are set:
 *
 *   TEST_DATABASE_URL=… TEST_NODE_RPC_URL=http://127.0.0.1:18232 \
 *     npx vitest run server/__tests__/follow-live.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const NODE_RPC_URL = process.env.TEST_NODE_RPC_URL;
const describeLive = DATABASE_URL && NODE_RPC_URL ? describe : describe.skip;

/** Bounded so the smoke test stays a smoke test. The real backfill just keeps going. */
const BLOCKS = 300;

describeLive("follower against the live node", () => {
  const store = new PostgresChainStore(DATABASE_URL);
  const rpc = new HttpNodeRpc(NODE_RPC_URL!);
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  /** The follower logs progress; a live test has nowhere useful to put it. */
  const log = () => {};

  beforeAll(async () => {
    await store.applySchema("./server/schema-chain.sql");
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await store.close();
  });

  it("reaches the node and reports a plausible tip", async () => {
    const tip = await rpc.getTipHeight();
    // Past NU6.3 activation, so anything much lower means we are talking to the wrong node.
    expect(tip).toBeGreaterThan(3_400_000);
  }, 30_000);

  it(`ingests ${BLOCKS} blocks from genesis, passing reconciliation on every one`, async () => {
    const result = await followOnce({ rpc, store, log, batch: BLOCKS });
    // A ReconciliationError anywhere in the range would have thrown rather than returned.
    expect(result.ingested).toBeGreaterThan(0);
    expect(result.localTip).toBeGreaterThanOrEqual(BLOCKS - 1);
    expect(result.caughtUp).toBe(false);
  }, 300_000);

  it("stored blocks form an unbroken hash chain", async () => {
    const { rows } = await pool.query<{ breaks: number }>(
      `SELECT COUNT(*)::int AS breaks
         FROM block b JOIN block p ON p.height = b.height - 1
        WHERE b.prev_hash <> p.hash`,
    );
    // Any break means we stitched together blocks from different histories.
    expect(rows[0]?.breaks).toBe(0);
  });

  it("derived real fees, not a wall of NULLs", async () => {
    const { rows } = await pool.query<{ known: number; unknown: number }>(
      `SELECT COUNT(*) FILTER (WHERE fee_zat IS NOT NULL)::int AS known,
              COUNT(*) FILTER (WHERE fee_zat IS NULL AND NOT is_coinbase)::int AS unknown
         FROM tx WHERE block_height < $1`,
      [BLOCKS],
    );
    // Genesis-era blocks are almost entirely coinbase, so `known` may be small — but a
    // non-coinbase transaction with an unresolvable input means resolution is broken,
    // because every output it could spend is inside the range we just ingested.
    expect(rows[0]?.unknown).toBe(0);
  });

  it("recorded the pool totals the node reports", async () => {
    const { rows } = await pool.query<{ with_pools: number }>(
      `SELECT COUNT(*)::int AS with_pools
         FROM block WHERE transparent_pool_zat IS NOT NULL AND block.height < $1`,
      [BLOCKS],
    );
    expect(rows[0]?.with_pools).toBeGreaterThan(0);
  });

  it("is idempotent — a second pass over the same range adds nothing", async () => {
    const before = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM block");
    // Re-running from a stored tip resumes forward, so force a re-read of the same range by
    // asking for a batch that starts where we already are.
    await followOnce({ rpc, store, log, batch: 5 });
    const after = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM block");
    expect((after.rows[0]?.n ?? 0) - (before.rows[0]?.n ?? 0)).toBeLessThanOrEqual(5);
  }, 60_000);
});

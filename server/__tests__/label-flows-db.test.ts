import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REORG_DEPTH } from "../follow";
import type { Pacer } from "../job-pacer";
import {
  LabelFlowTracker,
  applyLabelFlowChunk,
  labelFlowChainIntact,
  pruneLabelFlowAddresses,
  labelFlowCompleteThrough,
  loadLabelFlowTxs,
} from "../label-flows";

/**
 * `label_flow_io` / `label_flow_tx` against a real Postgres: each transaction is stored whole for
 * the current label set, nothing within the reorg depth is stored, an address labelled later
 * rewrites exactly the transactions it appears in, and an address unlabelled leaves them.
 *
 *   TEST_DATABASE_URL=postgres://explorer:test@127.0.0.1:55432/explorer \
 *     npx vitest run server/__tests__/label-flows-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_label_flows_test";

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

const BASE = 1_577_836_800;

describeDb("label flows", () => {
  let pool: Pool;

  async function chain(tip: number): Promise<void> {
    await pool.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
       SELECT h, lpad(h::text, 64, 'a'), lpad(h::text, 64, 'p'), $2::bigint + h * 60, 1000, 1
         FROM generate_series(0, $1::int) h`,
      [tip, BASE],
    );
  }

  /** More blocks, `from..to`, after the first chain. */
  async function chain2(from: number, to: number): Promise<void> {
    await pool.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
       SELECT h, lpad(h::text, 64, 'a'), lpad(h::text, 64, 'p'), $3::bigint + h * 60, 1000, 1
         FROM generate_series($1::int, $2::int) h`,
      [from, to, BASE],
    );
  }

  let n = 0;
  async function tx(
    height: number,
    ios: Array<{ io: "in" | "out"; address: string | null; value: number | null }>,
    over: { sapling?: number; sprout?: number; coinbase?: boolean } = {},
  ): Promise<string> {
    const txid = `t${(n += 1)}-${height}`.padEnd(64, "0");
    await pool.query(
      `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version,
                       sapling_spends, sapling_outputs, sapling_value_balance_zat,
                       sprout_joinsplits, sprout_vpub_net_zat)
       VALUES ($1, $2, $3, $4, 'transparent', 200, 5, $5, $5, $6, $7, $8)`,
      [
        txid,
        height,
        BASE + height * 60,
        over.coinbase ?? false,
        over.sapling === undefined ? null : 1,
        over.sapling ?? null,
        over.sprout === undefined ? null : 1,
        over.sprout ?? null,
      ],
    );
    for (const [ordinal, io] of ios.entries()) {
      await pool.query(
        `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [txid, io.io, ordinal, io.address, io.value, height],
      );
    }
    return txid;
  }

  const tracker = (addresses: string[], chunkBlocks = 50) =>
    new LabelFlowTracker({
      pool,
      network: "mainnet",
      addresses,
      pacer,
      log: () => {},
      chunkBlocks,
    });

  const stored = async () =>
    (await loadLabelFlowTxs(pool, 0, 1_000_000)).map((t) => ({
      txid: t.txid,
      in: t.unlabelledInZat,
      out: t.unlabelledOutZat,
      deltas: Object.fromEntries(t.deltas.map((d) => [d.address, d.deltaZat])),
    }));

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
      "TRUNCATE label_flow_io, label_flow_tx, label_flow_state, label_flow_meta, tx_transparent_io, tx, block CASCADE",
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("stores each transaction whole, with its unlabelled side, and nothing within reorg depth", async () => {
    const tip = 400;
    await chain(tip);
    const deposit = await tx(10, [
      { io: "in", address: "tU1", value: 1_000 },
      { io: "out", address: "tA", value: 990 },
    ]);
    const withdrawal = await tx(20, [
      { io: "in", address: "tA", value: 990 },
      { io: "out", address: "tU2", value: 500 },
      { io: "out", address: "tB", value: 480 },
    ]);
    await tx(tip - REORG_DEPTH + 1, [{ io: "out", address: "tA", value: 7 }]);
    await tracker(["tA", "tB"]).refresh();
    expect(await stored()).toEqual([
      { txid: deposit, in: 1_000, out: 0, deltas: { tA: 990 } },
      { txid: withdrawal, in: 0, out: 500, deltas: { tA: -990, tB: 480 } },
    ]);
    expect(await labelFlowCompleteThrough(pool, ["tA", "tB"])).toBe(tip - REORG_DEPTH);
  });

  it("gives one answer for a transaction two addresses reach, whatever their watermarks", async () => {
    await chain(400);
    const shared = await tx(30, [
      { io: "in", address: "tA", value: 100 },
      { io: "out", address: "tB", value: 90 },
    ]);
    await tracker(["tA", "tB"], 7).refresh();
    expect(await stored()).toEqual([{ txid: shared, in: 0, out: 0, deltas: { tA: -100, tB: 90 } }]);
  });

  it("rewrites exactly the transactions an address labelled later appears in", async () => {
    await chain(400);
    const both = await tx(10, [
      { io: "in", address: "tC", value: 300 },
      { io: "out", address: "tA", value: 290 },
    ]);
    const aOnly = await tx(11, [
      { io: "in", address: "tU", value: 50 },
      { io: "out", address: "tA", value: 40 },
    ]);
    await tracker(["tA"]).refresh();
    expect((await stored()).find((t) => t.txid === both)).toEqual({
      txid: both,
      in: 300,
      out: 0,
      deltas: { tA: 290 },
    });
    // tC is labelled now: it walks from genesis alone and rewrites the one transaction it is in.
    await tracker(["tA", "tC"]).refresh();
    expect(await stored()).toEqual([
      { txid: both, in: 0, out: 0, deltas: { tA: 290, tC: -300 } },
      { txid: aOnly, in: 50, out: 0, deltas: { tA: 40 } },
    ]);
  });

  it("returns an unlabelled address's value to the unlabelled side, and drops a transaction left with none", async () => {
    await chain(400);
    const both = await tx(10, [
      { io: "in", address: "tC", value: 300 },
      { io: "out", address: "tA", value: 290 },
    ]);
    const cOnly = await tx(12, [{ io: "out", address: "tC", value: 5 }]);
    await tracker(["tA", "tC"]).refresh();
    expect((await stored()).map((t) => t.txid)).toEqual([both, cOnly]);
    await tracker(["tA"]).refresh();
    expect(await stored()).toEqual([{ txid: both, in: 300, out: 0, deltas: { tA: 290 } }]);
    expect(
      (await pool.query("SELECT address FROM label_flow_state ORDER BY address")).rows,
    ).toEqual([{ address: "tA" }]);
  });

  it("refuses a chunk whose watermark moved under it", async () => {
    await chain(400);
    await pool.query(
      "INSERT INTO label_flow_state (address, through_height, updated_at) VALUES ('tA', 5, 0)",
    );
    expect(await applyLabelFlowChunk(pool, ["tA"], 4, 50, ["tA"], 0)).toBe("moved");
    expect(await applyLabelFlowChunk(pool, ["tA"], 5, 50, ["tA"], 0)).toBe("applied");
    expect((await pool.query("SELECT through_height FROM label_flow_state")).rows).toEqual([
      { through_height: 50 },
    ]);
  });

  it("carries coinbase and shielded movement from the transaction itself", async () => {
    await chain(400);
    await tx(40, [{ io: "out", address: "tA", value: 100 }], { coinbase: true });
    await tx(41, [{ io: "out", address: "tA", value: 50 }], { sapling: 50 });
    await tracker(["tA"]).refresh();
    const rows = await loadLabelFlowTxs(pool, 0, 1_000);
    // Sapling's stored balance is positive into the pool: +50 is the pool taking 50.
    expect(rows.map((r) => [r.isCoinbase, r.poolsGaveZat, r.poolsTookZat])).toEqual([
      [true, 0, 0],
      [false, 0, 50],
    ]);
  });

  it("reads pool value by the way it moved: Sapling stored positive into the pool, Sprout the reverse", async () => {
    await chain(400);
    await tx(50, [{ io: "out", address: "tA", value: 70 }], { sapling: -70 });
    await tx(51, [{ io: "out", address: "tA", value: 30 }], { sprout: 30 });
    await tx(52, [{ io: "in", address: "tA", value: 40 }], { sprout: -40 });
    await tracker(["tA"]).refresh();
    const rows = await loadLabelFlowTxs(pool, 50, 52);
    expect(rows.map((r) => [r.poolsGaveZat, r.poolsTookZat])).toEqual([
      [70, 0],
      [30, 0],
      [0, 40],
    ]);
  });

  it("removes an unlisted address in batches, and resumes a removal cut short", async () => {
    await chain(400);
    const cOnly = [];
    for (let h = 20; h < 25; h += 1)
      cOnly.push(await tx(h, [{ io: "out", address: "tC", value: h }]));
    const both = await tx(30, [
      { io: "in", address: "tC", value: 9 },
      { io: "out", address: "tA", value: 8 },
    ]);
    await tracker(["tA", "tC"]).refresh();
    expect((await stored()).length).toBe(6);
    // Two transactions a batch, and a pause after the first: tC's state stays until the last batch.
    expect(await pruneLabelFlowAddresses(pool, ["tA"], async () => "abort", 2)).toBeNull();
    expect((await pool.query("SELECT 1 FROM label_flow_state WHERE address = 'tC'")).rowCount).toBe(
      1,
    );
    expect(await pruneLabelFlowAddresses(pool, ["tA"], async () => "continue", 2)).toBe(1);
    expect(await stored()).toEqual([{ txid: both, in: 9, out: 0, deltas: { tA: 8 } }]);
    expect((await pool.query("SELECT 1 FROM label_flow_state WHERE address = 'tC'")).rowCount).toBe(
      0,
    );
  });

  it("refuses a chunk on a changed chain or inside the reorg depth, checked under the lock", async () => {
    await chain(400);
    await pool.query(
      "INSERT INTO label_flow_state (address, through_height, updated_at) VALUES ('tA', 10, 0)",
    );
    expect(await applyLabelFlowChunk(pool, ["tA"], 10, 400 - REORG_DEPTH + 1, ["tA"], 0)).toBe(
      "chain",
    );
    expect(await applyLabelFlowChunk(pool, ["tA"], 10, 200, ["tA"], 0)).toBe("applied");
    await pool.query("UPDATE block SET hash = lpad('y', 64, 'y') WHERE height = 200");
    expect(await applyLabelFlowChunk(pool, ["tA"], 200, 250, ["tA"], 0)).toBe("chain");
  });

  it("stops, writing nothing, once a block below the stored rows has changed", async () => {
    await chain(400);
    await tx(10, [{ io: "out", address: "tA", value: 5 }]);
    await tracker(["tA"]).refresh();
    expect(await labelFlowChainIntact(pool)).toBe(true);
    // A reorg deeper than the reorg depth: the block the rows were stored through is replaced.
    await pool.query("UPDATE block SET hash = lpad('x', 64, 'x') WHERE height = $1", [
      400 - REORG_DEPTH,
    ]);
    expect(await labelFlowChainIntact(pool)).toBe(false);
    await tx(305, [{ io: "out", address: "tA", value: 9 }]);
    await chain2(401, 600);
    const r = await tracker(["tA"]).refresh();
    expect(r.aborted).toBe(true);
    expect((await stored()).length).toBe(1);
  });

  it("reports no completeness while any labelled address has not been walked", async () => {
    await chain(400);
    await tracker(["tA"]).refresh();
    expect(await labelFlowCompleteThrough(pool, ["tA", "tNew"])).toBeNull();
  });
});

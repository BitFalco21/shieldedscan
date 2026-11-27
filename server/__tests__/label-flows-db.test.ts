import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REORG_DEPTH } from "../follow";
import type { Pacer } from "../job-pacer";
import type { LabelGroup } from "@/domain";
import {
  LabelFlowTracker,
  applyLabelFlowChunk,
  labelFlowReadiness,
  loadLabelFlowAggregates,
  loadLargestLabelFlows,
  regroupLabelFlowAddress,
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
      "TRUNCATE label_flow_io, label_flow_tx, label_flow_flow, label_flow_state, label_flow_meta, label_flow_derive, tx_transparent_io, tx, block CASCADE",
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

  // ---------------------------------------------------------------- classified flows

  const EX = (exchange: "binance" | "kraken"): LabelGroup => ({ kind: "exchange", exchange });
  const groupsBy =
    (map: Record<string, LabelGroup>) =>
    (a: string): LabelGroup | null =>
      map[a] ?? null;
  const flowTracker = (
    addresses: string[],
    groupOf: (a: string) => LabelGroup | null,
    over: { version?: string; chunkBlocks?: number; abortAfter?: number } = {},
  ) => {
    let units = 0;
    return new LabelFlowTracker({
      pool,
      network: "mainnet",
      addresses,
      log: () => {},
      chunkBlocks: over.chunkBlocks ?? 50,
      groupOf,
      version: over.version ?? "1",
      pacer: () => ({
        ...pacer(),
        afterUnit: async () =>
          over.abortAfter !== undefined && (units += 1) >= over.abortAfter ? "abort" : "continue",
      }),
    });
  };
  const flows = async () =>
    (
      await pool.query<{
        txid: string;
        exchange: string;
        direction: string;
        zat: number;
        parts: unknown;
      }>(
        "SELECT txid, exchange, direction, zat, parts FROM label_flow_flow ORDER BY block_height, txid, exchange",
      )
    ).rows;

  it("classifies each transaction's flows beside its rows, internal moves included", async () => {
    await chain(400);
    const g = groupsBy({ xB: EX("binance"), xB2: EX("binance"), xK: EX("kraken") });
    const deposit = await tx(10, [
      { io: "in", address: "tU1", value: 1_000 },
      { io: "out", address: "xB", value: 990 },
    ]);
    const batch = await tx(20, [
      { io: "in", address: "xB", value: 990 },
      { io: "out", address: "tU2", value: 500 },
      { io: "out", address: "xK", value: 480 },
    ]);
    const sweep = await tx(30, [
      { io: "in", address: "xB", value: 400 },
      { io: "out", address: "xB2", value: 399 },
    ]);
    await flowTracker(["xB", "xB2", "xK"], g).refresh();
    expect(await flows()).toEqual([
      {
        txid: deposit,
        exchange: "binance",
        direction: "in",
        zat: 990,
        parts: [{ kind: "transparent", zat: 990 }],
      },
      {
        txid: batch,
        exchange: "binance",
        direction: "out",
        zat: 990,
        parts: [
          { kind: "transparent", zat: 500 },
          { kind: "exchange", exchange: "kraken", zat: 480 },
          { kind: "fee", zat: 10 },
        ],
      },
      {
        txid: batch,
        exchange: "kraken",
        direction: "in",
        zat: 480,
        parts: [{ kind: "exchange", exchange: "binance", zat: 480 }],
      },
      { txid: sweep, exchange: "binance", direction: "internal", zat: 1, parts: [] },
    ]);
  });

  it("reclassifies every stored transaction when the classifier changes, and only the new one reads", async () => {
    await chain(400);
    const g = groupsBy({ xB: EX("binance") });
    for (let h = 10; h <= 250; h += 40) {
      await tx(h, [
        { io: "in", address: "tU", value: 100 },
        { io: "out", address: "xB", value: 90 },
      ]);
    }
    await flowTracker(["xB"], g, { version: "1" }).refresh();
    const before = await flows();
    expect(before.length).toBe(7);
    expect((await labelFlowReadiness(pool, ["xB"], g, "1"))?.caps.get("binance")).toBe(
      400 - REORG_DEPTH,
    );

    // A new classifier: reset first, then reclassified in height chunks; paused after one.
    await flowTracker(["xB"], g, { version: "2", chunkBlocks: 50, abortAfter: 1 }).refresh();
    expect(await labelFlowReadiness(pool, ["xB"], g, "1")).toBeNull();
    // Counted only as far as reclassified.
    expect((await labelFlowReadiness(pool, ["xB"], g, "2"))?.caps.get("binance")).toBe(49);

    await flowTracker(["xB"], g, { version: "2" }).refresh();
    expect((await labelFlowReadiness(pool, ["xB"], g, "2"))?.caps.get("binance")).toBe(
      400 - REORG_DEPTH,
    );
    expect(await flows()).toEqual(before);
    expect((await pool.query("SELECT grp FROM label_flow_state")).rows).toEqual([
      { grp: "binance" },
    ]);
  });

  it("reclassifies only an address whose group changed, and counts neither group meanwhile", async () => {
    await chain(400);
    const old = groupsBy({ xA: EX("binance"), xB: EX("binance"), xK: EX("kraken") });
    const moved = await tx(10, [
      { io: "in", address: "tU", value: 100 },
      { io: "out", address: "xA", value: 90 },
    ]);
    const moved2 = await tx(11, [
      { io: "in", address: "tU", value: 60 },
      { io: "out", address: "xA", value: 50 },
    ]);
    const untouched = await tx(12, [
      { io: "in", address: "tU", value: 10 },
      { io: "out", address: "xB", value: 9 },
    ]);
    await flowTracker(["xA", "xB", "xK"], old).refresh();
    // xA turns out to be Kraken's.
    const now = groupsBy({ xA: EX("kraken"), xB: EX("binance"), xK: EX("kraken") });
    // Cut short after one transaction: marked pending, so neither Binance nor Kraken is counted.
    expect(await regroupLabelFlowAddress(pool, "xA", "kraken", now, async () => "abort", 1)).toBe(
      false,
    );
    for (const g of [old, now]) {
      const r = await labelFlowReadiness(pool, ["xA", "xB", "xK"], g, "1");
      expect(r?.caps.get("binance")).toBeNull();
      expect(r?.caps.get("kraken")).toBeNull();
    }
    await flowTracker(["xA", "xB", "xK"], now).refresh();
    expect((await flows()).map((f) => [f.txid, f.exchange])).toEqual([
      [moved, "kraken"],
      [moved2, "kraken"],
      [untouched, "binance"],
    ]);
    const r = await labelFlowReadiness(pool, ["xA", "xB", "xK"], now, "1");
    expect(r?.caps.get("kraken")).toBe(400 - REORG_DEPTH);
    expect(r?.caps.get("binance")).toBe(400 - REORG_DEPTH);
    // A reader still built with the old grouping does not count either group.
    expect(
      (await labelFlowReadiness(pool, ["xA", "xB", "xK"], old, "1"))?.caps.get("kraken"),
    ).toBeNull();
  });

  it("leaves uncounted only the group of an address not yet walked or being removed", async () => {
    await chain(400);
    const g = groupsBy({ xB: EX("binance"), xK: EX("kraken"), xK2: EX("kraken") });
    await tx(10, [{ io: "out", address: "xB", value: 5 }]);
    await flowTracker(["xB", "xK"], g).refresh();
    // xK2 newly listed, not walked yet.
    let r = await labelFlowReadiness(pool, ["xB", "xK", "xK2"], g, "1");
    expect(r?.caps.get("binance")).toBe(400 - REORG_DEPTH);
    expect(r?.caps.get("kraken")).toBeNull();
    // xK delisted while its rows remain: Kraken is uncounted until they are gone.
    r = await labelFlowReadiness(pool, ["xB"], g, "1");
    expect(r?.caps.get("binance")).toBe(400 - REORG_DEPTH);
    expect(r?.caps.get("kraken")).toBeNull();
  });

  it("reads nothing once the chain changed below the stored rows", async () => {
    await chain(400);
    const g = groupsBy({ xB: EX("binance") });
    await tx(10, [{ io: "out", address: "xB", value: 5 }]);
    await flowTracker(["xB"], g).refresh();
    await pool.query("UPDATE block SET hash = lpad('x', 64, 'x') WHERE height = $1", [
      400 - REORG_DEPTH,
    ]);
    expect(await labelFlowReadiness(pool, ["xB"], g, "1")).toBeNull();
  });

  it("flags a transaction with an input it could not resolve", async () => {
    await chain(400);
    const g = groupsBy({ xB: EX("binance") });
    await tx(10, [
      { io: "in", address: null, value: null },
      { io: "out", address: "xB", value: 5 },
    ]);
    await flowTracker(["xB"], g).refresh();
    expect((await pool.query("SELECT unresolved FROM label_flow_tx")).rows).toEqual([
      { unresolved: true },
    ]);
  });

  it("sums the flows by day and ranks the largest, in one snapshot with the caps", async () => {
    await chain(400);
    const g = groupsBy({ xB: EX("binance"), xB2: EX("binance"), xK: EX("kraken") });
    await tx(10, [
      { io: "in", address: "tU1", value: 1_000 },
      { io: "out", address: "xB", value: 990 },
    ]);
    const batch = await tx(20, [
      { io: "in", address: "xB", value: 990 },
      { io: "out", address: "tU2", value: 500 },
      { io: "out", address: "xK", value: 480 },
    ]);
    await tx(30, [
      { io: "in", address: "xB", value: 400 },
      { io: "out", address: "xB2", value: 399 },
    ]);
    const addrs = ["xB", "xB2", "xK"];
    await flowTracker(addrs, g).refresh();
    const later = BASE + 10 * 86_400;
    const a = (await loadLabelFlowAggregates(pool, addrs, later, g, "1"))!;
    const day = Math.floor(BASE / 86_400);
    expect(a.caps.get("binance")).toBe(400 - REORG_DEPTH);
    expect(a.dayLastHeight.get(day)).toBe(400);
    const byKey = (r: { exchange: string; direction: string }) => `${r.exchange}:${r.direction}`;
    expect(Object.fromEntries(a.days.map((r) => [byKey(r), [r.txs, r.zat]]))).toEqual({
      "binance:in": [1, 990],
      "binance:out": [1, 990],
      "binance:internal": [1, 1],
      "kraken:in": [1, 480],
    });
    expect(
      a.parts
        .filter((r) => r.exchange === "binance" && r.direction === "out")
        .map((r) => [r.kind, r.counterpart, r.zat])
        .sort(),
    ).toEqual([
      ["exchange", "kraken", 480],
      ["fee", null, 10],
      ["transparent", null, 500],
    ]);
    // Today has not ended: its last block is not known yet.
    const same = (await loadLabelFlowAggregates(pool, addrs, BASE + 3_600, g, "1"))!;
    expect(same.dayLastHeight.has(day)).toBe(false);

    const top = (await loadLargestLabelFlows(
      pool,
      addrs,
      { exchange: null, direction: null, fromTs: 0, toTs: Infinity, limit: 2 },
      g,
      "1",
    ))!;
    expect(top.rows.map((r) => [r.exchange, r.direction, r.zat])).toEqual([
      ["binance", "out", 990],
      ["binance", "in", 990],
    ]);
    expect(top.rows[0]!.txid).toBe(batch);
    const kraken = (await loadLargestLabelFlows(
      pool,
      addrs,
      { exchange: "kraken", direction: "in", fromTs: 0, toTs: Infinity, limit: 5 },
      g,
      "1",
    ))!;
    expect(kraken.rows.map((r) => r.zat)).toEqual([480]);
    // Another classifier version reads nothing.
    expect(await loadLabelFlowAggregates(pool, addrs, later, g, "2")).toBeNull();
  });
});

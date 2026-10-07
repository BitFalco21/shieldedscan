import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { RpcBlockHeader } from "@/data/chain/rpc-types";
import { difficultyForRow, repairDifficulty } from "../repair-difficulty";

const header = (over: Partial<RpcBlockHeader> = {}): RpcBlockHeader => ({
  hash: "a".repeat(64),
  height: 100,
  difficulty: 52_708_042.43,
  ...over,
});

const row = { height: 100, hash: "a".repeat(64) };

/**
 * The repair's only decision, and every unclear branch leaves a NULL rather than a number: a
 * repair that answered an unclear case with a plausible value would fabricate data, so refusing
 * has to be the cheap path.
 */
describe("difficultyForRow", () => {
  it("takes the node's figure when the header is the block we asked about", () => {
    expect(difficultyForRow(row, header())).toBe(52_708_042.43);
  });

  it("refuses a header for a DIFFERENT block", () => {
    // The reorg case: we hold a row's hash and the node answered about something else.
    expect(difficultyForRow(row, header({ hash: "b".repeat(64) }))).toBeNull();
  });

  it("accepts genesis's difficulty of exactly 1", () => {
    // Verified on the live node: heights 0, 1 and 2 report difficulty 1. A guard written as
    // `> 1` or `>= 2` would silently drop the first blocks of the chain.
    expect(difficultyForRow(row, header({ difficulty: 1 }))).toBe(1);
  });

  it("refuses a zero, which is the exact value this whole exercise removed", () => {
    expect(difficultyForRow(row, header({ difficulty: 0 }))).toBeNull();
  });

  it("refuses a negative", () => {
    expect(difficultyForRow(row, header({ difficulty: -5 }))).toBeNull();
  });

  it("refuses NaN and Infinity, which typeof calls numbers", () => {
    expect(difficultyForRow(row, header({ difficulty: Number.NaN }))).toBeNull();
    expect(difficultyForRow(row, header({ difficulty: Number.POSITIVE_INFINITY }))).toBeNull();
  });
});

/** An in-memory `block` table that answers the two statements the repair issues. */
function fakePool(blocks: { height: number; hash: string; difficulty: number | null }[]) {
  const updates: { height: number; difficulty: number }[] = [];
  let selects = 0;
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("REFRESH MATERIALIZED VIEW")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("SELECT height, hash")) {
        selects++;
        if (selects > 50) throw new Error("runaway loop: the repair is not making progress");
        // `$3` is present only on the bounded form of the statement, exactly as in the real
        // query — the fake has to model that or an `end` test passes without exercising it.
        const [from, limit, end] = params as [number, number, number | undefined];
        const rows = blocks
          .filter(
            (b) =>
              b.difficulty === null && b.height >= from && (end === undefined || b.height < end),
          )
          .sort((a, b) => a.height - b.height)
          .slice(0, limit)
          .map((b) => ({ height: b.height, hash: b.hash }));
        return { rows, rowCount: rows.length };
      }
      const [heights, values] = params as [number[], number[]];
      let rowCount = 0;
      heights.forEach((h, i) => {
        const b = blocks.find((x) => x.height === h);
        // Mirrors `AND b.difficulty IS NULL` in the real statement.
        if (b && b.difficulty === null) {
          b.difficulty = values[i]!;
          updates.push({ height: h, difficulty: values[i]! });
          rowCount++;
        }
      });
      return { rows: [], rowCount };
    }),
  };
  return { pool: pool as unknown as Pool, updates, blocks, selects: () => selects };
}

const hashFor = (h: number) => String(h).padStart(64, "0");

describe("repairDifficulty", () => {
  const rpc = {
    getBlockHeaderByHash: async (hash: string) => header({ hash, difficulty: 1000 + Number(hash) }),
  };
  const log = () => {};

  it("fills every hole and leaves populated rows untouched", async () => {
    const already = 42_000;
    const f = fakePool([
      { height: 1, hash: hashFor(1), difficulty: null },
      { height: 2, hash: hashFor(2), difficulty: already },
      { height: 3, hash: hashFor(3), difficulty: null },
    ]);
    const out = await repairDifficulty({ pool: f.pool, rpc, log, batch: 2 });

    expect(out.written).toBe(2);
    expect(f.blocks.find((b) => b.height === 2)?.difficulty).toBe(already);
    expect(f.blocks.find((b) => b.height === 1)?.difficulty).toBe(1001);
    expect(f.blocks.find((b) => b.height === 3)?.difficulty).toBe(1003);
  });

  it("TERMINATES when a row can never be filled", async () => {
    // The hazard that shaped the query: an unfillable row keeps `difficulty IS NULL`, so a
    // loop selecting on that predicate alone re-reads it forever. Without the low-water mark
    // this test hangs until the fake pool's runaway guard fires.
    const dead = {
      getBlockHeaderByHash: async () => {
        throw new Error("-5 block height not in best chain");
      },
    };
    const f = fakePool([
      { height: 1, hash: hashFor(1), difficulty: null },
      { height: 2, hash: hashFor(2), difficulty: null },
    ]);
    const out = await repairDifficulty({ pool: f.pool, rpc: dead, log, batch: 1 });

    expect(out.skippedUnknownHash).toBe(2);
    expect(out.written).toBe(0);
    expect(f.blocks.every((b) => b.difficulty === null)).toBe(true);
  });

  it("counts a refused value separately from a hash the node does not know", async () => {
    // Two different failures. Collapsing them into one counter would hide "the node is
    // answering with nonsense" behind "these blocks are orphans", which are not the same
    // problem and do not have the same fix.
    const zeroes = {
      getBlockHeaderByHash: async (hash: string) => header({ hash, difficulty: 0 }),
    };
    const f = fakePool([{ height: 1, hash: hashFor(1), difficulty: null }]);
    const out = await repairDifficulty({ pool: f.pool, rpc: zeroes, log });

    expect(out.skippedBadValue).toBe(1);
    expect(out.skippedUnknownHash).toBe(0);
    expect(out.written).toBe(0);
  });

  it("refreshes the day matview so the chart changes without waiting for the follower", async () => {
    const f = fakePool([{ height: 1, hash: hashFor(1), difficulty: null }]);
    await repairDifficulty({ pool: f.pool, rpc, log });
    const sql = (f.pool.query as unknown as { mock: { calls: [string][] } }).mock.calls.map(
      ([s]) => s,
    );
    expect(sql.some((s) => s.includes("REFRESH MATERIALIZED VIEW CONCURRENTLY"))).toBe(true);
  });

  it("can be told not to refresh", async () => {
    const f = fakePool([{ height: 1, hash: hashFor(1), difficulty: null }]);
    await repairDifficulty({ pool: f.pool, rpc, log, refresh: false });
    const sql = (f.pool.query as unknown as { mock: { calls: [string][] } }).mock.calls.map(
      ([s]) => s,
    );
    expect(sql.some((s) => s.includes("REFRESH"))).toBe(false);
  });
});

describe("repairDifficulty bounded by end", () => {
  const rpc = {
    getBlockHeaderByHash: async (hash: string) => header({ hash, difficulty: 1000 + Number(hash) }),
  };
  const log = () => {};

  it("fills only below `end`, so a first run can be checked by hand", () => {
    const f = fakePool([
      { height: 1, hash: hashFor(1), difficulty: null },
      { height: 5, hash: hashFor(5), difficulty: null },
      { height: 9, hash: hashFor(9), difficulty: null },
    ]);
    return repairDifficulty({ pool: f.pool, rpc, log, end: 5, refresh: false }).then((out) => {
      expect(out.written).toBe(1);
      expect(f.blocks.find((b) => b.height === 1)?.difficulty).toBe(1001);
      // `end` is exclusive: height 5 itself is out of range, as is everything above it.
      expect(f.blocks.find((b) => b.height === 5)?.difficulty).toBeNull();
      expect(f.blocks.find((b) => b.height === 9)?.difficulty).toBeNull();
    });
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { publicValueZat } from "@/domain";
import type { Transaction } from "@/domain";
import {
  dropValueStaging,
  ensureValueStaging,
  foldValueExtremes,
  stageValueExtremes,
} from "../value-extremes";

/**
 * The transparent value range, and the two properties it stands on.
 *
 * Fold parity: chunked extrema must equal a single whole-table query, tie counts included. The
 * tie counts are the half a naive fold gets wrong: taking `min(lowest_zat)` is obvious, summing
 * the counts of only the chunks that hold it is not.
 *
 * SQL/domain parity: the SQL transcription of `publicValueZat` must agree with the domain
 * function row by row. The outputs-sum-to-zero fallback is the branch a careless transcription
 * drops, so the fixture exercises it.
 *
 * Needs a real database. Skips without TEST_DATABASE_URL, and creates its own database rather
 * than sharing the one the URL names:
 *
 *   docker run -d --name pgtest -e POSTGRES_PASSWORD=test -e POSTGRES_DB=explorer \
 *     -p 55432:5432 postgres:17
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/value-extremes.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const TEST_DB = "explorer_value_extremes_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

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

/**
 * One fixture transaction, described in the terms both sides of the parity check understand.
 *
 * `outs`/`ins` are plain zatoshi amounts, so the same row can be inserted into Postgres and
 * built into a domain `Transaction` — which is what lets the two implementations be compared
 * rather than each asserted against a hand-written expectation.
 */
interface Fixture {
  txid: string;
  height: number;
  kind: "transparent" | "mixed" | "shielded" | "coinbase";
  outs: number[];
  ins: number[];
  /** What `publicValueZat` should say, stated here only to document intent. */
  expect: number | null;
}

/**
 * Spread across heights on purpose, so chunk boundaries fall BETWEEN transactions that matter.
 *
 * The important shapes, and each is here because it can break something:
 *
 *  - a TIE at the minimum (three transactions at 1,000), across two different chunks, so the
 *    fold has to add counts from separate rows rather than take one chunk's;
 *  - a UNIQUE maximum, so the "may be named" branch is reachable;
 *  - `zero-out`, whose outputs sum to zero and whose value is therefore its INPUTS — the
 *    fallback branch;
 *  - `shielded` and `coinbase`, which must be excluded entirely, not counted as zero;
 *  - `no-value`, with neither outputs nor inputs, which must drop out rather than sort first.
 */
const FIXTURES: Fixture[] = [
  {
    txid: "a".repeat(64),
    height: 100,
    kind: "transparent",
    outs: [1_000],
    ins: [5_000],
    expect: 1_000,
  },
  { txid: "b".repeat(64), height: 150, kind: "mixed", outs: [50_000], ins: [], expect: 50_000 },
  {
    txid: "c".repeat(64),
    height: 220,
    kind: "transparent",
    outs: [1_000],
    ins: [9_000],
    expect: 1_000,
  },
  {
    txid: "d".repeat(64),
    height: 260,
    kind: "transparent",
    outs: [900_000_000],
    ins: [],
    expect: 900_000_000,
  },
  {
    txid: "e".repeat(64),
    height: 310,
    kind: "transparent",
    outs: [1_000],
    ins: [2_000],
    expect: 1_000,
  },
  // Outputs sum to zero, so the value falls back to the inputs. The branch a naive
  // transcription of `publicValueZat` drops.
  {
    txid: "f".repeat(64),
    height: 340,
    kind: "transparent",
    outs: [0],
    ins: [7_777],
    expect: 7_777,
  },
  // Excluded: no public amount exists at all.
  { txid: "1".repeat(64), height: 360, kind: "shielded", outs: [], ins: [], expect: null },
  // Excluded: creates value rather than moving it.
  {
    txid: "2".repeat(64),
    height: 380,
    kind: "coinbase",
    outs: [312_500_000],
    ins: [],
    expect: 312_500_000,
  },
  // Neither side positive — must drop out, never rank as the smallest.
  { txid: "3".repeat(64), height: 400, kind: "transparent", outs: [0], ins: [0], expect: null },
];

/** The same fixture as a domain `Transaction`, for the parity check. */
function asTransaction(f: Fixture): Transaction {
  return {
    txid: f.txid,
    blockHeight: f.height,
    timestamp: 1_700_000_000,
    isCoinbase: f.kind === "coinbase",
    transparentInputs: f.ins.map((valueZat, i) => ({
      address: `t1in${i}`,
      valueZat,
      prevTxid: null,
      prevVout: null,
    })),
    transparentOutputs: f.outs.map((valueZat, i) => ({ address: `t1out${i}`, valueZat })),
    sapling: null,
    orchard: null,
    ironwood: null,
    sprout: null,
    feeZat: 10_000,
    sizeBytes: 200,
  } as unknown as Transaction;
}

describeDb("the transparent value range", () => {
  let pool: Pool;

  beforeAll(async () => {
    const url = await createTestDatabase(DATABASE_URL as string);
    pool = new Pool({ connectionString: url });
    // The real schema, so the published table under test is the one production creates.
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await dropValueStaging(pool);
    await ensureValueStaging(pool);
    await pool.query("DELETE FROM chain_value_extremes");
    await pool.query("TRUNCATE tx_transparent_io, tx, block CASCADE");
    for (const f of FIXTURES) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, 1700000000, 1000, 1) ON CONFLICT DO NOTHING`,
        [f.height, `h${f.height}`.padEnd(64, "0"), `p${f.height}`.padEnd(64, "0")],
      );
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version)
         VALUES ($1, $2, 1700000000, $3, $4, 200, 4)`,
        [f.txid, f.height, f.kind === "coinbase", f.kind],
      );
      let ordinal = 0;
      for (const value of f.outs) {
        await pool.query(
          `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
           VALUES ($1, 'out', $2, $3, $4, $5)`,
          [f.txid, ordinal, `t1out${ordinal}`, value, f.height],
        );
        ordinal += 1;
      }
      ordinal = 0;
      for (const value of f.ins) {
        await pool.query(
          `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
           VALUES ($1, 'in', $2, $3, $4, $5)`,
          [f.txid, ordinal, `t1in${ordinal}`, value, f.height],
        );
        ordinal += 1;
      }
    }
    // A tip well above the fixtures so the reorg margin never truncates the range under test.
    await pool.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
       VALUES (1000, $1, $2, 1700000000, 1000, 0) ON CONFLICT DO NOTHING`,
      ["tip".padEnd(64, "0"), "tipprev".padEnd(64, "0")],
    );
  });

  const read = async () => {
    const { rows } = await pool.query(
      "SELECT * FROM chain_value_extremes WHERE scope = 'transaction'",
    );
    return rows[0] as
      | {
          lowest_zat: string;
          lowest_count: string;
          highest_zat: string;
          highest_count: string;
          highest_txid: string;
          highest_height: number;
          considered: string;
          covered_through_height: number;
          updated_at: number;
        }
      | undefined;
  };

  /**
   * The claim the whole design rests on. Two chunk sizes that split the fixtures differently —
   * 50 puts the three tied minima in three separate chunks, 10,000 puts them all in one — must
   * produce identical figures.
   */
  it.each([50, 137, 10_000])("folds chunks of %i into the same exact answer", async (chunk) => {
    await stageValueExtremes({ pool, chunk, adaptive: false });
    await foldValueExtremes(pool);
    const row = await read();
    expect(row).toBeDefined();
    // Minimum 1,000, shared by three transactions across (at chunk=50) three different chunks.
    expect(Number(row!.lowest_zat)).toBe(1_000);
    expect(Number(row!.lowest_count)).toBe(3);
    // Maximum unique, so it is nameable.
    expect(Number(row!.highest_zat)).toBe(900_000_000);
    expect(Number(row!.highest_count)).toBe(1);
    expect(row!.highest_txid).toBe("d".repeat(64));
    expect(row!.highest_height).toBe(260);
    // Six priced transactions: shielded, coinbase and the value-less one are all excluded.
    expect(Number(row!.considered)).toBe(6);
  });

  it("equals a single whole-table query, which is the definition", async () => {
    await stageValueExtremes({ pool, chunk: 50, adaptive: false });
    await foldValueExtremes(pool);
    const folded = await read();
    const { rows } = await pool.query<{ lo: string; hi: string; n: string; considered: string }>(
      `WITH v AS (
         SELECT t.txid,
                COALESCE(NULLIF(sum(i.value_zat) FILTER (WHERE i.io = 'out'), 0),
                         NULLIF(sum(i.value_zat) FILTER (WHERE i.io = 'in'), 0)) AS value_zat
           FROM tx t JOIN tx_transparent_io i ON i.txid = t.txid
          WHERE t.kind IN ('transparent', 'mixed')
          GROUP BY t.txid)
       SELECT min(value_zat)::text AS lo, max(value_zat)::text AS hi,
              count(*) FILTER (WHERE value_zat = (SELECT min(value_zat) FROM v))::text AS n,
              count(*)::text AS considered
         FROM v WHERE value_zat IS NOT NULL`,
    );
    const oracle = rows[0]!;
    expect(folded!.lowest_zat).toBe(oracle.lo);
    expect(folded!.highest_zat).toBe(oracle.hi);
    expect(folded!.lowest_count).toBe(oracle.n);
    expect(folded!.considered).toBe(oracle.considered);
  });

  /**
   * The SQL is a copy of `publicValueZat`, so it is checked against the function rather than
   * against a number someone typed. A shielded transaction is null on both sides; the
   * outputs-zero row falls back to its inputs on both sides.
   */
  it("agrees with publicValueZat row by row, fallback included", async () => {
    const { rows } = await pool.query<{ txid: string; value_zat: string | null }>(
      `SELECT t.txid,
              COALESCE(NULLIF(sum(i.value_zat) FILTER (WHERE i.io = 'out'), 0),
                       NULLIF(sum(i.value_zat) FILTER (WHERE i.io = 'in'), 0))::text AS value_zat
         FROM tx t LEFT JOIN tx_transparent_io i ON i.txid = t.txid
        GROUP BY t.txid`,
    );
    const bySql = new Map(
      rows.map((r) => [r.txid, r.value_zat === null ? null : Number(r.value_zat)]),
    );
    let compared = 0;
    for (const f of FIXTURES) {
      // The domain function decides `shielded` from the transaction's own bundles; the SQL
      // reads the stored `kind`. Compare only where both are looking at the same question —
      // a shielded transaction is excluded by the WHERE clause in production, not by the sum.
      if (f.kind === "shielded") continue;
      expect(bySql.get(f.txid), f.txid).toBe(publicValueZat(asTransaction(f)));
      expect(bySql.get(f.txid), f.txid).toBe(f.expect);
      compared += 1;
    }
    // A silently empty loop would pass this test while proving nothing.
    expect(compared).toBe(FIXTURES.filter((f) => f.kind !== "shielded").length);
  });

  /**
   * Coverage is a correctness field. A run that stops early must record how far it reached, so
   * the route can refuse rather than publish a maximum taken over part of the chain.
   */
  it("records how far it covered, so a partial run can be refused", async () => {
    const partial = await stageValueExtremes({ pool, chunk: 50, adaptive: false, chunks: 2 });
    expect(partial.complete).toBe(false);
    await foldValueExtremes(pool);
    const row = await read();
    expect(row!.covered_through_height).toBe(partial.throughHeight);
    expect(row!.covered_through_height).toBeLessThan(partial.hTarget);
    // And the partial answer is genuinely different, which is why serving it would be wrong:
    // the real maximum is at height 260, past where two 50-block chunks reach.
    expect(Number(row!.highest_zat)).toBeLessThan(900_000_000);
  });

  /**
   * Coverage is the watermark, not the last chunk that happened to hold a transaction: a chunk
   * with no priced transaction writes no row, so `max(height_hi)` would lag the walk by however
   * long the newest stretch of chain has been quiet, and the route would never publish.
   */
  it("reports coverage as how far the WALK reached, not the last priced height", async () => {
    const done = await stageValueExtremes({ pool, chunk: 50, adaptive: false });
    await foldValueExtremes(pool);
    const row = await read();
    expect(done.complete).toBe(true);
    expect(row!.covered_through_height).toBe(done.hTarget);
    // The fixtures stop at height 400 while the target is far above it, so a coverage figure
    // taken from the chunk rows would be stuck down there.
    const { rows } = await pool.query<{ max: number }>(
      "SELECT max(height_hi) AS max FROM value_extremes_chunk",
    );
    expect(rows[0]!.max).toBeLessThan(done.hTarget);
  });

  it("resumes where it stopped and reaches the same answer as one pass", async () => {
    await stageValueExtremes({ pool, chunk: 50, adaptive: false, chunks: 2 });
    await stageValueExtremes({ pool, chunk: 50, adaptive: false });
    await foldValueExtremes(pool);
    const resumed = await read();
    expect(Number(resumed!.highest_zat)).toBe(900_000_000);
    expect(Number(resumed!.lowest_count)).toBe(3);
  });

  /**
   * The hourly top-up must combine with what is already published, never replace it; a replace
   * would silently turn the range into "the extremes of the last hour". Both directions are
   * exercised (a new block that beats the record and one that does not), since a replace passes
   * only the first.
   */
  it("tops up incrementally, combining rather than replacing", async () => {
    const { PostgresChainStore } = await import("../postgres-chain-store");
    const store = new PostgresChainStore(pool);
    await stageValueExtremes({ pool, chunk: 50, adaptive: false });
    await foldValueExtremes(pool);
    const before = await read();
    expect(Number(before!.highest_zat)).toBe(900_000_000);

    /*
     * New blocks arrive at the tip, so each addition also advances the tip past the reorg margin;
     * otherwise the new height sits below `covered_through_height` and the top-up correctly ignores
     * it. The walk owns everything it has covered; only heights above it are new work.
     */
    const add = async (height: number, txid: string, out: number) => {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, 1700000000, 1000, 1) ON CONFLICT DO NOTHING`,
        [height, `n${height}`.padEnd(64, "0"), `q${height}`.padEnd(64, "0")],
      );
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version)
         VALUES ($1, $2, 1700000000, false, 'transparent', 200, 4)`,
        [txid, height],
      );
      await pool.query(
        `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
         VALUES ($1, 'out', 0, 't1new', $2, $3)`,
        [txid, out, height],
      );
    };

    // Height 950 with the tip pushed to 1100, so the target moves to 1000 and 950 is new work.
    const bumpTip = async (height: number) =>
      pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, 1700000000, 1000, 0) ON CONFLICT DO NOTHING`,
        [height, `tip${height}`.padEnd(64, "0"), `tp${height}`.padEnd(64, "0")],
      );

    await add(950, "5".repeat(64), 4_000);
    await bumpTip(1100);
    await store.refreshValueExtremes();
    const middle = await read();
    expect(Number(middle!.highest_zat)).toBe(900_000_000);
    expect(middle!.highest_txid).toBe("d".repeat(64));
    expect(Number(middle!.considered)).toBe(7);
    expect(middle!.covered_through_height).toBeGreaterThan(before!.covered_through_height);

    // Now one that DOES beat it: the record and its identifier both move, and the tie count
    // resets to the new record's rather than accumulating the old one's.
    await add(1050, "6".repeat(64), 5_000_000_000);
    await bumpTip(1200);
    await store.refreshValueExtremes();
    const after = await read();
    expect(Number(after!.highest_zat)).toBe(5_000_000_000);
    expect(after!.highest_txid).toBe("6".repeat(64));
    expect(Number(after!.highest_count)).toBe(1);
    expect(Number(after!.considered)).toBe(8);
    // The minimum is untouched by either addition, which a replace would have destroyed.
    expect(Number(after!.lowest_zat)).toBe(1_000);
    expect(Number(after!.lowest_count)).toBe(3);
  });

  it("does not top up before the first full walk has run", async () => {
    const { PostgresChainStore } = await import("../postgres-chain-store");
    // No published row at all: the one-shot job has never run, and the top-up must not turn
    // itself into a whole-chain walk inside the follower's refresh cycle.
    await new PostgresChainStore(pool).refreshValueExtremes();
    expect(await read()).toBeUndefined();
  });

  /**
   * Re-running a chunk must be a no-op, not a double count (unlike `tx-count-backfill`, whose
   * accumulator is additive). This keeps the overwrite from becoming an increment.
   */
  it("is idempotent — a chunk applied twice changes nothing", async () => {
    await stageValueExtremes({ pool, chunk: 50, adaptive: false });
    await foldValueExtremes(pool);
    // `updated_at` records when the fold ran, so it legitimately moves; every value must not.
    const values = async () => {
      const row = await read();
      if (!row) return row;
      const { updated_at: _ranAt, ...rest } = row;
      return rest;
    };
    const once = await values();
    await pool.query("UPDATE value_extremes_state SET through_height = 0");
    await stageValueExtremes({ pool, chunk: 50, adaptive: false });
    await foldValueExtremes(pool);
    expect(await values()).toEqual(once);
  });
});

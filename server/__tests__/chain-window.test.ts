import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  bucketTotalTxs,
  parseChainWindowGroupBy,
  POOL_TX_COUNT_MAX_BLOCKS,
  type ChainWindowBucket,
} from "@/domain";
import { aggregateSql, loadChainWindow } from "../chain-window";

/**
 * The windowed chain aggregate, in three layers:
 *
 *  - the grain parser and the domain helpers are pure, so they are tested directly;
 *  - the SQL's shape is pinned structurally: a weighted mean that silently became unweighted, or
 *    a `<=` where the half-open window needs `<`, is invisible in a well-formed payload;
 *  - the arithmetic is proved against a real Postgres, since a fake pool reimplementing the
 *    weighting would be testing itself.
 */

describe("parseChainWindowGroupBy", () => {
  it("accepts the three grains a chain window has", () => {
    expect(parseChainWindowGroupBy("none")).toBe("none");
    expect(parseChainWindowGroupBy("day")).toBe("day");
    expect(parseChainWindowGroupBy("month")).toBe("month");
  });

  it("degrades anything else to the whole-window totals", () => {
    // Unrecognised means the widest honest answer, never an error — and never a value that
    // reaches SQL. A caller that needs to know its grain survived reads the echo.
    expect(parseChainWindowGroupBy(undefined)).toBe("none");
    expect(parseChainWindowGroupBy("")).toBe("none");
    expect(parseChainWindowGroupBy("week")).toBe("none");
    // A cross-chain axis names no column here, which is why the two parsers are separate.
    expect(parseChainWindowGroupBy("chain")).toBe("none");
    expect(parseChainWindowGroupBy("venue")).toBe("none");
  });
});

const bucket = (over: Partial<ChainWindowBucket> = {}): ChainWindowBucket => ({
  timestamp: 1_782_000_000,
  daysCovered: 1,
  transparentTxs: 10,
  mixedTxs: 4,
  shieldedTxs: 6,
  shieldingTxs: 3,
  unshieldingTxs: 1,
  indeterminateTxs: 0,
  blocks: 1_100,
  shieldedZat: 900_000_000,
  unshieldedZat: 400_000_000,
  feeZat: 22_000_000,
  blocksCovered: 1_100,
  avgDifficulty: 60_000_000,
  avgBlockBytes: 4_000,
  ...over,
});

describe("the bucket helpers", () => {
  it("totals only non-coinbase transactions, as every count here does", () => {
    expect(bucketTotalTxs(bucket())).toBe(20);
  });
});

describe("the aggregation SQL", () => {
  const sql = aggregateSql("day");

  it("weights each daily mean by that day's own block count", () => {
    // An unweighted AVG of daily means differs from the per-block mean whenever block production
    // varies (every difficulty adjustment), so this must never become AVG(avg_difficulty).
    expect(sql).toContain("SUM(avg_difficulty * net_blocks)");
    expect(sql).toContain("SUM(avg_block_bytes * net_blocks)");
    expect(sql).not.toMatch(/AVG\(\s*avg_difficulty\s*\)/);
    expect(sql).not.toMatch(/AVG\(\s*avg_block_bytes\s*\)/);
  });

  it("keeps the window half-open: from inclusive, to exclusive", () => {
    // `<=` would put the first instant of August inside July, double-counting a day at month
    // boundaries.
    expect(sql).toContain(">= $1::bigint");
    expect(sql).toContain("<  $2::bigint");
    expect(sql).not.toContain("<= $2::bigint");
  });

  it("takes the fee denominator and its coverage from the same matview", () => {
    // Both from `chain_day_fee_total` (COUNT(*) and COUNT(total_fee_zat)). Taking the count from
    // `chain_day_network` could let blocksCovered exceed blocks when the two views refresh at
    // different times.
    expect(sql).toContain("COALESCE(f.blocks, 0)            AS blocks");
    expect(sql).toContain("COALESCE(f.blocks_covered, 0)    AS blocks_covered");
  });

  it("joins FULL OUTER, so a day with no shielding still counts its transactions", () => {
    // The three daily matviews plus `dir`, the per-day direction counts. A day with blocks and no
    // boundary-crossing transaction must still appear with zeroes; an inner join would drop it
    // from a transaction count.
    expect(sql.match(/FULL OUTER JOIN/g)).toHaveLength(4);
  });

  it("serves no percentile — a median does not aggregate over a window", () => {
    // No window median: a seven-day median is not a function of seven daily medians, and
    // `chain_day_fee_kind` is deliberately not joined.
    expect(sql).not.toMatch(/percentile|median|p25|p75/i);
    expect(sql).not.toContain("chain_day_fee_kind");
  });

  it("differs between grains only in the bucket key", () => {
    const none = aggregateSql("none");
    const month = aggregateSql("month");
    // Asserted on the bucket key itself (`dir` aggregates per day in every grain, so a constant
    // `date_trunc('day', …)` appears regardless). Anchored backwards from `AS bucket_ts`, because
    // the first `SELECT` in the statement belongs to the `dir` CTE.
    const bucketKey = (s: string) => {
      const end = s.indexOf(" AS bucket_ts");
      return s.slice(s.lastIndexOf("SELECT ", end), end);
    };
    expect(bucketKey(month)).toContain("date_trunc('month'");
    expect(bucketKey(none)).not.toContain("date_trunc");
    // Everything after the bucket key is identical, so the totals query and the grouped query
    // are one aggregation rather than two hand-written copies.
    const tail = (s: string) => s.slice(s.indexOf("COUNT(*)::int"));
    expect(tail(none)).toBe(tail(month));
    expect(tail(aggregateSql("day"))).toBe(tail(month));
  });
});

/**
 * The mapper and the payload's shape, against a pool that returns canned rows: a NULL average
 * survives as null, an empty window is a bucket of zeroes, and the echo carries only the bounds
 * that were applied. The SUMs are proved by the integration block below.
 */
function fakePool(rows: Record<string, unknown>[], closing: Record<string, unknown>[] = []) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("top_height, sprout")) return { rows: closing };
      return { rows };
    },
  } as unknown as Pool;
  return { pool, queries };
}

const ROW = {
  bucket_ts: "0",
  days_covered: 31,
  transparent: "1000",
  mixed: "400",
  shielded: "600",
  blocks: "35000",
  shielded_zat: "900000000",
  unshielded_zat: "400000000",
  fee_zat: "22000000",
  blocks_covered: "34900",
  avg_difficulty: "60000000",
  avg_block_bytes: "4000",
  first_at: "1782000000",
  last_at: "1784592000",
};

describe("loadChainWindow", () => {
  it("echoes only the bounds it was given", async () => {
    const { pool } = fakePool([ROW]);
    const both = await loadChainWindow(pool, { fromTimestamp: 100, toTimestamp: 200 }, "none");
    expect(both.applied).toEqual({ fromTimestamp: 100, toTimestamp: 200 });

    // An absent bound is an absent key, not a null, so a caller can tell "asked for all time"
    // from "asked for a window and an older deployment ignored it".
    const neither = await loadChainWindow(pool, {}, "none");
    expect(neither.applied).toEqual({});
    expect("fromTimestamp" in neither.applied).toBe(false);
  });

  it("stamps an ungrouped bucket with the window's own start, not the first day of data", async () => {
    // The echo reports the edge the caller asked for, not the first covered day.
    const { pool } = fakePool([ROW]);
    const result = await loadChainWindow(pool, { fromTimestamp: 1_700_000_000 }, "none");
    expect(result.totals.timestamp).toBe(1_700_000_000);
    expect(result.firstAt).toBe(1_782_000_000);
  });

  it("keeps a NULL average null — Number(null) is 0, which is a difficulty proof-of-work cannot take", async () => {
    const { pool } = fakePool([{ ...ROW, avg_difficulty: null, avg_block_bytes: null }]);
    const result = await loadChainWindow(pool, {}, "none");
    expect(result.totals.avgDifficulty).toBeNull();
    expect(result.totals.avgBlockBytes).toBeNull();
  });

  it("reports an empty window as zeroes with null averages, never as no data", async () => {
    // No row for an empty window is a measurement (nothing happened), distinct from a failed
    // read.
    const { pool } = fakePool([]);
    const result = await loadChainWindow(pool, { fromTimestamp: 4_000_000_000 }, "none");
    expect(result.totals.blocks).toBe(0);
    expect(bucketTotalTxs(result.totals)).toBe(0);
    expect(result.totals.avgDifficulty).toBeNull();
    expect(result.firstAt).toBeNull();
    expect(result.lastAt).toBeNull();
    expect(result.closingPools).toBeNull();
  });

  it("does not look up closing pool balances for a window with no days in it", async () => {
    const { pool, queries } = fakePool([]);
    await loadChainWindow(pool, { fromTimestamp: 4_000_000_000 }, "none");
    expect(queries.some((q) => q.sql.includes("top_height"))).toBe(false);
  });

  it("returns no groups when the grain is none, and runs one query for the totals", async () => {
    const { pool, queries } = fakePool([ROW]);
    const result = await loadChainWindow(pool, {}, "none");
    expect(result.groups).toEqual([]);
    expect(result.groupBy).toBe("none");
    // The aggregation runs once; the second query is the closing-pool lookup.
    expect(queries.filter((q) => q.sql.includes("COUNT(*)::int"))).toHaveLength(1);
  });

  it("runs the totals SEPARATELY from the groups rather than folding them", async () => {
    // Folding in TypeScript would re-implement the block-weighted mean beside a plain count and
    // a plain sum.
    const { pool, queries } = fakePool([{ ...ROW, bucket_ts: "1782000000" }]);
    const result = await loadChainWindow(pool, {}, "month");
    expect(result.groups).toHaveLength(1);
    expect(queries.filter((q) => q.sql.includes("COUNT(*)::int"))).toHaveLength(2);
  });
});

/**
 * The arithmetic, against a real Postgres. The four daily matviews are created as plain tables
 * under their production names, so the weighted mean, the half-open edges and the month-grouping
 * reconciliation are proved by execution.
 *
 * Skips without TEST_DATABASE_URL. A throwaway is enough:
 *
 *   docker run --rm -e POSTGRES_PASSWORD=x -p 15433:5432 -d postgres:16
 *   TEST_DATABASE_URL=postgres://postgres:x@localhost:15433/postgres \
 *     npx vitest run server/__tests__/chain-window.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const DAY = 86_400;
/** 2026-07-01T00:00:00Z — a month start, so the grouping has a real boundary to respect. */
const JULY_1 = Math.floor(Date.parse("2026-07-01T00:00:00Z") / 1000);
const AUGUST_1 = Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000);

/**
 * Its own database: other suites apply `schema-chain.sql` to the shared one, which creates these
 * four names as materialized views and makes the `DROP TABLE` below fail.
 */
const TEST_DB = "explorer_chain_window_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

describeDb("loadChainWindow against Postgres", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    await pool.query(`
      DROP TABLE IF EXISTS chain_day_rollup, chain_day_shielding_flow,
                           chain_day_fee_total, chain_day_network;
      CREATE TABLE chain_day_rollup (
        ts bigint PRIMARY KEY, top_height int, transparent int, mixed int, shielded int,
        sprout bigint, sapling bigint, orchard bigint, ironwood bigint);
      CREATE TABLE chain_day_shielding_flow (
        ts bigint PRIMARY KEY, shielded_zat bigint, unshielded_zat bigint);
      CREATE TABLE chain_day_fee_total (
        ts bigint PRIMARY KEY, fee_zat bigint, blocks int, blocks_covered int);
      CREATE TABLE chain_day_network (
        ts bigint PRIMARY KEY, avg_difficulty numeric, avg_block_bytes numeric, blocks int);
      -- block and tx for the per-pool counts, which are the one thing here that reads real
      -- tables rather than a daily matview. Only the columns the count touches.
      DROP TABLE IF EXISTS block, tx;
      CREATE TABLE block (height int PRIMARY KEY, timestamp bigint);
      CREATE TABLE boundary_daily (
        day date PRIMARY KEY, shielding_txs bigint, unshielding_txs bigint,
        indeterminate_txs bigint, migration_txs bigint);
      -- Present and EMPTY: the window's height range reads its per-day bounds and, finding no
      -- settled day, falls back to the exact scan these tests were written against.
      CREATE TABLE mining_day (
        day date PRIMARY KEY, blocks int, unrecorded_blocks int, computed_at bigint,
        first_height int, last_height int);
      CREATE INDEX block_timestamp_idx ON block (timestamp DESC);
      CREATE TABLE tx (
        txid text PRIMARY KEY, block_height int, timestamp bigint, kind text, direction text,
        sprout_joinsplits int, sapling_spends int, sapling_outputs int,
        orchard_actions int, ironwood_actions int,
        -- The four published pool value balances. A crossing's magnitude is their absolute sum,
        -- which is what a value floor compares against.
        ironwood_value_balance_zat bigint, orchard_value_balance_zat bigint,
        sapling_value_balance_zat bigint, sprout_vpub_net_zat bigint);
      CREATE INDEX tx_block_idx ON tx (block_height DESC);
      CREATE INDEX tx_direction_keyset_idx
        ON tx (direction, timestamp DESC, txid DESC) WHERE kind = 'mixed';
      -- The price tables live in the API's own schema, not the chain schema, and USD is always a
      -- READ-TIME join on the day. Same database, so the join is real here too.
      DROP TABLE IF EXISTS zec_price_daily, fx_rate_daily;
      CREATE TABLE zec_price_daily (day date PRIMARY KEY, usd double precision);
      CREATE TABLE fx_rate_daily (day date, currency text, rate double precision);
      -- The migration matview's name as a plain table, with its own column shape — the queries
      -- under test only read it, so a table is the honest stand-in (the pool-series precedent).
      DROP TABLE IF EXISTS chain_day_pool_migration;
      CREATE TABLE chain_day_pool_migration (
        day date, destination text, source text, txs bigint, zat bigint);
    `);

    // Three days in July and one in August. Block counts (100 and 900) and difficulties (10 and
    // 110) are chosen so the weighted mean (100) and the unweighted mean of daily means (~43) are
    // far apart.
    //
    // One statement per query: Postgres refuses multiple commands in a prepared statement.
    const days = [JULY_1, JULY_1 + DAY, JULY_1 + 2 * DAY, AUGUST_1];
    await pool.query(
      `INSERT INTO chain_day_rollup VALUES
         ($1, 1000, 10, 4, 6, 1, 2, 3, 4),
         ($2, 2000, 20, 5, 7, 1, 2, 3, 5),
         ($3, 3000, 30, 6, 8, 1, 2, 3, 6),
         ($4, 4000, 40, 7, 9, 1, 2, 3, 7)`,
      days,
    );
    // No row for July 2nd: a day on which nothing crossed the shielded boundary, which is what
    // the FULL OUTER JOIN exists for.
    await pool.query(
      `INSERT INTO chain_day_shielding_flow VALUES ($1, 100, 40), ($2, 300, 60), ($3, 400, 70)`,
      [days[0], days[2], days[3]],
    );
    await pool.query(
      `INSERT INTO chain_day_fee_total VALUES
         ($1, 1000, 100, 100),
         ($2, 2000, 900, 850),
         ($3, 3000, 100, 100),
         ($4, 4000, 500, 500)`,
      days,
    );
    await pool.query(
      `INSERT INTO chain_day_network VALUES
         ($1, 10,  1000, 100),
         ($2, 110, 5000, 900),
         ($3, 10,  1000, 100),
         ($4, 50,  2000, 500)`,
      days,
    );

    /*
     * Mixed transactions with the direction they crossed the boundary in, which the daily matviews
     * cannot supply (`chain_day_rollup` counts `mixed` as one bucket).
     *
     * The per-day totals (4 / 5 / 6 / 7) equal the `mixed` counts inserted above, the invariant the
     * payload rests on: the three directions partition `mixedTxs`.
     *
     * July 1 is shielding-heavy and July 2 unshielding-heavy, so the busiest day differs by
     * direction and a ranking on the wrong column lands on a different day. July 3 carries
     * `indeterminate` rows, which belong to neither direction and would inflate both if folded in.
     *
     * Each row also carries a magnitude: the g'th row of a group crosses g × 1,000 ZEC, so a floor
     * can fall between two rows of one day and direction and an off-by-one can fail. The sign
     * follows the direction (entering the pools is positive). `indeterminate` rows get two pools
     * moving opposite ways, so their magnitude is 0 and a bug letting them past the direction
     * filter shows up as a count.
     */
    const mixedTx = (day: number, n: number, direction: string) =>
      pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, kind, direction,
                         sapling_value_balance_zat, orchard_value_balance_zat)
           SELECT $1 || g, 1, $2, 'mixed', $3,
                  CASE $3 WHEN 'shielding'   THEN  g * 100000000000::bigint
                          WHEN 'unshielding' THEN -g * 100000000000::bigint
                          ELSE -g * 100000000000::bigint END,
                  CASE $3 WHEN 'indeterminate' THEN g * 100000000000::bigint ELSE 0 END
             FROM generate_series(1, $4) g`,
        [`m${day}${direction}`, days[day], direction, n],
      );
    await mixedTx(0, 3, "shielding");
    await mixedTx(0, 1, "unshielding");
    await mixedTx(1, 1, "shielding");
    await mixedTx(1, 4, "unshielding");
    await mixedTx(2, 2, "shielding");
    await mixedTx(2, 2, "unshielding");
    await mixedTx(2, 2, "indeterminate");
    await mixedTx(3, 4, "shielding");
    await mixedTx(3, 3, "unshielding");

    /*
     * ZEC closed at $100 on July 1st and 2nd, so a dollar floor is a floor in thousands of ZEC.
     *
     * July 3rd has no row: a day the chain covers and the price series does not. A currency floor
     * must exclude its crossings (reporting so through `pricedCrossings`); a ZEC floor must count
     * them. That missing row is what tells the two apart.
     *
     * The euro rate is half a dollar on the priced days, so the same crossings clear a different
     * set of euro floors, proving the FX leg of the join binds.
     */
    await pool.query(
      `INSERT INTO zec_price_daily VALUES (to_timestamp($1)::date, 100), (to_timestamp($2)::date, 100), (to_timestamp($3)::date, 100)`,
      [days[0], days[1], days[3]],
    );
    await pool.query(
      `INSERT INTO fx_rate_daily VALUES (to_timestamp($1)::date, 'eur', 0.5), (to_timestamp($2)::date, 'eur', 0.5)`,
      [days[0], days[1]],
    );

    /*
     * Migration rows for the per-day split:
     *
     *  - July 1 and July 3 carry the Orchard→Ironwood pair with different counts (2 and 5), so a
     *    split that summed or mixed buckets cannot pass;
     *  - July 2 is a covered day with rows for other pairs only, so the filtered pair must read an
     *    empty list there (a measurement), never an absent key;
     *  - August 1 carries the same pair, so a July window that included it over-counts;
     *  - July 3 has no stored close, so pricing must cover July 1's 2 transactions only and say so
     *    through pricedTxCount.
     */
    await pool.query(
      `INSERT INTO chain_day_pool_migration VALUES
         (to_timestamp($1)::date, 'ironwood', 'orchard', 2, 20000000000),
         (to_timestamp($1)::date, 'orchard',  'sapling', 1,  5000000000),
         (to_timestamp($2)::date, 'orchard',  'sapling', 3, 15000000000),
         (to_timestamp($3)::date, 'ironwood', 'orchard', 5, 50000000000),
         (to_timestamp($3)::date, 'ironwood', 'multi',   1, 10000000000),
         (to_timestamp($4)::date, 'ironwood', 'orchard', 7, 70000000000)`,
      days,
    );
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS chain_day_rollup, chain_day_shielding_flow,
                                          chain_day_fee_total, chain_day_network, block, tx,
                                          zec_price_daily, fx_rate_daily,
                                          chain_day_pool_migration;`);
    await pool.end();
  });

  it("excludes the day the window ends on — the bound is exclusive", async () => {
    const july = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 },
      "none",
    );
    expect(july.totals.daysCovered).toBe(3);
    expect(july.totals.transparentTxs).toBe(60);
    expect(july.lastAt).toBe(JULY_1 + 2 * DAY);
    // August's row is on the boundary itself and must be absent from July entirely.
    expect(july.totals.blocks).toBe(1_100);
  });

  it("weights the difficulty mean by block count, matching a scan of every block", async () => {
    const july = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 },
      "none",
    );
    // Written as the formula: (10×100 + 110×900 + 10×100) / 1,100.
    const weighted = (10 * 100 + 110 * 900 + 10 * 100) / 1_100;
    expect(Number(july.totals.avgDifficulty)).toBeCloseTo(weighted, 6);
    expect(Number(july.totals.avgBlockBytes)).toBeCloseTo(
      (1000 * 100 + 5000 * 900 + 1000 * 100) / 1_100,
      6,
    );

    // The unweighted mean of the same daily means is a different number, so a query that dropped
    // the weight could not pass the line above.
    const unweighted = (10 + 110 + 10) / 3;
    expect(Number(july.totals.avgDifficulty)).not.toBeCloseTo(unweighted, 1);
  });

  /**
   * Direction counts, and the value floor on them.
   *
   * The fixture's magnitudes are g × 1,000 ZEC at $100, so July 1 shields $100k/$200k/$300k and
   * July 2 unshields $100k/$200k/$300k/$400k. Expectations are written as the rows they select
   * rather than as bare totals.
   */
  const july = { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 };

  it("omits the floor fields entirely when no floor was asked for", async () => {
    // Absent, not zero: a zero would state that no crossing cleared a threshold nobody set.
    const plain = await loadChainWindow(pool, july, "none");
    expect(plain.totals.shieldingTxsOverFloor).toBeUndefined();
    expect(plain.totals.unshieldingTxsOverFloor).toBeUndefined();
    expect(plain.totals.consideredCrossings).toBeUndefined();
    expect(plain.applied.minCrossingZat).toBeUndefined();
  });

  it("counts crossings at or above a ZEC floor, on every day including unpriced ones", async () => {
    // 1,500 ZEC falls BETWEEN the fixture's magnitudes, so it takes part of each group:
    // shielding 2,000 + 3,000 on July 1 and 2,000 on July 3; unshielding 2,000/3,000/4,000 on
    // July 2 and 2,000 on July 3. July 3 has no stored close and is counted anyway — a ZEC
    // floor involves no price.
    const w = await loadChainWindow(pool, { ...july, minCrossingZat: 1_500 * 1e8 }, "none");
    expect(w.totals.shieldingTxsOverFloor).toBe(3);
    expect(w.totals.unshieldingTxsOverFloor).toBe(4);
    // Everything is measurable against a ZEC floor, so the counts are exact rather than a floor.
    expect(w.totals.pricedCrossings).toBe(w.totals.consideredCrossings);
    // The two `indeterminate` crossings are NOT considered: their pools moved opposite ways, so
    // they have no single amount. 15 mixed transactions in July, 13 of them crossings.
    expect(w.totals.consideredCrossings).toBe(13);
    expect(w.totals.mixedTxs).toBe(15);
    // The unthresholded counts are untouched beside them.
    expect(w.totals.shieldingTxs).toBe(6);
    expect(w.totals.unshieldingTxs).toBe(7);
    expect(w.applied.minCrossingZat).toBe(1_500 * 1e8);
  });

  it("is inclusive at the floor itself", async () => {
    // "Worth more than" is at-or-above. At exactly 3,000 ZEC only July 1's largest shielding
    // crossing qualifies; a hair above it, none does.
    const at = await loadChainWindow(pool, { ...july, minCrossingZat: 3_000 * 1e8 }, "none");
    expect(at.totals.shieldingTxsOverFloor).toBe(1);
    const above = await loadChainWindow(pool, { ...july, minCrossingZat: 3_000 * 1e8 + 1 }, "none");
    expect(above.totals.shieldingTxsOverFloor).toBe(0);
  });

  it("EXCLUDES a crossing whose day has no stored close, and says how many it could price", async () => {
    // A crossing on an unpriced day has not been measured against the floor, so it is excluded.
    // At $150k the answer differs from the ZEC floor above (3/4): July 3's two qualifying
    // crossings drop out, proving the two floors are not one code path.
    const w = await loadChainWindow(pool, { ...july, minCrossingValue: 150_000 }, "none");
    expect(w.totals.shieldingTxsOverFloor).toBe(2);
    expect(w.totals.unshieldingTxsOverFloor).toBe(3);
    // 9 of 13 crossings fell on a day with a close, so the counts are a floor and say so.
    expect(w.totals.pricedCrossings).toBe(9);
    expect(w.totals.consideredCrossings).toBe(13);
    expect(w.applied.minCrossingValue).toBe(150_000);
    expect(w.applied.crossingCurrency).toBe("usd");
  });

  it("values each crossing at its own day's rate in the requested currency", async () => {
    // The euro rate is 0.5, so a 3,000 ZEC crossing is €150,000 and the two below it are not.
    // A currency floor that ignored the FX leg would return the USD answer of 2 here.
    const w = await loadChainWindow(
      pool,
      { ...july, minCrossingValue: 150_000, crossingCurrency: "eur" },
      "none",
      "eur",
    );
    expect(w.totals.shieldingTxsOverFloor).toBe(1);
    expect(w.applied.crossingCurrency).toBe("eur");
    // July 3 is unpriced in every currency, and July 1 and 2 have a euro rate — so the coverage
    // is the same 9 of 13 and a missing FX row would show up as a smaller one.
    expect(w.totals.pricedCrossings).toBe(9);
  });

  it("reports a day that cleared nothing as a zero, not as a missing bucket", async () => {
    // Zero is a measurement; a day missing from `groups` would read as a gap. July 3 both cleared
    // nothing and is the unpriced day.
    const w = await loadChainWindow(pool, { ...july, minCrossingValue: 150_000 }, "day");
    expect(w.groups).toHaveLength(3);
    const third = w.groups[2]!;
    expect(third.timestamp).toBe(JULY_1 + 2 * DAY);
    expect(third.shieldingTxsOverFloor).toBe(0);
    expect(third.unshieldingTxsOverFloor).toBe(0);
    expect(third.pricedCrossings).toBe(0);
    // It still held four crossings: the zero is about the floor, not about the day being empty.
    expect(third.consideredCrossings).toBe(4);
    // And the day buckets reconcile with the window's own totals.
    const summed = w.groups.reduce((n, b) => n + (b.shieldingTxsOverFloor ?? 0), 0);
    expect(summed).toBe(w.totals.shieldingTxsOverFloor);
  });

  it("keeps the exclusive end of the window when a floor is applied", async () => {
    // August 1st sits on the boundary with seven more crossings; bounds applied after the CTE,
    // or a `<=`, would swallow them.
    const w = await loadChainWindow(pool, { ...july, minCrossingZat: 1 }, "none");
    expect(w.totals.consideredCrossings).toBe(13);
    const withAugust = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 + DAY, minCrossingZat: 1 },
      "none",
    );
    expect(withAugust.totals.consideredCrossings).toBe(20);
  });

  it("ANDs the two floors when both are given", async () => {
    // Both bind, rather than one silently winning. $150k alone gives 2 shielding crossings;
    // adding a 3,000 ZEC floor narrows it to the one that clears both.
    const w = await loadChainWindow(
      pool,
      { ...july, minCrossingValue: 150_000, minCrossingZat: 3_000 * 1e8 },
      "none",
    );
    expect(w.totals.shieldingTxsOverFloor).toBe(1);
    expect(w.applied.minCrossingValue).toBe(150_000);
    expect(w.applied.minCrossingZat).toBe(3_000 * 1e8);
  });

  it("splits the mixed count into the two directions plus the indeterminate remainder", async () => {
    const july = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 },
      "none",
    );
    expect(july.totals.shieldingTxs).toBe(6);
    expect(july.totals.unshieldingTxs).toBe(7);
    expect(july.totals.indeterminateTxs).toBe(2);
    // The three partition `mixedTxs` exactly.
    expect(
      july.totals.shieldingTxs + july.totals.unshieldingTxs + july.totals.indeterminateTxs,
    ).toBe(july.totals.mixedTxs);
  });

  it("keeps the direction counts inside the window's own half-open bounds", async () => {
    // August 1 carries 4 shielding and 3 unshielding. A `to` on that boundary must exclude them
    // entirely, exactly as it excludes that day's matview row.
    const july = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 },
      "none",
    );
    expect(july.totals.shieldingTxs).toBe(6);
    const all = await loadChainWindow(pool, {}, "none");
    expect(all.totals.shieldingTxs).toBe(10);
    expect(all.totals.unshieldingTxs).toBe(10);
  });

  it("attributes each direction to its own day, so a ranking cannot use the wrong column", async () => {
    const july = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 },
      "day",
    );
    const shielding = july.groups.map((g) => g.shieldingTxs);
    const unshielding = july.groups.map((g) => g.unshieldingTxs);
    expect(shielding).toEqual([3, 1, 2]);
    expect(unshielding).toEqual([1, 4, 2]);
    // The busiest day differs by direction, so a query reading one column for both fails here.
    expect(shielding.indexOf(Math.max(...shielding))).not.toBe(
      unshielding.indexOf(Math.max(...unshielding)),
    );
  });

  it("reports a day with no mixed transactions as zero rather than dropping it", async () => {
    // A day the rollup has and the tx table does not still appears, with 0.
    const august = await loadChainWindow(
      pool,
      { fromTimestamp: AUGUST_1, toTimestamp: AUGUST_1 + DAY },
      "day",
    );
    expect(august.groups).toHaveLength(1);
    expect(august.groups[0]!.indeterminateTxs).toBe(0);
  });

  it("counts a day with no shielding row, because the join is FULL OUTER", async () => {
    // July 2nd has transactions and fees but no shielding-flow row; an inner join would drop it
    // from the transaction count.
    const july = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 },
      "none",
    );
    expect(july.totals.transparentTxs).toBe(60);
    expect(july.totals.shieldedZat).toBe(400);
    expect(july.totals.unshieldedZat).toBe(100);
  });

  it("carries the fee coverage below its own denominator", async () => {
    const july = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 },
      "none",
    );
    expect(july.totals.feeZat).toBe(6_000);
    expect(july.totals.blocks).toBe(1_100);
    expect(july.totals.blocksCovered).toBe(1_050);
  });

  it("groups by month with nothing double-counted at the boundary", async () => {
    const both = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 + DAY },
      "month",
    );
    expect(both.groups).toHaveLength(2);
    expect(both.groups.map((g) => g.timestamp)).toEqual([JULY_1, AUGUST_1]);
    // The grouped buckets must reconcile against the ungrouped totals exactly.
    const summed = both.groups.reduce((n, g) => n + bucketTotalTxs(g), 0);
    expect(summed).toBe(bucketTotalTxs(both.totals));
    expect(both.groups[0]!.blocks + both.groups[1]!.blocks).toBe(both.totals.blocks);
  });

  it("groups by day, one bucket per day with data", async () => {
    const july = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 },
      "day",
    );
    expect(july.groups.map((g) => g.timestamp)).toEqual([JULY_1, JULY_1 + DAY, JULY_1 + 2 * DAY]);
    expect(july.groups.every((g) => g.daysCovered === 1)).toBe(true);
  });

  it("reads the closing pool balances off the window's LAST covered day", async () => {
    const july = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1, toTimestamp: AUGUST_1 },
      "none",
    );
    // July 3rd's row, not August's and not the window's own end.
    expect(july.closingPools).toEqual({
      topHeight: 3000,
      sproutZat: 1,
      saplingZat: 2,
      orchardZat: 3,
      ironwoodZat: 6,
    });
  });

  it("answers a window with no data as zeroes, and finds no closing balances", async () => {
    const empty = await loadChainWindow(
      pool,
      { fromTimestamp: AUGUST_1 + 10 * DAY, toTimestamp: AUGUST_1 + 20 * DAY },
      "none",
    );
    expect(bucketTotalTxs(empty.totals)).toBe(0);
    expect(empty.totals.blocks).toBe(0);
    expect(empty.totals.avgDifficulty).toBeNull();
    expect(empty.firstAt).toBeNull();
    expect(empty.closingPools).toBeNull();
    expect(empty.applied.fromTimestamp).toBe(AUGUST_1 + 10 * DAY);
  });

  it("covers all of history when given no bounds", async () => {
    const all = await loadChainWindow(pool, {}, "none");
    expect(all.totals.daysCovered).toBe(4);
    expect(all.firstAt).toBe(JULY_1);
    expect(all.lastAt).toBe(AUGUST_1);
    expect(all.applied).toEqual({});
  });

  /**
   * The per-period migration split. The matrix is stored per (day, source, destination); the
   * pair filter is what bounds the payload enough to expose it per period.
   */
  describe("the migration pair filter and its per-period split", () => {
    const pair = { ...july, migrationSource: "orchard", migrationDestination: "ironwood" };

    it("narrows the window matrix to the pair and echoes the filter", async () => {
      const agg = await loadChainWindow(pool, pair, "none");
      expect(agg.applied.migrationSource).toBe("orchard");
      expect(agg.applied.migrationDestination).toBe("ironwood");
      // July 1's 2 plus July 3's 5 — August's 7 sits on the exclusive boundary and must be out.
      expect(agg.poolMigrations).toEqual([
        expect.objectContaining({
          source: "orchard",
          destination: "ironwood",
          txCount: 7,
          amountZat: 70_000_000_000,
        }),
      ]);
    });

    it("splits the pair per day, and a covered day with no match reads an EMPTY list", async () => {
      const agg = await loadChainWindow(pool, pair, "day");
      const byTs = new Map(agg.groups.map((g) => [g.timestamp, g.migrations]));
      expect(byTs.get(JULY_1)).toEqual([
        expect.objectContaining({ txCount: 2, amountZat: 20_000_000_000 }),
      ]);
      // July 2 has migration rows for other pairs, so the filtered pair's empty list is a
      // measurement.
      expect(byTs.get(JULY_1 + DAY)).toEqual([]);
      expect(byTs.get(JULY_1 + 2 * DAY)).toEqual([
        expect.objectContaining({ txCount: 5, amountZat: 50_000_000_000 }),
      ]);
      // August is outside the window entirely.
      expect(byTs.has(AUGUST_1)).toBe(false);
    });

    it("prices each day at ITS OWN close, and says what it could not price", async () => {
      const agg = await loadChainWindow(pool, pair, "day");
      const byTs = new Map(agg.groups.map((g) => [g.timestamp, g.migrations]));
      // July 1 closed at $100: 200 ZEC → $20,000, all 2 transactions priced.
      const day1 = byTs.get(JULY_1)![0]!;
      expect(day1.valueText).toBe("$20,000.00");
      expect(day1.pricedTxCount).toBe(2);
      // July 3 has NO stored close, so its cell carries the ZEC exactly and no money figure —
      // never a spot conversion and never a zero.
      const day3 = byTs.get(JULY_1 + 2 * DAY)![0]!;
      expect(day3.valueText).toBeNull();
      expect(day3.pricedTxCount).toBe(0);
      // And the window TOTAL's coverage says 2 of 7 were priced.
      const total = agg.poolMigrations![0]!;
      expect(total.pricedTxCount).toBe(2);
      expect(total.valueText).toBe("$20,000.00");
    });

    it("splits per month on the month grain, keyed at the month's own start", async () => {
      const agg = await loadChainWindow(pool, { ...pair, toTimestamp: AUGUST_1 + DAY }, "month");
      const byTs = new Map(agg.groups.map((g) => [g.timestamp, g.migrations]));
      expect(byTs.get(JULY_1)![0]).toEqual(expect.objectContaining({ txCount: 7 }));
      expect(byTs.get(AUGUST_1)![0]).toEqual(expect.objectContaining({ txCount: 7 }));
    });

    it("filters on ONE side alone, keeping every source into the destination", async () => {
      const agg = await loadChainWindow(pool, { ...july, migrationDestination: "ironwood" }, "day");
      const day3 = agg.groups.find((g) => g.timestamp === JULY_1 + 2 * DAY)!;
      // Orchard's 5 and the multi-source 1, as separate cells — never folded into one figure.
      expect(day3.migrations!.map((c) => c.source).sort()).toEqual(["multi", "orchard"]);
      expect(agg.applied.migrationSource).toBeUndefined();
    });

    it("attaches NOTHING to an unfiltered grouped window — the filter is the payload bound", async () => {
      const agg = await loadChainWindow(pool, july, "day");
      for (const g of agg.groups) expect(g.migrations).toBeUndefined();
      // And the unfiltered matrix stays whole.
      const totalTxs = agg.poolMigrations!.reduce((n, c) => n + c.txCount, 0);
      expect(totalTxs).toBe(2 + 1 + 3 + 5 + 1);
    });
  });
});

/**
 * Per-pool transaction counts, against a real Postgres. Every property worth asserting is a
 * property of the SQL (which predicate counts a Sapling shielding transaction, half-open height
 * edges, overlapping counts), so a fake would test an idea of the query rather than the query.
 */
describeDb("per-pool transaction counts", () => {
  let pool: Pool;
  const POOL_DB = "explorer_pool_counts_test";
  // 1,000 blocks a day, so a window's block span is easy to reason about against the cap.
  const H = (day: number, n: number) => day * 1000 + n;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${POOL_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${POOL_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, POOL_DB) });
    await pool.query(`
      CREATE TABLE chain_day_rollup (
        ts bigint PRIMARY KEY, top_height int, transparent int, mixed int, shielded int,
        sprout bigint, sapling bigint, orchard bigint, ironwood bigint);
      CREATE TABLE chain_day_shielding_flow (
        ts bigint PRIMARY KEY, shielded_zat bigint, unshielded_zat bigint);
      CREATE TABLE chain_day_fee_total (
        ts bigint PRIMARY KEY, fee_zat bigint, blocks int, blocks_covered int);
      CREATE TABLE chain_day_network (
        ts bigint PRIMARY KEY, avg_difficulty numeric, avg_block_bytes numeric, blocks int);
      CREATE TABLE block (height int PRIMARY KEY, timestamp bigint);
      CREATE TABLE boundary_daily (
        day date PRIMARY KEY, shielding_txs bigint, unshielding_txs bigint,
        indeterminate_txs bigint, migration_txs bigint);
      -- Present and EMPTY: the window's height range reads its per-day bounds and, finding no
      -- settled day, falls back to the exact scan these tests were written against.
      CREATE TABLE mining_day (
        day date PRIMARY KEY, blocks int, unrecorded_blocks int, computed_at bigint,
        first_height int, last_height int);
      CREATE INDEX block_timestamp_idx ON block (timestamp DESC);
      CREATE TABLE tx (
        txid text PRIMARY KEY, block_height int, timestamp bigint, kind text, direction text,
        sprout_joinsplits int, sapling_spends int, sapling_outputs int,
        orchard_actions int, ironwood_actions int);
      CREATE INDEX tx_block_idx ON tx (block_height DESC);
      CREATE INDEX tx_direction_keyset_idx
        ON tx (direction, timestamp DESC, txid DESC) WHERE kind = 'mixed';
      -- Present and EMPTY: a window over the cap ROUTES to this day matview
      -- rather than refusing, and an empty one degrades to the honest "window-too-wide" — which
      -- is what the over-cap test below asserts. Without the table that path threw outright.
      CREATE TABLE chain_day_pool_tx (
        day date, pool text, txs bigint, value_in_zat bigint, value_out_zat bigint);
    `);
    // Three days of blocks. Day 0 is the day under test; days -1 and +1 exist so a transaction
    // just outside EACH edge can prove the boundary rather than only the count.
    for (const d of [-1, 0, 1]) {
      await pool.query(
        `INSERT INTO block (height, timestamp)
           SELECT $1 + g, $2 + g * 60 FROM generate_series(0, 99) g`,
        [H(d + 1, 0), JULY_1 + d * DAY],
      );
    }
    const tx = (
      txid: string,
      height: number,
      pools: Partial<{ sprout: number; ss: number; so: number; orchard: number; ironwood: number }>,
    ) =>
      // Columns named, not positional, so adding a column to `tx` cannot shift values into the
      // wrong column.
      pool.query(
        `INSERT INTO tx (txid, block_height, sprout_joinsplits, sapling_spends,
                         sapling_outputs, orchard_actions, ironwood_actions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          txid,
          height,
          pools.sprout ?? 0,
          pools.ss ?? 0,
          pools.so ?? 0,
          pools.orchard ?? 0,
          pools.ironwood ?? 0,
        ],
      );
    const today = H(1, 10);
    // Inside the window under test.
    await tx("orchard-only", today, { orchard: 2 });
    await tx("orchard-and-sapling", today, { orchard: 2, ss: 1 }); // the overlap that breaks summing
    await tx("sapling-shielding", today, { so: 3 }); // OUTPUTS and no spends — the predicate trap
    await tx("sprout-ancient", today, { sprout: 1 });
    await tx("ironwood", today, { ironwood: 4 });
    await tx("transparent", today, {});
    // Just outside each edge, on pools that would change a figure if an edge were wrong.
    await tx("day-before", H(0, 50), { orchard: 9 });
    await tx("day-after", H(2, 50), { orchard: 9 });
  });

  afterAll(async () => {
    await pool.end();
  });

  const oneDay = () =>
    loadChainWindow(pool, { fromTimestamp: JULY_1, toTimestamp: JULY_1 + DAY }, "none");

  it("counts each pool exactly, over the window's own blocks", async () => {
    const { poolTxCounts: c } = await oneDay();
    expect(c).not.toBeNull();
    // orchard-only + orchard-and-sapling
    expect(c!.orchard).toBe(2);
    // orchard-and-sapling (spends) + sapling-shielding (outputs only)
    expect(c!.sapling).toBe(2);
    expect(c!.sprout).toBe(1);
    expect(c!.ironwood).toBe(1);
    expect(c!.transparentOnly).toBe(1);
  });

  it("counts a Sapling SHIELDING transaction, which has outputs and no spends", async () => {
    // Testing `sapling_spends > 0` alone would miss every shielding transaction, hence spends OR
    // outputs.
    const { poolTxCounts: c } = await oneDay();
    expect(c!.sapling).toBeGreaterThan(1);
  });

  it("produces counts that deliberately do NOT sum to the transaction total", async () => {
    // The counts overlap: six transactions in the window, and the pool counts add to more than
    // the five that carry a bundle.
    const { poolTxCounts: c } = await oneDay();
    // The exact path measures the complement, so it is a number here.
    expect(c!.transparentOnly).not.toBeNull();
    const summed = c!.sprout + c!.sapling + c!.orchard + c!.ironwood + (c!.transparentOnly ?? 0);
    expect(summed).toBe(7);
    expect(summed).not.toBe(6);
  });

  it("excludes a transaction one block outside each edge", async () => {
    // Both edge transactions carry 9 Orchard actions, so an off-by-one at either end changes
    // `orchard` rather than merely a total.
    const { poolTxCounts: c } = await oneDay();
    expect(c!.orchard).toBe(2);
    expect(c!.fromHeight).toBe(H(1, 0));
    expect(c!.toHeight).toBe(H(1, 99));
  });

  it("publishes the height range it counted over", async () => {
    // The one step of the query a reader cannot check from the totals.
    const { poolTxCounts: c } = await oneDay();
    expect(c!.toHeight - c!.fromHeight + 1).toBe(100);
  });

  it("refuses a window wider than the cap, and says it was OURS", async () => {
    // A window covering more blocks than the exact-scan cap: the reason must name the cost limit,
    // not a gap in the data.
    await pool.query(`INSERT INTO block (height, timestamp) VALUES ($1, $2)`, [
      H(1, 0) + POOL_TX_COUNT_MAX_BLOCKS + 10,
      JULY_1 + 12 * 3600,
    ]);
    const { poolTxCounts, poolTxCountsUnavailable } = await oneDay();
    expect(poolTxCounts).toBeNull();
    expect(poolTxCountsUnavailable).toBe("window-too-wide");
    await pool.query(`DELETE FROM block WHERE height = $1`, [
      H(1, 0) + POOL_TX_COUNT_MAX_BLOCKS + 10,
    ]);
  });

  it("sums day totals past the cap, and leaves transparentOnly unmeasured rather than zero", async () => {
    // The day totals hold one row per pool, so a transaction using no pool has nowhere to be
    // counted there: `transparentOnly` is unmeasured on this path, never 0.
    const far = H(1, 0) + POOL_TX_COUNT_MAX_BLOCKS + 10;
    await pool.query(`INSERT INTO block (height, timestamp) VALUES ($1, $2)`, [
      far,
      JULY_1 + 12 * 3600,
    ]);
    await pool.query(
      `INSERT INTO chain_day_pool_tx (day, pool, txs)
         VALUES ((to_timestamp($1) AT TIME ZONE 'UTC')::date, 'orchard', 42)`,
      [JULY_1],
    );
    try {
      const { poolTxCounts, poolTxCountsUnavailable } = await oneDay();
      expect(poolTxCountsUnavailable).toBeNull();
      expect(poolTxCounts?.basis).toBe("whole-days");
      expect(poolTxCounts?.orchard).toBe(42);
      expect(poolTxCounts?.transparentOnly).toBeNull();
    } finally {
      await pool.query(`DELETE FROM chain_day_pool_tx`);
      await pool.query(`DELETE FROM block WHERE height = $1`, [far]);
    }
  });

  it("distinguishes a window with no blocks from one too wide to count", async () => {
    // A measurement, not a limit of ours.
    const { poolTxCounts, poolTxCountsUnavailable } = await loadChainWindow(
      pool,
      { fromTimestamp: JULY_1 - 400 * DAY, toTimestamp: JULY_1 - 399 * DAY },
      "none",
    );
    expect(poolTxCounts).toBeNull();
    expect(poolTxCountsUnavailable).toBe("no-blocks");
  });

  it("answers an open-ended window over the whole chain instead of refusing it", async () => {
    // An all-history count is answered from the day matview; the edges are the chain's own first
    // and last blocks.
    const { poolTxCounts, poolTxCountsUnavailable } = await loadChainWindow(pool, {}, "none");
    const { rows } = await pool.query<{ lo: number; hi: number }>(
      "SELECT min(height) AS lo, max(height) AS hi FROM block",
    );
    expect(poolTxCountsUnavailable).toBeNull();
    expect(poolTxCounts?.fromHeight).toBe(rows[0]!.lo);
    expect(poolTxCounts?.toHeight).toBe(rows[0]!.hi);
  });
});

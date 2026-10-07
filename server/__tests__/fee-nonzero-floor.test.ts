import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { readFeeExtremes, readValueExtremes } from "../analytics-routes";

/**
 * The non-zero fee floor and the "worth at the time" enrichment, over the real SQL.
 *
 *  - The floor is a separate figure from the minimum. The minimum is 0 with ties and the non-zero
 *    floor is tied too (two transactions at 1,000), so naming a "cheapest transaction" from either
 *    fails; the block floor is unique, so the two scopes must not copy each other's naming.
 *  - An unpopulated floor view costs the floor, never the range. SELECTing a never-populated
 *    matview is an error in Postgres, not an empty set; the enrichment swallows exactly that.
 *  - The at-close valuation is attached only where a close exists for the record's own day,
 *    pre-formatted with the day and source; a missing day loses the valuation, never the figure.
 *
 * Needs a real database; skips without TEST_DATABASE_URL and creates its own.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const TEST_DB = "explorer_fee_floor_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const T = (c: string) => c.repeat(64);

/** 2025-10-07 00:00 UTC — the day the seeded close belongs to. */
const PRICED_DAY_TS = 1_759_795_200;
/** A day with NO close in the price table. */
const UNPRICED_DAY_TS = 1_759_881_600;

describeDb("the non-zero fee floor and the at-close valuation", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB), max: 1 });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    // `zec_price_daily` belongs to the API's schema file; the one table is enough here.
    await pool.query(
      `CREATE TABLE zec_price_daily (
         day DATE PRIMARY KEY, usd DOUBLE PRECISION NOT NULL, source TEXT NOT NULL,
         fetched_at BIGINT NOT NULL)`,
    );
    await pool.query(
      "INSERT INTO zec_price_daily (day, usd, source, fetched_at) VALUES ('2025-10-07', 128.166, 'yahoo', 0)",
    );
    // The valuation LEFT JOINs the FX table, so it must exist (empty: a dollar valuation needs no
    // rate). Taken from the API's schema file so the two cannot drift.
    const fxTable = /CREATE TABLE IF NOT EXISTS fx_rate_daily \([\s\S]*?\n\);/.exec(
      readFileSync("server/schema.sql", "utf8"),
    );
    if (!fxTable) throw new Error("fx_rate_daily is no longer defined in server/schema.sql");
    await pool.query(fxTable[0]);

    // Heights 100/200/300/400: the fee maximum (unique, priced day), the tied floor pair, and
    // a zero-fee row. Height 400's day has NO close.
    const blocks: [number, number, number][] = [
      // [height, timestamp, total_fee_zat]
      [100, PRICED_DAY_TS, 6_000], // unique block maximum AND unique block floor... no:
      [200, PRICED_DAY_TS, 1_000],
      [300, PRICED_DAY_TS, 0],
      [400, UNPRICED_DAY_TS, 9_000], // unique block maximum, on a day with no close
    ];
    for (const [h, ts, fee] of blocks) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count, total_fee_zat)
         VALUES ($1, $2, $3, $4, 1000, 1, $5)`,
        [h, `h${h}`.padEnd(64, "0"), `p${h}`.padEnd(64, "0"), ts, fee],
      );
    }
    const txs: [string, number, number, string][] = [
      // [txid, height, fee, kind]
      [T("a"), 100, 5_000, "transparent"], // unique tx maximum, priced day
      [T("b"), 200, 1_000, "transparent"], // tied floor
      [T("c"), 200, 1_000, "transparent"], // tied floor
      [T("d"), 300, 0, "transparent"], // the true minimum
      [T("e"), 300, 0, "transparent"],
      [T("f"), 100, 7_777, "coinbase"], // must be excluded everywhere
    ];
    for (const [txid, h, fee, kind] of txs) {
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version, fee_zat)
         VALUES ($1, $2, $3, $4, $5, 200, 4, $6)`,
        [txid, h, PRICED_DAY_TS, kind === "coinbase", kind, fee],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("costs the floor and never the range while the floor view is unpopulated", async () => {
    await pool.query("REFRESH MATERIALIZED VIEW chain_fee_extremes");
    const extremes = await readFeeExtremes(pool);
    expect(extremes).not.toBeNull();
    expect(extremes!.transaction.highest.feeZat).toBe(5_000);
    // A never-populated matview SELECTs as an ERROR, not an empty set — swallowed as exactly
    // "no floor", with the range intact.
    expect(extremes!.transaction.lowestNonZero).toBeNull();
  });

  it("serves the floor as a distinct figure, with per-scope naming decisions", async () => {
    await pool.query("REFRESH MATERIALIZED VIEW chain_fee_nonzero_floor");
    const extremes = await readFeeExtremes(pool);
    expect(extremes).not.toBeNull();

    const tx = extremes!.transaction;
    // The true minimum stays what it is; the floor is the separate answer.
    expect(tx.lowest).toMatchObject({ feeZat: 0, count: 2, id: null });
    expect(tx.lowestNonZero).toMatchObject({ feeZat: 1_000, count: 2, id: null, height: null });
    // Coinbase excluded from the floor's population: 4 non-coinbase fee-bearing rows.
    expect(tx.considered).toBe(5);

    // The BLOCK floor is unique, so it may be named — the scope that differs on purpose.
    expect(extremes!.block.lowestNonZero).toMatchObject({ feeZat: 1_000, count: 1, id: "200" });
  });

  it("values a named record at its own day's close, source and day inside the string", async () => {
    const extremes = await readFeeExtremes(pool);
    const text = extremes!.transaction.highest.usdAtCloseText;
    expect(text).toMatch(/^≈ \$/);
    expect(text).toContain("yahoo");
    expect(text).toContain("2025-10-07");
    expect(text).toContain("not the moment's price");
    // 5,000 zat at $128.166 — the amount is sub-cent, and the formatter must not print $0.00.
    expect(text).not.toContain("$0.00 at");
  });

  it("loses the valuation, never the figure, when the record's day has no close", async () => {
    const extremes = await readFeeExtremes(pool);
    const block = extremes!.block;
    // Height 400 is the unique block maximum and its day has no stored close.
    expect(block.highest).toMatchObject({ feeZat: 9_000, count: 1, id: "400" });
    expect(block.highest.usdAtCloseText).toBeNull();
  });

  it("attaches the valuation to the value range's named maximum too", async () => {
    await pool.query(
      `INSERT INTO chain_value_extremes
              (scope, lowest_zat, lowest_count, highest_zat, highest_count,
               highest_txid, highest_height, considered, covered_through_height, updated_at)
       VALUES ('transaction', 54, 10, 900000000, 1, $1, 100, 1000, 350, 0)`,
      [T("a")],
    );
    const value = await readValueExtremes(pool);
    expect(value).not.toBeNull();
    expect(value!.highest.usdAtCloseText).toContain("2025-10-07");
    expect(value!.highest.usdAtCloseText).toContain("yahoo");
  });
});

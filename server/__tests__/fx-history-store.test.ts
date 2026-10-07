import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { upsertFxRates } from "../fx-history";

/**
 * `fx_rate_daily`'s write path, against a real database (the property is ON CONFLICT behaviour).
 * Skips without TEST_DATABASE_URL.
 *
 * The currencies are synthetic (`zz1`, `zz2`): this file shares the table with the coverage suite
 * below, and codes outside ISO 4217 cannot collide with anything the ingest writes.
 */
const url = process.env.TEST_DATABASE_URL;
const run = url ? describe : describe.skip;
// Runs only against a database already holding real chain and rate data: an empty one has
// nothing to check. Set TEST_DATABASE_HAS_REAL_DATA=1 beside TEST_DATABASE_URL to opt in.
const runWithData =
  url && process.env.TEST_DATABASE_HAS_REAL_DATA === "1" ? describe : describe.skip;

run("upsertFxRates", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query(`CREATE TABLE IF NOT EXISTS fx_rate_daily (
      day DATE NOT NULL, currency TEXT NOT NULL,
      rate DOUBLE PRECISION NOT NULL CHECK (rate > 0),
      rate_day DATE NOT NULL, source TEXT NOT NULL, fetched_at BIGINT NOT NULL,
      PRIMARY KEY (day, currency))`);
    await pool.query("DELETE FROM fx_rate_daily WHERE currency IN ('zz1','zz2')");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM fx_rate_daily WHERE currency IN ('zz1','zz2')");
    await pool.end();
  });

  it("is idempotent — a re-run refreshes rather than duplicating", async () => {
    const row = {
      day: "2020-01-02",
      currency: "zz1",
      rate: 0.89,
      rateDay: "2020-01-02",
      source: "ecb" as const,
    };
    await upsertFxRates(pool, [row]);
    await upsertFxRates(pool, [{ ...row, rate: 0.9 }]);
    const res = await pool.query<{ rate: number }>(
      "SELECT rate FROM fx_rate_daily WHERE currency = 'zz1' AND day = '2020-01-02'",
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.rate).toBe(0.9);
  });

  it("keeps one row per (day, currency), not per day", async () => {
    await upsertFxRates(pool, [
      { day: "2020-01-03", currency: "zz1", rate: 0.89, rateDay: "2020-01-03", source: "ecb" },
      { day: "2020-01-03", currency: "zz2", rate: 0.00013, rateDay: "2020-01-03", source: "yahoo" },
    ]);
    const res = await pool.query(
      "SELECT * FROM fx_rate_daily WHERE day = '2020-01-03' AND currency IN ('zz1','zz2')",
    );
    expect(res.rowCount).toBe(2);
  });

  it("writes nothing for an empty batch", async () => {
    expect(await upsertFxRates(pool, [])).toBe(0);
  });
});

/**
 * No currency may have a gap in its span. A currency quoted today can still lack years of history
 * (`isk` has no rate before 2018-02-01), so a gap is the property to test, not a row count.
 *
 * Each currency is checked against its own span: BTC comes from Yahoo and the fiats from the ECB,
 * so they can legitimately end on different days. `date - date` yields integer days in Postgres,
 * so a span with no gap has exactly `hi - lo + 1` rows.
 *
 * Requires a populated table (run `backfillFxRates` against TEST_DATABASE_URL first); skips
 * otherwise.
 */
runWithData("fx_rate_daily coverage", () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool.end();
  });

  it("has a rate for EVERY calendar day inside each currency's span", async () => {
    const res = await pool.query<{ currency: string; missing: number }>(
      `SELECT currency, (max(day) - min(day) + 1) - count(*)::int AS missing
         FROM fx_rate_daily
        GROUP BY currency
       HAVING (max(day) - min(day) + 1) <> count(*)::int
        ORDER BY currency`,
    );
    expect(res.rows).toEqual([]);
  });

  it("starts every currency on the same day, so none is short at the front", async () => {
    const res = await pool.query<{ starts: string; which: string }>(
      `SELECT starts::text AS starts, string_agg(currency, ',' ORDER BY currency) AS which
         FROM (SELECT currency, min(day) AS starts FROM fx_rate_daily GROUP BY currency) s
        GROUP BY starts ORDER BY starts`,
    );
    // One distinct start day across every currency. Two rows here means a currency joined
    // late — the isk shape, which `deriveOfferedCurrencies` is supposed to have excluded.
    expect(res.rows).toHaveLength(1);
  });
});

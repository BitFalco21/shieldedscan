import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresFxRates, resolveCurrency, USD } from "../fx-rates";

/**
 * The rate port against a real `fx_rate_daily`. `MemoryFxRates` proves the resolution rules; this
 * proves the SQL that feeds them: a `DISTINCT ON` that picks the right row per currency, and a
 * cold port that does not answer before its first refresh.
 *
 * Needs a populated table (run `backfillFxRates` against TEST_DATABASE_URL first); skips without
 * it.
 */
const url = process.env.TEST_DATABASE_URL;
// Runs only against a database already holding real chain and rate data: an empty one has
// nothing to check. Set TEST_DATABASE_HAS_REAL_DATA=1 beside TEST_DATABASE_URL to opt in.
const run = url && process.env.TEST_DATABASE_HAS_REAL_DATA === "1" ? describe : describe.skip;

run("PostgresFxRates", () => {
  let pool: Pool;
  let fx: PostgresFxRates;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    fx = new PostgresFxRates(pool);
    await fx.refresh();
  });
  afterAll(async () => {
    await pool.end();
  });

  it("offers usd plus every currency the table carries", () => {
    const offered = fx.offered();
    expect(offered).toContain(USD);
    expect(offered).toContain("eur");
    expect(offered).toContain("btc");
    // The eight excluded currencies must not appear: each has a hole in its span, and a
    // currency that answers recent questions and fails old ones is worse than one absent.
    for (const excluded of ["rub", "isk", "hrk", "bgn", "twd"]) {
      expect(offered).not.toContain(excluded);
    }
  });

  it("takes the MOST RECENT day's rate for each currency", async () => {
    const { rows } = await pool.query<{ rate: number }>(
      "SELECT rate FROM fx_rate_daily WHERE currency = 'eur' ORDER BY day DESC LIMIT 1",
    );
    expect(fx.latest("eur")).toBe(rows[0]!.rate);
  });

  it("returns a plausible euro rate, so a wrong-way-up rate cannot pass", () => {
    const eur = fx.latest("eur")!;
    // Units of EUR per one USD. Inverted it would be ~1.16, which this band excludes.
    expect(eur).toBeGreaterThan(0.5);
    expect(eur).toBeLessThan(1.0);
  });

  it("reads a specific past day, and refuses a day it has no rate for", async () => {
    // The launch weekend, carried from the Friday — the row the coverage fix restored.
    expect(await fx.on("2016-10-29", "eur")).toBeCloseTo(0.91558, 5);
    expect(await fx.on("1999-01-01", "eur")).toBeNull();
  });

  it("is USD at exactly 1 on any day, without consulting the table", async () => {
    expect(await fx.on("1999-01-01", USD)).toBe(1);
    expect(fx.latest(USD)).toBe(1);
  });

  it("resolves a real currency end to end", () => {
    const out = resolveCurrency("EUR", fx);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unreachable");
    expect(out.currency).toBe("eur");
    expect(out.rate).toBe(fx.latest("eur"));
  });

  it("refuses an excluded currency by name, against the real offered set", () => {
    const out = resolveCurrency("rub", fx);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.reason).toContain("rub");
  });

  it("a COLD port offers usd alone, so start-up refuses rather than defaulting", () => {
    // Not a detail: a default rate of 1 during boot would value everything in euro at the
    // dollar figure — a wrong number under a confident heading, where a refusal is honest.
    const cold = new PostgresFxRates(pool);
    expect(cold.offered()).toEqual([USD]);
    expect(resolveCurrency("eur", cold).ok).toBe(false);
  });
});

/**
 * The historical half: a record valued at its own day's close, converted at that day's rate. A day
 * with a close but no rate loses the conversion and never falls back to the dollar figure.
 */
run("at-close conversion", () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool.end();
  });

  it("joins the rate on the record's OWN day, not on today", async () => {
    const { rows } = await pool.query<{ own: number; today: number }>(
      `SELECT (SELECT rate FROM fx_rate_daily WHERE currency='eur' AND day='2019-05-01') AS own,
              (SELECT rate FROM fx_rate_daily WHERE currency='eur' ORDER BY day DESC LIMIT 1) AS today`,
    );
    // The two must genuinely differ, or this test could pass against an implementation that
    // used today's rate for everything.
    expect(rows[0]!.own).not.toBe(rows[0]!.today);
    expect(rows[0]!.own).toBeGreaterThan(0.5);
    expect(rows[0]!.own).toBeLessThan(1.2);
  });

  it("has a rate for every day a price close exists, so no record loses its conversion", async () => {
    // If this ever fails, the at-close path starts returning null for some records — which is
    // the honest behaviour, but it should be a known gap rather than a surprise.
    const { rows } = await pool.query<{ missing: string }>(
      `SELECT count(*)::text AS missing
         FROM zec_price_daily p
         LEFT JOIN fx_rate_daily f ON f.day = p.day AND f.currency = 'eur'
        WHERE f.rate IS NULL AND p.day >= '2016-10-29'`,
    );
    expect(Number(rows[0]!.missing)).toBe(0);
  });
});

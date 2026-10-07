import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { loadChainWindow } from "../chain-window";

/**
 * The directed migration matrix over an arbitrary window, priced day by day. The day matview
 * makes any window, including all of history, a sum over tens of thousands of rows.
 *
 * ZEC's price has moved by a factor of ten across this data, so each day must be valued at its
 * own close and its own reference rate; a single rate over a multi-year span would be wrong.
 *
 * Needs a real database with real rows, prices and fx rates (otherwise the currency assertions
 * pass vacuously on nulls). Skips without TEST_DATABASE_URL.
 */
const url = process.env.TEST_DATABASE_URL;
// Runs only against a database already holding real chain and rate data: an empty one has
// nothing to check. Set TEST_DATABASE_HAS_REAL_DATA=1 beside TEST_DATABASE_URL to opt in.
const run = url && process.env.TEST_DATABASE_HAS_REAL_DATA === "1" ? describe : describe.skip;

const WHOLE_HISTORY = { fromTimestamp: 1_477_000_000, toTimestamp: 2_000_000_000 };

run("pool migrations over an arbitrary window", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query("REFRESH MATERIALIZED VIEW chain_day_pool_migration");
  });
  afterAll(async () => {
    await pool.end();
  });

  it("returns the directed matrix, not a fixed set of buckets", async () => {
    const agg = await loadChainWindow(pool, WHOLE_HISTORY, "none");
    expect(agg.poolMigrations).not.toBeNull();
    expect(agg.poolMigrations!.length).toBeGreaterThan(1);
    for (const cell of agg.poolMigrations!) {
      // Exactly one destination is the whole definition; `multi` is a SOURCE bucket only.
      expect(cell.destination).not.toBe("multi");
      expect(["sprout", "sapling", "orchard", "ironwood"]).toContain(cell.destination);
      expect(["sprout", "sapling", "orchard", "ironwood", "multi"]).toContain(cell.source);
      // A pool never migrates into itself — that would mean the one-destination filter went.
      expect(cell.source).not.toBe(cell.destination);
    }
  });

  it("agrees with the matview it reads", async () => {
    const agg = await loadChainWindow(pool, WHOLE_HISTORY, "none");
    const { rows } = await pool.query<{ txs: string; zat: string }>(
      "SELECT SUM(txs)::bigint AS txs, SUM(zat)::bigint AS zat FROM chain_day_pool_migration",
    );
    const totalTxs = agg.poolMigrations!.reduce((n, c) => n + c.txCount, 0);
    const totalZat = agg.poolMigrations!.reduce((n, c) => n + c.amountZat, 0);
    expect(totalTxs).toBe(Number(rows[0]!.txs));
    expect(totalZat).toBe(Number(rows[0]!.zat));
  });

  it("prices in dollars by default, with the coverage count beside it", async () => {
    const agg = await loadChainWindow(pool, WHOLE_HISTORY, "none");
    const priced = agg.poolMigrations!.find((c) => c.valueText !== null)!;
    expect(priced.valueText).toMatch(/^\$/);
    // The honesty half: how many of the transactions actually had a close behind them.
    expect(priced.pricedTxCount).toBeGreaterThan(0);
    expect(priced.pricedTxCount).toBeLessThanOrEqual(priced.txCount);
  });

  it("converts each day at ITS OWN rate, not one rate over the span", async () => {
    /*
     * Asserted against an independently computed figure, not a plausible band: a ratio band wide
     * enough to be true also passes a single rate applied across the whole span. This rebuilds the
     * sum day by day from the raw rows and compares exactly.
     */
    const eur = await loadChainWindow(pool, WHOLE_HISTORY, "none", "eur");
    const { rows } = await pool.query<{
      source: string;
      destination: string;
      zat: string;
      usd: number;
      rate: number;
    }>(
      `SELECT m.source, m.destination, m.zat::text AS zat, p.usd, f.rate
         FROM chain_day_pool_migration m
         JOIN zec_price_daily p ON p.day = m.day
         JOIN fx_rate_daily  f ON f.day = m.day AND f.currency = 'eur'`,
    );
    expect(rows.length).toBeGreaterThan(0);

    const expected = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.destination}<-${r.source}`;
      expected.set(k, (expected.get(k) ?? 0) + (Number(r.zat) / 1e8) * r.usd * r.rate);
    }

    let compared = 0;
    for (const cell of eur.poolMigrations!) {
      const want = expected.get(`${cell.destination}<-${cell.source}`);
      if (want === undefined || cell.valueText === null) continue;
      expect(cell.valueText).toMatch(/^€/);
      const got = Number(cell.valueText.replace(/[^0-9.]/g, ""));
      // Formatted to 2dp, so compare at that grain. A single-rate conversion misses by orders
      // of magnitude more than a rounding step.
      expect(Math.abs(got - want)).toBeLessThan(0.02 + Math.abs(want) * 1e-9);
      compared += 1;
    }
    // Proves the loop ran: an all-null currency column would otherwise pass silently.
    expect(compared).toBeGreaterThan(0);
  });

  it("treats an OPEN window as all of history, not a refusal", async () => {
    /*
     * Unlike the per-pool count, an open window here means all of history: this reads a small day
     * matview rather than walking `tx`, and "which pools fed which, ever" should not require
     * knowing Zcash's launch date.
     */
    const open = await loadChainWindow(pool, {}, "none");
    const bounded = await loadChainWindow(pool, WHOLE_HISTORY, "none");
    expect(open.poolMigrations).not.toBeNull();
    expect(open.poolMigrations!.length).toBe(bounded.poolMigrations!.length);
    const total = (cells: { txCount: number }[]) => cells.reduce((n, c) => n + c.txCount, 0);
    expect(total(open.poolMigrations!)).toBe(total(bounded.poolMigrations!));
  });
});

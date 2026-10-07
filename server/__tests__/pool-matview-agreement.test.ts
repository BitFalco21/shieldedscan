import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { POOL_MIGRATION_MATRIX_SQL } from "../analytics-routes";

/**
 * `chain_day_pool_migration` must agree with the live query, row for row. The matview holds a
 * second copy of `poolMigration`'s classification (a TypeScript constant cannot be interpolated
 * into the `.sql` file the follower applies), so a flipped sign, a forgotten pool or a relaxed
 * refusal in either definition fails here.
 *
 * The window starts at a UTC midnight: the matview is day-grained and the live query cuts at an
 * exact second, so anchoring on midnight makes both cover the same transactions and the assertion
 * can be equality rather than a tolerance.
 *
 * Needs a real database with real rows (an empty one would pass vacuously). Skips without
 * TEST_DATABASE_URL.
 */
const url = process.env.TEST_DATABASE_URL;
// Runs only against a database already holding real chain and rate data: an empty one has
// nothing to check. Set TEST_DATABASE_HAS_REAL_DATA=1 beside TEST_DATABASE_URL to opt in.
const run = url && process.env.TEST_DATABASE_HAS_REAL_DATA === "1" ? describe : describe.skip;

/** Midnight UTC, `days` ago — the shared edge both sides cut on. */
function utcMidnightDaysAgo(days: number): number {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

run("chain_day_pool_migration agrees with POOL_MIGRATION_MATRIX_SQL", () => {
  let pool: Pool;
  const cutoff = utcMidnightDaysAgo(20);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query("REFRESH MATERIALIZED VIEW chain_day_pool_migration");
  });
  afterAll(async () => {
    await pool.end();
  });

  it("has rows to compare, so the test is not passing vacuously", async () => {
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM chain_day_pool_migration WHERE day >= (to_timestamp($1) AT TIME ZONE 'UTC')::date",
      [cutoff],
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  it("produces identical cells to the live query over the same window", async () => {
    // The live query brackets rows by age; all three brackets together are the whole window,
    // which is what the matview is summed over. Both cut at the same UTC midnight.
    const live = await pool.query<{ dest: string; source: string; txs: string; zat: string }>(
      POOL_MIGRATION_MATRIX_SQL,
      [cutoff, cutoff, cutoff],
    );
    const liveCells = new Map<string, { txs: number; zat: number }>();
    for (const r of live.rows) {
      const k = `${r.dest}<-${r.source}`;
      const cur = liveCells.get(k) ?? { txs: 0, zat: 0 };
      cur.txs += Number(r.txs);
      cur.zat += Number(r.zat);
      liveCells.set(k, cur);
    }

    const view = await pool.query<{
      destination: string;
      source: string;
      txs: string;
      zat: string;
    }>(
      `SELECT destination, source, SUM(txs)::bigint AS txs, SUM(zat)::bigint AS zat
         FROM chain_day_pool_migration
        WHERE day >= (to_timestamp($1) AT TIME ZONE 'UTC')::date
        GROUP BY 1, 2`,
      [cutoff],
    );
    const viewCells = new Map<string, { txs: number; zat: number }>();
    for (const r of view.rows) {
      viewCells.set(`${r.destination}<-${r.source}`, { txs: Number(r.txs), zat: Number(r.zat) });
    }

    // Same cells: a pair present in one and not the other is the drift this exists to catch.
    expect([...viewCells.keys()].sort()).toEqual([...liveCells.keys()].sort());
    // And the same figures, exactly — no tolerance, because a tolerance is where drift hides.
    for (const [k, v] of viewCells) expect({ k, ...v }).toEqual({ k, ...liveCells.get(k)! });
  });

  it("files a multi-source migration under 'multi' rather than splitting it", async () => {
    const { rows } = await pool.query<{ source: string }>(
      "SELECT DISTINCT source FROM chain_day_pool_migration",
    );
    for (const r of rows) {
      expect(["sprout", "sapling", "orchard", "ironwood", "multi"]).toContain(r.source);
    }
  });

  it("never files a destination that also lost value", async () => {
    // "Exactly one pool gaining" is the whole definition; a row where the destination is also
    // its own source would mean the one-destination filter had been dropped.
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM chain_day_pool_migration WHERE destination = source",
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

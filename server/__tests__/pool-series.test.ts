import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  POOL_MIGRATION_SERIES_SQL,
  POOL_USAGE_SERIES_SQL,
  toPoolMigrationPoint,
  toPoolUsagePoint,
} from "../analytics-routes";

/**
 * The two per-pool chart series, in two layers:
 *
 *  - the row mappers are pure, so they are tested directly;
 *  - the SQL is proved against a real Postgres: the per-pool pivot and the day-spine zero-fill are
 *    SQL semantics. Both matviews store rows only for (day, pool) pairs with activity, and the
 *    charts' x-axes are positional, so a missing day would silently compress time.
 *
 * Skips without TEST_DATABASE_URL. A throwaway is enough:
 *
 *   docker run --rm -e POSTGRES_PASSWORD=x -p 15433:5432 -d postgres:16
 *   TEST_DATABASE_URL=postgres://postgres:x@localhost:15433/postgres \
 *     npx vitest run server/__tests__/pool-series.test.ts
 */

describe("toPoolUsagePoint", () => {
  it("maps a pivoted row onto the domain point", () => {
    expect(
      toPoolUsagePoint({ ts: 1_700_000_000, sprout: 5, sapling: 3, orchard: 9, ironwood: 0 }),
    ).toEqual({
      timestamp: 1_700_000_000,
      sproutTxs: 5,
      saplingTxs: 3,
      orchardTxs: 9,
      ironwoodTxs: 0,
    });
  });
});

describe("toPoolMigrationPoint", () => {
  it("maps a pivoted row onto the domain point", () => {
    expect(
      toPoolMigrationPoint({
        ts: 1_700_000_000,
        sprout: 0,
        sapling: 0,
        orchard: 50,
        ironwood: 250,
      }),
    ).toEqual({
      timestamp: 1_700_000_000,
      toSproutZat: 0,
      toSaplingZat: 0,
      toOrchardZat: 50,
      toIronwoodZat: 250,
    });
  });
});

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** Its own database, like every newer integration test here — the shared one carries the real
 * matviews from `schema-chain.sql`, and `CREATE TABLE` under those names would collide. */
const TEST_DB = "explorer_pool_series_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const DAY_1 = "2026-07-01";
const DAY_2 = "2026-07-02";
const DAY_3 = "2026-07-03";
const utc = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);

describeDb("pool series SQL against Postgres", () => {
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
    // The matview names as plain tables, with the matviews' own column shapes. The queries
    // under test only read them, so a table is the honest stand-in.
    await pool.query(`
      CREATE TABLE chain_day_pool_tx (
        day date, pool text, txs bigint, value_in_zat bigint, value_out_zat bigint);
      CREATE TABLE chain_day_pool_migration (
        day date, destination text, source text, txs bigint, zat bigint);
    `);
    // Day 2 has NO rows in either table — the gap the spine exists for. Day 3's usage rows
    // deliberately sum past any plausible per-day tx total elsewhere; nothing here asserts a
    // partition, and nothing may.
    await pool.query(
      `INSERT INTO chain_day_pool_tx VALUES
         ($1, 'sprout',  5, 100, 0),
         ($1, 'sapling', 3, 200, 0),
         ($2, 'orchard', 7, 900, 100),
         ($2, 'sapling', 1, 0, 50),
         ($2, 'ironwood', 2, 300, 0)`,
      [DAY_1, DAY_3],
    );
    await pool.query(
      `INSERT INTO chain_day_pool_migration VALUES
         ($1, 'orchard',  'sapling', 1, 100),
         ($2, 'ironwood', 'orchard', 2, 250),
         ($2, 'orchard',  'multi',   1, 50)`,
      [DAY_1, DAY_3],
    );
  });
  afterAll(async () => {
    await pool.end();
  });

  it("pivots usage per pool, zero-fills the missing day, and orders ascending", async () => {
    const { rows } = await pool.query(POOL_USAGE_SERIES_SQL);
    expect(rows.map(toPoolUsagePoint)).toEqual([
      { timestamp: utc(DAY_1), sproutTxs: 5, saplingTxs: 3, orchardTxs: 0, ironwoodTxs: 0 },
      { timestamp: utc(DAY_2), sproutTxs: 0, saplingTxs: 0, orchardTxs: 0, ironwoodTxs: 0 },
      { timestamp: utc(DAY_3), sproutTxs: 0, saplingTxs: 1, orchardTxs: 7, ironwoodTxs: 2 },
    ]);
  });

  it("pivots migrated value per destination and zero-fills the quiet day", async () => {
    const { rows } = await pool.query(POOL_MIGRATION_SERIES_SQL);
    expect(rows.map(toPoolMigrationPoint)).toEqual([
      {
        timestamp: utc(DAY_1),
        toSproutZat: 0,
        toSaplingZat: 0,
        toOrchardZat: 100,
        toIronwoodZat: 0,
      },
      { timestamp: utc(DAY_2), toSproutZat: 0, toSaplingZat: 0, toOrchardZat: 0, toIronwoodZat: 0 },
      // Day 3 splits by destination: the multi-source Orchard migration stays Orchard's, and
      // the Ironwood turnstile row stays Ironwood's — never summed into one figure.
      {
        timestamp: utc(DAY_3),
        toSproutZat: 0,
        toSaplingZat: 0,
        toOrchardZat: 50,
        toIronwoodZat: 250,
      },
    ]);
  });

  it("answers an empty table with an empty series, never a fabricated spine", async () => {
    await pool.query("BEGIN");
    try {
      await pool.query("DELETE FROM chain_day_pool_tx");
      await pool.query("DELETE FROM chain_day_pool_migration");
      const usage = await pool.query(POOL_USAGE_SERIES_SQL);
      const migrations = await pool.query(POOL_MIGRATION_SERIES_SQL);
      expect(usage.rows).toEqual([]);
      expect(migrations.rows).toEqual([]);
    } finally {
      await pool.query("ROLLBACK");
    }
  });
});

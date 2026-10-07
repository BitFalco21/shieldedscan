import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { POOL_ANALYTICS_MATVIEWS, PostgresChainStore } from "../postgres-chain-store";

/**
 * The per-pool day matviews, and who is allowed to fill one, against a real database.
 *
 * The hourly timer never performs a first fill. An unpopulated matview forbids `CONCURRENTLY`, so
 * populating one takes an exclusive lock for the whole scan, in front of the follower's
 * ingestion. `refreshPoolAnalytics` (what the timer calls) refreshes only what is already
 * populated and says which views it skipped; `fillPoolAnalytics`, called only by
 * `fill-pool-analytics-main.ts`, populates behind the pacer's preflight. An unfilled view stays
 * empty and `/chain/pulse/ribbons` answers 503 visibly.
 *
 * A raised `work_mem` must be `RESET`: the connection returns to a shared pool, and a ceiling
 * left raised applies to every later query on it.
 *
 * Needs a real database; creates its own, since the shared one carries no base rows.
 *
 *   TEST_DATABASE_URL=postgres://test:test@127.0.0.1:55433/test \
 *     npx vitest run server/__tests__/pool-refresh.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

const TEST_DB = "explorer_pool_refresh_test";

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

/** 2026-03-04T12:00:00Z. One day is enough: these assertions are about WHO fills, not what. */
const TIMESTAMP = Date.UTC(2026, 2, 4, 12) / 1000;

/**
 * The minimum that makes every view non-empty enough to count.
 *
 * One block gives `chain_day_supply_close` its closing row, and one transaction carrying an
 * Orchard bundle gives `chain_day_pool_tx` its row. The migration and boundary views may
 * legitimately produce nothing from it — they are about crossings, and this seed has none — so
 * the assertions below are on the TOTAL, which is what `refreshPoolAnalytics` returns.
 */
async function seed(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count,
                        transparent_pool_zat, sprout_pool_zat, sapling_pool_zat,
                        orchard_pool_zat, ironwood_pool_zat, lockbox_pool_zat)
     VALUES (100, $1, $2, $3, 1000, 1, 1000, 10, 20, 30, 40, 50)`,
    ["a".repeat(64), "b".repeat(64), TIMESTAMP],
  );
  await pool.query(
    `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, direction,
                     version, size_bytes, fee_zat, orchard_actions, orchard_value_balance_zat)
     VALUES ($1, 100, $2, false, 'mixed', 'shielding', 5, 200, 10000, 2, 500000000)`,
    ["c".repeat(64), TIMESTAMP],
  );
}

async function populated(pool: Pool): Promise<Record<string, boolean>> {
  const { rows } = await pool.query<{ matviewname: string; ispopulated: boolean }>(
    "SELECT matviewname, ispopulated FROM pg_matviews WHERE matviewname = ANY($1::text[])",
    [[...POOL_ANALYTICS_MATVIEWS]],
  );
  return Object.fromEntries(rows.map((r) => [r.matviewname, r.ispopulated]));
}

run("the per-pool day matviews", () => {
  let pool: Pool;
  let store: PostgresChainStore;

  beforeAll(async () => {
    const url = await createTestDatabase(DATABASE_URL as string);
    pool = new Pool({ connectionString: url });
    // The real schema, so the views under test are the ones production creates — and every
    // one of them arrives `WITH NO DATA`, which is the state these assertions are about.
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    store = new PostgresChainStore(pool);
    await seed(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("covers every chain_day_pool_% view the SCHEMA defines", async () => {
    // Reads the database's own catalogue rather than comparing the constant against itself:
    // a view in the schema and not in that list is one that is created, queried, and never
    // refreshed, whose stale rows look exactly like fresh ones.
    const { rows } = await pool.query<{ matviewname: string }>(
      "SELECT matviewname FROM pg_matviews WHERE matviewname LIKE 'chain\\_day\\_pool\\_%'",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const v of rows) expect([...POOL_ANALYTICS_MATVIEWS]).toContain(v.matviewname);
  });

  it("SKIPS an unpopulated view rather than taking the first fill on the timer's clock", async () => {
    const before = await populated(pool);
    expect(Object.values(before).some(Boolean), "the fixture must start unpopulated").toBe(false);

    const logged: string[] = [];
    const result = await store.refreshPoolAnalytics((m) => logged.push(m));

    // Nothing was filled: the exclusive lock a first fill takes never happened.
    expect(await populated(pool)).toEqual(before);
    expect([...result.skipped].sort()).toEqual([...POOL_ANALYTICS_MATVIEWS].sort());
    // Zero rows because it refreshed nothing — never a count over views it could not read.
    expect(result.rows).toBe(0);
    // By NAME, because "some view is stale" is not an operator instruction.
    for (const view of POOL_ANALYTICS_MATVIEWS) {
      expect(logged.join("\n")).toContain(view);
    }
  });

  it("populates EVERY view in the list once the fill script runs, and reports the row count", async () => {
    const result = await store.fillPoolAnalytics();
    expect(result.rows).toBeGreaterThan(0);
    expect(result.skipped).toEqual([]);
    // Derived from the constant rather than a `LIKE` and a literal count, so a view added later
    // stays covered.
    const state = await populated(pool);
    expect(Object.keys(state).sort()).toEqual([...POOL_ANALYTICS_MATVIEWS].sort());
    for (const view of POOL_ANALYTICS_MATVIEWS) expect(state[view]).toBe(true);
  });

  it("refreshes on the timer once populated, and skips nothing", async () => {
    const result = await store.refreshPoolAnalytics();
    expect(result.rows).toBeGreaterThan(0);
    expect(result.skipped).toEqual([]);
    // Still populated, so every pass after the first went CONCURRENTLY — an exclusive lock
    // here would block every reader behind it.
    const state = await populated(pool);
    for (const view of POOL_ANALYTICS_MATVIEWS) expect(state[view]).toBe(true);
  });

  it("RESETS work_mem, so a pooled connection is not left raised", async () => {
    await store.refreshPoolAnalytics();
    await store.fillPoolAnalytics();
    for (let i = 0; i < 3; i += 1) {
      const { rows } = await pool.query<{ work_mem: string }>("SHOW work_mem");
      expect(rows[0]!.work_mem).not.toBe("256MB");
    }
  });
});

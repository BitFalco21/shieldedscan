// server/__tests__/social-snapshot.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { buildSnapshot } from "../social-snapshot";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const d = DATABASE_URL ? describe : describe.skip;

// The `now` every test reads against. Chosen to sit just after the tip block's own
// timestamp, matching the fixture below.
const NOW_MS = 1_788_000_500_000;
const NOW_SEC = Math.floor(NOW_MS / 1000); // 1_788_000_500
const DAY_SEC = 24 * 3600;
const WINDOW_START_SEC = NOW_SEC - DAY_SEC; // 1_787_914_100

/**
 * Its own database: this file creates `block`/`tx`/`zec_price_daily` under their production
 * names, as do other suites and the follower's schema, and in a shared database one suite's
 * minimal tables make another's `CREATE TABLE IF NOT EXISTS` silently no-op.
 */
const TEST_DB = "explorer_social_snapshot_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

d("buildSnapshot", () => {
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
      CREATE TABLE block (
        height INTEGER PRIMARY KEY, timestamp BIGINT NOT NULL,
        transparent_pool_zat BIGINT, sprout_pool_zat BIGINT, sapling_pool_zat BIGINT,
        orchard_pool_zat BIGINT, lockbox_pool_zat BIGINT, ironwood_pool_zat BIGINT);
      CREATE TABLE zec_price_daily (day DATE PRIMARY KEY, usd DOUBLE PRECISION NOT NULL, source TEXT NOT NULL);
      -- Correction 2: the columns flow24h actually reads, mirroring the tx table in
      -- server/schema-chain.sql closely enough to exercise the same query.
      CREATE TABLE tx (
        txid TEXT PRIMARY KEY,
        block_height INTEGER,
        timestamp BIGINT NOT NULL,
        kind TEXT NOT NULL,
        sapling_value_balance_zat BIGINT,
        orchard_value_balance_zat BIGINT,
        ironwood_value_balance_zat BIGINT,
        sprout_vpub_net_zat BIGINT);`);
    // Tip at height 200; an earlier block that must NOT be read as the tip.
    await pool.query(`INSERT INTO block VALUES
      (199, 1787990000, 100, 1, 2, 3, 50, 4),
      (200, 1788000000, 100, 10, 20, 30, 50, 40)`);
    await pool.query(`INSERT INTO zec_price_daily VALUES
      ('2026-08-27', 780.1, 'yahoo'), ('2026-08-28', 795.4, 'yahoo')`);

    // --- flow24h fixture ---------------------------------------------------------------
    // Each row is chosen so dropping the one filter or sign it exercises would change the
    // asserted totals.
    const RECENT_TS = NOW_SEC - 100; // well inside the trailing 24h window
    const OLD_TS = WINDOW_START_SEC - 14_100; // outside the window by several hours
    await pool.query(
      `INSERT INTO tx (txid, block_height, timestamp, kind, sapling_value_balance_zat,
                        orchard_value_balance_zat, ironwood_value_balance_zat, sprout_vpub_net_zat)
       VALUES
        -- 1. Shielding: Sapling value balance positive. net_in = 1000 -> shielded += 1000.
        ('shield1', 200, $1, 'shielded', 1000, NULL, NULL, NULL),
        -- 2. Unshielding: Orchard value balance negative. net_in = -400 -> unshielded += 400.
        ('unshield1', 200, $1, 'shielded', NULL, -400, NULL, NULL),
        -- 3. Sprout-only, sign-exercising: RPC-sign vpub_net of -300. The view SUBTRACTS
        --    this term, so net_in = 0 - (-300) = +300 -> shielded += 300. A wrongly-signed
        --    (+) version of the formula would instead read -300 and land in 'unshielded',
        --    which is exactly the six-times-recorded sign bug this fixture is built to catch.
        ('sprout1', 200, $1, 'shielded', NULL, NULL, NULL, -300),
        -- 4. Coinbase: must be EXCLUDED by kind <> 'coinbase'. A huge value balance so
        --    that failing to exclude it would blow the totals up unmissably.
        ('coinbase1', 200, $1, 'coinbase', NULL, NULL, 999999, NULL),
        -- 5. Mempool row: block_height IS NULL, must be EXCLUDED regardless of recency.
        ('mempool1', NULL, $1, 'shielded', 5000, NULL, NULL, NULL),
        -- 6. Older than 24h: must be EXCLUDED by the timestamp bound.
        ('old1', 200, $2, 'shielded', 7000, NULL, NULL, NULL)`,
      [RECENT_TS, OLD_TS],
    );
  });
  afterAll(async () => await pool.end());

  it("reads the pool balances at the TIP, not at an earlier block", async () => {
    const s = await buildSnapshot(pool, { usd: 804.63, change24hPct: 4.2 }, NOW_MS);
    expect(s.readAtHeight).toBe(200);
    expect(s.pools.find((p) => p.pool === "ironwood")?.balanceZat).toBe(40);
    expect(s.pools).toHaveLength(4);
  });

  // Circulating excludes the unspendable NU6 lockbox — the denominator the share names.
  it("excludes the lockbox from circulating supply", async () => {
    const s = await buildSnapshot(pool, { usd: 804.63, change24hPct: 4.2 }, NOW_MS);
    expect(s.circulatingSupplyZat).toBe(100 + 10 + 20 + 30 + 40);
  });

  it("carries the daily closes oldest first, for the sparkline", async () => {
    const s = await buildSnapshot(pool, { usd: 804.63, change24hPct: 4.2 }, NOW_MS);
    expect(s.recentCloses.map((c) => c.day)).toEqual(["2026-08-27", "2026-08-28"]);
  });

  // A cold PriceTracker yields null, and null must travel rather than becoming a zero.
  it("carries a null price rather than substituting one", async () => {
    const s = await buildSnapshot(pool, { usd: null, change24hPct: null }, NOW_MS);
    expect(s.priceUsd).toBeNull();
    expect(s.priceChange24hPct).toBeNull();
  });

  // The trailing-24h flow must match chain_day_shielding_flow's own
  // per_tx expression exactly — MINUS Sprout, coinbase excluded, mempool excluded, and
  // bounded to the trailing 24h.
  it("computes gross shielded/unshielded over the trailing 24h, excluding coinbase, mempool and stale rows", async () => {
    const s = await buildSnapshot(pool, { usd: 804.63, change24hPct: 4.2 }, NOW_MS);
    expect(s.flow24h).not.toBeNull();
    // shield1 (1000) + sprout1 (+300, from the negated vpub_net term) = 1300
    expect(s.flow24h?.shieldedZat).toBe(1300);
    // unshield1 only: 400
    expect(s.flow24h?.unshieldedZat).toBe(400);
  });

  // A NULL pool column must be refused, never coerced to 0 (`Number(null)` is 0). A pool the tip
  // block has no reading for is omitted from `pools`, which makes `snapshotIsComplete`'s
  // four-pool check meaningful.
  //
  // A new, higher tip block is inserted per test, so each test's buildSnapshot reads exactly the
  // row it just wrote without disturbing earlier tests.
  it("omits a pool from `pools` when its column is NULL, rather than publishing it as 0", async () => {
    await pool.query(
      `INSERT INTO block (height, timestamp, transparent_pool_zat, sprout_pool_zat,
                           sapling_pool_zat, orchard_pool_zat, lockbox_pool_zat, ironwood_pool_zat)
       VALUES (201, $1, 100, NULL, 20, 30, 50, 40)`,
      [NOW_SEC],
    );
    const s = await buildSnapshot(pool, { usd: 804.63, change24hPct: 4.2 }, NOW_MS + 1000);
    expect(s.readAtHeight).toBe(201);
    expect(s.pools.map((p) => p.pool).sort()).toEqual(["ironwood", "orchard", "sapling"]);
    expect(s.pools.find((p) => p.pool === "sprout")).toBeUndefined();
  });

  // A NULL transparent column means the balance was not read, not that it is zero; coercing it
  // would still yield a positive circulating total and a 100% shielded share.
  it("yields a null circulating supply when the transparent column is NULL", async () => {
    await pool.query(
      `INSERT INTO block (height, timestamp, transparent_pool_zat, sprout_pool_zat,
                           sapling_pool_zat, orchard_pool_zat, lockbox_pool_zat, ironwood_pool_zat)
       VALUES (202, $1, NULL, 10, 20, 30, 50, 40)`,
      [NOW_SEC],
    );
    const s = await buildSnapshot(pool, { usd: 804.63, change24hPct: 4.2 }, NOW_MS + 2000);
    expect(s.readAtHeight).toBe(202);
    expect(s.circulatingSupplyZat).toBeNull();
    // Every pool column was present, so the pools themselves are still all four —
    // only the transparent-derived figure is refused.
    expect(s.pools).toHaveLength(4);
  });

  // A bare aggregate always returns one row, even over zero transactions, so `row === undefined`
  // cannot protect this query. Zero transactions in a trailing 24h window means a stalled `tx`
  // table, not a quiet chain, so the flow is null rather than "+0.00". A `now` far past every
  // fixture puts the whole window after everything inserted.
  it("yields a null flow24h when the trailing window holds zero transactions", async () => {
    const farFutureMs = NOW_MS + 365 * DAY_SEC * 1000;
    const s = await buildSnapshot(pool, { usd: 804.63, change24hPct: 4.2 }, farFutureMs);
    expect(s.flow24h).toBeNull();
  });
});

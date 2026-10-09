import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Hono } from "hono";
import type {
  BlocksDayPoint,
  FeeSpreadSeries,
  MinerShareMonth,
  NoteTreeDayPoint,
  TransparentDayPoint,
} from "@/domain";
import {
  BLOCKS_DAILY_PATH,
  FEE_SPREAD_PATH,
  MINER_SHARES_PATH,
  NOTE_TREES_PATH,
  TRANSPARENT_DAYS_PATH,
  chartSeriesRoutes,
} from "../chart-series-routes";
import { loadReorgWeeks } from "../reorg-routes";
import { PostgresStorePort } from "../postgres-crosschain-store";

/**
 * The chart library's newer series against a real database: each query's grouping, gaps and
 * denominators are SQL semantics, which a fake pool cannot prove. Tables are created with only the
 * columns each query reads.
 *
 * Skips without TEST_DATABASE_URL:
 *
 *   docker run -d --name pg-test -e POSTGRES_PASSWORD=test -e POSTGRES_USER=test \
 *     -e POSTGRES_DB=test -p 55433:5432 postgres:17
 *   TEST_DATABASE_URL=postgres://test:test@127.0.0.1:55433/test \
 *     npx vitest run server/__tests__/chart-series-db.test.ts
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const DAY = 86_400;
/** 2026-09-01 and 2026-10-01, UTC midnight. */
const SEP = Date.UTC(2026, 8, 1) / 1000;
const OCT = Date.UTC(2026, 9, 1) / 1000;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createTestDatabase(url: string): Promise<string> {
  const name = "explorer_chart_series_test";
  const admin = new Pool({ connectionString: withDatabase(url, "postgres"), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return withDatabase(url, name);
}

describeDb("the chart library's newer series", () => {
  let pool: Pool;
  let url: string;
  let app: Hono;
  const get = async <T>(path: string) => (await (await app.request(path)).json()) as T;

  beforeAll(async () => {
    url = await createTestDatabase(DATABASE_URL!);
    pool = new Pool({ connectionString: url, max: 2 });
    for (const view of ["chain_month_fee_kind", "chain_day_fee_kind"]) {
      await pool.query(`CREATE TABLE ${view} (
        ts BIGINT, kind TEXT, median_zat BIGINT, p25_zat BIGINT, p75_zat BIGINT, txs INT)`);
    }
    await pool.query(`INSERT INTO chain_month_fee_kind VALUES
      (${SEP}, 'shielded', 10000, 10000, 15000, 900),
      (${SEP}, 'transparent', 20000, 15000, 30000, 400),
      (${OCT}, 'transparent', 21000, 15000, 31000, 410)`);

    await pool.query(`CREATE TABLE pool_usage_daily (day DATE, pool TEXT, notes_at_close BIGINT)`);
    await pool.query(`INSERT INTO pool_usage_daily VALUES
      ('2026-09-01', 'sapling', 100), ('2026-09-01', 'orchard', 50), ('2026-09-01', 'sprout', NULL),
      ('2026-09-02', 'sapling', 110), ('2026-09-02', 'orchard', 55), ('2026-09-02', 'ironwood', 3)`);

    await pool.query(`CREATE TABLE transparent_daily (
      day DATE PRIMARY KEY, active_addresses INT, out_transparent_zat BIGINT, out_mixed_zat BIGINT)`);
    await pool.query(`INSERT INTO transparent_daily VALUES
      ('2026-09-01', 40, 1000, 500), ('2026-09-03', 42, 2000, 0)`);

    await pool.query(`CREATE TABLE mining_day (day DATE PRIMARY KEY, blocks INT)`);
    await pool.query(
      `CREATE TABLE mining_day_payout (day DATE, kind TEXT, address TEXT, blocks INT)`,
    );
    await pool.query(`INSERT INTO mining_day VALUES ('2026-09-01', 600), ('2026-09-02', 400)`);
    await pool.query(`INSERT INTO mining_day_payout VALUES
      ('2026-09-01', 'transparent', 't1a', 300), ('2026-09-02', 'transparent', 't1a', 100),
      ('2026-09-01', 'transparent', 't1b', 250),
      ('2026-09-01', 'shielded', 'zs1x', 50), ('2026-09-02', 'transparent', 't1c', 300)`);

    await pool.query(`CREATE TABLE chain_day_network (ts BIGINT, blocks INT)`);
    await pool.query(`CREATE TABLE chain_day_rollup (ts BIGINT, top_height INT)`);
    const today = Math.floor(Date.now() / 1000 / DAY) * DAY;
    await pool.query(`INSERT INTO chain_day_network VALUES ($1, 1150), ($2, 1152), ($3, 300)`, [
      today - 2 * DAY,
      today - DAY,
      today,
    ]);
    await pool.query(
      `INSERT INTO chain_day_rollup VALUES ($1, 3500000), ($2, 3501152), ($3, 3501452)`,
      [today - 2 * DAY, today - DAY, today],
    );

    await pool.query(`CREATE TABLE reorg_observation (observing_since BIGINT)`);
    await pool.query(`CREATE TABLE reorg_event (id BIGSERIAL, detected_at BIGINT, depth INT)`);
    app = chartSeriesRoutes(undefined, pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("pivots fee percentiles per kind, a kind with no row being null", async () => {
    const body = await get<FeeSpreadSeries>(FEE_SPREAD_PATH);
    expect(body.monthly).toHaveLength(2);
    expect(body.monthly[0]).toMatchObject({
      timestamp: SEP,
      shielded: { p25Zat: 10000, medianZat: 10000, p75Zat: 15000, txs: 900 },
      mixed: null,
    });
    expect(body.monthly[1]!.shielded).toBeNull();
  });

  it("pivots tree sizes per pool, never reading Sprout's", async () => {
    const body = await get<NoteTreeDayPoint[]>(NOTE_TREES_PATH);
    expect(body).toEqual([
      { timestamp: SEP, saplingNotes: 100, orchardNotes: 50, ironwoodNotes: null },
      { timestamp: SEP + DAY, saplingNotes: 110, orchardNotes: 55, ironwoodNotes: 3 },
    ]);
  });

  it("serves every day between the first and last, a missing one as nulls", async () => {
    const body = await get<TransparentDayPoint[]>(TRANSPARENT_DAYS_PATH);
    expect(body).toEqual([
      { timestamp: SEP, activeAddresses: 40, outputsZat: 1500 },
      { timestamp: SEP + DAY, activeAddresses: null, outputsZat: null },
      { timestamp: SEP + 2 * DAY, activeAddresses: 42, outputsZat: 2000 },
    ]);
  });

  it("ranks transparent addresses within the month, against every block", async () => {
    const [sep] = await get<MinerShareMonth[]>(MINER_SHARES_PATH);
    // t1a 400, t1c 300, t1b 250 of 1,000 blocks; the shielded payout counts in the denominator only.
    expect(sep).toEqual({
      timestamp: SEP,
      blocks: 1000,
      days: 2,
      top1Blocks: 400,
      top3Blocks: 950,
      top10Blocks: 950,
    });
  });

  it("serves complete days only, today left out", async () => {
    const body = await get<BlocksDayPoint[]>(BLOCKS_DAILY_PATH);
    expect(body.map((p) => p.blocks)).toEqual([1150, 1152]);
    expect(body[1]!.topHeight).toBe(3501152);
  });

  it("counts reorgs per week from the week observation began, never before", async () => {
    // Observation began on a Wednesday; its week starts the Monday before.
    const wednesday = Date.UTC(2026, 8, 2) / 1000;
    const monday = Date.UTC(2026, 7, 31) / 1000;
    await pool.query("INSERT INTO reorg_observation VALUES ($1)", [wednesday]);
    await pool.query("INSERT INTO reorg_event (detected_at, depth) VALUES ($1, 1), ($2, 2)", [
      wednesday + DAY,
      wednesday + 8 * DAY,
    ]);
    const body = await loadReorgWeeks(pool);
    expect(body.observingSince).toBe(wednesday);
    expect(body.weeks[0]).toEqual({ timestamp: monday, reorgs: 1, deepest: 1 });
    expect(body.weeks[1]).toEqual({ timestamp: monday + 7 * DAY, reorgs: 1, deepest: 2 });
    // Every week to the current one, a quiet week a measured zero.
    expect(body.weeks.at(-1)!.timestamp).toBeGreaterThan(monday + 7 * DAY);
    expect(body.weeks.slice(2).every((w) => w.reorgs === 0)).toBe(true);
  });

  it("sums inbound ZEC per source chain and month, settlement legs excluded", async () => {
    await pool.query(`CREATE TABLE crosschain_transfer (
      id TEXT PRIMARY KEY, direction TEXT, counterpart_chain TEXT, counterpart_asset TEXT,
      zec_amount_zat BIGINT, timestamp BIGINT)`);
    await pool.query(`INSERT INTO crosschain_transfer VALUES
      ('a', 'in',  'BTC',  'BTC',   500, ${SEP + 10}),
      ('b', 'in',  'BTC',  'BTC',   250, ${SEP + DAY}),
      ('c', 'out', 'BTC',  'BTC',   999, ${SEP + 20}),
      ('d', 'in',  'MAYA', 'CACAO', 777, ${SEP + 30}),
      ('e', 'in',  'ETH',  'ETH',   100, ${OCT + 5})`);
    const store = new PostgresStorePort(url);
    try {
      expect(await store.inflowByChain()).toEqual([
        { timestamp: SEP, chain: "BTC", inZat: 750 },
        { timestamp: OCT, chain: "ETH", inZat: 100 },
      ]);
    } finally {
      await store.close();
    }
  });
});

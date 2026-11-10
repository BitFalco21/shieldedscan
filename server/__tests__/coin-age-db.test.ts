import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { COIN_AGE_PATH, chartSeriesRoutes } from "../chart-series-routes";
import { REORG_DEPTH } from "../follow";
import type { Pacer } from "../job-pacer";
import {
  CoinAgeRangeRefused,
  CoinAgeTracker,
  applyCoinAgeRange,
  coinAgeState,
  fillCoinAgeMonthEnds,
} from "../coin-age";
import {
  COIN_AGE_STALE_BLOCKS,
  V1_COIN_AGE_PATH,
  loadCoinAgeSeries,
  v1CoinAgeRoutes,
} from "../v1/coin-age";

/**
 * `coin_age_matrix` against a real Postgres: outputs land on their block's day, a spend moves its
 * output's own value to (creation day, spend day), a block whose timestamp runs back across
 * midnight stays on the later day, every range is held to the node's transparent pool before it
 * commits, a range is never applied twice, and the tracker stops at the reorg depth.
 *
 *   TEST_DATABASE_URL=postgres://explorer:test@127.0.0.1:55432/explorer \
 *     npx vitest run server/__tests__/coin-age-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_coin_age_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const pacer = (): Pacer => ({
  preflight: async () => {},
  afterUnit: async () => "continue",
  stats: { sleptMs: 0, stallSamples: 0, maxBlocksBehind: 0 },
});

const DAY = 86_400;
/** 2026-10-30 00:00 UTC. */
const D0 = 1_793_318_400;

interface Spend {
  prev: string;
  vout: number;
}

describeDb("coin_age_matrix", () => {
  let pool: Pool;
  /** Each output's value, by txid and ordinal, so an input carries the value it spends. */
  const values = new Map<string, number>();
  let poolZat = 0;

  /**
   * A block at `height` stamped `ts` with one transaction paying `outs` and spending `ins`. The
   * block's transparent pool moves by outputs minus inputs, as the node's does, unless `poolOverride`
   * says otherwise.
   */
  async function block(
    height: number,
    ts: number,
    outs: number[],
    ins: Spend[] = [],
    poolOverride?: number | null,
  ): Promise<string> {
    const txid = `tx${height}-`.padEnd(64, "0");
    const spent = ins.map((s) => values.get(`${s.prev}:${s.vout}`) ?? 0);
    poolZat += outs.reduce((a, b) => a + b, 0) - spent.reduce((a, b) => a + b, 0);
    await pool.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count, transparent_pool_zat)
       VALUES ($1, $2, $3, $4, 1000, 1, $5)`,
      [
        height,
        `h${height}-`.padEnd(64, "0"),
        `p${height}-`.padEnd(64, "0"),
        ts,
        poolOverride === undefined ? poolZat : poolOverride,
      ],
    );
    await pool.query(
      `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version)
       VALUES ($1, $2, $3, $4, $5, 200, 5)`,
      [txid, height, ts, ins.length === 0, ins.length === 0 ? "coinbase" : "transparent"],
    );
    for (const [ordinal, v] of outs.entries()) {
      values.set(`${txid}:${ordinal}`, v);
      await pool.query(
        `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
         VALUES ($1, 'out', $2, 't1x', $3, $4)`,
        [txid, ordinal, v, height],
      );
    }
    for (const [ordinal, s] of ins.entries()) {
      await pool.query(
        `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height, prev_txid, prev_vout)
         VALUES ($1, 'in', $2, 't1x', $3, $4, $5, $6)`,
        [txid, ordinal, spent[ordinal], height, s.prev, s.vout],
      );
    }
    return txid;
  }

  async function matrix() {
    const { rows } = await pool.query<{ c: string; s: string | null; v: string; n: string }>(
      `SELECT creation_day::text c, spend_day::text s, value_zat v, outputs n
         FROM coin_age_matrix WHERE outputs <> 0 ORDER BY 1, 2 NULLS LAST`,
    );
    return rows.map((r) => [r.c, r.s, Number(r.v), Number(r.n)]);
  }

  const seed = () =>
    pool.query(
      "INSERT INTO coin_age_state (id, applied_height, applied_day, updated_at) VALUES (TRUE, -1, NULL, 0)",
    );

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));
  });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE coin_age_matrix, coin_age_day, coin_age_month_end, coin_age_state, tx_transparent_io, tx, block CASCADE",
    );
    values.clear();
    poolZat = 0;
  });

  afterAll(async () => {
    await pool?.end();
  });

  /**
   * Day 0: a coinbase (0) and a spend of half of it (1). Day 1: a block (2) whose timestamp runs
   * back into day 0, spending block 0's other output, then a day-1 block (3) spending block 1's.
   */
  async function smallChain() {
    const t0 = await block(0, D0 + 100, [600, 400]);
    const t1 = await block(1, D0 + 200, [550], [{ prev: t0, vout: 0 }]);
    await block(2, D0 + DAY + 50, [70]);
    await block(3, D0 + DAY - 10, [390], [{ prev: t0, vout: 1 }]);
    await block(4, D0 + DAY + 300, [500], [{ prev: t1, vout: 0 }]);
    return { t0, t1 };
  }

  it("applies ranges into the matrix, each output's own value moved by its spend", async () => {
    await smallChain();
    await seed();
    expect(await applyCoinAgeRange(pool, 0, 1, 1)).toBe(true);
    expect(await applyCoinAgeRange(pool, 2, 4, 2)).toBe(true);
    expect(await matrix()).toEqual([
      // Block 0's 600 spent on day 0 by block 1; its 400 spent by block 3, which is stamped back
      // into day 0 but follows a day-1 block, so it belongs to day 1.
      ["2026-10-30", "2026-10-30", 600, 1],
      ["2026-10-30", "2026-10-31", 950, 2],
      ["2026-10-31", null, 960, 3],
    ]);
    expect(await coinAgeState(pool)).toEqual({ appliedHeight: 4, appliedDay: "2026-10-31" });
    const { rows } = await pool.query(
      "SELECT day::text, last_height FROM coin_age_day ORDER BY day",
    );
    expect(rows).toEqual([
      { day: "2026-10-30", last_height: 1 },
      { day: "2026-10-31", last_height: 4 },
    ]);
  });

  it("gives the same matrix whatever the range boundaries", async () => {
    await smallChain();
    await seed();
    for (let h = 0; h <= 4; h++) expect(await applyCoinAgeRange(pool, h, h, 1)).toBe(true);
    expect(await matrix()).toEqual([
      ["2026-10-30", "2026-10-30", 600, 1],
      ["2026-10-30", "2026-10-31", 950, 2],
      ["2026-10-31", null, 960, 3],
    ]);
  });

  it("refuses a range that does not continue the watermark, writing nothing", async () => {
    await smallChain();
    await seed();
    expect(await applyCoinAgeRange(pool, 1, 2, 1)).toBe(false);
    expect(await applyCoinAgeRange(pool, 0, 1, 1)).toBe(true);
    expect(await applyCoinAgeRange(pool, 0, 1, 1)).toBe(false);
    expect((await coinAgeState(pool))?.appliedHeight).toBe(1);
  });

  it("rolls a range back when it does not add up to the node's transparent pool", async () => {
    const t0 = await block(0, D0, [1000]);
    await block(1, D0 + 10, [900], [{ prev: t0, vout: 0 }], 999);
    await seed();
    await expect(applyCoinAgeRange(pool, 0, 1, 1)).rejects.toBeInstanceOf(CoinAgeRangeRefused);
    expect(await matrix()).toEqual([]);
    expect((await coinAgeState(pool))?.appliedHeight).toBe(-1);
  });

  it("rolls a range back when an input spends an output the index does not hold", async () => {
    await block(0, D0, [1000]);
    await block(1, D0 + 10, [900], [{ prev: "ff".repeat(32), vout: 0 }], 1900);
    await seed();
    await expect(applyCoinAgeRange(pool, 0, 1, 1)).rejects.toThrow(/found no output/);
    expect((await coinAgeState(pool))?.appliedHeight).toBe(-1);
  });

  it("serves month-ends and the newest block, every point adding up to the pool", async () => {
    // Two months: October's last day closes at block 1, November is still open at block 3.
    const t0 = await block(0, D0, [1000]);
    await block(1, D0 + DAY + 3600, [200], [{ prev: t0, vout: 0 }]);
    await block(2, D0 + 3 * DAY, [300]);
    await block(3, D0 + 3 * DAY + 60, [50]);
    await seed();
    expect(await applyCoinAgeRange(pool, 0, 3, 1)).toBe(true);
    // Before the month-ends are stored, only the newest block is served.
    expect((await loadCoinAgeSeries(pool)).monthEnds).toEqual([]);
    expect(await fillCoinAgeMonthEnds(pool)).toEqual(["2026-10-31"]);
    // Stored once: a second pass writes nothing.
    expect(await fillCoinAgeMonthEnds(pool)).toEqual([]);
    const series = await loadCoinAgeSeries(pool);
    expect(series.monthEnds.map((p) => [p.asOf, p.height])).toEqual([["2026-10-31", 1]]);
    const total = (p: { bands: { valueZat: number }[] }) =>
      p.bands.reduce((s, b) => s + b.valueZat, 0);
    expect(total(series.monthEnds[0]!)).toBe(200);
    expect(series.latest?.asOf).toBe("2026-11-02");
    expect(series.latest?.height).toBe(3);
    expect(total(series.latest!)).toBe(550);
    expect(series.latest?.bands.find((b) => b.key === "lt1w")?.valueZat).toBe(550);
  });

  it("never changes a stored month-end when later blocks spend its coins", async () => {
    const t0 = await block(0, D0, [1000]);
    await block(1, D0 + DAY + 60, [5]);
    await block(2, D0 + 3 * DAY, [7], [{ prev: t0, vout: 0 }]);
    await seed();
    expect(await applyCoinAgeRange(pool, 0, 1, 1)).toBe(true);
    expect(await fillCoinAgeMonthEnds(pool)).toEqual([]);
    expect(await applyCoinAgeRange(pool, 2, 2, 2)).toBe(true);
    await fillCoinAgeMonthEnds(pool);
    const before = (await loadCoinAgeSeries(pool)).monthEnds;
    expect(before.map((p) => p.asOf)).toEqual(["2026-10-31"]);
    // Block 0's 1000 was unspent at the end of 31 October; block 2 spent it in November.
    expect(before[0]!.bands.reduce((s, b) => s + b.valueZat, 0)).toBe(1005);
  });

  it("says the newest point has fallen behind once the index's tip is a day of blocks past it", async () => {
    const t0 = await block(0, D0, [1000]);
    await block(1, D0 + 60, [5], [{ prev: t0, vout: 0 }]);
    await seed();
    expect(await applyCoinAgeRange(pool, 0, 1, 1)).toBe(true);
    const coverage = async () => {
      const res = await v1CoinAgeRoutes({ pool }).request(V1_COIN_AGE_PATH);
      return ((await res.json()) as { coverage: { status: string } }).coverage.status;
    };
    expect(await coverage()).toBe("complete");
    await block(COIN_AGE_STALE_BLOCKS + 2, D0 + 120, [7]);
    expect(await coverage()).toBe("partial");
  });

  it("reads the unspent rows through their partial index, not a pass over the spent ones", async () => {
    // ~3,600 creation days with one unspent row each and the rest spent, the production shape.
    await pool.query(`
      INSERT INTO coin_age_matrix (creation_day, spend_day, value_zat, outputs)
      SELECT c, s, 1, 1
        FROM generate_series(date '2016-10-28', date '2026-10-28', interval '1 day') c
        CROSS JOIN LATERAL generate_series(c, c + interval '80 days', interval '1 day') s
      UNION ALL
      SELECT c, NULL, 1, 1 FROM generate_series(date '2016-10-28', date '2026-10-28', interval '1 day') c`);
    await pool.query("ANALYZE coin_age_matrix");
    for (const sql of [
      "SELECT coalesce(sum(value_zat), 0) FROM coin_age_matrix WHERE spend_day IS NULL",
      "SELECT creation_day, value_zat FROM coin_age_matrix WHERE spend_day IS NULL AND outputs <> 0 ORDER BY creation_day",
    ]) {
      const { rows } = await pool.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`);
      expect(rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain("coin_age_matrix_unspent");
    }
  });

  it("answers the page an empty series before the seed, never an error", async () => {
    const res = await chartSeriesRoutes(undefined, pool).request(COIN_AGE_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ monthEnds: [], latest: null });
  });

  it("does nothing before it is seeded, then applies only through the reorg depth", async () => {
    const tip = REORG_DEPTH + 5;
    for (let h = 0; h <= tip; h++) await block(h, D0 + h * 60, [10]);
    const tracker = new CoinAgeTracker({ pool, pacer, log: () => {} });
    expect(await tracker.refresh()).toEqual({ applied: 0, aborted: false });
    await seed();
    expect(await tracker.refresh()).toEqual({ applied: tip - REORG_DEPTH + 1, aborted: false });
    expect((await coinAgeState(pool))?.appliedHeight).toBe(tip - REORG_DEPTH);
  });
});

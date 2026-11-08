import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { minerFeeShareZat, NU7_HEIGHT } from "@/domain";
import { loadNsmDays } from "../miners-nsm";

/**
 * The NSM read on a real Postgres with the real schemas: blocks around NU7 with fees chosen so
 * per-block rounding differs from rounding the day's sum, a block whose fee is unknown, and one
 * stamped before the midnight its predecessor crossed.
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55435/postgres \
 *     npx vitest run server/__tests__/miners-nsm-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_miners_nsm_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const NOV_6 = Date.UTC(2026, 10, 6) / 1000;
const NOV_7 = NOV_6 + 86_400;
const NOV_8 = NOV_7 + 86_400;
/** Noon on 2026-11-08. */
const NOW = NOV_8 + 43_200;

/** [height, timestamp, fee]: the last pre-NU7 block, then NU7 onwards. */
const BLOCKS: [number, number, number | null][] = [
  [NU7_HEIGHT - 1, NOV_6 + 9_000, 1_000_000],
  [NU7_HEIGHT, NOV_6 + 9_242, 7],
  [NU7_HEIGHT + 1, NOV_6 + 9_267, 7],
  [NU7_HEIGHT + 2, NOV_7 - 10, 13],
  // Across midnight, then one stamped back before it: it belongs to the 6th.
  [NU7_HEIGHT + 3, NOV_7 + 5, 25],
  [NU7_HEIGHT + 4, NOV_7 - 3, 100],
  [NU7_HEIGHT + 5, NOV_8 + 60, 9],
  [NU7_HEIGHT + 6, NOV_8 + 85, null],
];

const nsmOf = (fee: number) => fee - minerFeeShareZat("mainnet", NU7_HEIGHT, fee);

describeDb("loadNsmDays", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));
    for (const [h, ts, fee] of BLOCKS) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count, total_fee_zat)
         VALUES ($1, $2, $3, $4, 1000, 1, $5)`,
        [h, `h${h}`.padEnd(64, "0"), `p${h}`.padEnd(64, "0"), ts, fee],
      );
    }
    for (const [day, usd] of [
      ["2026-11-06", 500],
      ["2026-11-07", 520],
      // Today's unfinished bar: never a close.
      ["2026-11-08", 9_999],
    ] as const) {
      await pool.query(
        "INSERT INTO zec_price_daily (day, usd, source, fetched_at) VALUES ($1, $2, 'test', 0)",
        [day, usd],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("splits each block's own fee as consensus does, by UTC day of its timestamp", async () => {
    const o = await loadNsmDays(pool, NOW);
    expect(o.activationDay).toBe("2026-11-06");
    expect(o.days.map((d) => [d.day, d.blocks, d.feeZat, d.nsmZat, d.closeUsd])).toEqual([
      // 7, 7, 13 and the back-stamped 100: floor(6f/10) per block is 4+4+7+60, not floor of 76.2.
      ["2026-11-06", 4, 127, nsmOf(7) * 2 + nsmOf(13) + nsmOf(100), 500],
      ["2026-11-07", 1, 25, nsmOf(25), 520],
      // One unknown fee leaves today unknown.
      ["2026-11-08", 2, null, null, null],
    ]);
    expect(o.days[0]!.nsmZat).toBe(75);
  });

  it("leaves every day unknown when a block in the span is missing", async () => {
    await pool.query("DELETE FROM block WHERE height = $1", [NU7_HEIGHT + 3]);
    const o = await loadNsmDays(pool, NOW);
    expect(o.days.every((d) => d.nsmZat === null)).toBe(true);
  });
});

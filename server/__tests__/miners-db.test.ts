import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINING_POOL_LABELS, type MinerSeries, type MinersOverview } from "@/domain";
import { minersRoutes } from "../miners-routes";

/**
 * The `/miners` routes on a real Postgres with the real schemas: rows written straight into the
 * rollups and the price table, then read through the routes.
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55435/postgres \
 *     npx vitest run server/__tests__/miners-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_miners_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const VIABTC_A = "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7";
const VIABTC_B = "t1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv";
const FOUNDRY = "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP";
const LONER = "t1LonerLonerLonerLonerLonerLoner1x";
const SOLO = "t1SoloSoloSoloSoloSoloSoloSoloSolo";

/** "Now": noon on 2026-11-06. Today is 2026-11-06, unfinished. */
const NOW = Date.UTC(2026, 10, 6, 12) / 1000;

interface Payout {
  day: string;
  kind: "transparent" | "shielded" | "unknown";
  address: string;
  blocks: number;
  reward: number | null;
  fee: number;
  feeBlocks?: number;
  lo: number;
  hi: number;
}

const PAYOUTS: Payout[] = [
  // Inside every window: yesterday and today.
  {
    day: "2026-11-05",
    kind: "transparent",
    address: VIABTC_A,
    blocks: 10,
    reward: 1_250_000_000,
    fee: 1_000,
    lo: 100,
    hi: 120,
  },
  {
    day: "2026-11-05",
    kind: "transparent",
    address: FOUNDRY,
    blocks: 5,
    reward: 625_000_000,
    fee: 500,
    lo: 101,
    hi: 119,
  },
  {
    day: "2026-11-05",
    kind: "transparent",
    address: LONER,
    blocks: 2,
    reward: 250_000_000,
    fee: 0,
    lo: 105,
    hi: 110,
  },
  {
    day: "2026-11-05",
    kind: "shielded",
    address: "",
    blocks: 3,
    reward: null,
    fee: 300,
    lo: 102,
    hi: 118,
  },
  {
    day: "2026-11-06",
    kind: "transparent",
    address: VIABTC_B,
    blocks: 4,
    reward: 500_000_000,
    fee: 0,
    lo: 121,
    hi: 130,
  },
  {
    day: "2026-11-06",
    kind: "transparent",
    address: SOLO,
    blocks: 1,
    reward: null,
    fee: 0,
    feeBlocks: 0,
    lo: 125,
    hi: 125,
  },
  // Only in 30d and 90d: a day with no stored close.
  {
    day: "2026-10-20",
    kind: "transparent",
    address: VIABTC_A,
    blocks: 6,
    reward: 750_000_000,
    fee: 0,
    lo: 50,
    hi: 60,
  },
  // Before the history floor: never read.
  {
    day: "2025-11-24",
    kind: "transparent",
    address: VIABTC_A,
    blocks: 999,
    reward: 7_875_000_000_000,
    fee: 0,
    lo: 1,
    hi: 9,
  },
];

const PRICES: [string, number][] = [
  ["2026-11-05", 400],
  ["2025-11-24", 600],
  // The feed stores today's unfinished bar too: it must never be read as a close.
  ["2026-11-06", 9_999],
];

describeDb("/chain/miners", () => {
  let pool: Pool;
  let app: ReturnType<typeof minersRoutes>;

  const overview = async (window = "") =>
    (await (await app.request(`/chain/miners${window}`)).json()) as MinersOverview;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));
    for (const p of PAYOUTS) {
      await pool.query(
        `INSERT INTO mining_day_payout (day, kind, address, blocks, reward_zat, fee_zat, fee_blocks,
                                        first_height, last_height)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [p.day, p.kind, p.address, p.blocks, p.reward, p.fee, p.feeBlocks ?? p.blocks, p.lo, p.hi],
      );
    }
    const days = [...new Set(PAYOUTS.map((p) => p.day))];
    for (const day of days) {
      const rows = PAYOUTS.filter((p) => p.day === day);
      await pool.query(
        `INSERT INTO mining_day (day, blocks, unrecorded_blocks, computed_at, first_height, last_height)
         VALUES ($1, $2, $3, 0, $4, $5)`,
        [
          day,
          rows.reduce((s, r) => s + r.blocks, 0) + (day === "2026-11-05" ? 1 : 0),
          day === "2026-11-05" ? 1 : 0,
          Math.min(...rows.map((r) => r.lo)),
          Math.max(...rows.map((r) => r.hi)),
        ],
      );
    }
    for (const [day, usd] of PRICES) {
      await pool.query(
        "INSERT INTO zec_price_daily (day, usd, source, fetched_at) VALUES ($1, $2, 'test', 0)",
        [day, usd],
      );
    }
    // ViaBTC's blocks for the pool route, and one block of another miner between them.
    for (const [h, address, reward] of [
      [121, VIABTC_B, 125_000_000],
      [122, FOUNDRY, 125_000_000],
      [130, VIABTC_B, 125_000_000],
      [120, VIABTC_A, 125_000_000],
    ] as const) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count,
                            miner_kind, miner_address, miner_reward_zat)
         VALUES ($1, $2, $3, $4, 1000, 1, 'transparent', $5, $6)`,
        [
          h,
          `h${h}`.padEnd(64, "0"),
          `p${h}`.padEnd(64, "0"),
          NOW - (200 - h) * 25,
          address,
          reward,
        ],
      );
    }
    app = minersRoutes({ pool, now: () => NOW * 1000 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("serves the default window, groups only labelled addresses, and counts every block", async () => {
    const o = await overview();
    expect(o.window).toBe("30d");
    expect([o.fromDay, o.toDay]).toEqual(["2026-10-08", "2026-11-06"]);
    // 31 payout blocks plus one unrecorded: the denominator counts it.
    expect(o.blocks).toBe(32);
    expect(o.unrecordedBlocks).toBe(1);
    expect(o.shieldedBlocks).toBe(3);
    expect(o.labelled.map((r) => [r.address, r.miningPool, r.blocks])).toEqual([
      [VIABTC_A, "viabtc", 16],
      [FOUNDRY, "foundry", 5],
      [VIABTC_B, "viabtc", 4],
    ]);
    expect(o.unattributed).toMatchObject({ blocks: 3, addresses: 2, rewardZat: null });
    expect(o.unattributed.largest.map((r) => r.address)).toEqual([LONER, SOLO]);
    expect(o.transparent.blocks).toBe(28);
    expect(o.topBlocks).toEqual({ top1: 16, top3: 25, top10: 28 });
    expect(o.registry).toEqual(Object.keys(MINING_POOL_LABELS).sort());
  });

  it("values closed days at their own close and leaves today and unpriced days apart", async () => {
    const o = await overview("?window=30d");
    const viaA = o.labelled.find((r) => r.address === VIABTC_A)!;
    // 12.5 ZEC × $400 on the 5th; the 20th has no close, so its 7.5 ZEC is counted apart.
    expect(viaA.usd).toEqual({ closedUsd: 5_000, unpricedZat: 750_000_000, todayZat: 0 });
    const viaB = o.labelled.find((r) => r.address === VIABTC_B)!;
    // Today's 5 ZEC is never valued at today's stored bar.
    expect(viaB.usd).toEqual({ closedUsd: 0, unpricedZat: 0, todayZat: 500_000_000 });
  });

  it("serves only open windows and never reads before the history floor", async () => {
    expect((await overview("?window=all")).window).toBe("30d");
    expect((await overview("?window=1y")).window).toBe("30d");
    const week = await overview("?window=7d");
    expect(week.fromDay).toBe("2026-10-31");
    expect(week.labelled.find((r) => r.address === VIABTC_A)?.blocks).toBe(10);
  });

  it("serves the series by pool from the floor, with every period's total", async () => {
    const res = await app.request("/chain/miners/series?interval=month");
    const s = (await res.json()) as MinerSeries;
    expect(s.fromDay).toBe("2025-12-01");
    expect(s.periods.map((p) => [p.period, p.blocks, p.partial])).toEqual([
      ["2026-10-01", 6, false],
      ["2026-11-01", 26, true],
    ]);
    const nov = s.points.filter((p) => p.period === "2026-11-01");
    expect(nov.map((p) => [p.group, p.blocks])).toEqual([
      ["foundry", 5],
      ["shielded", 3],
      ["unattributed", 3],
      ["viabtc", 14],
    ]);
    expect(nov.find((p) => p.group === "unattributed")?.rewardZat).toBeNull();
    expect((await app.request("/chain/miners/series?interval=week")).status).toBe(400);
  });

  it("lists a pool's newest blocks from the rollup's height ranges, and 404s an unknown pool", async () => {
    const res = await app.request("/chain/miners/pools/viabtc/blocks");
    const body = (await res.json()) as { miningPool: string; blocks: { height: number }[] };
    expect(body.miningPool).toBe("viabtc");
    expect(body.blocks.map((b) => b.height)).toEqual([130, 121, 120]);
    expect((await app.request("/chain/miners/pools/nobody/blocks")).status).toBe(404);
  });
});

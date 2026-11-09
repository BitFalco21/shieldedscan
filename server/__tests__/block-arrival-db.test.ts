import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { arrivalCell, ARRIVAL_ALL_GROUP, UNATTRIBUTED_GROUP } from "@/domain";
import type { Pacer } from "../job-pacer";
import {
  ARRIVAL_START_RETRY_MS,
  BlockArrivalTracker,
  arrivalDaysToCompute,
  arrivalRecordingStart,
  computeArrivalSpan,
  loadBlockArrival,
  storeArrivalDay,
} from "../block-arrival";

/**
 * `block_arrival_day` and `block_arrival_window` against a real Postgres: the SQL agrees with the
 * domain's `arrivalCell` on the same ages, a late block is left out and counted, a negative age is
 * kept, an unstamped block counts only in `blocks`, and the tracker fills days from the first
 * stamped one.
 *
 *   TEST_DATABASE_URL=postgres://explorer:test@127.0.0.1:55432/explorer \
 *     npx vitest run server/__tests__/block-arrival-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_block_arrival_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const DAY = 86_400;
const D0 = 1_790_000_000 - (1_790_000_000 % DAY);
const FOUNDRY = "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP";
const VIABTC = "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7";
const STRANGER = "t1StrangerAddressNotInAnyReviewedLabelXX";

interface B {
  ts: number;
  miner: string | null;
  /** Seconds after the header timestamp the follower stored it; null: unstamped. */
  age: number | null;
}

// Day -1 has only unstamped (backfilled) blocks: recording starts on day 0.
const BLOCKS: B[] = [
  { ts: D0 - DAY + 100, miner: FOUNDRY, age: null },
  { ts: D0 - DAY + 200, miner: VIABTC, age: null },
  // Day 0: Foundry has 12 measured (one negative), one late, one unstamped.
  ...Array.from({ length: 12 }, (_, i) => ({
    ts: D0 + 100 + i * 60,
    miner: FOUNDRY,
    age: i === 0 ? -3 : 5 + i * 4,
  })),
  { ts: D0 + 2_000, miner: FOUNDRY, age: 900 },
  { ts: D0 + 2_100, miner: FOUNDRY, age: null },
  // ViaBTC: only 4 measured, too few for percentiles.
  ...Array.from({ length: 4 }, (_, i) => ({ ts: D0 + 3_000 + i * 60, miner: VIABTC, age: 20 })),
  // An unlabelled address and a shielded coinbase (no address) are unattributed.
  { ts: D0 + 4_000, miner: STRANGER, age: 30 },
  { ts: D0 + 4_100, miner: null, age: 40 },
  // Day 1: exactly the 600 s boundary is measured, 601 is late.
  ...Array.from({ length: 10 }, (_, i) => ({
    ts: D0 + DAY + 100 + i * 60,
    miner: VIABTC,
    age: i === 9 ? 600 : 10 + i,
  })),
  { ts: D0 + DAY + 1_000, miner: VIABTC, age: 601 },
];

const pacer = (): Pacer => ({
  preflight: async () => {},
  afterUnit: async () => "continue",
  stats: { sleptMs: 0, stallSamples: 0, maxBlocksBehind: 0 },
});

const ages = (from: number, to: number, keep: (b: B) => boolean) =>
  BLOCKS.filter((b) => b.ts >= from && b.ts < to && keep(b)).map((b) => b.age);

describeDb("block arrival", () => {
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
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));
    let h = 1_000;
    for (const b of BLOCKS) {
      h += 1;
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count, miner_address,
                            received_at)
         VALUES ($1, $2, $3, $4, 1000, 1, $5, $6)`,
        [
          h,
          `h${h}`.padEnd(64, "0"),
          `p${h}`.padEnd(64, "0"),
          b.ts,
          b.miner,
          b.age === null ? null : b.ts + b.age,
        ],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("agrees with the domain's arrivalCell on the same ages, group by group", async () => {
    const cells = await computeArrivalSpan(pool, D0, D0 + DAY);
    const by = Object.fromEntries(cells.map((c) => [c.group, c]));
    expect(by.foundry).toEqual(
      arrivalCell(
        "foundry",
        ages(D0, D0 + DAY, (b) => b.miner === FOUNDRY),
      ),
    );
    expect(by.foundry).toMatchObject({ blocks: 14, measured: 12, late: 1 });
    // The negative age is kept: the median of [-3, 9, 13, …] sits on a real block's age.
    expect(by.foundry!.p50Seconds).toBe(25);
    expect(by.viabtc).toMatchObject({ blocks: 4, measured: 4, p50Seconds: null, p90Seconds: null });
    expect(by[UNATTRIBUTED_GROUP]).toMatchObject({ blocks: 2, measured: 2 });
    expect(by[ARRIVAL_ALL_GROUP]).toEqual(
      arrivalCell(
        ARRIVAL_ALL_GROUP,
        ages(D0, D0 + DAY, () => true),
      ),
    );
  });

  it("measures an age of exactly 600 s and leaves 601 out", async () => {
    const cells = await computeArrivalSpan(pool, D0 + DAY, D0 + 2 * DAY);
    const viabtc = cells.find((c) => c.group === "viabtc")!;
    expect(viabtc).toMatchObject({ blocks: 11, measured: 10, late: 1, p90Seconds: 18 });
  });

  it("fills days from the first stamped one, then the windows", async () => {
    const now = (D0 + DAY + 50_000) * 1000;
    // The walk skips day -1, whose blocks the backfiller wrote unstamped.
    expect(await arrivalRecordingStart(pool, now / 1000)).toBe(D0);
    expect(await arrivalDaysToCompute(pool, now / 1000, D0)).toEqual([D0, D0 + DAY]);
    const tracker = new BlockArrivalTracker({ pool, pacer, log: () => {}, now: () => now });
    expect(await tracker.refresh()).toEqual({ computed: 5, aborted: false });
    const series = await loadBlockArrival(pool, now / 1000);
    expect(series.recordingSince).toBe(new Date(D0 * 1000).toISOString().slice(0, 10));
    expect(series.days.map((d) => d.partial)).toEqual([false, true]);
    expect(series.days[0]!.groups[0]!.group).toBe(ARRIVAL_ALL_GROUP);
    expect(series.windows.map((w) => w.window)).toEqual(["7d", "30d", "90d"]);
    const week = series.windows[0]!.groups.find((g) => g.group === "viabtc")!;
    // Every ViaBTC block in the last seven days, the unstamped one included: a window's median
    // comes from its own blocks, never from its days' medians.
    expect(week).toEqual(
      arrivalCell(
        "viabtc",
        ages(D0 - 5 * DAY, D0 + 2 * DAY, (b) => b.miner === VIABTC),
      ),
    );
    expect(week).toMatchObject({ blocks: 16, measured: 14, late: 1 });
  });

  it("files a day under its UTC date whatever the session's time zone", async () => {
    const honolulu = new Pool({
      connectionString: withDatabase(DATABASE_URL!, TEST_DB),
      options: "-c TimeZone=Pacific/Honolulu",
    });
    try {
      const cells = await computeArrivalSpan(honolulu, D0, D0 + DAY);
      await storeArrivalDay(honolulu, D0, cells, D0);
      const { rows } = await pool.query<{ day: string }>(
        `SELECT DISTINCT to_char(day, 'YYYY-MM-DD') AS day FROM block_arrival_day ORDER BY day`,
      );
      expect(rows.map((r) => r.day)).toEqual([
        new Date(D0 * 1000).toISOString().slice(0, 10),
        new Date((D0 + DAY) * 1000).toISOString().slice(0, 10),
      ]);
    } finally {
      await honolulu.end();
    }
  });
});

describeDb("block arrival on a database whose follower never stamped a block", () => {
  const DB = "explorer_block_arrival_nostamp_test";
  let pool: Pool;
  /** Every statement that read `block`, and whether the pacer had cleared it to run. */
  const blockReads: { sql: string; paced: boolean }[] = [];
  let paced = false;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, DB) });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));
    // Three-digit heights: padded hashes of 1 and 10 would collide.
    for (let h = 101; h <= 120; h += 1) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, $4, 1000, 1)`,
        [h, `h${h}`.padEnd(64, "0"), `p${h}`.padEnd(64, "0"), D0 + (h - 100) * 600],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("walks a bounded range once, after the pacer, then waits hours before looking again", async () => {
    let clock = (D0 + DAY) * 1000;
    const counting = new Proxy(pool, {
      get(target, key, receiver) {
        if (key !== "query") return Reflect.get(target, key, receiver);
        return (sql: string, params?: unknown[]) => {
          if (/\bFROM block\b/.test(sql)) blockReads.push({ sql, paced });
          return target.query(sql, params);
        };
      },
    }) as Pool;
    const tracker = new BlockArrivalTracker({
      pool: counting,
      pacer: () => ({
        preflight: async () => {
          paced = true;
        },
        afterUnit: async () => "continue",
        stats: { sleptMs: 0, stallSamples: 0, maxBlocksBehind: 0 },
      }),
      log: () => {},
      now: () => clock,
    });
    expect(await tracker.refresh()).toEqual({ computed: 0, aborted: false });
    // One bounded read per day from the floor to today, every one after the pacer: never the
    // unbounded `min(timestamp) WHERE received_at IS NOT NULL` scan.
    expect(blockReads.length).toBeGreaterThan(0);
    for (const r of blockReads) {
      expect(r.paced).toBe(true);
      expect(r.sql).toMatch(/timestamp >= \$1::bigint AND timestamp < \$2::bigint/);
    }
    const walked = blockReads.length;
    expect(walked).toBeLessThanOrEqual((D0 + DAY - Date.UTC(2026, 7, 17) / 1000) / DAY + 1);

    // Ten minutes later: nothing is read at all.
    clock += 10 * 60 * 1000;
    expect(await tracker.refresh()).toEqual({ computed: 0, aborted: false });
    expect(blockReads.length).toBe(walked);

    // Past the wait it looks again.
    clock += ARRIVAL_START_RETRY_MS;
    await tracker.refresh();
    expect(blockReads.length).toBeGreaterThan(walked);
  });
});

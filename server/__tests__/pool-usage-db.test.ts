import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pacer } from "../job-pacer";
import {
  PoolUsageTracker,
  computePoolUsageDay,
  daysToCompute,
  loadPoolUsage,
  upsertPoolUsage,
} from "../pool-usage";

/**
 * `pool_usage_daily`, against a real Postgres: the day query, the tracker's pass, and the property
 * that makes the table trustworthy: its per-pool transaction counts equal the follower's own
 * `chain_day_pool_tx` matview, row for row.
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/pool-usage-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_pool_usage_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const DAY = 86_400;
const D0 = 1_780_000_000 - (1_780_000_000 % DAY);

interface Tx {
  height: number;
  ts: number;
  kind: "transparent" | "shielded" | "mixed" | "coinbase";
  direction?: "shielding" | "unshielding" | "indeterminate";
  sprout?: number;
  sapling?: [spends: number, outputs: number];
  orchard?: number;
  ironwood?: number;
}

// Two days. Day 0 closes at height 102, day 1 at 105; block 103 is stamped on day 1.
const TXS: Tx[] = [
  { height: 100, ts: D0 + 10, kind: "coinbase", sapling: [0, 1] },
  { height: 100, ts: D0 + 10, kind: "shielded", orchard: 2 },
  { height: 101, ts: D0 + 500, kind: "mixed", direction: "shielding", sapling: [0, 2] },
  { height: 101, ts: D0 + 500, kind: "mixed", direction: "unshielding", orchard: 3 },
  // A migration: two pools, counted in both.
  { height: 102, ts: D0 + 900, kind: "shielded", orchard: 2, ironwood: 2 },
  { height: 102, ts: D0 + 900, kind: "transparent" },
  { height: 103, ts: D0 + DAY + 5, kind: "mixed", direction: "indeterminate", sapling: [1, 1] },
  { height: 104, ts: D0 + DAY + 50, kind: "mixed", direction: "unshielding", sprout: 1 },
  { height: 105, ts: D0 + DAY + 99, kind: "shielded", ironwood: 4 },
];

/** Tree sizes as a node would report them: grows with height, no Sprout. */
const trees = async (height: number) => ({
  sapling: 1_000 + height,
  orchard: 2_000 + height,
  ironwood: height >= 102 ? 10 + height : null,
});

const pacer = (): Pacer => ({
  preflight: async () => {},
  afterUnit: async () => "continue",
  stats: { sleptMs: 0, stallSamples: 0, maxBlocksBehind: 0 },
});

describeDb("pool_usage_daily", () => {
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
    const heights = [...new Set(TXS.map((t) => t.height))];
    for (const h of heights) {
      const ts = TXS.find((t) => t.height === h)!.ts;
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, $4, 1000, 1)`,
        [h, `h${h}`.padEnd(64, "0"), `p${h}`.padEnd(64, "0"), ts],
      );
    }
    let n = 0;
    for (const t of TXS) {
      n += 1;
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, direction, size_bytes,
                         version, sprout_joinsplits, sprout_vpub_net_zat, sapling_spends,
                         sapling_outputs, sapling_value_balance_zat, orchard_actions,
                         orchard_value_balance_zat, ironwood_actions, ironwood_value_balance_zat)
         VALUES ($1, $2, $3, $4, $5, $6, 200, 5, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          String(n).padStart(64, "0"),
          t.height,
          t.ts,
          t.kind === "coinbase",
          t.kind,
          t.direction ?? null,
          t.sprout ?? null,
          t.sprout ? 0 : null,
          t.sapling?.[0] ?? null,
          t.sapling?.[1] ?? null,
          t.sapling ? 0 : null,
          t.orchard ?? null,
          t.orchard !== undefined ? 0 : null,
          t.ironwood ?? null,
          t.ironwood !== undefined ? 0 : null,
        ],
      );
    }
    await pool.query("REFRESH MATERIALIZED VIEW chain_day_pool_tx");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("counts a day per pool, partitioned by kind, with the bundles and the closing tree", async () => {
    const rows = await computePoolUsageDay(pool, D0, trees);
    const by = Object.fromEntries(rows.map((r) => [r.pool, r]));
    expect(by.orchard).toMatchObject({
      txs: 3,
      fullyShielded: 2,
      mixed: 1,
      unshielding: 1,
      coinbase: 0,
      actions: 7,
      spends: null,
      notesAtClose: 2_102,
      closeHeight: 102,
    });
    expect(by.sapling).toMatchObject({
      txs: 2,
      mixed: 1,
      shielding: 1,
      coinbase: 1,
      spends: 0,
      outputs: 3,
      actions: null,
    });
    expect(by.ironwood).toMatchObject({ txs: 1, fullyShielded: 1, actions: 2, notesAtClose: 112 });
    // Sprout: counted, but the node reports no tree for it — null, never 0.
    expect(by.sprout).toMatchObject({ txs: 0, joinsplits: 0, notesAtClose: null });
    for (const r of rows) expect(r.fullyShielded + r.mixed + r.coinbase, r.pool).toBe(r.txs);
  });

  it("agrees with the follower's chain_day_pool_tx matview, row for row", async () => {
    const tracker = new PoolUsageTracker({
      pool,
      trees,
      pacer,
      log: () => {},
      now: () => (D0 + 3 * DAY) * 1000,
    });
    const pass = await tracker.refresh();
    expect(pass).toEqual({ computed: 2, aborted: false });
    const ours = (await loadPoolUsage(pool)).filter((r) => r.txs > 0);
    // The day as epoch seconds IN SQL: node-postgres reads a DATE as local midnight.
    const { rows: theirs } = await pool.query<{ day: string; pool: string; txs: string }>(
      `SELECT EXTRACT(EPOCH FROM day)::bigint::text AS day, pool, txs
         FROM chain_day_pool_tx ORDER BY day, pool`,
    );
    expect(ours.map((r) => [r.day, r.pool, r.txs])).toEqual(
      theirs.map((r) => [Number(r.day), r.pool, Number(r.txs)]),
    );
  });

  it("files a day under its UTC date whatever the session's time zone", async () => {
    // Honolulu is ten hours behind UTC, so a UTC midnight is the PREVIOUS local day there — a
    // date cast that follows the session's zone files the row a day early.
    const honolulu = new Pool({
      connectionString: withDatabase(DATABASE_URL!, TEST_DB),
      options: "-c TimeZone=Pacific/Honolulu",
    });
    try {
      const rows = await computePoolUsageDay(honolulu, D0, trees);
      await upsertPoolUsage(honolulu, rows, D0);
      const stored = await loadPoolUsage(honolulu);
      expect(stored.filter((r) => r.day === D0).length).toBe(4);
      expect(stored.some((r) => r.day === D0 - DAY)).toBe(false);
    } finally {
      await honolulu.end();
    }
  });

  it("recomputes the chain's newest three days, and older days only while incomplete", async () => {
    // Both stored days sit inside the newest three of a two-day chain, so both stay open.
    expect(await daysToCompute(pool, D0 + 3 * DAY)).toEqual([D0, D0 + DAY]);
    // A block five days on: days 0 and 1 are complete and settled, days 2–4 hold no rows yet.
    await pool.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
       VALUES (200, $1, $2, $3, 1000, 0)`,
      ["h200".padEnd(64, "0"), "p200".padEnd(64, "0"), D0 + 5 * DAY + 10],
    );
    try {
      expect(await daysToCompute(pool, D0 + 9 * DAY)).toEqual([
        D0 + 2 * DAY,
        D0 + 3 * DAY,
        D0 + 4 * DAY,
        D0 + 5 * DAY,
      ]);
    } finally {
      await pool.query("DELETE FROM block WHERE height = 200");
    }
  });

  it("an aborted pass keeps what it computed and the next pass resumes from the gap", async () => {
    await pool.query("DELETE FROM pool_usage_daily");
    let units = 0;
    const stopAfterOne = (): Pacer => ({
      ...pacer(),
      afterUnit: async () => (++units >= 1 ? "abort" : "continue"),
    });
    const log: string[] = [];
    const tracker = new PoolUsageTracker({
      pool,
      trees,
      pacer: stopAfterOne,
      log: (m) => log.push(m),
      now: () => (D0 + 30 * DAY) * 1000,
    });
    expect(await tracker.refresh()).toEqual({ computed: 1, aborted: true });
    const stored = new Set((await loadPoolUsage(pool)).map((r) => r.day));
    expect([...stored]).toEqual([D0]);
    expect(log.join("\n")).toMatch(/ingestion is behind/);
    // The next pass finishes the gap.
    const resume = new PoolUsageTracker({
      pool,
      trees,
      pacer,
      log: () => {},
      now: () => (D0 + 30 * DAY) * 1000,
    });
    expect(await resume.refresh()).toEqual({ computed: 2, aborted: false });
  });
});

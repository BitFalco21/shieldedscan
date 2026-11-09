import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { OrphanRateSeries } from "@/domain";
import { loadOrphanRate, ORPHAN_RATE_PATH, reorgRoutes } from "../reorg-routes";

/**
 * The observed orphan rate against a real database: the height-to-day pairing, the depth
 * expansion and the FILTER windows are SQL semantics a fake pool cannot prove.
 *
 * Skips without TEST_DATABASE_URL:
 *
 *   TEST_DATABASE_URL=postgres://explorer:test@127.0.0.1:55432/explorer \
 *     npx vitest run server/__tests__/orphan-rate-db.test.ts
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const DAY = 86_400;
const HOUR = 3_600;
/** 2026-11-09 00:00 UTC: "today". The series is read at noon. */
const TODAY = Date.UTC(2026, 10, 9) / 1000;
const NOW = TODAY + 12 * HOUR;
/** One block an hour from 2026-11-05 00:00, height 1000 upward, through NOW. */
const FIRST_BLOCK = TODAY - 4 * DAY;
const heightAt = (ts: number) => 1000 + (ts - FIRST_BLOCK) / HOUR;
/** Observation began 2026-11-06 06:00. */
const SINCE = TODAY - 3 * DAY + 6 * HOUR;
/** The upgrade activates at 2026-11-08 00:00's block. */
const UPGRADE = { name: "NU7", height: heightAt(TODAY - DAY) };

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createTestDatabase(url: string): Promise<string> {
  const name = "explorer_orphan_rate_test";
  const admin = new Pool({ connectionString: withDatabase(url, "postgres"), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return withDatabase(url, name);
}

describeDb("the observed orphan rate", () => {
  let pool: Pool;
  let body: OrphanRateSeries;

  beforeAll(async () => {
    pool = new Pool({ connectionString: await createTestDatabase(DATABASE_URL!), max: 2 });
    await pool.query(`CREATE TABLE block (height INTEGER PRIMARY KEY, timestamp BIGINT NOT NULL)`);
    await pool.query(
      `INSERT INTO block SELECT 1000 + k, $1::bigint + k * 3600 FROM generate_series(0, $2) AS k`,
      [FIRST_BLOCK, (NOW - FIRST_BLOCK) / HOUR],
    );
    await pool.query(`CREATE TABLE reorg_observation (observing_since BIGINT NOT NULL)`);
    await pool.query("INSERT INTO reorg_observation VALUES ($1)", [SINCE]);
    await pool.query(`CREATE TABLE reorg_event (
      id BIGSERIAL PRIMARY KEY, detected_at BIGINT NOT NULL, height BIGINT NOT NULL,
      depth INT NOT NULL, orphaned_hash TEXT NOT NULL DEFAULT '', replaced_by TEXT NOT NULL DEFAULT '')`);
    const reorg = (detectedAt: number, blockAt: number, depth: number) =>
      pool.query("INSERT INTO reorg_event (detected_at, height, depth) VALUES ($1, $2, $3)", [
        detectedAt,
        heightAt(blockAt),
        depth,
      ]);
    // Detected after observation began, for a block mined before it: on neither side.
    await reorg(SINCE + 60, SINCE - HOUR, 1);
    // Depth 2 on 11-07: two orphans, at 03:00's and 04:00's heights.
    await reorg(TODAY - 2 * DAY + 3 * HOUR + 30, TODAY - 2 * DAY + 3 * HOUR, 2);
    // Mined 11-07 23:00, detected after midnight: still 11-07's, the day of its height.
    await reorg(TODAY - DAY + 30, TODAY - DAY - HOUR, 1);
    // 11-08 has none. Today, 05:00.
    await reorg(TODAY + 5 * HOUR + 30, TODAY + 5 * HOUR, 1);
    body = await loadOrphanRate(pool, { upgrade: UPGRADE, nowSec: NOW });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("starts the days at observation, never before, and marks both partial ends", () => {
    expect(body.observingSince).toBe(SINCE);
    expect(body.asOf).toBe(NOW);
    expect(body.days).toEqual([
      // From 06:00 only: the 05:00 block and its orphan precede observation.
      { timestamp: TODAY - 3 * DAY, orphans: 0, blocks: 18, partial: true },
      // A depth-2 reorg is two orphans, plus the one detected after midnight.
      { timestamp: TODAY - 2 * DAY, orphans: 3, blocks: 24, partial: false },
      // A day with none is a measured zero, not a gap.
      { timestamp: TODAY - DAY, orphans: 0, blocks: 24, partial: false },
      // Today, through noon.
      { timestamp: TODAY, orphans: 1, blocks: 13, partial: true },
    ]);
  });

  it("windows the trailing spans by header time, bounded by observation", () => {
    const w = Object.fromEntries(body.windows.map((x) => [x.key, x]));
    expect(body.windows.map((x) => x.key)).toEqual([
      "24h",
      "7d",
      "30d",
      "before-upgrade",
      "since-upgrade",
    ]);
    expect(w["24h"]).toEqual({
      key: "24h",
      orphans: 1,
      blocks: 24,
      firstBlockAt: NOW - DAY + HOUR,
      lastBlockAt: NOW,
    });
    expect(w["7d"]).toMatchObject({ orphans: 4, blocks: 79, firstBlockAt: SINCE });
    expect(w["30d"]).toMatchObject({ orphans: 4, blocks: 79 });
  });

  it("splits before and since the upgrade by height", () => {
    const w = Object.fromEntries(body.windows.map((x) => [x.key, x]));
    expect(w["before-upgrade"]).toMatchObject({
      orphans: 3,
      blocks: 42,
      firstBlockAt: SINCE,
      lastBlockAt: TODAY - DAY - HOUR,
    });
    expect(w["since-upgrade"]).toMatchObject({ orphans: 1, blocks: 37, firstBlockAt: TODAY - DAY });
    expect(body.upgrade).toEqual({ ...UPGRADE, activatedAt: TODAY - DAY });
  });

  it("drops the upgrade pair where none is scheduled", async () => {
    const none = await loadOrphanRate(pool, { upgrade: null, nowSec: NOW });
    expect(none.upgrade).toBeNull();
    expect(none.windows.map((x) => x.key)).toEqual(["24h", "7d", "30d"]);
  });

  it("serves the series on its private route", async () => {
    const app = reorgRoutes(undefined, { pool, network: "mainnet" });
    const res = await app.request(ORPHAN_RATE_PATH);
    expect(res.status).toBe(200);
    const served = (await res.json()) as OrphanRateSeries;
    expect(served.observingSince).toBe(SINCE);
    expect(served.windows).toHaveLength(5);
    expect(served.upgrade?.name).toBe("NU7");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { orchardDrainSeries } from "@/domain";
import { loadOrchardDrain } from "../orchard-drain";
import { orchardDrainWire } from "../v1/orchard-drain";

/**
 * Orchard emptying into Ironwood against a real database: the activation day found from the
 * block's own timestamp, the day join, the source filter and the base read are SQL semantics.
 * Tables carry only the columns the queries read.
 *
 *   TEST_DATABASE_URL=postgres://explorer:test@127.0.0.1:55432/explorer \
 *     npx vitest run server/__tests__/orchard-drain-db.test.ts
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const ACTIVATION = 3_428_143;
const ZEC = 100_000_000;
/** 2026-07-28, activation's day, at UTC midnight. */
const D0 = Date.UTC(2026, 6, 28) / 1000;
const DAY = 86_400;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createTestDatabase(url: string): Promise<string> {
  const name = "explorer_orchard_drain_test";
  const admin = new Pool({ connectionString: withDatabase(url, "postgres"), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return withDatabase(url, name);
}

describeDb("Orchard emptying into Ironwood", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: await createTestDatabase(DATABASE_URL!), max: 2 });
    await pool.query(
      `CREATE TABLE block (height INT PRIMARY KEY, timestamp BIGINT, orchard_pool_zat BIGINT)`,
    );
    // The block before activation sits on the previous UTC day; activation lands at 14:00.
    await pool.query(`INSERT INTO block VALUES ($1, $2, $3), ($4, $5, $6)`, [
      ACTIVATION - 1,
      D0 - 600,
      4_000_000 * ZEC,
      ACTIVATION,
      D0 + 14 * 3_600,
      3_999_990 * ZEC,
    ]);
    await pool.query(
      `CREATE TABLE chain_day_supply_close (day DATE PRIMARY KEY, top_height INT, orchard_pool_zat BIGINT)`,
    );
    const today = new Date().toISOString().slice(0, 10);
    await pool.query(`INSERT INTO chain_day_supply_close VALUES
      ('2026-07-27', ${ACTIVATION - 1}, ${4_000_000 * ZEC}),
      ('2026-07-28', ${ACTIVATION + 500}, ${3_600_000 * ZEC}),
      ('2026-07-29', ${ACTIVATION + 1_650}, NULL),
      ('2026-07-30', ${ACTIVATION + 2_800}, ${3_180_000 * ZEC}),
      ('${today}', 9999999, 1)`);
    await pool.query(
      `CREATE TABLE chain_day_pool_migration (day DATE, destination TEXT, source TEXT, txs BIGINT, zat BIGINT)`,
    );
    await pool.query(`INSERT INTO chain_day_pool_migration VALUES
      ('2026-07-28', 'ironwood', 'orchard', 10, ${380_000 * ZEC}),
      ('2026-07-28', 'ironwood', 'multi', 1, ${4_000 * ZEC}),
      ('2026-07-28', 'ironwood', 'sapling', 3, ${9_000 * ZEC}),
      ('2026-07-28', 'sapling', 'orchard', 2, ${7 * ZEC}),
      ('2026-07-30', 'ironwood', 'orchard', 8, ${356_000 * ZEC}),
      ('${today}', 'ironwood', 'orchard', 1, ${1 * ZEC})`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("reads Orchard at the block before activation, and every complete day from activation's", async () => {
    const drain = await loadOrchardDrain(pool, ACTIVATION);
    expect(drain.baseHeight).toBe(ACTIVATION - 1);
    expect(drain.baseOrchardZat).toBe(4_000_000 * ZEC);
    // The 27th is before activation's day, and today is not closed yet.
    expect(drain.days.map((d) => d.timestamp)).toEqual([D0, D0 + DAY, D0 + 2 * DAY]);
    expect(drain.days.map((d) => d.migratedZat)).toEqual([380_000 * ZEC, 0, 356_000 * ZEC]);
    expect(drain.days.map((d) => d.multiSourceZat)).toEqual([4_000 * ZEC, 0, 0]);
    // A close the node did not report stays null; a quiet day is a measured zero.
    expect(drain.days[1]!.orchardZat).toBeNull();
    expect(drain.days[2]!.closeHeight).toBe(ACTIVATION + 2_800);
  });

  it("states the share against the pre-activation base, with both terms on the wire", async () => {
    const drain = await loadOrchardDrain(pool, ACTIVATION);
    expect(orchardDrainSeries(drain).map((p) => p.sharePct)).toEqual([9.5, 9.5, 18.4]);
    const unknowns: Record<string, string> = {};
    const wire = orchardDrainWire(drain, unknowns)!;
    expect(wire.latest).toMatchObject({
      day: "2026-07-30",
      migratedToIronwood: { zat: 736_000 * ZEC },
      remaining: { zat: 3_180_000 * ZEC },
      shareMigrated: { pct: 18.4, numerator: 736_000 * ZEC, denominator: 4_000_000 * ZEC },
    });
    expect(unknowns).toEqual({ "data.orchard.days.1.remaining": "unmeasured" });
  });

  it("has no base until the index holds the block before activation", async () => {
    await pool.query(`DELETE FROM block WHERE height = $1`, [ACTIVATION - 1]);
    const drain = await loadOrchardDrain(pool, ACTIVATION);
    expect(drain.baseOrchardZat).toBeNull();
    expect(orchardDrainSeries(drain).every((p) => p.sharePct === null)).toBe(true);
  });
});

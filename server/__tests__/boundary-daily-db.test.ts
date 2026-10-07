import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeBoundaryDay, readCrossingRecords, upsertBoundaryDay } from "../boundary-daily";
import { aggregateSql } from "../chain-window";

/**
 * `boundary_daily` on a real Postgres with the real schemas: the day's counts and maxima (ties,
 * Sprout's sign, what is and is not a migration), migration parity with the follower's own
 * `chain_day_pool_migration`, and the window aggregate reading the table for covered days and
 * `tx` for the rest — with the same answer either way, and the table demonstrably read.
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/boundary-daily-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_boundary_daily_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const D0 = Date.UTC(2020, 2, 2) / 1000;
const D1 = D0 + 86_400;
const D2 = D1 + 86_400;
const D3 = D2 + 86_400;

interface Fx {
  txid: string;
  day: number;
  kind: "mixed" | "shielded";
  direction?: "shielding" | "unshielding" | "indeterminate";
  sa?: number;
  oc?: number;
  iw?: number;
  /** Sprout's vpub_new − vpub_old, RPC sign: positive is value LEAVING Sprout. */
  sproutVpub?: number;
}

const FIXTURES: Fx[] = [
  { txid: "s1", day: D0, kind: "mixed", direction: "shielding", sa: 900 },
  { txid: "s2", day: D0, kind: "mixed", direction: "shielding", oc: 900 },
  { txid: "s3", day: D0, kind: "mixed", direction: "shielding", sa: 100 },
  { txid: "u1", day: D0, kind: "mixed", direction: "unshielding", sa: -700 },
  { txid: "i1", day: D0, kind: "mixed", direction: "indeterminate", sa: 5, oc: -7 },
  { txid: "m1", day: D0, kind: "shielded", oc: -1_000, iw: 990 },
  // Sprout as the source: 500 leaves Sprout (RPC sign +500), 490 lands in Sapling.
  { txid: "m2", day: D0, kind: "shielded", sproutVpub: 500, sa: 490 },
  // A transfer inside one pool, and two pools gaining: neither is a migration.
  { txid: "n1", day: D0, kind: "shielded", sa: -20 },
  { txid: "n2", day: D0, kind: "shielded", iw: 5, oc: 5, sa: -20 },
  { txid: "s4", day: D1, kind: "mixed", direction: "shielding", iw: 900 },
  { txid: "u2", day: D1, kind: "mixed", direction: "unshielding", oc: -2_000 },
  { txid: "m3", day: D1, kind: "shielded", sa: -3_000, oc: 2_990 },
  { txid: "s5", day: D2, kind: "mixed", direction: "shielding", sa: 50 },
];

describeDb("boundary_daily", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));
    let height = 100;
    for (const day of [D0, D1, D2]) {
      for (const f of FIXTURES.filter((x) => x.day === day)) {
        height += 1;
        await pool.query(
          `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
           VALUES ($1, $2, $3, $4, 1000, 1)`,
          [height, `h${height}`.padEnd(64, "0"), `p${height}`.padEnd(64, "0"), day + height],
        );
        await pool.query(
          `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, direction, size_bytes,
                           version, sprout_joinsplits, sprout_vpub_net_zat, sapling_spends,
                           sapling_outputs, sapling_value_balance_zat, orchard_actions,
                           orchard_value_balance_zat, ironwood_actions, ironwood_value_balance_zat)
           VALUES ($1, $2, $3, false, $4, $5, 200, 5, $6, $7, $8, $8, $9, $10, $11, $12, $13)`,
          [
            f.txid.padEnd(64, "0"),
            height,
            day + height,
            f.kind,
            f.direction ?? null,
            f.sproutVpub === undefined ? null : 1,
            f.sproutVpub ?? null,
            f.sa === undefined ? null : 1,
            f.sa ?? null,
            f.oc === undefined ? null : 2,
            f.oc ?? null,
            f.iw === undefined ? null : 2,
            f.iw ?? null,
          ],
        );
      }
    }
    for (const view of [
      "chain_day_rollup",
      "chain_day_shielding_flow",
      "chain_day_fee_total",
      "chain_day_network",
      "chain_day_pool_migration",
    ]) {
      await pool.query(`REFRESH MATERIALIZED VIEW ${view}`);
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  const tx = (id: string) => id.padEnd(64, "0");

  it("counts a day and keeps its maxima, naming a txid only when the maximum is unique", async () => {
    const d0 = await computeBoundaryDay(pool, D0);
    expect(d0).toMatchObject({
      shieldingTxs: 3,
      unshieldingTxs: 1,
      indeterminateTxs: 1,
      migrationTxs: 2,
      // Two shieldings of 900 tie: the amount is kept, no transaction is named.
      shielding: { zat: 900, ties: 2, txid: null },
      unshielding: { zat: 700, ties: 1, txid: tx("u1") },
      migration: { zat: 990, ties: 1, txid: tx("m1") },
    });
  });

  it("counts migrations exactly as the follower's chain_day_pool_migration does", async () => {
    for (const day of [D0, D1, D2]) {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT COALESCE(sum(txs), 0)::text AS n FROM chain_day_pool_migration
          WHERE day = (to_timestamp($1) AT TIME ZONE 'UTC')::date`,
        [day],
      );
      expect((await computeBoundaryDay(pool, day)).migrationTxs, String(day)).toBe(
        Number(rows[0]!.n),
      );
    }
  });

  const windowCounts = async () => {
    const { rows } = await pool.query<{ bucket_ts: string; shielding_txs: string }>(
      aggregateSql("day"),
      [D0, D3],
    );
    return Object.fromEntries(rows.map((r) => [Number(r.bucket_ts), Number(r.shielding_txs)]));
  };

  it("gives the window the same counts from the table as from tx, and reads the table", async () => {
    const fromTx = await windowCounts();
    expect(fromTx).toEqual({ [D0]: 3, [D1]: 1, [D2]: 1 });
    for (const day of [D0, D1, D2]) {
      await upsertBoundaryDay(pool, await computeBoundaryDay(pool, day), 1);
    }
    expect(await windowCounts()).toEqual(fromTx);
    // Proof the covered days come from the table: a different number there shows through.
    await pool.query(
      "UPDATE boundary_daily SET shielding_txs = 77 WHERE day = (to_timestamp($1) AT TIME ZONE 'UTC')::date",
      [D1],
    );
    expect(await windowCounts()).toEqual({ ...fromTx, [D1]: 77 });
    // A gap ends the coverage: D1 onward is read from tx again, exact.
    await pool.query(
      "DELETE FROM boundary_daily WHERE day = (to_timestamp($1) AT TIME ZONE 'UTC')::date",
      [D1],
    );
    expect(await windowCounts()).toEqual(fromTx);
  });

  it("folds the all-time records, with ties across days and the coverage stated", async () => {
    for (const day of [D0, D1, D2]) {
      await upsertBoundaryDay(pool, await computeBoundaryDay(pool, day), 1);
    }
    const r = await readCrossingRecords(pool);
    expect(r.complete).toBe(true);
    // 900 on D0 (twice) and D1 (once): three ties, so no transaction is the record.
    // Heights follow the insert order: D0's nine transactions take 101–109, then D1's s4, u2, m3.
    expect(r.shielding).toEqual({
      amountZat: 900,
      ties: 3,
      txid: null,
      height: null,
      considered: 5,
    });
    expect(r.unshielding).toEqual({
      amountZat: 2_000,
      ties: 1,
      txid: tx("u2"),
      height: 111,
      considered: 2,
    });
    expect(r.migration).toEqual({
      amountZat: 2_990,
      ties: 1,
      txid: tx("m3"),
      height: 112,
      considered: 3,
    });
    await pool.query(
      "DELETE FROM boundary_daily WHERE day = (to_timestamp($1) AT TIME ZONE 'UTC')::date",
      [D1],
    );
    expect((await readCrossingRecords(pool)).complete).toBe(false);
  });
});

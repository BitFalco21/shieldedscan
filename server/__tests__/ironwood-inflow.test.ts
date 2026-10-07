// server/__tests__/ironwood-inflow.test.ts
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyticsRoutes } from "../analytics-routes";

/**
 * `/chain/analytics/ironwood`'s transparent term, against the real schema. It is the
 * per-transaction balance identity (fee plus the domain-sign pool balances, minus Sprout's
 * RPC-sign one), with a join on `tx_transparent_io` kept only for a row whose fee is unknown; a
 * per-transaction join over that table is too slow at scale. This pins that the identity equals
 * what the inputs and outputs actually sum to on every shape that matters, and that a wrong sign
 * fails.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_ironwood_inflow_test";
const ACTIVATION = 3_428_143;
const ZEC = 100_000_000;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

interface Seed {
  txid: string;
  kind: "shielded" | "mixed" | "coinbase";
  fee: number | null;
  /** DOMAIN sign: positive = value entering the pool. */
  ironwood: number;
  orchard?: number;
  /** Transparent inputs and outputs, in zatoshi. */
  ins?: number[];
  outs?: number[];
}

const SEEDS: Seed[] = [
  // Shielding from transparent: 5 ZEC in, plus the fee.
  { txid: "f1", kind: "mixed", fee: 10_000, ironwood: 5 * ZEC, ins: [5 * ZEC + 10_000] },
  // A pure Orchard → Ironwood migration: no transparent side at all.
  { txid: "f2", kind: "shielded", fee: 15_000, ironwood: 2 * ZEC - 15_000, orchard: -2 * ZEC },
  // Unshielding to transparent, with change back into the pool and two outputs.
  {
    txid: "f3",
    kind: "mixed",
    fee: 10_000,
    ironwood: -(1 * ZEC + 10_000),
    outs: [70_000_000, 30_000_000],
  },
  // A ZIP-213 coinbase straight into Ironwood: issuance, never part of the transparent term.
  { txid: "f4", kind: "coinbase", fee: null, ironwood: 3 * ZEC, outs: [12 * ZEC] },
  // An unknown fee: the identity has nothing to start from, so the join answers for this row.
  { txid: "f5", kind: "mixed", fee: null, ironwood: 1 * ZEC, ins: [1 * ZEC + 20_000] },
];

/** What the inputs and outputs say, non-coinbase only — the join's own definition. */
const EXPECTED_TRANSPARENT = SEEDS.filter((s) => s.kind !== "coinbase").reduce(
  (sum, s) =>
    sum + (s.ins ?? []).reduce((a, b) => a + b, 0) - (s.outs ?? []).reduce((a, b) => a + b, 0),
  0,
);

describeDb("/chain/analytics/ironwood transparent term", () => {
  let pool: Pool;
  let url: string;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    url = withDatabase(DATABASE_URL!, TEST_DB);
    pool = new Pool({ connectionString: url });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));

    const height = ACTIVATION + 10;
    await pool.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
       VALUES ($1, 'h1', 'h0', 1785000000, 1000, $2)`,
      [height, SEEDS.length],
    );
    for (const s of SEEDS) {
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version,
                         fee_zat, ironwood_actions, ironwood_value_balance_zat,
                         orchard_actions, orchard_value_balance_zat)
         VALUES ($1, $2, 1785000000, $3, $4, 500, 6, $5, 2, $6, $7, $8)`,
        [
          s.txid,
          height,
          s.kind === "coinbase",
          s.kind,
          s.fee,
          s.ironwood,
          s.orchard === undefined ? null : 2,
          s.orchard ?? null,
        ],
      );
      const rows = [
        ...(s.ins ?? []).map((v) => ["in", v] as const),
        ...(s.outs ?? []).map((v) => ["out", v] as const),
      ];
      for (const [i, [io, value]] of rows.entries()) {
        await pool.query(
          `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat)
           VALUES ($1, $2, $3, 't1x', $4)`,
          [s.txid, io, i, value],
        );
      }
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("equals what the transparent inputs and outputs sum to, the coinbase excluded", async () => {
    const res = await analyticsRoutes(url).request("/chain/analytics/ironwood");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { netFromTransparentZat: number; balanceZat: number };
    expect(body.netFromTransparentZat).toBe(EXPECTED_TRANSPARENT);
    expect(body.balanceZat).toBe(SEEDS.reduce((sum, s) => sum + s.ironwood, 0));
  });
});

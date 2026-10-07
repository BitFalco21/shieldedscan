import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import {
  assembleIronwoodMigrations,
  IRONWOOD_MIGRATIONS_SQL,
  migrationUsdText,
  POOL_MIGRATION_MATRIX_SQL,
  type IronwoodMigrationRow,
  type PoolMigrationMatrixRow,
} from "../analytics-routes";

/**
 * Pool migrations: the since-activation into-Ironwood totals, the trailing all-pools matrix, and
 * the dollar valuation both carry.
 *
 * The SQL transcribes `poolMigration`'s definition, so the real queries run against a real
 * database over rows that exercise every branch. The accumulation and the USD text are pure and
 * tested below without a database.
 *
 * The fixture includes the shapes that must not count: an Ironwood-only fully shielded transfer
 * with no source pool, a shielding transaction (kind 'mixed', a transparent source), a
 * two-destination transaction (which `poolMigration` refuses to apportion), a shielded coinbase,
 * a pre-activation row, and a mempool row (block_height NULL).
 *
 * Closes exist for every fixture day except today's, as in production (`zec_price_daily` stores
 * only ended days), so the mixed closes-plus-spot basis is exercised.
 *
 *   docker run -d --name pgtest -e POSTGRES_PASSWORD=test -e POSTGRES_DB=explorer \
 *     -p 55432:5432 postgres:17
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/ironwood-migrations.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const TEST_DB = "explorer_ironwood_migrations_test";
const ACTIVATION = 3_428_143;
// 21:06 UTC, so every "hours old" row falls on TODAY (no stored close) and every "days old"
// row on an ended day (stored close) — the two pricing bases, both exercised.
const NOW = 1_785_100_000;
const HOUR = 3_600;
const DAY = 86_400;
const ZEC = 100_000_000;
/** Stored close for every ended fixture day. */
const CLOSE = 2;
/** Injected live price for today's rows. */
const SPOT = 3;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

interface Row {
  txid: string;
  height: number | null;
  /** Seconds before NOW — how old the transaction is. */
  age: number;
  kind: "shielded" | "mixed" | "coinbase";
  ironwood?: number;
  orchard?: number;
  sapling?: number;
  sproutVpubNet?: number;
}

/**
 * Ages are chosen so every window differs: rows inside 24h, more inside 7d, more inside 30d,
 * one older — plus the excluded shapes at ages where counting them would visibly change a
 * window. Amounts are in whole ZEC (×1e8) so the dollar texts land above the cent grain.
 */
const ROWS: Row[] = [
  // Orchard → Ironwood, one per bracket.
  {
    txid: "a1",
    height: ACTIVATION + 900,
    age: 2 * HOUR,
    kind: "shielded",
    ironwood: 1_000 * ZEC,
    orchard: -1_010 * ZEC,
  },
  {
    txid: "a2",
    height: ACTIVATION + 700,
    age: 3 * DAY,
    kind: "shielded",
    ironwood: 2_000 * ZEC,
    orchard: -2_010 * ZEC,
  },
  {
    txid: "a3",
    height: ACTIVATION + 400,
    age: 20 * DAY,
    kind: "shielded",
    ironwood: 4_000 * ZEC,
    orchard: -4_010 * ZEC,
  },
  // Older than 30d: in sinceActivation only, absent from every matrix window.
  {
    txid: "a4",
    height: ACTIVATION + 100,
    age: 60 * DAY,
    kind: "shielded",
    ironwood: 8_000 * ZEC,
    orchard: -8_010 * ZEC,
  },
  // Sapling → Ironwood, inside 7d only.
  {
    txid: "s1",
    height: ACTIVATION + 650,
    age: 4 * DAY,
    kind: "shielded",
    ironwood: 300 * ZEC,
    sapling: -310 * ZEC,
  },
  // Multi-source (Orchard AND Sapling) → Ironwood, inside 24h. Counted whole, never split.
  {
    txid: "m1",
    height: ACTIVATION + 910,
    age: 5 * HOUR,
    kind: "shielded",
    ironwood: 500 * ZEC,
    orchard: -260 * ZEC,
    sapling: -250 * ZEC,
  },
  // Sprout → Ironwood (RPC sign: positive vpub = leaving Sprout), inside 30d.
  {
    txid: "p1",
    height: ACTIVATION + 300,
    age: 25 * DAY,
    kind: "shielded",
    ironwood: 90 * ZEC,
    sproutVpubNet: 95 * ZEC,
  },
  // OTHER destinations — the matrix half. Absent from sinceActivation, which is Ironwood-only.
  {
    txid: "b1",
    height: ACTIVATION + 905,
    age: 10 * HOUR,
    kind: "shielded",
    orchard: 700 * ZEC,
    sapling: -710 * ZEC,
  },
  {
    txid: "b2",
    height: ACTIVATION + 800,
    age: 2 * DAY,
    kind: "shielded",
    orchard: 900 * ZEC,
    ironwood: -910 * ZEC,
  },
  {
    txid: "b3",
    height: ACTIVATION + 500,
    age: 10 * DAY,
    kind: "shielded",
    sapling: 1_100 * ZEC,
    orchard: -1_110 * ZEC,
  },
  // EXCLUDED — Ironwood-only fully shielded transfer: the pool was used, nothing migrated.
  { txid: "x1", height: ACTIVATION + 920, age: 1 * HOUR, kind: "shielded", ironwood: 70 * ZEC },
  // EXCLUDED — a shielding (kind 'mixed'): the source is transparent, not a pool.
  { txid: "x2", height: ACTIVATION + 930, age: 1 * HOUR, kind: "mixed", ironwood: 600 * ZEC },
  // EXCLUDED — two destinations: Sapling also gaining, the shape poolMigration refuses.
  {
    txid: "x3",
    height: ACTIVATION + 940,
    age: 1 * HOUR,
    kind: "shielded",
    ironwood: 200 * ZEC,
    orchard: -450 * ZEC,
    sapling: 250 * ZEC,
  },
  // EXCLUDED — ZIP-213 shielded coinbase: newly issued value, not a migration.
  { txid: "x4", height: ACTIVATION + 950, age: 1 * HOUR, kind: "coinbase", ironwood: 312 * ZEC },
  // EXCLUDED — pre-activation row: absent from sinceActivation (defensive; none can exist on
  // the real chain). It IS a legitimate matrix row — the matrix is bounded by time, not height.
  {
    txid: "x5",
    height: ACTIVATION - 10,
    age: 40 * DAY,
    kind: "shielded",
    ironwood: 40 * ZEC,
    orchard: -45 * ZEC,
  },
  // EXCLUDED from the matrix — a mempool migration is not confirmed, not a measurement.
  {
    txid: "x6",
    height: null,
    age: 1 * HOUR,
    kind: "shielded",
    ironwood: 25 * ZEC,
    orchard: -26 * ZEC,
  },
];

const utcDay = (unixSec: number): string => new Date(unixSec * 1000).toISOString().slice(0, 10);

describeDb("pool migration windows (real database)", () => {
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
    // Both real schemas: tx lives in the chain schema, zec_price_daily in the API schema, and
    // production holds them in one database — which is what the price join stands on.
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));
    for (const r of ROWS) {
      if (r.height !== null) {
        await pool.query(
          `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
           VALUES ($1, $2, $3, $4, 1000, 1) ON CONFLICT DO NOTHING`,
          [r.height, `h${r.height}`.padEnd(64, "0"), `p${r.height}`.padEnd(64, "0"), NOW - r.age],
        );
      }
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version,
                         ironwood_actions, ironwood_value_balance_zat,
                         orchard_actions, orchard_value_balance_zat,
                         sapling_spends, sapling_outputs, sapling_value_balance_zat,
                         sprout_joinsplits, sprout_vpub_net_zat)
         VALUES ($1, $2, $3, $4, $5, 200, 5,
                 $6, $7, $8, $9, $10, $10, $11, $12, $13)`,
        [
          r.txid.padEnd(64, "0"),
          r.height,
          NOW - r.age,
          r.kind === "coinbase",
          r.kind,
          r.ironwood === undefined ? null : 2,
          r.ironwood ?? null,
          r.orchard === undefined ? null : 2,
          r.orchard ?? null,
          r.sapling === undefined ? null : 1,
          r.sapling ?? null,
          r.sproutVpubNet === undefined ? 0 : 1,
          r.sproutVpubNet ?? null,
        ],
      );
    }
    // A close for every ENDED fixture day, none for today — production's shape by construction.
    const today = utcDay(NOW);
    const days = new Set(ROWS.map((r) => utcDay(NOW - r.age)));
    for (const day of days) {
      if (day === today) continue;
      await pool.query(
        `INSERT INTO zec_price_daily (day, usd, source, fetched_at)
         VALUES ($1, $2, 'test', $3) ON CONFLICT DO NOTHING`,
        [day, CLOSE, NOW],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  const run = async (spot: number | null = SPOT) => {
    const [since, matrix] = await Promise.all([
      pool.query<IronwoodMigrationRow>(IRONWOOD_MIGRATIONS_SQL, [ACTIVATION]),
      pool.query<PoolMigrationMatrixRow>(POOL_MIGRATION_MATRIX_SQL, [
        NOW - 24 * HOUR,
        NOW - 7 * DAY,
        NOW - 30 * DAY,
      ]),
    ]);
    return assembleIronwoodMigrations(since.rows, matrix.rows, NOW, spot);
  };

  const pair = (
    m: Awaited<ReturnType<typeof run>>,
    w: "last24Hours" | "last7Days" | "last30Days",
    from: string,
    to: string,
  ) => m[w].pairs.find((p) => p.from === from && p.to === to);

  it("the 24h matrix carries every destination, and each excluded shape stays out", async () => {
    const m = await run();
    // a1 (orchard→iw), m1 (multi→iw), b1 (sapling→orchard). The six excluded rows all sit
    // inside this window, so any of them counting would change these figures.
    expect(m.last24Hours.txCount).toBe(3);
    expect(m.last24Hours.amountZat).toBe(2_200 * ZEC);
    expect(pair(m, "last24Hours", "orchard", "ironwood")).toMatchObject({
      txCount: 1,
      amountZat: 1_000 * ZEC,
    });
    expect(pair(m, "last24Hours", "multi", "ironwood")).toMatchObject({
      txCount: 1,
      amountZat: 500 * ZEC,
    });
    expect(pair(m, "last24Hours", "sapling", "orchard")).toMatchObject({
      txCount: 1,
      amountZat: 700 * ZEC,
    });
    expect(m.last24Hours.pairs).toHaveLength(3);
  });

  it("windows nest cumulatively and totals sum the pairs", async () => {
    const m = await run();
    // 7d adds a2 (orchard→iw), s1 (sapling→iw), b2 (ironwood→orchard).
    expect(m.last7Days.txCount).toBe(6);
    expect(m.last7Days.amountZat).toBe(5_400 * ZEC);
    expect(pair(m, "last7Days", "ironwood", "orchard")).toMatchObject({
      txCount: 1,
      amountZat: 900 * ZEC,
    });
    // 30d adds a3, p1 (sprout→iw), b3 (orchard→sapling).
    expect(m.last30Days.txCount).toBe(9);
    expect(pair(m, "last30Days", "orchard", "sapling")).toMatchObject({
      txCount: 1,
      amountZat: 1_100 * ZEC,
    });
    expect(pair(m, "last30Days", "sprout", "ironwood")).toMatchObject({
      txCount: 1,
      amountZat: 90 * ZEC,
    });
    for (const w of ["last24Hours", "last7Days", "last30Days"] as const) {
      expect(m[w].txCount).toBe(m[w].pairs.reduce((t, p) => t + p.txCount, 0));
      expect(m[w].amountZat).toBe(m[w].pairs.reduce((t, p) => t + p.amountZat, 0));
    }
  });

  it("sinceActivation stays into-Ironwood only, pre-activation and other pools excluded", async () => {
    const m = await run();
    // a1..a4, s1, m1, p1 — never b1/b2/b3 (other destinations) and never x5 (pre-activation).
    expect(m.sinceActivation.txCount).toBe(7);
    expect(m.sinceActivation.amountZat).toBe(15_890 * ZEC);
    expect(m.sinceActivation.fromOrchard).toMatchObject({ txCount: 4, amountZat: 15_000 * ZEC });
    expect(m.sinceActivation.fromSapling).toMatchObject({ txCount: 1, amountZat: 300 * ZEC });
    expect(m.sinceActivation.fromSprout).toMatchObject({ txCount: 1, amountZat: 90 * ZEC });
    expect(m.sinceActivation.multiSource).toMatchObject({ txCount: 1, amountZat: 500 * ZEC });
  });

  /*
   * Every since-activation source bucket carries its own USD figure: splitting the total or
   * applying a spot price are both forbidden to a consumer, so the payload must carry it.
   */
  it("prices every since-activation source bucket, on the same bases as the block's total", async () => {
    const m = await run();
    for (const key of ["fromOrchard", "fromSapling", "fromSprout", "multiSource"] as const) {
      expect(m.sinceActivation[key].valueUsdText, key).toEqual(expect.any(String));
    }
    // The same bases as the total, and the SHORT form: the total names them once, and four
    // copies of that sentence is the noise the matrix pairs already avoid.
    expect(m.sinceActivation.fromOrchard.valueUsdText).toMatch(/^≈ \$[\d,]+\.\d\d$/);
    expect(m.sinceActivation.fromOrchard.valueUsdText).not.toMatch(/stored close|current price/);
    expect(m.sinceActivation.valueUsdText).toMatch(/stored close/);
  });

  it("prices ended days at their close and today's rows at the live price, both bases named", async () => {
    const m = await run();
    // 24h: all three rows are today's — no closes — so the whole figure rides the spot price:
    // 2,200 ZEC × $3.
    expect(m.last24Hours.valueUsdText).toContain("≈ $6,600.00");
    expect(m.last24Hours.valueUsdText).toMatch(/current price \(\$3\.00\)/);
    expect(m.last24Hours.valueUsdText).toMatch(/not each transfer's moment/i);
    // 7d: 3,200 ZEC on closed days × $2 + 2,200 ZEC today × $3 = $6,400 + $6,600.
    expect(m.last7Days.valueUsdText).toContain("≈ $13,000.00");
    // A pair wholly on ended days is at-close only, short form.
    expect(pair(m, "last7Days", "ironwood", "orchard")!.valueUsdText).toBe("≈ $1,800.00");
    // sinceActivation: 14,390 ZEC at close + 1,500 ZEC at spot.
    expect(m.sinceActivation.valueUsdText).toContain("≈ $33,280.00");
  });

  it("without a live price, a partly-unpriced figure degrades to a floor", async () => {
    const m = await run(null);
    // 24h is entirely today: nothing priced, no spot — null, never $0.
    expect(m.last24Hours.valueUsdText).toBeNull();
    expect(pair(m, "last24Hours", "orchard", "ironwood")!.valueUsdText).toBeNull();
    // 7d has priced days plus today's remainder: a stated floor.
    expect(m.last7Days.valueUsdText).toContain("≥ $6,400.00");
    expect(m.last7Days.valueUsdText).toMatch(/unpriced/);
  });
});

describe("IRONWOOD_MIGRATIONS_SQL plan shape", () => {
  // A plan cannot be asserted on a fixture database (the planner's choice turns on production
  // statistics), but the fence that produces the intended plan can be pinned. Unfenced, a
  // `kind =` filter pulls the large tx_kind_keyset_idx into the plan.
  it("reads tx behind a MATERIALIZED fence that never filters on kind", () => {
    const fence = /WITH r AS MATERIALIZED \(([\s\S]*?)\n \)/.exec(IRONWOOD_MIGRATIONS_SQL);
    expect(fence).not.toBeNull();
    expect(fence![1]).toMatch(/FROM tx\b/);
    expect(fence![1]).not.toMatch(/\bkind\s*=/);
    expect(IRONWOOD_MIGRATIONS_SQL).toMatch(/FROM r\s+WHERE kind = 'shielded'/);
  });
});

describe("assembleIronwoodMigrations (pure)", () => {
  const row = (
    over: Partial<PoolMigrationMatrixRow> &
      Pick<PoolMigrationMatrixRow, "dest" | "source" | "bracket">,
  ): PoolMigrationMatrixRow => ({
    txs: 0,
    zat: 0,
    priced_txs: 0,
    priced_zat: 0,
    priced_usd: 0,
    ...over,
  });

  it("an empty row set is a real answer: every window zero, edges still stated", () => {
    const m = assembleIronwoodMigrations([], [], 1_785_100_000, null);
    expect(m.sinceActivation.txCount).toBe(0);
    expect(m.sinceActivation.valueUsdText).toBeNull();
    expect(m.last24Hours).toMatchObject({
      txCount: 0,
      amountZat: 0,
      fromTimestamp: 1_785_100_000 - 24 * 3600,
      pairs: [],
    });
  });

  it("accumulates smallest-bracket cells into nested windows, largest flow first", () => {
    const m = assembleIronwoodMigrations(
      [],
      [
        row({ dest: "ironwood", source: "orchard", bracket: "h24", txs: 1, zat: 10 }),
        row({ dest: "ironwood", source: "orchard", bracket: "d7", txs: 2, zat: 20 }),
        row({ dest: "orchard", source: "sapling", bracket: "d7", txs: 5, zat: 500 }),
        row({ dest: "sapling", source: "multi", bracket: "d30", txs: 1, zat: 5 }),
      ],
      1_785_100_000,
      null,
    );
    expect(m.last24Hours.txCount).toBe(1);
    expect(m.last7Days.txCount).toBe(8);
    expect(m.last7Days.pairs.map((p) => `${p.from}→${p.to}`)).toEqual([
      "sapling→orchard",
      "orchard→ironwood",
    ]);
    expect(m.last30Days.txCount).toBe(9);
    expect(m.last30Days.pairs).toHaveLength(3);
  });
});

describe("migrationUsdText", () => {
  const cell = (over: Partial<Parameters<typeof migrationUsdText>[0]>) => ({
    txCount: 0,
    amountZat: 0,
    pricedTxs: 0,
    pricedZat: 0,
    pricedUsd: 0,
    ...over,
  });

  it("fully priced: at-close figure, basis named only in the verbose form", () => {
    const c = cell({
      txCount: 2,
      amountZat: 200e8,
      pricedTxs: 2,
      pricedZat: 200e8,
      pricedUsd: 400e8,
    });
    expect(migrationUsdText(c, null, false)).toBe("≈ $400.00");
    expect(migrationUsdText(c, null, true)).toMatch(/own day's stored close/);
  });

  it("mixed bases: today's remainder at the spot price, both bases in the verbose text", () => {
    const c = cell({
      txCount: 3,
      amountZat: 300e8,
      pricedTxs: 2,
      pricedZat: 200e8,
      pricedUsd: 400e8,
    });
    expect(migrationUsdText(c, 3, false)).toBe("≈ $700.00");
    expect(migrationUsdText(c, 3, true)).toMatch(/stored close.*current price \(\$3\.00\)/s);
  });

  it("no spot: a floor when something was priced, null when nothing was — never $0", () => {
    const partly = cell({
      txCount: 3,
      amountZat: 300e8,
      pricedTxs: 2,
      pricedZat: 200e8,
      pricedUsd: 400e8,
    });
    expect(migrationUsdText(partly, null, false)).toBe("≥ $400.00");
    const nothing = cell({ txCount: 3, amountZat: 300e8 });
    expect(migrationUsdText(nothing, null, true)).toBeNull();
    expect(migrationUsdText(nothing, 0, true)).toBeNull();
    expect(migrationUsdText(cell({}), 3, true)).toBeNull();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { pulseEventForTx, type PulseEvent, type Transaction } from "@/domain";

/**
 * The two matviews `/pulse` reads must agree with the domain functions they transcribe.
 *
 * `chain_day_pool_boundary` is a second copy of `boundaryCrossing` + `pathLegs`, written in SQL
 * because a TypeScript function cannot be interpolated into the `.sql` file the follower applies.
 * This sums `pulseEventForTx`'s own legs over a UTC day and compares them to the view cell for
 * cell, with no tolerance, since a tolerance is where drift would hide.
 *
 * `chain_day_supply_close` holds the closing balances the mined edge is differenced from. Unlike
 * `chain_day_rollup`, which COALESCEs an absent pool to zero (right for a chart, wrong in a
 * subtraction), it keeps nulls: the four pools must agree where a balance exists and differ where
 * one does not.
 *
 * Needs a real database; creates its own and skips without TEST_DATABASE_URL.
 *
 *   TEST_DATABASE_URL=postgres://test:test@127.0.0.1:55433/test \
 *     npx vitest run server/__tests__/pulse-matview-agreement.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const TEST_DB = "explorer_pulse_matview_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createTestDatabase(url: string): Promise<string> {
  const admin = new Pool({ connectionString: withDatabase(url, "postgres"), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
  return withDatabase(url, TEST_DB);
}

/** 2026-03-04T12:00:00Z and 2026-03-05T12:00:00Z — two whole UTC days apart. */
const DAY_ONE = Date.UTC(2026, 2, 4, 12) / 1000;
const DAY_TWO = Date.UTC(2026, 2, 5, 12) / 1000;

/**
 * One fixture transaction, described in terms BOTH sides of the parity check understand: the
 * same row is inserted into Postgres and built into a domain `Transaction`, so the two
 * implementations are compared rather than each asserted against a hand-written expectation.
 *
 * `sproutVpubNet` is in RPC sign (positive = LEAVING Sprout), exactly as the column stores it,
 * so the negation the store does once at its boundary is itself under test.
 */
interface Fixture {
  txid: string;
  height: number;
  timestamp: number;
  kind: "transparent" | "mixed" | "shielded" | "coinbase";
  direction: "shielding" | "unshielding" | "indeterminate" | null;
  ins: number[];
  outs: number[];
  sprout?: { joinSplits: number; vpubNet: number };
  sapling?: number | null;
  orchard?: number | null;
  ironwood?: number | null;
  /** Why this row is here — every one of them can break something. */
  note: string;
}

const FIXTURES: Fixture[] = [
  {
    txid: "a".repeat(64),
    height: 100,
    timestamp: DAY_ONE,
    kind: "mixed",
    direction: "shielding",
    ins: [600_000_000],
    outs: [],
    sapling: 500_000_000,
    note: "a plain shielding: transparent in, Sapling gains",
  },
  {
    txid: "b".repeat(64),
    height: 101,
    timestamp: DAY_ONE,
    kind: "mixed",
    direction: "shielding",
    ins: [400_000_000],
    outs: [90_000_000],
    orchard: 300_000_000,
    sapling: -100_000_000,
    note: "net shielding while SAPLING FELL — boundaryCrossing withdraws, so it is a hub",
  },
  {
    txid: "c".repeat(64),
    height: 102,
    timestamp: DAY_ONE,
    kind: "mixed",
    direction: "unshielding",
    ins: [],
    outs: [700_000_000],
    orchard: -700_010_000,
    note: "a plain unshielding out of Orchard",
  },
  {
    txid: "d".repeat(64),
    height: 103,
    timestamp: DAY_ONE,
    kind: "mixed",
    direction: "unshielding",
    ins: [],
    outs: [500_000_000],
    // RPC sign: positive means value LEFT Sprout, so the domain leg is `sprout → transparent`.
    sprout: { joinSplits: 2, vpubNet: 500_000_000 },
    note: "Sprout's public JoinSplit value, in the sign the column stores",
  },
  {
    txid: "e".repeat(64),
    height: 104,
    timestamp: DAY_ONE,
    kind: "mixed",
    direction: "indeterminate",
    ins: [200_000_000],
    outs: [100_000_000],
    sapling: 100_000_000,
    orchard: -200_000_000,
    note: "the pools moved opposite ways — a hub by definition",
  },
  {
    txid: "f".repeat(64),
    height: 105,
    timestamp: DAY_ONE,
    kind: "coinbase",
    direction: null,
    ins: [],
    outs: [212_500_000],
    ironwood: 100_000_000,
    note: "a ZIP-213 coinbase paying part of the subsidy into a pool",
  },
  {
    txid: "1".repeat(64),
    height: 106,
    timestamp: DAY_ONE,
    kind: "mixed",
    direction: "shielding",
    ins: [300_000_000],
    outs: [],
    sapling: 200_000_000,
    orchard: 0,
    note: "an Orchard bundle at exactly zero beside a real shielding — present, but no leg",
  },
  {
    txid: "2".repeat(64),
    height: 107,
    timestamp: DAY_ONE,
    kind: "shielded",
    direction: null,
    ins: [],
    outs: [],
    orchard: -400_000_000,
    ironwood: 400_000_000,
    note: "a pool migration: the migration view's business, and never the boundary's",
  },
  {
    txid: "3".repeat(64),
    height: 200,
    timestamp: DAY_TWO,
    kind: "mixed",
    direction: "shielding",
    ins: [900_000_000],
    outs: [],
    ironwood: 800_000_000,
    note: "the next UTC day, so day bucketing is exercised rather than assumed",
  },
];

/**
 * The same fixture as the domain `Transaction` the index would hydrate.
 *
 * A typed literal rather than a cast, so a field added to `Transaction` breaks this file
 * instead of arriving as `undefined` inside the function under test.
 */
function asTransaction(f: Fixture): Transaction {
  return {
    txid: f.txid,
    blockHeight: f.height,
    blockHash: `h${f.height}`.padEnd(64, "0"),
    timestamp: f.timestamp,
    isCoinbase: f.kind === "coinbase",
    version: 5,
    sizeBytes: 200,
    lockTime: null,
    expiryHeight: null,
    rawHex: null,
    feeZat: 10_000,
    bindingSigValid: true,
    transparentInputs: f.ins.map((valueZat, i) => ({ address: `t1in${i}`, valueZat })),
    transparentOutputs: f.outs.map((valueZat, i) => ({ address: `t1out${i}`, valueZat })),
    sprout: f.sprout ? { joinSplits: f.sprout.joinSplits } : null,
    sapling:
      f.sapling === undefined ? null : { spends: 1, outputs: 1, valueBalanceZat: f.sapling ?? 0 },
    orchard: f.orchard === undefined ? null : { actions: 2, valueBalanceZat: f.orchard ?? 0 },
    ironwood: f.ironwood === undefined ? null : { actions: 2, valueBalanceZat: f.ironwood ?? 0 },
  };
}

/** The UTC day a fixture falls in, as `YYYY-MM-DD` — the key the view groups by. */
const utcDay = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

interface Cell {
  shieldedZat: number;
  shieldedTxs: number;
  unshieldedZat: number;
  unshieldedTxs: number;
  coinbaseZat: number;
  coinbaseTxs: number;
  hubZat: number;
  hubTxs: number;
}

const emptyCell = (): Cell => ({
  shieldedZat: 0,
  shieldedTxs: 0,
  unshieldedZat: 0,
  unshieldedTxs: 0,
  coinbaseZat: 0,
  coinbaseTxs: 0,
  hubZat: 0,
  hubTxs: 0,
});

/**
 * The view's own shape, computed from the domain events instead.
 *
 * A `hub` event is counted ONCE, under the pseudo-pool `hub`, and only its POOL legs are
 * summed: its transparent leg is a net over the transaction's own public sides, and adding it
 * to a magnitude of pool movement would be adding two different quantities.
 */
function cellsFromEvents(events: readonly PulseEvent[]): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const at = (day: string, pool: string): Cell => {
    const key = `${day}|${pool}`;
    const cell = cells.get(key) ?? emptyCell();
    cells.set(key, cell);
    return cell;
  };

  for (const event of events) {
    const day = utcDay(event.at);
    if (event.shape === "hub") {
      const cell = at(day, "hub");
      cell.hubTxs += 1;
      for (const leg of event.legs) {
        if (leg.to === "transparent" || leg.amountZat === null) continue;
        cell.hubZat += Math.abs(leg.amountZat);
      }
      continue;
    }
    for (const leg of event.legs) {
      if (leg.amountZat === null) continue;
      // A coinbase's `mined → transparent` leg belongs to neither side of the boundary: it is
      // issuance, and the view measures issuance from the supply closes instead.
      if (leg.from === "transparent" && leg.to !== "transparent") {
        const cell = at(day, leg.to);
        cell.shieldedZat += leg.amountZat;
        cell.shieldedTxs += 1;
      } else if (leg.to === "transparent" && leg.from !== "transparent" && leg.from !== "mined") {
        const cell = at(day, leg.from);
        cell.unshieldedZat += leg.amountZat;
        cell.unshieldedTxs += 1;
      } else if (leg.from === "mined" && leg.to !== "transparent") {
        const cell = at(day, leg.to);
        cell.coinbaseZat += leg.amountZat;
        cell.coinbaseTxs += 1;
      }
    }
  }
  return cells;
}

describeDb("the /pulse matviews agree with the domain they transcribe", () => {
  let pool: Pool;

  beforeAll(async () => {
    const url = await createTestDatabase(DATABASE_URL as string);
    pool = new Pool({ connectionString: url });
    // The real schema, so the views under test are the ones production creates.
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));

    const heights = [...new Set(FIXTURES.map((f) => f.height))];
    for (const height of heights) {
      const f = FIXTURES.find((x) => x.height === height)!;
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count,
                            transparent_pool_zat, sprout_pool_zat, sapling_pool_zat,
                            orchard_pool_zat, ironwood_pool_zat, lockbox_pool_zat)
         VALUES ($1, $2, $3, $4, 1000, 1, 1000, 10, 20, 30, 40, 50)`,
        [height, `h${height}`.padEnd(64, "0"), `h${height - 1}`.padEnd(64, "0"), f.timestamp],
      );
    }
    for (const f of FIXTURES) {
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, direction,
                         version, size_bytes, fee_zat,
                         sprout_joinsplits, sprout_vpub_net_zat,
                         sapling_spends, sapling_outputs, sapling_value_balance_zat,
                         orchard_actions, orchard_value_balance_zat,
                         ironwood_actions, ironwood_value_balance_zat)
         VALUES ($1, $2, $3, $4, $5, $6, 5, 200, 10000, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          f.txid,
          f.height,
          f.timestamp,
          f.kind === "coinbase",
          f.kind,
          f.direction,
          f.sprout ? f.sprout.joinSplits : null,
          f.sprout ? f.sprout.vpubNet : null,
          f.sapling === undefined ? null : 1,
          f.sapling === undefined ? null : 1,
          f.sapling === undefined ? null : (f.sapling ?? 0),
          f.orchard === undefined ? null : 2,
          f.orchard === undefined ? null : (f.orchard ?? 0),
          f.ironwood === undefined ? null : 2,
          f.ironwood === undefined ? null : (f.ironwood ?? 0),
        ],
      );
      let ordinal = 0;
      for (const value of f.outs) {
        await pool.query(
          `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
           VALUES ($1, 'out', $2, $3, $4, $5)`,
          [f.txid, ordinal, `t1out${ordinal}`, value, f.height],
        );
        ordinal += 1;
      }
      ordinal = 0;
      for (const value of f.ins) {
        await pool.query(
          `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
           VALUES ($1, 'in', $2, $3, $4, $5)`,
          [f.txid, ordinal, `t1in${ordinal}`, value, f.height],
        );
        ordinal += 1;
      }
    }
    await pool.query("REFRESH MATERIALIZED VIEW chain_day_pool_boundary");
    await pool.query("REFRESH MATERIALIZED VIEW chain_day_supply_close");
    await pool.query("REFRESH MATERIALIZED VIEW chain_day_rollup");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("has rows to compare, so the comparison is not passing vacuously", async () => {
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM chain_day_pool_boundary",
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  it("files every leg exactly as pulseEventForTx does, cell for cell", async () => {
    const events = FIXTURES.map((f) =>
      pulseEventForTx(
        asTransaction(f),
        // The negation the store does once at its boundary: the column is RPC sign.
        f.sprout ? -f.sprout.vpubNet : null,
        f.kind === "coinbase" ? 10_000 : undefined,
      ),
    );
    // The migration is a `shielded` row: the boundary view excludes it, and so must this side.
    const expected = cellsFromEvents(events.filter((_, i) => FIXTURES[i]!.kind !== "shielded"));

    const { rows } = await pool.query<{
      day: string;
      pool: string;
      shielded_zat: number;
      shielded_txs: number;
      unshielded_zat: number;
      unshielded_txs: number;
      coinbase_zat: number;
      coinbase_txs: number;
      hub_zat: number;
      hub_txs: number;
    }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, pool, shielded_zat, shielded_txs,
              unshielded_zat, unshielded_txs, coinbase_zat, coinbase_txs, hub_zat, hub_txs
         FROM chain_day_pool_boundary`,
    );
    const actual = new Map<string, Cell>(
      rows.map((r) => [
        `${r.day}|${r.pool}`,
        {
          shieldedZat: Number(r.shielded_zat),
          shieldedTxs: Number(r.shielded_txs),
          unshieldedZat: Number(r.unshielded_zat),
          unshieldedTxs: Number(r.unshielded_txs),
          coinbaseZat: Number(r.coinbase_zat),
          coinbaseTxs: Number(r.coinbase_txs),
          hubZat: Number(r.hub_zat),
          hubTxs: Number(r.hub_txs),
        },
      ]),
    );

    // Same cells: one present on one side only is exactly the drift this exists to catch.
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [key, cell] of expected)
      expect({ key, ...actual.get(key)! }).toEqual({ key, ...cell });
  });

  it("states the shapes the agreement rests on, so a passing comparison is readable", async () => {
    const { rows } = await pool.query<{ day: string; pool: string; z: string; t: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, pool,
              (shielded_zat + unshielded_zat + coinbase_zat + hub_zat)::text AS z,
              (shielded_txs + unshielded_txs + coinbase_txs + hub_txs)::text AS t
         FROM chain_day_pool_boundary ORDER BY day, pool`,
    );
    const by = new Map(rows.map((r) => [`${r.day}|${r.pool}`, { z: Number(r.z), t: Number(r.t) }]));

    // Sprout: the column is RPC sign and +5e8 means value LEFT, so it is an UNSHIELDING of 5 ZEC.
    expect(by.get("2026-03-04|sprout")).toEqual({ z: 500_000_000, t: 1 });
    // The contradicted shielding and the indeterminate row: two transactions, four pool legs.
    expect(by.get("2026-03-04|hub")).toEqual({
      z: 300_000_000 + 100_000_000 + 100_000_000 + 200_000_000,
      t: 2,
    });
    // The ZIP-213 coinbase leg, and the next day's shielding, both under Ironwood.
    expect(by.get("2026-03-04|ironwood")).toEqual({ z: 100_000_000, t: 1 });
    expect(by.get("2026-03-05|ironwood")).toEqual({ z: 800_000_000, t: 1 });
    // The Orchard bundle at exactly zero produced no leg on its day's shielding row.
    expect(by.get("2026-03-04|orchard")).toEqual({ z: 700_010_000, t: 1 });
  });

  it("never files a `shielded` row: a migration crosses no boundary", async () => {
    // Both of the migration's pools moved 4 ZEC; if it had leaked in, one of these would carry it.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM chain_day_pool_boundary
        WHERE shielded_zat = 400000000 OR unshielded_zat = 400000000 OR hub_zat = 800000000`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("closes each day on its LAST block, and agrees with chain_day_rollup's four pools", async () => {
    const { rows } = await pool.query<{
      day: string;
      top_height: number;
      sprout: number | null;
      sapling: number | null;
      orchard: number | null;
      ironwood: number | null;
      r_sprout: number;
      r_sapling: number;
      r_orchard: number;
      r_ironwood: number;
      r_height: number;
    }>(
      `SELECT to_char(c.day, 'YYYY-MM-DD') AS day, c.top_height,
              c.sprout_pool_zat AS sprout, c.sapling_pool_zat AS sapling,
              c.orchard_pool_zat AS orchard, c.ironwood_pool_zat AS ironwood,
              r.sprout AS r_sprout, r.sapling AS r_sapling, r.orchard AS r_orchard,
              r.ironwood AS r_ironwood, r.top_height AS r_height
         FROM chain_day_supply_close c
         JOIN chain_day_rollup r ON r.ts = EXTRACT(EPOCH FROM c.day)::bigint
        ORDER BY c.day`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.top_height).toBe(r.r_height);
      expect([r.sprout, r.sapling, r.orchard, r.ironwood]).toEqual([
        r.r_sprout,
        r.r_sapling,
        r.r_orchard,
        r.r_ironwood,
      ]);
    }
    // The last block of each day, not the first and not the largest balance.
    expect(rows.map((r) => r.top_height)).toEqual([107, 200]);
  });

  it("keeps an absent pool ABSENT, where chain_day_rollup reads it as zero", async () => {
    // The difference that makes this view exist: `issuanceZatBetween` refuses on a null, and it
    // can only do that if the null survives. A zero here would be a wrong figure, not a small one.
    await pool.query("UPDATE block SET ironwood_pool_zat = NULL WHERE height = 200");
    await pool.query("REFRESH MATERIALIZED VIEW chain_day_supply_close");
    await pool.query("REFRESH MATERIALIZED VIEW chain_day_rollup");
    const { rows } = await pool.query<{ close: number | null; rollup: number }>(
      `SELECT c.ironwood_pool_zat AS close, r.ironwood AS rollup
         FROM chain_day_supply_close c
         JOIN chain_day_rollup r ON r.ts = EXTRACT(EPOCH FROM c.day)::bigint
        WHERE c.top_height = 200`,
    );
    expect(rows[0]!.close).toBeNull();
    expect(Number(rows[0]!.rollup)).toBe(0);
  });
});

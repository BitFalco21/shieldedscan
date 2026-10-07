import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { eligibleBoundaryCrossings } from "../boundary-events";
import { boundaryAmountZat, boundaryDirection, boundaryIsComplete } from "@/domain/boundary";
import { encodeEventWatermark } from "@/domain/watermark";

/**
 * The boundary-crossing eligibility query, against a real database. The properties here (a
 * row-value keyset over `(block_height, txid)`, a frontier computed before the floor, and a
 * magnitude ordering that must equal the domain's `boundaryAmountZat`) are SQL semantics that an
 * in-memory store never exercises.
 *
 * Skips without TEST_DATABASE_URL and creates its own database:
 *
 *   docker run -d --name bx-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_USER=explorer \
 *     -e POSTGRES_DB=explorer -p 15434:5432 postgres:17
 *   TEST_DATABASE_URL=postgres://explorer:test@localhost:15434/explorer \
 *     npx vitest run server/__tests__/boundary-events.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_boundary_events_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const TIP = 1_000;
const ZEC = 100_000_000;

/** Sixteen hex characters repeated four times, so each id is a real 64-char txid. */
function T(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

interface Row {
  txid: string;
  height: number;
  direction: "shielding" | "unshielding";
  ironwood?: number;
  orchard?: number;
  sapling?: number;
  sprout?: number;
}

const ROWS: Row[] = [
  // The biggest confirmed crossing: this must win every unfiltered poll.
  { txid: T("a"), height: 100, direction: "shielding", ironwood: 900 * ZEC },
  // Second largest, and a DIFFERENT direction — one scan serves both.
  { txid: T("b"), height: 200, direction: "unshielding", orchard: -500 * ZEC },
  // Two pools at once, and deliberately with a ZERO Orchard leg beside a real Sapling
  // one: the zero must never be named as a pool that moved.
  { txid: T("c"), height: 300, direction: "unshielding", sapling: -300 * ZEC, orchard: 0 },
  // Below the floor. It must be EXCLUDED from the candidates and still move the frontier,
  // or a quiet week advances nothing and every later poll rescans a growing range.
  { txid: T("d"), height: 400, direction: "shielding", ironwood: 1 * ZEC },
  // Pools that contradict each other. The SQL deliberately does NOT filter this out —
  // there is one definition of when a direction may be claimed and it lives in the domain.
  { txid: T("e"), height: 500, direction: "unshielding", sapling: -200 * ZEC, orchard: 5 * ZEC },
  // Too recent: inside the confirmation depth, so not eligible at any floor.
  { txid: T("f"), height: TIP - 3, direction: "shielding", ironwood: 5_000 * ZEC },
];

const FLOOR = 10 * ZEC;

describeDb("eligible boundary crossings", () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB), max: 1 });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    for (const r of ROWS) {
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, $4, 1000, 1)`,
        [
          r.height,
          `h${r.height}`.padEnd(64, "0"),
          `p${r.height}`.padEnd(64, "0"),
          1_700_000_000 + r.height,
        ],
      );
      // A bundle is whole or absent — the schema's own CHECK — so an action count travels
      // with every balance. That is also what makes row `c` faithful to the mainnet
      // transaction it models: a two-action Orchard bundle whose balance is exactly zero.
      const actions = (v: number | undefined) => (v === undefined ? null : 2);
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, direction, size_bytes,
                         version,
                         ironwood_actions, ironwood_value_balance_zat,
                         orchard_actions, orchard_value_balance_zat,
                         sapling_spends, sapling_outputs, sapling_value_balance_zat,
                         sprout_vpub_net_zat)
         VALUES ($1, $2, $3, false, 'mixed', $4, 500, 5, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          r.txid,
          r.height,
          1_700_000_000 + r.height,
          r.direction,
          actions(r.ironwood),
          r.ironwood ?? null,
          actions(r.orchard),
          r.orchard ?? null,
          r.sapling === undefined ? null : 1,
          r.sapling === undefined ? null : 1,
          r.sapling ?? null,
          r.sprout ?? null,
        ],
      );
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  const poll = (since: string | null, limit = 10) =>
    eligibleBoundaryCrossings(pool, { minZat: FLOOR, since, tipHeight: TIP, limit });

  it("returns candidates largest first, whatever order they sit in the chain", async () => {
    const { candidates } = await poll(null);
    expect(candidates.map((c) => c.txid)).toEqual([T("a"), T("b"), T("c"), T("e")]);
  });

  // The SQL's magnitude and the domain's own total must be the SAME quantity. They are two
  // expressions of one rule — one cannot be interpolated into the other — so the agreement
  // is asserted rather than assumed.
  it("orders by exactly the total the domain derives", async () => {
    const { candidates } = await poll(null);
    const totals = candidates.map(boundaryAmountZat);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    expect(totals[0]).toBe(900 * ZEC);
  });

  it("excludes a crossing below the floor", async () => {
    const { candidates } = await poll(null);
    expect(candidates.map((c) => c.txid)).not.toContain(T("d"));
  });

  it("excludes a crossing inside the confirmation depth", async () => {
    const { candidates } = await poll(null);
    expect(candidates.map((c) => c.txid)).not.toContain(T("f"));
  });

  /**
   * The frontier is computed BEFORE the floor, so a poll that posts nothing still learns how
   * far it got. Without this the watermark never moves on a quiet stretch and every later
   * poll rescans a range that only grows.
   */
  it("reports a frontier past the sub-floor rows it rejected", async () => {
    const { frontier } = await poll(null);
    expect(frontier).toBe(encodeEventWatermark(500, T("e")));
  });

  it("still reports a frontier when nothing clears the floor", async () => {
    const huge = await eligibleBoundaryCrossings(pool, {
      minZat: 1_000_000 * ZEC,
      since: null,
      tipHeight: TIP,
      limit: 10,
    });
    expect(huge.candidates).toEqual([]);
    expect(huge.frontier).toBe(encodeEventWatermark(500, T("e")));
  });

  it("has no frontier when nothing at all is eligible", async () => {
    const past = await poll(encodeEventWatermark(999, T("z")));
    expect(past.candidates).toEqual([]);
    expect(past.frontier).toBeNull();
  });

  it("seeks past the watermark, both columns", async () => {
    const { candidates } = await poll(encodeEventWatermark(200, T("b")));
    expect(candidates.map((c) => c.txid)).toEqual([T("c"), T("e")]);
  });

  /**
   * A pool whose bundle is present with a balance of exactly zero moved nothing, and must not be
   * named. Real mainnet transactions have this shape.
   */
  it("never names a pool whose balance is zero", async () => {
    const { candidates } = await poll(null);
    const twoPool = candidates.find((c) => c.txid === T("c"))!;
    expect(twoPool.pools.map((p) => p.pool)).toEqual(["sapling"]);
    expect(boundaryDirection(twoPool)).toBe("unshielding");
  });

  /**
   * A contradictory crossing is RETURNED and refused downstream. Filtering it in SQL would
   * put a second copy of the direction rule in a place the domain's tests cannot reach.
   */
  it("leaves a contradictory crossing for the domain to refuse", async () => {
    const { candidates } = await poll(null);
    const contradictory = candidates.find((c) => c.txid === T("e"))!;
    expect(contradictory.pools).toHaveLength(2);
    expect(boundaryDirection(contradictory)).toBeNull();
    expect(boundaryIsComplete({ ...contradictory, priceUsd: 500 })).toBe(false);
  });

  it("carries no price: the poster reads that once, at claim time", async () => {
    const { candidates } = await poll(null);
    expect(candidates.every((c) => c.priceUsd === null)).toBe(true);
  });

  it("bounds the batch by the limit while keeping the largest", async () => {
    const { candidates } = await poll(null, 2);
    expect(candidates.map((c) => c.txid)).toEqual([T("a"), T("b")]);
  });
});

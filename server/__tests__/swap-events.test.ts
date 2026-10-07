// server/__tests__/swap-events.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { eligibleSwaps, encodeSwapWatermark, SWAP_SETTLE_SECONDS } from "../swap-events";

/**
 * The watermark helpers are pure and tested in `src/domain/__tests__/swap.test.ts`; this file
 * uses `encodeSwapWatermark` only to build watermarks for the integration fixtures below.
 *
 * Creates and drops its own database, since suites sharing one collide. Skips without
 * TEST_DATABASE_URL.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const TEST_DB = "swap_events_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

// A fixed instant, so every row's age is exact rather than derived from the wall clock.
const NOW_MS = 1_788_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);
const MIN = 60;

const AGE_20_MIN = NOW_SEC - 20 * MIN;
const AGE_2_MIN = NOW_SEC - 2 * MIN;
// Old enough to clear the settle window on its own; distinct from AGE_20_MIN so the
// watermark is the ONLY rule that excludes it.
const AGE_60_MIN = NOW_SEC - 60 * MIN;
// Older still, and its own group: the shared-timestamp fixture sits furthest back so it never
// interacts with tests that watermark on SINCE, and is the globally oldest group under a
// wide-open `since: null` query, which the batch-boundary and LIMIT tests need.
const TIE_TS = NOW_SEC - 90 * MIN;
// Just after the tied group: if this row were the oldest, a small LIMIT under a wide-open
// query would select only it, and the protocol guard would filter it out, collapsing the
// batch to zero for a reason unrelated to LIMIT.
const UNKNOWN_PROTOCOL_TS = TIE_TS + 30;

const MIN_USD = 100_000;

// Strictly between AGE_60_MIN and AGE_20_MIN: row 6 (60 min old) is at-or-before it and every
// "20 min old" row is after it. No fixture row shares this timestamp, so the composite
// watermark degrades to a plain timestamp comparison, as one minted from a unique timestamp does.
const SINCE_TS = NOW_SEC - 30 * MIN;
const SINCE = encodeSwapWatermark(SINCE_TS, "0");

interface FixtureRow {
  id: string;
  protocol: string;
  direction: "in" | "out";
  status: "completed" | "pending" | "refunded";
  timestamp: number;
  counterpartChain: string;
  counterpartAsset: string;
  counterpartAmount: number | null;
  counterpartIsSynthetic: boolean;
  zcashTxid: string | null;
  zecAmountZat: number;
  usdValueAtSwap: number | null;
  /**
   * When we first stored the row, distinct from `timestamp` (the venue's own clock). Defaults
   * (via `BASE`) to well before every settle window here; `backfilledRow` overrides it.
   */
  firstSeenAt: number;
}

const BASE: Omit<FixtureRow, "id"> = {
  protocol: "maya",
  direction: "in",
  status: "completed",
  timestamp: AGE_20_MIN,
  counterpartChain: "BTC",
  counterpartAsset: "BTC",
  counterpartAmount: 12.5,
  counterpartIsSynthetic: false,
  zcashTxid: "tx0000000000000000000000000000000000000000000000000000000000",
  zecAmountZat: 5_000_000_000,
  usdValueAtSwap: 500_638,
  firstSeenAt: AGE_60_MIN,
};

const ROWS: FixtureRow[] = [
  // 1. Eligible: inbound, priced above the floor, settled, after the watermark.
  { ...BASE, id: "row1" },
  // 2. Inside the 15-minute settle window.
  { ...BASE, id: "row2", timestamp: AGE_2_MIN },
  // 3. Outbound — also eligible: both directions are announced since 2026-08-30.
  { ...BASE, id: "row3", direction: "out", usdValueAtSwap: 900_000 },
  // 4. Below the $100,000 floor.
  { ...BASE, id: "row4", usdValueAtSwap: 9_000 },
  // 5. Never priced by the venue — NULL, not zero.
  { ...BASE, id: "row5", usdValueAtSwap: null },
  // 6. Already considered: older than the watermark, though otherwise eligible.
  { ...BASE, id: "row6", timestamp: AGE_60_MIN, usdValueAtSwap: 200_000 },
  // 7. The movement was undone.
  { ...BASE, id: "row7", status: "refunded", usdValueAtSwap: 300_000 },
  // 8. It has not happened yet.
  { ...BASE, id: "row8", status: "pending", usdValueAtSwap: 300_000 },
  // 9. Unsettled: the schema's own comment says NULL means this.
  { ...BASE, id: "row9", counterpartAmount: null, usdValueAtSwap: 300_000 },
  // 10. Nothing to check the post's call to action against.
  { ...BASE, id: "row10", zcashTxid: null, usdValueAtSwap: 300_000 },
  // 11. Wrapped ZEC redeeming to native ZEC — a real crossing, nonsense as a post.
  {
    ...BASE,
    id: "row11",
    counterpartChain: "MAYA",
    counterpartAsset: "ZEC/ZEC",
    counterpartIsSynthetic: true,
    usdValueAtSwap: 300_000,
  },
  // 12-14. A tied group: three rows sharing one timestamp, older than SINCE and priced below
  // MIN_USD so they never interfere with other tests. They prove LIMIT truncating a tied group
  // does not strand the remainder.
  { ...BASE, id: "tieA", timestamp: TIE_TS, usdValueAtSwap: 50_000 },
  { ...BASE, id: "tieB", timestamp: TIE_TS, usdValueAtSwap: 50_000 },
  { ...BASE, id: "tieC", timestamp: TIE_TS, usdValueAtSwap: 50_000 },
  // 15. Otherwise fully eligible, but a protocol `protocolLabel` cannot name.
  {
    ...BASE,
    id: "unknownProtocolRow",
    protocol: "some-new-venue-not-yet-supported",
    timestamp: UNKNOWN_PROTOCOL_TS,
    usdValueAtSwap: 50_000,
  },
  // 16. A venue settling its own internal accounts (CACAO on Maya), not a crossing.
  // Otherwise identical to row1, so nothing but the settlement-asset exclusion keeps it out.
  {
    ...BASE,
    id: "cacaoRow",
    counterpartChain: "MAYA",
    counterpartAsset: "CACAO",
    usdValueAtSwap: 300_000,
  },
  // 17. Backfilled: an old venue timestamp, but we only just stored it (first_seen_at is now).
  // Only the first_seen_at half of the settle-window check keeps it out.
  {
    ...BASE,
    id: "backfilledRow",
    timestamp: AGE_60_MIN,
    firstSeenAt: NOW_SEC,
    usdValueAtSwap: 300_000,
  },
  // 18. A venue publishing a control character and an unbounded length where a ticker belongs,
  // and an IP-with-path where a chain name belongs. Priced below MIN_USD and apart from the tied
  // group so it never interferes with the exact-array assertions; its own test reads it back.
  {
    ...BASE,
    id: "maliciousTextRow",
    timestamp: TIE_TS + 60,
    counterpartChain: "185.199.108.153/claim",
    counterpartAsset: "  CLAIM\u0007-YOUR-ZEC-NOW-RIGHT-NOW  ",
    usdValueAtSwap: 50_000,
  },
];

describeDb("eligibleSwaps against Postgres", () => {
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
    // The real DDL from server/schema.sql, not a paraphrase — the whole point of this
    // task is that the column names differ from the /v1 wire shape.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crosschain_transfer (
        id                  TEXT PRIMARY KEY,
        protocol            TEXT   NOT NULL,
        direction           TEXT   NOT NULL CHECK (direction IN ('in', 'out')),
        status              TEXT   NOT NULL CHECK (status IN ('completed', 'pending', 'refunded')),
        timestamp           BIGINT NOT NULL,

        counterpart_chain   TEXT   NOT NULL,
        counterpart_asset   TEXT   NOT NULL,
        counterpart_amount  DOUBLE PRECISION,
        counterpart_tx_hash TEXT,
        counterpart_address TEXT,
        counterpart_is_synthetic BOOLEAN NOT NULL DEFAULT false,

        zcash_txid          TEXT,
        zcash_address       TEXT,
        zcash_address_kind  TEXT CHECK (zcash_address_kind IN ('transparent', 'sapling', 'unified')),

        zec_amount_zat      BIGINT NOT NULL,
        usd_value_at_swap   DOUBLE PRECISION,

        first_seen_at       BIGINT NOT NULL,
        updated_at          BIGINT NOT NULL
      );
    `);

    for (const row of ROWS) {
      await pool.query(
        `INSERT INTO crosschain_transfer
           (id, protocol, direction, status, timestamp, counterpart_chain, counterpart_asset,
            counterpart_amount, counterpart_is_synthetic, zcash_txid, zec_amount_zat,
            usd_value_at_swap, first_seen_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          row.id,
          row.protocol,
          row.direction,
          row.status,
          row.timestamp,
          row.counterpartChain,
          row.counterpartAsset,
          row.counterpartAmount,
          row.counterpartIsSynthetic,
          row.zcashTxid,
          row.zecAmountZat,
          row.usdValueAtSwap,
          row.firstSeenAt,
          NOW_SEC,
        ],
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS crosschain_transfer;`);
    await pool.end();
  });

  it("returns exactly the rows every rule agrees are eligible, in both directions", async () => {
    const results = await eligibleSwaps(pool, {
      minUsd: MIN_USD,
      since: SINCE,
      settleSeconds: SWAP_SETTLE_SECONDS,
      nowMs: NOW_MS,
      limit: 20,
    });

    expect(results.map((r) => r.transferId)).toEqual(["row1", "row3"]);
    expect(results.map((r) => r.direction)).toEqual(["in", "out"]);

    const [swap] = results;
    expect(swap).toBeDefined();
    if (!swap) return;
    expect(swap.venue).toBe("Maya Protocol");
    expect(swap.zcashTxid).toBe(BASE.zcashTxid);
    expect(swap.counterpartAsset).toBe("BTC");
    expect(swap.counterpartChain).toBe("BTC");
    expect(swap.counterpartAmount).toBe(12.5);
    expect(swap.counterpartIsNative).toBe(true);
    expect(swap.timestamp).toBe(AGE_20_MIN);
    expect(swap.usdAtSwap).toBe(500_638);
    expect(swap.zecAmountZat).toBe(5_000_000_000);
  });

  it("lets row 4 in the moment the floor rule alone is dropped", async () => {
    // Row 4 differs from row 1 only in being priced below the floor, so dropping only the floor
    // must surface it and nothing else new.
    const floorDropped = await eligibleSwaps(pool, {
      minUsd: 0,
      since: SINCE,
      settleSeconds: SWAP_SETTLE_SECONDS,
      nowMs: NOW_MS,
      limit: 20,
    });
    expect(floorDropped.map((r) => r.transferId).sort()).toEqual(["row1", "row3", "row4"]);
  });

  it("lets row 6 in the moment the watermark alone is dropped", async () => {
    // Row 6 differs from row 1 only in being older than `since`. Dropping just the watermark must
    // surface it and nothing else new (the tied group and the unrecognised-protocol row are
    // priced below MIN_USD, so the floor still excludes them).
    const watermarkDropped = await eligibleSwaps(pool, {
      minUsd: MIN_USD,
      since: null,
      settleSeconds: SWAP_SETTLE_SECONDS,
      nowMs: NOW_MS,
      limit: 20,
    });
    expect(watermarkDropped.map((r) => r.transferId).sort()).toEqual(["row1", "row3", "row6"]);
  });

  it("lets row 2 in the moment the settle window alone is dropped", async () => {
    // Row 2 differs from row 1 only in being 2 minutes old rather than 20. Dropping
    // just the settle window, with the floor and watermark unchanged, must surface it
    // and nothing else new.
    const settleDropped = await eligibleSwaps(pool, {
      minUsd: MIN_USD,
      since: SINCE,
      settleSeconds: 0,
      nowMs: NOW_MS,
      limit: 20,
    });
    expect(settleDropped.map((r) => r.transferId).sort()).toEqual(["row1", "row2", "row3"]);
  });

  it("orders oldest first, so a watermark can advance monotonically", async () => {
    const results = await eligibleSwaps(pool, {
      minUsd: 0,
      since: null,
      settleSeconds: 0,
      nowMs: NOW_MS,
      limit: 50,
    });
    const timestamps = results.map((r) => r.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("honours LIMIT — removing it would return every qualifying row instead of one", async () => {
    const results = await eligibleSwaps(pool, {
      minUsd: 0,
      since: null,
      settleSeconds: 0,
      nowMs: NOW_MS,
      limit: 1,
    });
    // Many rows qualify at minUsd: 0 with no watermark; only LIMIT keeps this at one.
    expect(results.length).toBe(1);
  });

  it("advances a composite watermark past a shared-timestamp group without skipping a row", async () => {
    // tieA/tieB/tieC share one timestamp, older than every other
    // eligible row, so a wide-open, no-watermark query returns them FIRST, in id order.
    const first = await eligibleSwaps(pool, {
      minUsd: 0,
      since: null,
      settleSeconds: 0,
      nowMs: NOW_MS,
      limit: 2,
    });
    expect(first.map((r) => r.transferId)).toEqual(["tieA", "tieB"]);

    const last = first[first.length - 1];
    expect(last).toBeDefined();
    if (!last) return;
    const watermark = encodeSwapWatermark(last.timestamp, last.transferId);

    const second = await eligibleSwaps(pool, {
      minUsd: 0,
      since: watermark,
      settleSeconds: 0,
      nowMs: NOW_MS,
      limit: 2,
    });
    // A timestamp-only watermark would compare tieC's timestamp against tieB's and find
    // them EQUAL, i.e. not strictly greater — exactly the bug this composite keyset
    // fixes. tieC must be the very next row.
    expect(second[0]?.transferId).toBe("tieC");
  });

  it("skips a row whose protocol protocolLabel cannot name, rather than publish an undefined venue", async () => {
    const results = await eligibleSwaps(pool, {
      minUsd: 0,
      since: null,
      settleSeconds: 0,
      nowMs: NOW_MS,
      limit: 50,
    });
    expect(results.map((r) => r.transferId)).not.toContain("unknownProtocolRow");
    // And the rest of the wide-open set is unaffected — this is a skip, not a crash or
    // a truncation of everything after it.
    expect(results.map((r) => r.transferId)).toContain("row1");
  });

  // A CACAO/RUNE counterpart is a venue settling its own
  // internal accounts, not a crossing — postgres-crosschain-store.ts's list/count/aggregate
  // queries already exclude it via SETTLEMENT_ASSETS, and this query must too.
  it("excludes a venue settlement leg (CACAO/RUNE counterpart), however it prices", async () => {
    const results = await eligibleSwaps(pool, {
      minUsd: 0,
      since: null,
      settleSeconds: 0,
      nowMs: NOW_MS,
      limit: 50,
    });
    expect(results.map((r) => r.transferId)).not.toContain("cacaoRow");
    expect(results.map((r) => r.transferId)).toContain("row1");
  });

  // The settle window must require both the venue's timestamp and first_seen_at to predate it.
  // `backfilledRow` clears the timestamp half (60 minutes old) but was only just stored.
  it("excludes a row whose venue timestamp is old but which we only just stored", async () => {
    const results = await eligibleSwaps(pool, {
      minUsd: 0,
      since: null,
      settleSeconds: SWAP_SETTLE_SECONDS,
      nowMs: NOW_MS,
      limit: 50,
    });
    expect(results.map((r) => r.transferId)).not.toContain("backfilledRow");
    // row6 is the same age (AGE_60_MIN) but was stored long ago (BASE's default
    // first_seen_at), so it must still clear both halves of the settle window.
    expect(results.map((r) => r.transferId)).toContain("row6");
  });

  // A venue's asset ticker and chain name are its own bytes, published with nothing else in
  // between. A control character is stripped, whitespace collapses and trims, and the length is
  // capped.
  it("sanitises a venue's own counterpart asset and chain name before publishing them", async () => {
    const results = await eligibleSwaps(pool, {
      minUsd: 0,
      since: null,
      settleSeconds: 0,
      nowMs: NOW_MS,
      limit: 50,
    });
    const row = results.find((r) => r.transferId === "maliciousTextRow");
    expect(row).toBeDefined();
    if (!row) return;
    // The control character (BEL) and the surrounding whitespace are both gone, and the
    // string is capped at 24 — well short of the raw input's own length.
    expect(row.counterpartAsset).toBe("CLAIM-YOUR-ZEC-NOW-RIGHT");
    expect(row.counterpartAsset.length).toBeLessThanOrEqual(24);
    // The sanitiser strips control characters and length, not shape: an IP-with-path chain name
    // passes through here and must be caught by the consumer that composes a post.
    expect(row.counterpartChainName).toBe("185.199.108.153/CLAIM");
    // Neither field carries a raw C0/C1 control character through to the published
    // row (BEL, U+0007, was in the raw input above).
    const hasControlCharacter = (value: string): boolean =>
      Array.from(value).some((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code < 0x20 || (code >= 0x7f && code <= 0x9f);
      });
    expect(hasControlCharacter(row.counterpartAsset)).toBe(false);
    expect(hasControlCharacter(row.counterpartChainName)).toBe(false);
  });

  it("rejects a malformed stored watermark rather than silently starting over", async () => {
    await expect(
      eligibleSwaps(pool, {
        minUsd: 0,
        since: "not-a-real-watermark",
        settleSeconds: 0,
        nowMs: NOW_MS,
        limit: 20,
      }),
    ).rejects.toThrow();
  });
});

/**
 * The protocol guard must run in SQL, not in JS after LIMIT: a batch consisting entirely of
 * unknown-protocol rows would otherwise filter to `[]`, and a consumer that advances its
 * watermark only from returned rows would refetch the same page forever. Its own database,
 * because this fixture shape would collide with the exact-array assertions above.
 */
describeDb("eligibleSwaps: the protocol filter runs in SQL, so LIMIT cannot stall on it", () => {
  let pool: Pool;
  const PROTOCOL_TEST_DB = "swap_events_protocol_test";

  const T1 = 1_000;
  const T2 = 2_000;
  const T3 = 3_000;
  const T4 = 4_000; // the only known-protocol row, and the only one that should post.

  beforeAll(async () => {
    const admin = new Pool({
      connectionString: withDatabase(DATABASE_URL!, "postgres"),
      max: 1,
    });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${PROTOCOL_TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${PROTOCOL_TEST_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, PROTOCOL_TEST_DB) });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crosschain_transfer (
        id                  TEXT PRIMARY KEY,
        protocol            TEXT   NOT NULL,
        direction           TEXT   NOT NULL CHECK (direction IN ('in', 'out')),
        status              TEXT   NOT NULL CHECK (status IN ('completed', 'pending', 'refunded')),
        timestamp           BIGINT NOT NULL,

        counterpart_chain   TEXT   NOT NULL,
        counterpart_asset   TEXT   NOT NULL,
        counterpart_amount  DOUBLE PRECISION,
        counterpart_tx_hash TEXT,
        counterpart_address TEXT,
        counterpart_is_synthetic BOOLEAN NOT NULL DEFAULT false,

        zcash_txid          TEXT,
        zcash_address       TEXT,
        zcash_address_kind  TEXT CHECK (zcash_address_kind IN ('transparent', 'sapling', 'unified')),

        zec_amount_zat      BIGINT NOT NULL,
        usd_value_at_swap   DOUBLE PRECISION,

        first_seen_at       BIGINT NOT NULL,
        updated_at          BIGINT NOT NULL
      );
    `);

    // Three otherwise-eligible rows the poster cannot label, followed by one row from a
    // known venue. Everything else is old enough to clear any settle window, priced
    // above any floor, transparent, completed, inbound, and fully settled/attributed.
    const rows: Array<{ id: string; protocol: string; timestamp: number }> = [
      { id: "unknownA", protocol: "some-new-venue", timestamp: T1 },
      { id: "unknownB", protocol: "some-new-venue", timestamp: T2 },
      { id: "unknownC", protocol: "some-new-venue", timestamp: T3 },
      { id: "knownD", protocol: "maya", timestamp: T4 },
    ];
    for (const row of rows) {
      await pool.query(
        `INSERT INTO crosschain_transfer
           (id, protocol, direction, status, timestamp, counterpart_chain, counterpart_asset,
            counterpart_amount, counterpart_is_synthetic, zcash_txid, zec_amount_zat,
            usd_value_at_swap, first_seen_at, updated_at)
         VALUES ($1, $2, 'in', 'completed', $3, 'BTC', 'BTC', 1, false,
                 'tx0000000000000000000000000000000000000000000000000000000000',
                 5000000000, 500000, 0, 0)`,
        [row.id, row.protocol, row.timestamp],
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS crosschain_transfer;`);
    await pool.end();
  });

  it("skips past a whole page of unknown-protocol rows instead of returning nothing", async () => {
    // LIMIT 2 is smaller than the 3 unknown-protocol rows that sort first. If the
    // protocol guard ran in JS after LIMIT (the old shape), this would return `[]` and
    // `knownD` would never be reachable — the exact stall this test exists to catch.
    const results = await eligibleSwaps(pool, {
      minUsd: 0,
      since: null,
      settleSeconds: 0,
      nowMs: 10_000_000,
      limit: 2,
    });
    expect(results.map((r) => r.transferId)).toEqual(["knownD"]);
  });
});

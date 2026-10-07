// server/__tests__/social-routes.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { socialRoutes } from "../social-routes";
import { isPublicPath } from "../public-paths";
import type { SocialSnapshot } from "@/domain/social";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const d = DATABASE_URL ? describe : describe.skip;

/**
 * Its own database: this file and `social-snapshot.test.ts` both create
 * `block`/`tx`/`zec_price_daily` under their production names, and racing DROP/CREATE pairs on
 * one shared database collide.
 */
const TEST_DB = "explorer_social_routes_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

d("socialRoutes", () => {
  let pool: Pool;
  let app: ReturnType<typeof socialRoutes>;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    await pool.query(`
      CREATE TABLE block (
        height INTEGER PRIMARY KEY, timestamp BIGINT NOT NULL,
        transparent_pool_zat BIGINT, sprout_pool_zat BIGINT, sapling_pool_zat BIGINT,
        orchard_pool_zat BIGINT, lockbox_pool_zat BIGINT, ironwood_pool_zat BIGINT);
      CREATE TABLE tx (
        txid TEXT PRIMARY KEY, block_height INTEGER, timestamp BIGINT NOT NULL, kind TEXT NOT NULL,
        sapling_value_balance_zat BIGINT, orchard_value_balance_zat BIGINT,
        ironwood_value_balance_zat BIGINT, sprout_vpub_net_zat BIGINT);
      CREATE TABLE zec_price_daily (day DATE PRIMARY KEY, usd DOUBLE PRECISION NOT NULL, source TEXT NOT NULL);
      CREATE TABLE social_post (
        kind TEXT NOT NULL, event_key TEXT NOT NULL, status TEXT NOT NULL
          CHECK (status IN ('claimed','posted','skipped','superseded','failed')),
        reason TEXT, figures JSONB, tweet_id TEXT,
        created_at BIGINT NOT NULL, posted_at BIGINT,
        PRIMARY KEY (kind, event_key));
      CREATE TABLE social_watermark (kind TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL);
      -- The one column shape swap-events.test.ts already proves the eligibility rules
      -- against; here it exists only so the ROUTE's own 400/200 wrapping is exercised
      -- against something real, not a second copy of the eligibility rules.
      CREATE TABLE crosschain_transfer (
        id TEXT PRIMARY KEY, protocol TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        status TEXT NOT NULL CHECK (status IN ('completed', 'pending', 'refunded')),
        timestamp BIGINT NOT NULL,
        counterpart_chain TEXT NOT NULL, counterpart_asset TEXT NOT NULL,
        counterpart_amount DOUBLE PRECISION, counterpart_is_synthetic BOOLEAN NOT NULL DEFAULT false,
        zcash_txid TEXT, zec_amount_zat BIGINT NOT NULL, usd_value_at_swap DOUBLE PRECISION,
        first_seen_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);`);
    await pool.query(`INSERT INTO block VALUES (200, 1788000000, 100, 10, 20, 30, 50, 40)`);
    await pool.query(`INSERT INTO zec_price_daily VALUES ('2026-08-28', 795.4, 'yahoo')`);
    await pool.query(
      `INSERT INTO crosschain_transfer
         (id, protocol, direction, status, timestamp, counterpart_chain, counterpart_asset,
          counterpart_amount, zcash_txid, zec_amount_zat, usd_value_at_swap, first_seen_at, updated_at)
       VALUES ('swap1', 'maya', 'in', 'completed', 1, 'BTC', 'BTC', 12.5,
               'tx1', 5000000000, 500638, 1, 1)`,
    );
    app = socialRoutes({ pool, price: () => ({ usd: 804.63, change24hPct: 4.2 }) });
  });
  afterAll(async () => await pool.end());
  beforeEach(async () => {
    await pool.query("DELETE FROM social_post");
    await pool.query("DELETE FROM social_watermark");
  });

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  // These are write endpoints, so the default-deny middleware in server/index.ts must gate them;
  // asserting the prefix is absent from `public-paths.ts` makes that a checked fact.
  it("is not on the public-paths allowlist, so the default-deny middleware gates it", () => {
    expect(isPublicPath("/chain/social/snapshot")).toBe(false);
    expect(isPublicPath("/chain/social/claim")).toBe(false);
    expect(isPublicPath("/chain/social/settled/daily/2026-08-29")).toBe(false);
    expect(isPublicPath("/chain/social/swaps")).toBe(false);
  });

  it("serves eligible swaps for a valid minUsd, oldest first", async () => {
    const res = await app.request("/chain/social/swaps?minUsd=100000");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { transferId: string }[] };
    expect(body.items.map((i) => i.transferId)).toEqual(["swap1"]);
  });

  it.each([
    ["missing minUsd", "/chain/social/swaps"],
    ["zero minUsd", "/chain/social/swaps?minUsd=0"],
    ["negative minUsd", "/chain/social/swaps?minUsd=-5"],
    ["non-numeric minUsd", "/chain/social/swaps?minUsd=oops"],
  ])("refuses %s with a 400", async (_label, path) => {
    const res = await app.request(path);
    expect(res.status).toBe(400);
  });

  // An unparseable watermark must never mean "consider everything", which would repost
  // crossings already watermarked past. `since` is a composite keyset ("<timestamp>:<id>"), so a
  // bare number is malformed too, as are whitespace and numeric-looking strings `Number()`
  // accepts too readily (hex, exponents, Infinity, NaN).
  it.each([
    ["non-numeric since", "/chain/social/swaps?minUsd=100000&since=oops"],
    ["empty since", "/chain/social/swaps?minUsd=100000&since="],
    [
      "whitespace-only since",
      `/chain/social/swaps?minUsd=100000&since=${encodeURIComponent("  ")}`,
    ],
    ["a bare number, no colon", "/chain/social/swaps?minUsd=100000&since=100"],
    ["a bare negative number", "/chain/social/swaps?minUsd=100000&since=-1"],
    ["a bare hex-looking number", "/chain/social/swaps?minUsd=100000&since=0x10"],
    ["a bare exponential-notation number", "/chain/social/swaps?minUsd=100000&since=1e5"],
    ["a bare Infinity", "/chain/social/swaps?minUsd=100000&since=Infinity"],
    ["a bare NaN", "/chain/social/swaps?minUsd=100000&since=NaN"],
    ["a negative timestamp half", "/chain/social/swaps?minUsd=100000&since=-1:abc"],
    ["a hex-looking timestamp half", "/chain/social/swaps?minUsd=100000&since=0x10:abc"],
    ["an exponential-notation timestamp half", "/chain/social/swaps?minUsd=100000&since=1e5:abc"],
    ["an empty id half", "/chain/social/swaps?minUsd=100000&since=100:"],
  ])("refuses a malformed since (%s) with a 400, never as absent", async (_label, path) => {
    const res = await app.request(path);
    expect(res.status).toBe(400);
  });

  it("accepts a well-formed composite watermark and applies it", async () => {
    // swap1's timestamp is 1 and its id is "swap1"; a watermark set to exactly that
    // position excludes it (the comparison is strictly greater-than).
    const since = encodeURIComponent("1:swap1");
    const res = await app.request(`/chain/social/swaps?minUsd=100000&since=${since}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("serves a live snapshot with the price getter's current figures", async () => {
    const res = await app.request("/chain/social/snapshot");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SocialSnapshot;
    expect(body.readAtHeight).toBe(200);
    expect(body.priceUsd).toBe(804.63);
  });

  it("claims a key, refuses a second claim, and reads it back", async () => {
    const claim1 = await post("/chain/social/claim", {
      kind: "daily",
      key: "2026-08-29",
      snapshot: { readAtUnix: 1, readAtHeight: 200 },
    });
    expect((await claim1.json()) as { claimed: boolean }).toEqual({ claimed: true });

    const claim2 = await post("/chain/social/claim", {
      kind: "daily",
      key: "2026-08-29",
      snapshot: { readAtUnix: 1, readAtHeight: 200 },
    });
    expect((await claim2.json()) as { claimed: boolean }).toEqual({ claimed: false });

    const read = await app.request("/chain/social/post/daily/2026-08-29");
    expect(read.status).toBe(200);
    // MINOR 13: the ledger key comes back as `eventKey`, never `parisDay`.
    const body = (await read.json()) as { eventKey: string };
    expect(body.eventKey).toBe("2026-08-29");
  });

  // MINOR 12: these are the first WRITE endpoints in this codebase, and an unvalidated
  // body would be written straight into JSONB. Each malformed shape below is rejected with
  // a 400 rather than reaching `SocialStore`.
  it.each([
    ["missing key", { kind: "daily", snapshot: {} }],
    ["non-string kind", { kind: 1, key: "2026-08-29", snapshot: {} }],
    ["empty key", { kind: "daily", key: "", snapshot: {} }],
    ["snapshot not an object", { kind: "daily", key: "2026-08-29", snapshot: "oops" }],
    ["snapshot is an array", { kind: "daily", key: "2026-08-29", snapshot: [] }],
    ["body is an array", []],
    ["body is a string", "oops"],
  ])("refuses a claim body: %s", async (_label, body) => {
    const res = await post("/chain/social/claim", body);
    expect(res.status).toBe(400);
  });

  it.each([
    ["missing reason", { kind: "daily", key: "2026-08-29" }],
    ["empty reason", { kind: "daily", key: "2026-08-29", reason: "" }],
  ])("refuses a skip body: %s", async (_label, body) => {
    const res = await post("/chain/social/skip", body);
    expect(res.status).toBe(400);
  });

  it.each([
    ["missing tweetId", { kind: "daily", key: "2026-08-29" }],
    ["non-string tweetId", { kind: "daily", key: "2026-08-29", tweetId: 123 }],
  ])("refuses a complete body: %s", async (_label, body) => {
    const res = await post("/chain/social/complete", body);
    expect(res.status).toBe(400);
  });

  it("404s reading a key that was never claimed", async () => {
    const res = await app.request("/chain/social/post/daily/2099-01-01");
    expect(res.status).toBe(404);
  });

  it("reports settled only after a claim, skip, or completion", async () => {
    const before = await app.request("/chain/social/settled/daily/2026-08-29");
    expect((await before.json()) as { settled: boolean }).toEqual({ settled: false });

    await post("/chain/social/claim", {
      kind: "daily",
      key: "2026-08-29",
      snapshot: { readAtUnix: 1, readAtHeight: 200 },
    });

    const after = await app.request("/chain/social/settled/daily/2026-08-29");
    expect((await after.json()) as { settled: boolean }).toEqual({ settled: true });
  });

  it("completes a claim with a tweet id", async () => {
    await post("/chain/social/claim", {
      kind: "daily",
      key: "2026-08-29",
      snapshot: { readAtUnix: 1, readAtHeight: 200 },
    });
    const res = await post("/chain/social/complete", {
      kind: "daily",
      key: "2026-08-29",
      tweetId: "1234567890",
    });
    expect(res.status).toBe(200);
    const read = await app.request("/chain/social/post/daily/2026-08-29");
    const body = (await read.json()) as { tweetId: string | null };
    expect(body.tweetId).toBe("1234567890");
  });

  it("skips a key without a prior claim, and that also settles it", async () => {
    const res = await post("/chain/social/skip", {
      kind: "daily",
      key: "2026-08-30",
      reason: "snapshot incomplete",
    });
    expect(res.status).toBe(200);
    const settled = await app.request("/chain/social/settled/daily/2026-08-30");
    expect((await settled.json()) as { settled: boolean }).toEqual({ settled: true });
  });

  it("is not on the public-paths allowlist either", () => {
    expect(isPublicPath("/chain/social/watermark/swap")).toBe(false);
  });

  it("has considered nothing for a kind it has never seen", async () => {
    const res = await app.request("/chain/social/watermark/swap");
    expect(res.status).toBe(200);
    expect((await res.json()) as { value: string | null }).toEqual({ value: null });
  });

  it("round-trips a watermark, and keeps kinds independent", async () => {
    const set = await post("/chain/social/watermark", { kind: "swap", value: "1785869315:swap1" });
    expect(set.status).toBe(200);

    const swap = await app.request("/chain/social/watermark/swap");
    expect((await swap.json()) as { value: string | null }).toEqual({
      value: "1785869315:swap1",
    });

    // The dry-run kind must never read back the real kind's progress — that is the whole
    // point of keeping them under separate keys.
    const dryRun = await app.request("/chain/social/watermark/swap-dryrun");
    expect((await dryRun.json()) as { value: string | null }).toEqual({ value: null });
  });

  it("overwrites rather than accumulating", async () => {
    await post("/chain/social/watermark", { kind: "swap", value: "1:a" });
    await post("/chain/social/watermark", { kind: "swap", value: "2:b" });
    const res = await app.request("/chain/social/watermark/swap");
    expect((await res.json()) as { value: string | null }).toEqual({ value: "2:b" });
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM social_watermark WHERE kind = 'swap'",
    );
    expect(rows[0].n).toBe(1);
  });

  it.each([
    ["missing value", { kind: "swap" }],
    ["empty value", { kind: "swap", value: "" }],
    ["missing kind", { value: "1:a" }],
    ["non-string kind", { kind: 1, value: "1:a" }],
    ["body is an array", []],
  ])("refuses a set-watermark body: %s", async (_label, body) => {
    const res = await post("/chain/social/watermark", body);
    expect(res.status).toBe(400);
  });
});

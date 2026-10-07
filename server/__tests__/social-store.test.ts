// server/__tests__/social-store.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { SocialStore } from "../social-store";
import type { SocialSnapshot } from "@/domain/social";

const URL = process.env.TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

const SNAPSHOT = {
  readAtUnix: 1_788_000_000,
  readAtHeight: 3_464_661,
  parisDay: "2026-08-29",
  priceUsd: 804.63,
  priceChange24hPct: 4.2,
  pools: [{ pool: "ironwood", balanceZat: 1 }],
  circulatingSupplyZat: 10,
  flow24h: { timestamp: 1, shieldedZat: 2, unshieldedZat: 3 },
  recentCloses: [{ day: "2026-08-28", usd: 795.4 }],
} as SocialSnapshot;

d("SocialStore", () => {
  let pool: Pool;
  let store: SocialStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_post (
        kind TEXT NOT NULL, event_key TEXT NOT NULL, status TEXT NOT NULL
          CHECK (status IN ('claimed','posted','skipped','superseded','failed')),
        reason TEXT, figures JSONB, tweet_id TEXT,
        created_at BIGINT NOT NULL, posted_at BIGINT,
        PRIMARY KEY (kind, event_key));`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_watermark (
        kind       TEXT PRIMARY KEY,
        value      TEXT   NOT NULL,
        updated_at BIGINT NOT NULL
      );`);
    store = new SocialStore(pool);
  });
  afterAll(async () => await pool.end());
  beforeEach(async () => {
    await pool.query("DELETE FROM social_post");
    await pool.query("DELETE FROM social_watermark");
  });

  it("claims a key once", async () => {
    expect(await store.claim("daily", "2026-08-29", SNAPSHOT)).toBe(true);
  });

  it("refuses a second claim on the same key", async () => {
    await store.claim("daily", "2026-08-29", SNAPSHOT);
    expect(await store.claim("daily", "2026-08-29", SNAPSHOT)).toBe(false);
  });

  // The crash-mid-post case. A `claimed` row that never completed must never be retried:
  // we cannot tell whether X accepted it.
  it("refuses to re-claim a row left claimed by a crash", async () => {
    await store.claim("daily", "2026-08-29", SNAPSHOT);
    expect(await store.claim("daily", "2026-08-29", SNAPSHOT)).toBe(false);
    expect(await store.hasSettled("daily", "2026-08-29")).toBe(true);
  });

  it("reads back exactly the figures that were claimed", async () => {
    await store.claim("daily", "2026-08-29", SNAPSHOT);
    const row = await store.read("daily", "2026-08-29");
    expect(row?.figures).toEqual(SNAPSHOT);
  });

  // MINOR 13: the field is `eventKey`, not `parisDay` — `event_key` is not necessarily a
  // Paris calendar day for every kind this ledger might ever hold, only for `daily`'s own.
  it("names the ledger key `eventKey`, not `parisDay`", async () => {
    await store.claim("daily", "2026-08-29", SNAPSHOT);
    const row = await store.read("daily", "2026-08-29");
    expect(row?.eventKey).toBe("2026-08-29");
    expect(row).not.toHaveProperty("parisDay");
  });

  it("records the tweet id on completion", async () => {
    await store.claim("daily", "2026-08-29", SNAPSHOT);
    await store.complete("daily", "2026-08-29", "1234567890");
    expect((await store.read("daily", "2026-08-29"))?.tweetId).toBe("1234567890");
  });

  // The ledger's whole purpose is to be an audit record of what was actually published; a
  // second `complete` call — a retried request, a duplicate webhook — must not be able to
  // silently rewrite the record of what X already said.
  it("refuses to rewrite an already-posted row on a second complete call", async () => {
    await store.claim("daily", "2026-08-29", SNAPSHOT);
    await store.complete("daily", "2026-08-29", "1234567890");
    await store.complete("daily", "2026-08-29", "9999999999");
    expect((await store.read("daily", "2026-08-29"))?.tweetId).toBe("1234567890");
  });

  // A dry run must be free to run any number of times without burning a real
  // day off the schedule, and it must never touch the real `daily` key while doing it.
  describe("claim under DAILY_DRYRUN_KIND", () => {
    it("always succeeds, even when the row already exists", async () => {
      expect(await store.claim("daily-dryrun", "2026-08-29", SNAPSHOT)).toBe(true);
      expect(await store.claim("daily-dryrun", "2026-08-29", SNAPSHOT)).toBe(true);
    });

    it("replaces the figures on every claim, so a re-run shows the freshest ones", async () => {
      await store.claim("daily-dryrun", "2026-08-29", SNAPSHOT);
      const second = { ...SNAPSHOT, priceUsd: 999.99 } as SocialSnapshot;
      await store.claim("daily-dryrun", "2026-08-29", second);
      const row = await store.read<SocialSnapshot>("daily-dryrun", "2026-08-29");
      expect(row?.figures.priceUsd).toBe(999.99);
    });

    it("clears a prior completion's tweet id when re-claimed", async () => {
      await store.claim("daily-dryrun", "2026-08-29", SNAPSHOT);
      await store.complete("daily-dryrun", "2026-08-29", "1234567890");
      await store.claim("daily-dryrun", "2026-08-29", SNAPSHOT);
      expect((await store.read("daily-dryrun", "2026-08-29"))?.tweetId).toBeNull();
    });

    it("never touches the real `daily` key for the same day", async () => {
      await store.claim("daily-dryrun", "2026-08-29", SNAPSHOT);
      expect(await store.hasSettled("daily", "2026-08-29")).toBe(false);
      expect(await store.claim("daily", "2026-08-29", SNAPSHOT)).toBe(true);
    });
  });

  // Replace-on-claim must apply to any dry-run kind, not just DAILY_DRYRUN_KIND: a dry run must
  // be free to run any number of times, so a second dry run of the same transfer id must not
  // come back `claim-lost`.
  describe("claim under SWAP_DRYRUN_KIND", () => {
    it("always succeeds, even when the row already exists", async () => {
      expect(await store.claim("swap-dryrun", "maya-abc123", SNAPSHOT)).toBe(true);
      expect(await store.claim("swap-dryrun", "maya-abc123", SNAPSHOT)).toBe(true);
    });

    it("replaces the figures on every claim, so a re-run shows the freshest ones", async () => {
      await store.claim("swap-dryrun", "maya-abc123", SNAPSHOT);
      const second = { ...SNAPSHOT, priceUsd: 999.99 } as SocialSnapshot;
      await store.claim("swap-dryrun", "maya-abc123", second);
      const row = await store.read<SocialSnapshot>("swap-dryrun", "maya-abc123");
      expect(row?.figures.priceUsd).toBe(999.99);
    });

    it("clears a prior completion's tweet id when re-claimed", async () => {
      await store.claim("swap-dryrun", "maya-abc123", SNAPSHOT);
      await store.complete("swap-dryrun", "maya-abc123", "1234567890");
      await store.claim("swap-dryrun", "maya-abc123", SNAPSHOT);
      expect((await store.read("swap-dryrun", "maya-abc123"))?.tweetId).toBeNull();
    });

    it("never touches the real `swap` key for the same transfer id", async () => {
      await store.claim("swap-dryrun", "maya-abc123", SNAPSHOT);
      expect(await store.hasSettled("swap", "maya-abc123")).toBe(false);
      expect(await store.claim("swap", "maya-abc123", SNAPSHOT)).toBe(true);
    });
  });

  it("records a skip with its reason and blocks the day", async () => {
    await store.skip("daily", "2026-08-29", "price unavailable");
    expect(await store.claim("daily", "2026-08-29", SNAPSHOT)).toBe(false);
    const { rows } = await pool.query("SELECT status, reason FROM social_post");
    expect(rows[0]).toMatchObject({ status: "skipped", reason: "price unavailable" });
  });

  it("has not settled a key it has never seen", async () => {
    expect(await store.hasSettled("daily", "2026-08-30")).toBe(false);
  });

  describe("watermark", () => {
    it("has considered nothing for a kind it has never seen", async () => {
      expect(await store.watermark("swap")).toBeNull();
    });

    it("round-trips a value", async () => {
      await store.setWatermark("swap", "1785869315");
      expect(await store.watermark("swap")).toBe("1785869315");
    });

    it("overwrites rather than accumulating", async () => {
      await store.setWatermark("swap", "1");
      await store.setWatermark("swap", "2");
      expect(await store.watermark("swap")).toBe("2");
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM social_watermark");
      expect(rows[0].n).toBe(1);
    });

    it("keeps kinds independent", async () => {
      await store.setWatermark("swap", "7");
      expect(await store.watermark("daily")).toBeNull();
    });
  });
});

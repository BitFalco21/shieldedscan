import { Hono } from "hono";
import type { Pool } from "pg";
import type { SocialSnapshot } from "@/domain/social";
import { buildSnapshot } from "./social-snapshot";
import { SocialStore } from "./social-store";
import { eligibleSwaps, SWAP_SETTLE_SECONDS } from "./swap-events";
import { eligibleBoundaryCrossings } from "./boundary-events";
import { parseEventWatermark } from "@/domain/watermark";

export interface SocialRouteDeps {
  pool: Pool;
  /**
   * A getter, not a value: the price tracker warms after boot, so the price at mount time is never
   * the price a snapshot is built with.
   */
  price: () => { usd: number | null; change24hPct: number | null };
}

interface ClaimBody {
  kind: string;
  key: string;
  snapshot: SocialSnapshot;
}

interface CompleteBody {
  kind: string;
  key: string;
  tweetId: string;
}

interface SkipBody {
  kind: string;
  key: string;
  reason: string;
}

interface SetWatermarkBody {
  kind: string;
  value: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** How many eligible crossings a single poll of `/chain/social/swaps` returns at most. */
const SWAP_QUERY_LIMIT = 20;

/**
 * How many boundary-crossing candidates a single poll returns at most. The poster works through
 * them oldest first; the limit only bounds one poll.
 */
const BOUNDARY_QUERY_LIMIT = 10;

/**
 * `since` is a composite watermark (`"<position>:<id>"`, see `parseEventWatermark`), not free text:
 * a value silently ignored would make the poster reconsider, and repost, crossings it already
 * decided. So a malformed value is a 400, never coerced to "no watermark".
 *
 * The shape check is delegated to `parseEventWatermark`, so there is one definition of a valid
 * watermark. Returns `undefined` on failure (distinct from the valid "absent" case, `null`), and
 * the original string on success; `eligibleSwaps` parses it itself.
 */
function parseSinceParam(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return null;
  if (raw.trim() === "") return undefined;
  try {
    // One shape for both pollers: a swap's watermark is `(timestamp, id)` and a crossing's is
    // `(block_height, txid)`, but the encoding is shared, so this validates either.
    parseEventWatermark(raw);
    return raw;
  } catch {
    return undefined;
  }
}

/**
 * Write endpoints: `kind`/`key` anchor a primary key, and `snapshot` becomes the published record.
 * This checks the shape only (non-empty strings, a plain object). The full `SocialSnapshot`
 * contract is checked where a bad snapshot could reach a publication, by `snapshotIsComplete`
 * before the card renders and the post is composed.
 */
function parseClaimBody(raw: unknown): ClaimBody | null {
  if (!isRecord(raw)) return null;
  const { kind, key, snapshot } = raw;
  if (!isNonEmptyString(kind) || !isNonEmptyString(key) || !isRecord(snapshot)) return null;
  return { kind, key, snapshot: snapshot as unknown as SocialSnapshot };
}

function parseCompleteBody(raw: unknown): CompleteBody | null {
  if (!isRecord(raw)) return null;
  const { kind, key, tweetId } = raw;
  if (!isNonEmptyString(kind) || !isNonEmptyString(key) || !isNonEmptyString(tweetId)) {
    return null;
  }
  return { kind, key, tweetId };
}

function parseSkipBody(raw: unknown): SkipBody | null {
  if (!isRecord(raw)) return null;
  const { kind, key, reason } = raw;
  if (!isNonEmptyString(kind) || !isNonEmptyString(key) || !isNonEmptyString(reason)) {
    return null;
  }
  return { kind, key, reason };
}

function parseSetWatermarkBody(raw: unknown): SetWatermarkBody | null {
  if (!isRecord(raw)) return null;
  const { kind, value } = raw;
  if (!isNonEmptyString(kind) || !isNonEmptyString(value)) return null;
  return { kind, value };
}

/**
 * The X poster's surface: one live read plus the ledger that makes posting exactly-once.
 *
 * Token-gated with the rest of `/chain/*` (`public-paths.ts` does not list it, so the default-deny
 * middleware in `index.ts` covers it). These are write endpoints, so an unprotected one would let a
 * stranger write the ledger.
 */
export function socialRoutes(deps: SocialRouteDeps): Hono {
  const app = new Hono();
  const store = new SocialStore(deps.pool);

  app.get("/chain/social/snapshot", async (c) =>
    c.json(await buildSnapshot(deps.pool, deps.price(), Date.now())),
  );

  // Which cross-chain crossings are eligible to post now, oldest first. `minUsd` is required (there
  // is no honest default floor), and a malformed `since` is refused rather than treated as
  // "consider everything", which would repost crossings already watermarked past.
  app.get("/chain/social/swaps", async (c) => {
    const minUsd = Number(c.req.query("minUsd"));
    if (!Number.isFinite(minUsd) || minUsd <= 0) {
      return c.json({ error: "minUsd required" }, 400);
    }
    const since = parseSinceParam(c.req.query("since"));
    if (since === undefined) {
      return c.json({ error: "since must be a valid watermark" }, 400);
    }
    return c.json({
      items: await eligibleSwaps(deps.pool, {
        minUsd,
        since,
        settleSeconds: SWAP_SETTLE_SECONDS,
        nowMs: Date.now(),
        limit: SWAP_QUERY_LIMIT,
      }),
    });
  });

  // Which boundary crossings are eligible now, oldest first. `minZat` is required (there is no
  // honest default floor), and a malformed `since` is refused rather than treated as "consider
  // everything".
  app.get("/chain/social/crossings", async (c) => {
    const minUsd = Number(c.req.query("minUsd"));
    if (!Number.isFinite(minUsd) || minUsd <= 0) {
      return c.json({ error: "minUsd required" }, 400);
    }
    const since = parseSinceParam(c.req.query("since"));
    if (since === undefined) {
      return c.json({ error: "since must be a valid watermark" }, 400);
    }
    // The tip is read here rather than taken from the caller: the confirmation depth is a
    // correctness property (posting about a block that is then orphaned is the worst failure
    // available), and a caller that could name its own tip could waive it.
    const { rows } = await deps.pool.query<{ height: number | null }>(
      "SELECT max(height) AS height FROM block",
    );
    const tipHeight = rows[0]?.height ?? null;
    if (tipHeight === null) return c.json({ error: "no chain data" }, 503);

    /*
     * The USD floor becomes a ZEC floor here, at the live price this service already holds, and the
     * price used travels back with the answer. The index compares zatoshi; converting on this side
     * means the same price bounds the candidates and is printed on the card, so the threshold a
     * crossing cleared and the rate beside its dollar figure are never two different numbers.
     *
     * A cold tracker is a 503, never a fallback floor: a USD threshold cannot be evaluated without
     * a price.
     */
    const priceUsd = deps.price().usd;
    if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0) {
      return c.json({ error: "no price available to evaluate a USD floor" }, 503);
    }
    const minZat = Math.round((minUsd / priceUsd) * 100_000_000);
    const batch = await eligibleBoundaryCrossings(deps.pool, {
      minZat,
      since,
      tipHeight,
      limit: BOUNDARY_QUERY_LIMIT,
    });
    return c.json({ ...batch, priceUsd, minZatApplied: minZat });
  });

  app.post("/chain/social/claim", async (c) => {
    const body = parseClaimBody(await c.req.json());
    if (!body) return c.json({ error: "invalid claim body" }, 400);
    return c.json({ claimed: await store.claim(body.kind, body.key, body.snapshot) });
  });

  app.post("/chain/social/complete", async (c) => {
    const body = parseCompleteBody(await c.req.json());
    if (!body) return c.json({ error: "invalid complete body" }, 400);
    await store.complete(body.kind, body.key, body.tweetId);
    return c.json({ ok: true });
  });

  app.post("/chain/social/skip", async (c) => {
    const body = parseSkipBody(await c.req.json());
    if (!body) return c.json({ error: "invalid skip body" }, 400);
    await store.skip(body.kind, body.key, body.reason);
    return c.json({ ok: true });
  });

  // How far a kind's poster has considered. A swap's watermark is a composite
  // `"<timestamp>:<id>"` (see `swap-events.ts`), opaque to this route as it is to `SocialStore`. A
  // kind with no row has considered nothing; an empty watermark is refused on write.
  app.get("/chain/social/watermark/:kind", async (c) =>
    c.json({ value: await store.watermark(c.req.param("kind")) }),
  );

  // Overwrites rather than accumulating. The poster calls this only once a crossing is settled
  // (posted, skipped, or already claimed), never before: a crash between claiming and this call
  // re-offers the same crossing, and the ledger's primary key stops the replay becoming a double
  // post.
  app.post("/chain/social/watermark", async (c) => {
    const body = parseSetWatermarkBody(await c.req.json());
    if (!body) return c.json({ error: "invalid watermark body" }, 400);
    await store.setWatermark(body.kind, body.value);
    return c.json({ ok: true });
  });

  // Read back what was published. The card route renders from this, so the image shows the figures
  // that were claimed rather than a later read.
  app.get("/chain/social/post/:kind/:key", async (c) => {
    const row = await store.read(c.req.param("kind"), c.req.param("key"));
    return row ? c.json(row) : c.json({ error: "not found" }, 404);
  });

  // Whether a key has already been decided (posted, skipped, claimed or failed). Cheap, and lets
  // the posting loop check before building a snapshot.
  app.get("/chain/social/settled/:kind/:key", async (c) =>
    c.json({ settled: await store.hasSettled(c.req.param("kind"), c.req.param("key")) }),
  );

  return app;
}

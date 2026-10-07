import type { Pool } from "pg";
import { isDryRunKind, type SocialPost, type SocialSnapshot } from "@/domain/social";
import type { SwapFigures } from "@/domain/swap";
import type { BoundaryFigures } from "@/domain/boundary";

/**
 * Whatever a ledger row's `figures` column may hold. A union rather than `unknown`: the
 * column is written once and read back by the card route, which picks its component from
 * the kind, so the set of shapes that can legally go in is closed and worth naming.
 */
export type SocialFigures = SocialSnapshot | SwapFigures | BoundaryFigures;

/**
 * The ledger that makes posting exactly-once.
 *
 * Every method is keyed on (kind, event_key), which is the primary key, so concurrency is
 * settled by the database rather than by a lock we would have to remember to take.
 */
export class SocialStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * Reserve a key and store the figures. Returns false when the key is already present in any
   * status, including `claimed` (the crash-mid-post case), which must never be retried.
   *
   * Dry-run kinds (`isDryRunKind`) are the exception: a dry run may run any number of times without
   * consuming a real event, so its row is replaced rather than reserved and always succeeds. Real
   * kinds never reach that branch; the caller keeps the kinds apart.
   */
  async claim(kind: string, key: string, snapshot: SocialFigures): Promise<boolean> {
    if (isDryRunKind(kind)) {
      await this.#pool.query(
        `INSERT INTO social_post (kind, event_key, status, figures, created_at)
         VALUES ($1, $2, 'claimed', $3, $4)
         ON CONFLICT (kind, event_key) DO UPDATE
           SET status = 'claimed', figures = $3, created_at = $4,
               tweet_id = NULL, posted_at = NULL, reason = NULL`,
        [kind, key, JSON.stringify(snapshot), Math.floor(Date.now() / 1000)],
      );
      return true;
    }
    const { rowCount } = await this.#pool.query(
      `INSERT INTO social_post (kind, event_key, status, figures, created_at)
       VALUES ($1, $2, 'claimed', $3, $4)
       ON CONFLICT (kind, event_key) DO NOTHING`,
      [kind, key, JSON.stringify(snapshot), Math.floor(Date.now() / 1000)],
    );
    return rowCount === 1;
  }

  /**
   * Guarded by `status = 'claimed'` so a retried call cannot rewrite `tweet_id`/`posted_at` on a
   * row that already recorded what X returned: the ledger is the audit record of what was
   * published.
   */
  async complete(kind: string, key: string, tweetId: string): Promise<void> {
    await this.#pool.query(
      `UPDATE social_post SET status = 'posted', tweet_id = $3, posted_at = $4
        WHERE kind = $1 AND event_key = $2 AND status = 'claimed'`,
      [kind, key, tweetId, Math.floor(Date.now() / 1000)],
    );
  }

  /** Record that we deliberately did not post, and why. Blocks the key like any other row. */
  async skip(kind: string, key: string, reason: string): Promise<void> {
    await this.#pool.query(
      `INSERT INTO social_post (kind, event_key, status, reason, created_at)
       VALUES ($1, $2, 'skipped', $3, $4)
       ON CONFLICT (kind, event_key) DO NOTHING`,
      [kind, key, reason, Math.floor(Date.now() / 1000)],
    );
  }

  /**
   * Generic over its figures, like `SocialPost<T>`: the ledger holds more than one kind of post,
   * and the caller knows which kind it asked for.
   */
  async read<T>(kind: string, key: string): Promise<SocialPost<T> | null> {
    const { rows } = await this.#pool.query(
      `SELECT event_key, figures, tweet_id FROM social_post
        WHERE kind = $1 AND event_key = $2 AND figures IS NOT NULL`,
      [kind, key],
    );
    if (rows.length === 0) return null;
    return {
      eventKey: rows[0].event_key,
      figures: rows[0].figures as T,
      tweetId: rows[0].tweet_id,
    };
  }

  /** Has this key been decided — posted, skipped, claimed or failed? */
  async hasSettled(kind: string, key: string): Promise<boolean> {
    const { rowCount } = await this.#pool.query(
      `SELECT 1 FROM social_post WHERE kind = $1 AND event_key = $2`,
      [kind, key],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * How far the poster has considered this kind of event (a timestamp for a venue feed, a height
   * for a chain walk). Distinct from `hasSettled`: this is what was looked at, not what was
   * decided, and a kind with no row has considered nothing.
   */
  async watermark(kind: string): Promise<string | null> {
    const { rows } = await this.#pool.query(`SELECT value FROM social_watermark WHERE kind = $1`, [
      kind,
    ]);
    return rows.length === 0 ? null : (rows[0].value as string);
  }

  /** Overwrites rather than accumulating: one watermark per kind, always the latest. */
  async setWatermark(kind: string, value: string): Promise<void> {
    await this.#pool.query(
      `INSERT INTO social_watermark (kind, value, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (kind) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [kind, value, Math.floor(Date.now() / 1000)],
    );
  }
}

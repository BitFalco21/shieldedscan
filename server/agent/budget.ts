import type { Pool } from "pg";
import { DAY_SECONDS } from "@/domain/time";

/**
 * Tokens one measured turn needs (~34–39k). "Allowed" means at least this much is in the bucket,
 * so a caller told to come back is told a time at which a whole turn can run, not one token.
 */
export const TURN_RESERVE_TOKENS = 40_000;

export interface BudgetState {
  allowed: boolean;
  /** Tokens spent so far on the UTC day — the accounting meter, unchanged. */
  tokensUsed: number;
  /** Tokens the bucket holds right now (may be negative after in-flight overshoot). */
  tokensAvailable: number;
  /** When refused: seconds until a whole turn's worth has refilled. Absent when allowed. */
  retryAfterSeconds?: number;
}

/**
 * The hard daily ceiling on what the agent may spend.
 *
 * One row per UTC day counts tokens in and out as the provider reports them, plus one row holds a
 * leaky bucket that decides admission (see `check`). Neither is an identifier — they say how much
 * the agent was used, never by whom — and both live in Postgres so a container restart does not
 * hand an attacker a fresh budget.
 *
 * check() and record() deliberately do not share a transaction: the ceiling is a cost control,
 * not an accounting invariant, and the worst overshoot is the requests already in flight. Errors
 * propagate and the caller answers 503: an unreadable meter must never allow traffic.
 */
export class AgentBudget {
  readonly #pool: Pool;
  readonly #dailyTokenBudget: number;

  constructor(pool: Pool, dailyTokenBudget: number) {
    this.#pool = pool;
    this.#dailyTokenBudget = dailyTokenBudget;
  }

  /** Idempotent, mirrored in schema.sql; here too so the test can run against a bare DB. */
  async ensureSchema(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS agent_budget (
        day        DATE   PRIMARY KEY,
        tokens_in  BIGINT NOT NULL DEFAULT 0,
        tokens_out BIGINT NOT NULL DEFAULT 0,
        requests   BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL
      )
    `);
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS agent_budget_bucket (
        id         SMALLINT PRIMARY KEY CHECK (id = 1),
        level      BIGINT   NOT NULL,
        updated_at BIGINT   NOT NULL
      )
    `);
  }

  /** Tokens refilled per second: the daily budget spread evenly over the day. */
  get #ratePerSecond(): number {
    return this.#dailyTokenBudget / DAY_SECONDS;
  }

  /**
   * Whether a turn may start now.
   *
   * The bucket, not the day, decides. Capacity is the daily budget (a legitimate burst is never held
   * below what the day allows), refilling at budget/86,400 per second. A coordinated drain costs the
   * drainer the same time as before but buys at most an hour of unavailability for everyone else,
   * instead of the rest of the UTC day. No identity anywhere: one row, no caller.
   */
  async check(nowMs: number): Promise<BudgetState> {
    const nowS = Math.floor(nowMs / 1000);
    const [meter, bucket] = await Promise.all([
      this.#pool.query<{ used: string }>(
        "SELECT tokens_in + tokens_out AS used FROM agent_budget WHERE day = $1",
        [utcDayKey(nowMs)],
      ),
      this.#pool.query<{ level: string; updated_at: string }>(
        "SELECT level, updated_at FROM agent_budget_bucket WHERE id = 1",
      ),
    ]);
    const tokensUsed = meter.rows[0] ? Number(meter.rows[0].used) : 0;
    const row = bucket.rows[0];
    const tokensAvailable =
      row === undefined
        ? this.#dailyTokenBudget
        : Math.min(
            this.#dailyTokenBudget,
            Number(row.level) + Math.max(0, nowS - Number(row.updated_at)) * this.#ratePerSecond,
          );
    // A turn's reserve, or a tenth of a budget too small to hold one (tests, tiny previews).
    const reserve = Math.min(TURN_RESERVE_TOKENS, this.#dailyTokenBudget / 10);
    if (tokensAvailable >= reserve) return { allowed: true, tokensUsed, tokensAvailable };
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((reserve - tokensAvailable) / this.#ratePerSecond),
    );
    return { allowed: false, tokensUsed, tokensAvailable, retryAfterSeconds };
  }

  /**
   * Add one request's usage, as reported by the provider's `usage` block — to the daily meter
   * (accounting: this is where per-request cost gets measured) and out of the bucket. One
   * statement each; the bucket's refill is applied in the same UPDATE that debits it, so two
   * concurrent turns cannot each credit the same elapsed seconds.
   */
  async record(nowMs: number, tokensIn: number, tokensOut: number): Promise<void> {
    const nowS = Math.floor(nowMs / 1000);
    const used = Math.max(0, tokensIn) + Math.max(0, tokensOut);
    await this.#pool.query(
      `INSERT INTO agent_budget (day, tokens_in, tokens_out, requests, updated_at)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (day) DO UPDATE SET
         tokens_in  = agent_budget.tokens_in  + EXCLUDED.tokens_in,
         tokens_out = agent_budget.tokens_out + EXCLUDED.tokens_out,
         requests   = agent_budget.requests + 1,
         updated_at = EXCLUDED.updated_at`,
      [utcDayKey(nowMs), Math.max(0, tokensIn), Math.max(0, tokensOut), nowS],
    );
    await this.#pool.query(
      `INSERT INTO agent_budget_bucket (id, level, updated_at)
       VALUES (1, $1::bigint - $2::bigint, $3)
       ON CONFLICT (id) DO UPDATE SET
         level = LEAST(
           $1::bigint,
           agent_budget_bucket.level
             + FLOOR(GREATEST(0, EXCLUDED.updated_at - agent_budget_bucket.updated_at) * $1::numeric / 86400)::bigint
         ) - $2::bigint,
         updated_at = GREATEST(agent_budget_bucket.updated_at, EXCLUDED.updated_at)`,
      [this.#dailyTokenBudget, used, nowS],
    );
  }
}

/** The UTC date a timestamp falls on — the meter's row key. Midnight UTC, never local. */
export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

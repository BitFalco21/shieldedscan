import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { AgentBudget, TURN_RESERVE_TOKENS, utcDayKey } from "../budget";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The daily token meter: it turns "a keyless LLM endpoint is a money faucet" into "worst case, one
 * day's ceiling". A per-day counter says how much the agent was used, never by whom, which keeps it
 * compatible with the no-visitor-logs rule where a per-client quota would not be.
 *
 * The date arithmetic is pure and tested flat; the SQL runs only when TEST_DATABASE_URL is set, the
 * same pattern as postgres-crosschain-store.test.ts:
 *
 *   docker run -d --name pgtest -e POSTGRES_PASSWORD=test -e POSTGRES_DB=explorer \
 *     -p 55432:5432 postgres:17
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer npx vitest run server/agent
 */

describe("utcDayKey", () => {
  it("formats a timestamp as its UTC date", () => {
    // 2026-08-03T10:14:22Z
    expect(utcDayKey(1_785_752_062_000)).toBe("2026-08-03");
  });

  it("rolls the day at midnight UTC, not local time", () => {
    // 2026-08-03T23:59:59Z is still the 3rd; one second later is the 4th.
    expect(utcDayKey(Date.UTC(2026, 7, 3, 23, 59, 59))).toBe("2026-08-03");
    expect(utcDayKey(Date.UTC(2026, 7, 3, 23, 59, 59) + 1_000)).toBe("2026-08-04");
  });

  it("zero-pads month and day", () => {
    expect(utcDayKey(Date.UTC(2026, 0, 5))).toBe("2026-01-05");
  });
});

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("AgentBudget (Postgres)", () => {
  let pool: Pool;
  let budget: AgentBudget;
  const DAY = Date.UTC(2026, 7, 3, 12, 0, 0);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    await pool.query("DROP TABLE IF EXISTS agent_budget, agent_budget_bucket");
    budget = new AgentBudget(pool, 10_000);
    await budget.ensureSchema();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("allows a fresh day and reports zero usage", async () => {
    const state = await budget.check(DAY);
    expect(state).toMatchObject({ allowed: true, tokensUsed: 0 });
  });

  it("accumulates recorded usage across calls", async () => {
    await budget.record(DAY, 3_000, 500);
    await budget.record(DAY, 2_000, 400);
    const state = await budget.check(DAY);
    expect(state).toMatchObject({ allowed: true, tokensUsed: 5_900 });
  });

  it("refuses once the ceiling is reached — at the ceiling, not past it", async () => {
    await budget.record(DAY, 4_000, 100);
    const state = await budget.check(DAY);
    expect(state.tokensUsed).toBe(10_000);
    expect(state.allowed).toBe(false);
  });

  it("a new UTC day starts a fresh meter", async () => {
    const nextDay = DAY + 24 * 3_600 * 1_000;
    const state = await budget.check(nextDay);
    expect(state).toMatchObject({ allowed: true, tokensUsed: 0 });
  });

  /*
   * The bucket: the daily amount refills continuously at budget/86,400 per second with the day's
   * budget as the cap, so a coordinated drain buys at most about an hour of unavailability rather
   * than the rest of the UTC day.
   */
  it("refills after a drain, and says how long the wait is", async () => {
    const pool2 = new Pool({ connectionString: DATABASE_URL, max: 2 });
    try {
      await pool2.query("DROP TABLE IF EXISTS agent_budget, agent_budget_bucket");
      const daily = 864_000; // 10 tokens per second, for legible arithmetic
      const b = new AgentBudget(pool2, daily);
      await b.ensureSchema();
      const t0 = Date.UTC(2026, 7, 28, 12, 0, 0);
      // Full at rest.
      expect((await b.check(t0)).allowed).toBe(true);
      // Drain it in one go.
      await b.record(t0, daily, 0);
      const drained = await b.check(t0);
      expect(drained.allowed).toBe(false);
      // One turn's reserve at 10 tokens/s is 4,000 s away.
      expect(drained.retryAfterSeconds).toBe(TURN_RESERVE_TOKENS / 10);
      // Not yet.
      expect((await b.check(t0 + 1_000_000)).allowed).toBe(false);
      // After the stated wait a turn may run again — the day has not rolled over.
      expect((await b.check(t0 + 4_000_000)).allowed).toBe(true);
      // The daily meter still accounts for the spend, independently.
      expect((await b.check(t0 + 4_000_000)).tokensUsed).toBe(daily);
    } finally {
      await pool2.end();
    }
  });

  it("caps the refill at the daily budget, and applies it in the debit itself", async () => {
    const pool2 = new Pool({ connectionString: DATABASE_URL, max: 2 });
    try {
      await pool2.query("DROP TABLE IF EXISTS agent_budget, agent_budget_bucket");
      const daily = 864_000;
      const b = new AgentBudget(pool2, daily);
      await b.ensureSchema();
      const t0 = Date.UTC(2026, 7, 28, 12, 0, 0);
      await b.record(t0, 100_000, 0);
      // A week idle refills to the cap, never beyond it.
      const later = t0 + 7 * 86_400_000;
      expect((await b.check(later)).tokensAvailable).toBe(daily);
      // A debit after the idle week credits the elapsed refill in the same statement.
      await b.record(later, 50_000, 0);
      expect((await b.check(later)).tokensAvailable).toBe(daily - 50_000);
    } finally {
      await pool2.end();
    }
  });

  it("rejects rather than answering when the database is unreachable — fail closed", async () => {
    const dead = new Pool({
      host: "127.0.0.1",
      port: 1,
      connectionTimeoutMillis: 300,
      max: 1,
    });
    const broken = new AgentBudget(dead, 10_000);
    await expect(broken.check(DAY)).rejects.toThrow();
    await dead.end();
  });
});

/**
 * The sizing gate. The rate limits in `server/Caddyfile` are justified in prose against a measured
 * per-request cost and the daily budget; a number in a comment goes stale silently. So the figures
 * are parsed out of that prose and the relationship is asserted: raising a ceiling, lowering the
 * budget, or updating the measured cost without redoing the arithmetic fails here.
 */
describe("the /agent budget and rate limits are sized against each other", () => {
  const caddyfile = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "Caddyfile"),
    "utf8",
  );

  const num = (raw: string) => Number(raw.replace(/,/g, ""));

  /** The measured per-request cost the sizing rests on. */
  const measuredTokensPerRequest = (() => {
    const m = caddyfile.match(/\*\*([\d,]+) tokens per request\*\*/);
    if (!m) throw new Error("the Caddyfile no longer states a measured per-request cost");
    return num(m[1]!);
  })();

  /** The daily budget the sizing assumes, taken from the same comment. */
  const dailyTokenBudget = (() => {
    const m = caddyfile.match(/AGENT_DAILY_TOKEN_BUDGET\s+([\d,]+)/);
    if (!m) throw new Error("the Caddyfile no longer states the intended daily token budget");
    return num(m[1]!);
  })();

  const zone = (name: string) => {
    // Non-greedy: `key {remote_host}` inside a zone body contains a `}`.
    const m = caddyfile.match(new RegExp(`zone ${name} \\{.*?events (\\d+).*?window (\\S+)`, "s"));
    if (!m) throw new Error(`zone ${name} not found in the Caddyfile`);
    return { events: Number(m[1]), window: m[2]! };
  };

  const questionsPerDay = () => Math.floor(dailyTokenBudget / measuredTokensPerRequest);

  it("states a cost, a budget and three zones that can all be read back", () => {
    expect(measuredTokensPerRequest).toBeGreaterThan(1_000);
    expect(dailyTokenBudget).toBeGreaterThan(0);
    expect(zone("agent_global").window).toBe("1m");
    expect(zone("agent_ip").window).toBe("1m");
    expect(zone("agent_burst").window).toBe("1s");
  });

  it("cannot have its whole day drained inside twenty minutes", () => {
    /*
     * An exhausted budget is the agent's worst failure mode: a 429 costs a visitor seconds and
     * carries `Retry-After`, while an exhausted budget costs every later visitor the whole feature.
     * Twenty minutes is the floor because it is long enough for a human to notice a flood and act.
     */
    const minutesToDrain = questionsPerDay() / zone("agent_global").events;
    expect(minutesToDrain).toBeGreaterThanOrEqual(20);
  });

  it("makes a single address take an hour or more to drain it", () => {
    // The distributed case needs many addresses; the cheap attack is one script from one host, and
    // this keeps that slow.
    const minutesFromOneAddress = questionsPerDay() / zone("agent_ip").events;
    expect(minutesFromOneAddress).toBeGreaterThanOrEqual(60);
  });

  it("keeps the per-IP sustained limit reachable by a script and not by a reader", () => {
    // A turn takes ~15 s and its answer has to be read, so a person cannot reach 5/min. Well above
    // that the limit protects nothing; at or below ~2/min a genuine reader hits it.
    expect(zone("agent_ip").events).toBeGreaterThanOrEqual(3);
    expect(zone("agent_ip").events).toBeLessThanOrEqual(8);
  });

  it("keeps the global ceiling inside what the process can actually serve", () => {
    /*
     * `MAX_IN_FLIGHT` is 8 concurrent turns and a typical turn takes ~15 s, so sustained capacity
     * is roughly 32 turns a minute. A ceiling above that is nominal: the excess finds no slot and
     * gets a 503 "at capacity", which reads as breakage rather than throttling.
     */
    const sustainedCapacityPerMinute = (8 * 60) / 15;
    expect(zone("agent_global").events).toBeLessThanOrEqual(sustainedCapacityPerMinute);
  });
});

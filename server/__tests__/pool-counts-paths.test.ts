import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { loadChainWindow } from "../chain-window";

/**
 * The two paths per-pool counts can take. A narrow window takes the exact `tx` scan and reports
 * `basis: "exact-blocks"`; a wide one takes `chain_day_pool_tx` and says so. Where both can serve
 * the same day-aligned window they must agree.
 *
 * Needs a real database with real rows and a populated `chain_day_pool_tx` (an empty one would
 * make the agreement vacuous). Skips without TEST_DATABASE_URL.
 */
const url = process.env.TEST_DATABASE_URL;
// Runs only against a database already holding real chain and rate data: an empty one has
// nothing to check. Set TEST_DATABASE_HAS_REAL_DATA=1 beside TEST_DATABASE_URL to opt in.
const run = url && process.env.TEST_DATABASE_HAS_REAL_DATA === "1" ? describe : describe.skip;

/** Midnight UTC, `days` ago — the edge both paths cut on identically. */
function utcMidnightDaysAgo(days: number): number {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

run("per-pool counts: path selection", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query("REFRESH MATERIALIZED VIEW chain_day_pool_tx");
  });
  afterAll(async () => {
    await pool.end();
  });

  it("takes the EXACT path for a narrow window", async () => {
    const agg = await loadChainWindow(
      pool,
      { fromTimestamp: utcMidnightDaysAgo(3), toTimestamp: utcMidnightDaysAgo(0) },
      "none",
    );
    expect(agg.poolTxCounts?.basis).toBe("exact-blocks");
    expect(agg.poolTxCounts?.fromDay).toBeUndefined();
    expect(agg.poolTxCountsUnavailable).toBeNull();
  });

  it("takes the WIDE path past the block cap, and names the days it summed", async () => {
    /*
     * The cap counts blocks, not days: a long window over a database holding a few weeks still
     * resolves to few blocks and takes the exact path. The fixture must span more than
     * POOL_TX_COUNT_MAX_BLOCKS heights (hence a distant slice as well as a recent one), and this
     * asserts it does, so the test cannot silently exercise the exact path twice.
     */
    const { rows } = await pool.query<{ span: string }>(
      "SELECT (max(height) - min(height))::text AS span FROM block",
    );
    expect(Number(rows[0]!.span)).toBeGreaterThan(230_000);

    const { rows: edges } = await pool.query<{ lo: string; hi: string }>(
      "SELECT min(timestamp)::text AS lo, max(timestamp)::text AS hi FROM block",
    );
    const agg = await loadChainWindow(
      pool,
      { fromTimestamp: Number(edges[0]!.lo), toTimestamp: Number(edges[0]!.hi) + 1 },
      "none",
    );
    expect(agg.poolTxCounts?.basis).toBe("whole-days");
    expect(agg.poolTxCounts?.fromDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(agg.poolTxCounts?.toDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The whole point of the change: a wide window is no longer a refusal.
    expect(agg.poolTxCountsUnavailable).toBeNull();
    expect(agg.poolTxCounts!.sapling).toBeGreaterThan(0);
  });

  it("answers an OPEN window exactly as the same window with the chain's own edges", async () => {
    // "All time" arrives with no edges. It must take the same wide path and return the same
    // counts as the explicit window above, never a refusal.
    const { rows: edges } = await pool.query<{ lo: string; hi: string }>(
      "SELECT min(timestamp)::text AS lo, max(timestamp)::text AS hi FROM block",
    );
    const explicit = await loadChainWindow(
      pool,
      { fromTimestamp: Number(edges[0]!.lo), toTimestamp: Number(edges[0]!.hi) + 1 },
      "none",
    );
    const open = await loadChainWindow(pool, {}, "none");
    expect(open.poolTxCountsUnavailable).toBeNull();
    expect(open.poolTxCounts?.basis).toBe("whole-days");
    // Not measurable from day totals: null, never a fabricated zero.
    expect(open.poolTxCounts?.transparentOnly).toBeNull();
    expect(open.poolTxCounts).toEqual(explicit.poolTxCounts);
  });

  it("the two paths AGREE on a day-aligned window both can serve", async () => {
    const from = utcMidnightDaysAgo(3);
    const to = utcMidnightDaysAgo(0);
    const exact = await loadChainWindow(pool, { fromTimestamp: from, toTimestamp: to }, "none");
    expect(exact.poolTxCounts!.basis).toBe("exact-blocks");

    const { rows } = await pool.query<{ pool: string; txs: string }>(
      `SELECT pool, SUM(txs)::bigint AS txs
         FROM chain_day_pool_tx
        WHERE day >= (to_timestamp($1) AT TIME ZONE 'UTC')::date
          AND day <  (to_timestamp($2) AT TIME ZONE 'UTC')::date
        GROUP BY 1`,
      [from, to],
    );
    const view = new Map(rows.map((r) => [r.pool, Number(r.txs)]));
    // Every pool, not just the busy one: a sign or a filter wrong on one pool alone is the
    // shape this codebase has got wrong most often.
    for (const p of ["sprout", "sapling", "orchard", "ironwood"] as const) {
      expect({ pool: p, n: exact.poolTxCounts![p] }).toEqual({ pool: p, n: view.get(p) ?? 0 });
    }
  });

  it("treats the `to` edge as EXCLUSIVE, like the exact path does", async () => {
    /*
     * The exact scan selects `timestamp >= from AND timestamp < to`, so a window ending exactly at
     * midnight must not include that midnight's day; a day query written `day <= date(to)` would.
     * Only a midnight edge can show it, since with mid-day edges `date(to)` and `date(to - 1)` are
     * the same day.
     */
    const { rows: days } = await pool.query<{ d: string }>(
      "SELECT to_char(day, 'YYYY-MM-DD') AS d FROM chain_day_pool_tx GROUP BY day ORDER BY day DESC LIMIT 2",
    );
    const lastDay = days[0]!.d;
    const priorDay = days[1]!.d;

    // A window ending at midnight ON the last day must stop BEFORE it.
    const midnightOfLastDay = Math.floor(Date.parse(`${lastDay}T00:00:00Z`) / 1000);
    const agg = await loadChainWindow(
      pool,
      {
        fromTimestamp: Math.floor(Date.parse("2020-01-01T00:00:00Z") / 1000),
        toTimestamp: midnightOfLastDay,
      },
      "none",
    );
    expect(agg.poolTxCounts!.basis).toBe("whole-days");
    // The reported last day is the day BEFORE the exclusive edge, not the edge itself.
    expect(agg.poolTxCounts!.toDay).toBe(priorDay);

    // And the figures must exclude that day entirely.
    const { rows } = await pool.query<{ txs: string }>(
      `SELECT COALESCE(SUM(txs), 0)::bigint AS txs FROM chain_day_pool_tx
        WHERE pool = 'orchard' AND day >= '2020-01-01' AND day <= $1::date`,
      [priorDay],
    );
    expect(agg.poolTxCounts!.orchard).toBe(Number(rows[0]!.txs));
  });

  it("still reports no-blocks for a window the chain never reached", async () => {
    // A measurement, not a refusal, and the distinction must survive this change.
    const agg = await loadChainWindow(pool, { fromTimestamp: 1, toTimestamp: 2 }, "none");
    expect(agg.poolTxCounts).toBeNull();
    expect(agg.poolTxCountsUnavailable).toBe("no-blocks");
  });
});

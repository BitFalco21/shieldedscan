import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresChainStore } from "../postgres-chain-store";
import { repairDirection } from "../repair-direction";
import { ROLLUP_VIEW_NAMES } from "../rollup/definitions";
import { ROLLUP_PASS_LOCK } from "../rollup/lock";
import { markingUpdate } from "../rollup/marks";
import { recomputeMonthChunk } from "../rollup/run";
import { monthEnd, monthStart } from "../rollup/pass";
import {
  at,
  chainBlock,
  columnTypes,
  createLegacyViews,
  expectRollupsEqual,
  freshDatabase,
  pendingMarks,
  refreshLegacyViews,
  type BlockSpec,
} from "./support/rollup-chain";

/**
 * The rollup tables, maintained incrementally, against the original view SQL evaluated from
 * scratch after every step.
 *
 * Each step changes the chain the way production does — the follower's ingest, a reorg's rollback,
 * the backfiller writing old heights, a repair rewriting history, mempool rows — then runs the
 * follower's pass, refreshes the frozen views and requires every table to equal its view row for
 * row. A step that only works by full recompute would pass here only if the dirty-period marks are
 * complete, which is the property under test.
 *
 *   TEST_DATABASE_URL=postgres://test:test@127.0.0.1:55434/test \
 *     npx vitest run server/__tests__/rollup-equality.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

const BASE = 3_600_000;

run("rollup tables equal the view definitions at every step", () => {
  let url: string;
  let pool: Pool;
  let store: PostgresChainStore;
  let backfiller: PostgresChainStore;

  /** One pass, then the full comparison against freshly refreshed views. */
  async function passAndCompare(context: string, budgetMs?: number): Promise<void> {
    while ((await pendingMarks(pool)) > 0) {
      const written = await store.refreshRollups(() => {}, budgetMs);
      expect(written, context).not.toBeNull();
    }
    await refreshLegacyViews(pool, "legacy");
    await expectRollupsEqual(
      pool,
      (n) => `public.${n}`,
      (n) => `legacy.${n}`,
      context,
    );
  }

  const ingest = async (specs: BlockSpec[], via = store) => {
    for (const spec of specs) await via.ingestBlock(chainBlock(spec));
  };

  beforeAll(async () => {
    url = await freshDatabase(DATABASE_URL!, "explorer_rollup_equality");
    pool = new Pool({ connectionString: url, max: 4 });
    store = new PostgresChainStore(pool);
    // The backfiller's shape: no sync state, old heights below the follower's tip.
    backfiller = new PostgresChainStore(pool, { trackSyncState: false });
    await createLegacyViews(pool, "legacy");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("declares every column exactly as the view did", async () => {
    for (const name of ROLLUP_VIEW_NAMES) {
      expect(await columnTypes(pool, `public.${name}`), name).toEqual(
        await columnTypes(pool, `legacy.${name}`),
      );
    }
  });

  it("starts empty and stays equal with nothing to do", async () => {
    expect(await store.refreshRollups()).toBe(0);
    await passAndCompare("empty chain");
  });

  it("blocks that pay no fee: the non-zero floor has no row", async () => {
    // Coinbase-only blocks total 0 in fees; there is no fee-paying transaction at all.
    await ingest(
      Array.from({ length: 6 }, (_, i) => ({
        height: BASE + i,
        time: at("2026-01-30T22:00:00") + i * 3_600,
        template: "coinbase" as const,
      })),
    );
    await passAndCompare("coinbase only");
    const { rows } = await pool.query("SELECT * FROM chain_fee_nonzero_floor");
    expect(rows).toEqual([]);
  });

  it("follows the chain across a day and a month boundary", async () => {
    const templates = ["mixed", "ironwood", "shielded", "sprout", "mixed", "ironwood"] as const;
    await ingest(
      Array.from({ length: 30 }, (_, i) => ({
        height: BASE + 6 + i,
        time: at("2026-01-31T18:00:00") + i * 1_500,
        template: templates[i % templates.length]!,
      })),
    );
    await passAndCompare("across 2026-01-31 / 2026-02-01");
  });

  it("handles timestamps that go backwards across both boundaries", async () => {
    // The tip is in February; these land back in January, and one jumps ahead a day.
    await ingest([
      { height: BASE + 36, time: at("2026-01-31T23:59:00"), template: "mixed" },
      { height: BASE + 37, time: at("2026-01-31T12:00:00"), template: "ironwood" },
      { height: BASE + 38, time: at("2026-02-02T00:30:00"), template: "shielded" },
      { height: BASE + 39, time: at("2026-02-01T08:00:00"), template: "sprout" },
    ]);
    await passAndCompare("backwards timestamps");
  });

  it("ignores mempool rows, then counts one once a block mines it", async () => {
    const pending = "mempool-0".padEnd(64, "0");
    await pool.query(
      `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, version, size_bytes, kind,
                       fee_zat, orchard_actions, orchard_value_balance_zat)
       VALUES ($1, NULL, $2, false, 5, 300, 'shielded', 10000, 2, -10000)`,
      [pending, at("2026-02-01T09:00:00")],
    );
    await passAndCompare("a mempool row");
    await ingest([
      {
        height: BASE + 40,
        time: at("2026-02-01T10:00:00"),
        template: "shielded",
        txids: { 2: pending },
      },
    ]);
    await passAndCompare("the mempool row mined");
  });

  it("recomputes the periods a reorg leaves, even one no new block touches", async () => {
    // Heights above BASE + 36 are replaced. The old blocks held 2026-02-02 (BASE + 38); none of
    // the replacements is on that day, so only the rollback's own marks can clear it.
    await store.rollbackAbove(BASE + 36);
    await ingest([
      { height: BASE + 37, time: at("2026-02-01T11:00:00"), template: "ironwood", fork: "b" },
      { height: BASE + 38, time: at("2026-02-01T11:30:00"), template: "mixed", fork: "b" },
      { height: BASE + 39, time: at("2026-01-31T23:00:00"), template: "sprout", fork: "b" },
    ]);
    const { rows } = await pool.query("SELECT 1 FROM block WHERE timestamp >= $1", [
      at("2026-02-02T00:00:00"),
    ]);
    expect(rows).toEqual([]);
    await passAndCompare("after a reorg");
  });

  it("follows the backfiller writing old heights into an earlier month", async () => {
    await ingest(
      Array.from({ length: 5 }, (_, i) => ({
        height: BASE - 100 + i,
        time: at("2025-12-14T10:00:00") + i * 40_000,
        template: (["mixed", "shielded", "ironwood", "sprout", "mixed"] as const)[i]!,
      })),
      backfiller,
    );
    await passAndCompare("backfilled history");
  });

  it("follows an upsert that replaces a block and moves a mined transaction, with no rollback", async () => {
    // The backfiller re-writing a height over a stale row: a different block with a different
    // day, one of whose transactions was already mined at another height on another day. Only
    // the marks of the timestamps these rows leave can clear the old periods.
    const moved = (
      await pool.query<{ txid: string }>(
        "SELECT txid FROM tx WHERE block_height = $1 AND NOT is_coinbase LIMIT 1",
        [BASE - 100],
      )
    ).rows[0]!.txid;
    await ingest(
      [
        {
          height: BASE - 97,
          time: at("2025-12-29T10:00:00"),
          template: "shielded",
          fork: "d",
          txids: { 1: moved },
        },
      ],
      backfiller,
    );
    await passAndCompare("an upsert over a stale block");
  });

  it("covers the rarer shapes: unsettled hub rows and multi-source migrations", async () => {
    // Rewritten by hand (and so marked by hand) into shapes the captured blocks lack.
    const mixed = (
      await pool.query<{ txid: string }>(
        "SELECT txid FROM tx WHERE kind = 'mixed' AND block_height IS NOT NULL ORDER BY txid LIMIT 2",
      )
    ).rows.map((r) => r.txid);
    await pool.query(
      markingUpdate(
        `UPDATE tx SET direction = 'indeterminate' WHERE txid = '${mixed[0]}' RETURNING tx.timestamp`,
      ),
    );
    // Shielding, while a published pool fell: `boundaryCrossing`'s withdrawal, a hub row.
    await pool.query(
      markingUpdate(
        `UPDATE tx SET direction = 'shielding', sapling_spends = 1, sapling_outputs = 0,
                       sapling_value_balance_zat = -5000
          WHERE txid = '${mixed[1]}' RETURNING tx.timestamp`,
      ),
    );
    // A fully shielded transaction fed by two pools into a third: a 'multi' source.
    await pool.query(
      markingUpdate(
        `UPDATE tx SET sapling_spends = 1, sapling_outputs = 1, sapling_value_balance_zat = 9000,
                       orchard_actions = 2, orchard_value_balance_zat = -6000,
                       ironwood_actions = 2, ironwood_value_balance_zat = -4000
          WHERE txid = (SELECT min(txid) FROM tx WHERE kind = 'shielded' AND block_height IS NOT NULL)
          RETURNING tx.timestamp`,
      ),
    );
    await passAndCompare("rarer shapes");
    const hub = await pool.query("SELECT 1 FROM chain_day_pool_boundary WHERE pool = 'hub'");
    expect(hub.rows.length).toBeGreaterThan(0);
    const multi = await pool.query("SELECT 1 FROM chain_day_pool_migration WHERE source = 'multi'");
    expect(multi.rows.length).toBeGreaterThan(0);
  });

  it("follows repairs that rewrite historic rows", async () => {
    // The state a database had before `direction` was backfilled: written by hand here, so it is
    // marked by hand, as any manual change must be.
    await pool.query(
      markingUpdate(
        `UPDATE tx SET direction = NULL WHERE kind = 'mixed' AND block_height IS NOT NULL
         RETURNING tx.timestamp`,
      ),
    );
    await passAndCompare("directions not yet backfilled");
    const repaired = await repairDirection({ pool, log: () => {} });
    expect(repaired.written).toBeGreaterThan(0);
    await passAndCompare("directions repaired");

    // A fee rewrite, as `repair-fees` writes it, on transactions and on block totals.
    await pool.query(
      markingUpdate(
        `UPDATE tx SET fee_zat = fee_zat + 7 WHERE fee_zat IS NOT NULL AND txid LIKE 'atx-%-1%'
         RETURNING tx.timestamp`,
      ),
    );
    await pool.query(
      markingUpdate(
        `UPDATE block SET total_fee_zat = 0 WHERE height = ${BASE + 9} RETURNING block.timestamp`,
      ),
    );
    await passAndCompare("fees repaired");
  });

  it("drains a backlog over several passes when the budget runs out", async () => {
    await pool.query(
      markingUpdate(
        `UPDATE tx SET fee_zat = fee_zat + 1 WHERE fee_zat IS NOT NULL RETURNING tx.timestamp`,
      ),
    );
    const log: string[] = [];
    // A budget of zero still processes one month per pass, newest first.
    await store.refreshRollups((line) => log.push(line), 0);
    expect(log.join("\n")).toMatch(/month\(s\) deferred/);
    expect(await pendingMarks(pool)).toBeGreaterThan(0);
    await passAndCompare("after draining the backlog", 0);
  });

  it("pins its own time zone whatever the session's", async () => {
    const elsewhere = new Pool({
      connectionString: url,
      max: 2,
      options: "-c TimeZone=Pacific/Kiritimati",
    });
    try {
      const other = new PostgresChainStore(elsewhere);
      await other.ingestBlock(
        chainBlock({
          height: BASE + 40,
          time: at("2026-02-01T13:30:00"),
          template: "mixed",
          fork: "c",
        }),
      );
      await other.ingestBlock(
        chainBlock({
          height: BASE + 41,
          time: at("2026-02-01T23:30:00"),
          template: "ironwood",
          fork: "c",
        }),
      );
      await other.refreshRollups();
    } finally {
      await elsewhere.end();
    }
    await passAndCompare("a session in UTC+14");
  });

  it("rebuilds from scratch to the same rows, in one go or month by month", async () => {
    await store.rebuildRollups();
    await passAndCompare("full rebuild");
    for (
      let m = monthStart(at("2025-12-01T00:00:00"));
      m < at("2026-03-01T00:00:00");
      m = monthEnd(m)
    ) {
      expect(await recomputeMonthChunk(pool, m, () => {})).not.toBeNull();
    }
    await passAndCompare("month-by-month fill");
  });

  it("skips a pass while another writer holds the lock, and a failed pass leaves no lock", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock($1)", [ROLLUP_PASS_LOCK]);
      expect(await store.refreshRollups()).toBeNull();
    } finally {
      await holder.query("SELECT pg_advisory_unlock($1)", [ROLLUP_PASS_LOCK]);
      holder.release();
    }

    await pool.query("INSERT INTO chain_rollup_dirty (ts_lo, ts_hi) VALUES ($1, $1)", [
      at("2026-02-01T12:00:00"),
    ]);
    // A constraint every recomputed row violates makes the pass fail mid-transaction.
    await pool.query("ALTER TABLE chain_day_rollup ADD CONSTRAINT refuse CHECK (ts < 0) NOT VALID");
    try {
      await expect(store.refreshRollups()).rejects.toThrow(/refuse/);
    } finally {
      await pool.query("ALTER TABLE chain_day_rollup DROP CONSTRAINT refuse");
    }
    const { rows } = await pool.query(
      "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = $1",
      [ROLLUP_PASS_LOCK],
    );
    expect(rows).toEqual([]);
    // The failed pass rolled back, so its mark is still there and the next pass takes it.
    expect(await pendingMarks(pool)).toBe(1);
    await passAndCompare("after a failed pass");
  });
});

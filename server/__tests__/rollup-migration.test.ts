import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresChainStore } from "../postgres-chain-store";
import { checkRollups } from "../rollup/check";
import { ROLLUP_VIEW_NAMES } from "../rollup/definitions";
import { monthEnd, monthStart } from "../rollup/pass";
import { recomputeMonthChunk } from "../rollup/run";
import { swapRollups } from "../rollup/swap";
import {
  applyChainSchema,
  at,
  chainBlock,
  createLegacyViews,
  expectRollupsEqual,
  freshDatabase,
  pendingMarks,
  type Template,
} from "./support/rollup-chain";

/**
 * The production migration, end to end, on a database shaped like production: the sixteen names
 * held by the materialized views, a chain ingested before the rollup tables existed.
 *
 *   1. the schema stages `<name>_next` beside each view and touches nothing else;
 *   2. the follower keeps refreshing the views, and its pass maintains the staged tables;
 *   3. the month-by-month fill covers the history ingested before them;
 *   4. the check passes, and fails on a corrupted row;
 *   5. the swap puts the tables in the views' names and rebinds a view that read them;
 *   6. after it the views are frozen, the tables go on, the check still holds;
 *   7. the revert puts it all back; the schema re-applies cleanly in every state.
 *
 *   TEST_DATABASE_URL=postgres://test:test@127.0.0.1:55434/test \
 *     npx vitest run server/__tests__/rollup-migration.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

const BASE = 3_700_000;
const TEMPLATES: Template[] = ["mixed", "ironwood", "shielded", "sprout"];

run("migrating from the views to the rollup tables", () => {
  let pool: Pool;
  let store: PostgresChainStore;
  let height = BASE;

  const ingestDays = async (fromIso: string, blocks: number, stepSeconds: number) => {
    const start = at(fromIso);
    for (let i = 0; i < blocks; i += 1) {
      await store.ingestBlock(
        chainBlock({
          height,
          time: start + i * stepSeconds,
          template: TEMPLATES[height % TEMPLATES.length]!,
        }),
      );
      height += 1;
    }
  };

  /** Every refresh the follower's transitional timers run. */
  const refreshViews = async () => {
    await store.refreshMonthlyRollup();
    await store.refreshShieldingFlow();
    await store.refreshFeeKinds();
    await store.refreshTxCounts();
    await store.refreshDayRollup();
    await store.refreshDayShieldingFlow();
    await store.refreshDayFeeKinds();
    await store.refreshDayFeeTotals();
    await store.refreshDayNetwork();
    await store.refreshFeeExtremes();
    // Never-populated pool views are skipped by the timer, as in production before their fill.
    const pass = await store.refreshPoolAnalytics();
    if (pass.skipped.length > 0) {
      const client = await pool.connect();
      try {
        await client.query("SET TimeZone = 'UTC'");
        for (const v of pass.skipped) await client.query(`REFRESH MATERIALIZED VIEW ${v}`);
      } finally {
        client.release();
      }
    }
  };

  const kinds = async () => {
    const { rows } = await pool.query<{ name: string; kind: string }>(
      `SELECT n AS name, (SELECT relkind FROM pg_class WHERE oid = to_regclass(n))::text AS kind
         FROM unnest($1::text[]) AS n`,
      [ROLLUP_VIEW_NAMES.flatMap((v) => [v, `${v}_next`, `${v}_old`])],
    );
    return new Map(rows.map((r) => [r.name, r.kind]));
  };

  const fill = async () => {
    for (
      let m = monthStart(at("2026-03-01T00:00:00"));
      m < at("2026-06-01T00:00:00");
      m = monthEnd(m)
    ) {
      expect(await recomputeMonthChunk(pool, m, () => {})).not.toBeNull();
    }
  };

  beforeAll(async () => {
    const url = await freshDatabase(DATABASE_URL!, "explorer_rollup_migration");
    pool = new Pool({ connectionString: url, max: 6, options: "-c TimeZone=UTC" });
    store = new PostgresChainStore(pool);
    // Production's shape: the views, not tables, hold the names, with their unique indexes.
    for (const name of ROLLUP_VIEW_NAMES) await pool.query(`DROP TABLE ${name}`);
    await createLegacyViews(pool, "public");
    // A chain ingested before the deploy: no marks survive from then.
    await ingestDays("2026-03-30T12:00:00", 30, 6_000);
    await pool.query("DELETE FROM chain_rollup_dirty");
    // A view that reads a rollup, as the open-data views do.
    await pool.query("CREATE SCHEMA od");
    await pool.query(
      "CREATE VIEW od.flow AS SELECT ts, shielded_zat FROM chain_day_shielding_flow",
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("stages a table beside each view and leaves the views alone", async () => {
    await applyChainSchema(pool);
    await applyChainSchema(pool);
    const k = await kinds();
    for (const name of ROLLUP_VIEW_NAMES) {
      expect(k.get(name), name).toBe("m");
      expect(k.get(`${name}_next`), name).toBe("r");
      expect(k.get(`${name}_old`), name).toBeNull();
    }
  });

  it("keeps the views refreshed and the staged tables current for new periods", async () => {
    await ingestDays("2026-04-02T00:00:00", 12, 9_000);
    await refreshViews();
    expect(await store.refreshRollups()).toBeGreaterThan(0);
    expect(await pendingMarks(pool)).toBe(0);
    // History before the deploy is not there yet: the check says so.
    const results = await checkRollups(pool);
    expect(results.some((r) => r.verdict !== "PASS")).toBe(true);
  });

  it("fills the history, after which every staged table equals its view", async () => {
    await fill();
    await expectRollupsEqual(
      pool,
      (n) => `${n}_next`,
      (n) => n,
      "staged after the fill",
    );
    const results = await checkRollups(pool);
    expect(results.map((r) => [r.table, r.verdict])).toEqual(
      ROLLUP_VIEW_NAMES.map((n) => [`${n}_next`, "PASS"]),
    );
    const live = await checkRollups(pool, { live: true });
    expect(live.every((r) => r.verdict === "PASS")).toBe(true);
  });

  it("live: blocks since the last pass are caught up in the check's own transaction, never written", async () => {
    // New blocks marked but not yet passed: on a moving chain this is the normal state.
    await ingestDays("2026-04-03T00:00:00", 1, 5_000);
    await refreshViews();
    const marked = await pendingMarks(pool);
    expect(marked).toBeGreaterThan(0);
    const snapshot = () =>
      pool.query("SELECT * FROM chain_day_rollup_next ORDER BY 1").then((r) => r.rows);
    const before = await snapshot();
    const live = await checkRollups(pool, { live: true });
    for (const r of live) expect(r.verdict, `${r.table}: ${r.detail}`).toBe("PASS");
    // Rolled back: the marks still wait for the follower and every row is as it was, the day the
    // new block landed in included.
    expect(await pendingMarks(pool)).toBe(marked);
    expect(await snapshot()).toEqual(before);
    // With the marks still pending: a wrong all-time total is caught although the catch-up would
    // rewrite it from scratch, and a wrong row in a period no mark touches is not masked by it.
    await pool.query(
      "UPDATE chain_tx_kind_count_next SET txs = txs + 1 WHERE kind = (SELECT min(kind) FROM chain_tx_kind_count_next)",
    );
    await pool.query(
      "UPDATE chain_day_pool_tx_next SET txs = txs + 1 WHERE day = (SELECT min(day) FROM chain_day_pool_tx_next)",
    );
    expect(await pendingMarks(pool)).toBe(marked);
    const wrong = await checkRollups(pool, { live: true });
    const kindCount = wrong.find((r) => r.table === "chain_tx_kind_count_next");
    expect(kindCount?.verdict).toBe("FAIL");
    expect(kindCount?.detail).toMatch(/before any catch-up/);
    expect(wrong.find((r) => r.table === "chain_day_pool_tx_next")?.verdict).toBe("FAIL");
    await fill();
    await store.refreshRollups();
    await refreshViews();
  }, 120_000);

  it("live: refuses a backlog over the catch-up bound instead of recomputing it under the lock", async () => {
    // A repair-sized mark, as the swap test uses: the chain itself is left as it was.
    await pool.query(
      `INSERT INTO chain_rollup_dirty (ts_lo, ts_hi) VALUES ($1::bigint, $1::bigint + 9 * 86400)`,
      [at("2026-03-30T00:00:00")],
    );
    const live = await checkRollups(pool, { live: true });
    for (const r of live) {
      expect(r.verdict, r.table).toBe("UNVERIFIED");
      expect(r.detail).toMatch(/marked days wait/);
    }
    // The refusal wrote nothing: the backlog is still there for the follower.
    expect(await pendingMarks(pool)).toBeGreaterThan(0);
    await store.refreshRollups();
    expect(await pendingMarks(pool)).toBe(0);
  }, 120_000);

  it("accepts a view that is merely behind, and refuses a wrong row", async () => {
    await ingestDays("2026-04-04T00:00:00", 4, 7_000);
    await store.refreshRollups();
    // The views are behind; a differing period passes because it equals its recompute, and an
    // all-time table, with no period to recompute, is unverified rather than passed.
    const allTime = new Set(
      [
        "chain_tx_kind_count",
        "chain_tx_mixed_direction_count",
        "chain_fee_extremes",
        "chain_fee_nonzero_floor",
      ].map((n) => `${n}_next`),
    );
    const behind = await checkRollups(pool);
    expect(behind.some((r) => /the view is behind/.test(r.detail))).toBe(true);
    for (const r of behind) {
      expect(r.verdict, `${r.table}: ${r.detail}`).toMatch(
        allTime.has(r.table) ? /^(PASS|UNVERIFIED)$/ : /^PASS$/,
      );
    }
    await pool.query(
      "UPDATE chain_day_pool_tx_next SET txs = txs + 1 WHERE day = (SELECT min(day) FROM chain_day_pool_tx_next)",
    );
    const wrong = await checkRollups(pool);
    expect(wrong.find((r) => r.table === "chain_day_pool_tx_next")?.verdict).toBe("FAIL");
    await fill();
    await refreshViews();
    const healed = await checkRollups(pool);
    expect(healed.every((r) => r.verdict === "PASS")).toBe(true);
  });

  it("refuses to swap while a reader could not read the tables, or a backlog waits", async () => {
    await pool.query("DROP ROLE IF EXISTS rollup_test_reader");
    await pool.query("CREATE ROLE rollup_test_reader");
    try {
      await pool.query("GRANT SELECT ON chain_day_rollup TO rollup_test_reader");
      await expect(swapRollups(pool)).rejects.toThrow(
        /rollup_test_reader can read chain_day_rollup but not its successor/,
      );
      await pool.query("GRANT SELECT ON chain_day_rollup_next TO rollup_test_reader");
      // A repair-sized backlog is the follower's passes to drain, not the swap's.
      await pool.query(
        `INSERT INTO chain_rollup_dirty (ts_lo, ts_hi) VALUES ($1::bigint, $1::bigint + 20 * 86400)`,
        [at("2026-03-01T00:00:00")],
      );
      await expect(swapRollups(pool)).rejects.toThrow(/marked days wait/);
      await store.refreshRollups();
    } finally {
      await pool.query(
        "REVOKE ALL ON chain_day_rollup, chain_day_rollup_next FROM rollup_test_reader",
      );
      await pool.query("DROP ROLE rollup_test_reader");
    }
  });

  it("swaps the tables into the views' names and rebinds what read them", async () => {
    const before = await pool.query("SELECT * FROM od.flow ORDER BY ts");
    await ingestDays("2026-04-05T00:00:00", 3, 5_000);
    await swapRollups(pool);
    const k = await kinds();
    for (const name of ROLLUP_VIEW_NAMES) {
      expect(k.get(name), name).toBe("r");
      expect(k.get(`${name}_old`), name).toBe("m");
      expect(k.get(`${name}_next`), name).toBeNull();
    }
    // The swap caught the tables up to the blocks ingested just before it.
    expect(await pendingMarks(pool)).toBe(0);
    const { rows } = await pool.query<{ ref: string }>(
      `SELECT DISTINCT d.refobjid::regclass::text AS ref
         FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
        WHERE w.ev_class = 'od.flow'::regclass AND d.refobjid <> 'od.flow'::regclass`,
    );
    expect(rows.map((r) => r.ref)).toEqual(["chain_day_shielding_flow"]);
    const after = await pool.query("SELECT * FROM od.flow ORDER BY ts");
    expect(after.rows.length).toBeGreaterThanOrEqual(before.rows.length);
    // The primary key moved with the table.
    const pk = await pool.query("SELECT 1 FROM pg_class WHERE relname = 'chain_day_rollup_pkey'");
    expect(pk.rows.length).toBe(1);
  });

  it("goes on after the swap: views frozen, refreshes no-ops, schema re-applies, check holds", async () => {
    await applyChainSchema(pool);
    const k = await kinds();
    expect(k.get("chain_day_rollup_next")).toBeNull();
    await refreshViews();
    await ingestDays("2026-04-05T12:00:00", 6, 4_000);
    await store.refreshRollups();
    const results = await checkRollups(pool);
    for (const r of results) {
      expect(r.table).toBe(r.view.replace(/_old$/, ""));
      expect(r.verdict).toMatch(/PASS|UNVERIFIED/);
    }
    const live = await checkRollups(pool, { live: true });
    expect(live.every((r) => r.verdict === "PASS")).toBe(true);
  });

  it("refuses to swap twice, and reverts to the views", async () => {
    await expect(swapRollups(pool)).rejects.toThrow(/refusing to swap/);
    await swapRollups(pool, { revert: true });
    const k = await kinds();
    for (const name of ROLLUP_VIEW_NAMES) {
      expect(k.get(name), name).toBe("m");
      expect(k.get(`${name}_next`), name).toBe("r");
      expect(k.get(`${name}_old`), name).toBeNull();
    }
    await applyChainSchema(pool);
    await refreshViews();
    await store.refreshRollups();
    await expectRollupsEqual(
      pool,
      (n) => `${n}_next`,
      (n) => n,
      "after the revert",
    );
    const { rows } = await pool.query<{ ref: string }>(
      `SELECT DISTINCT d.refobjid::regclass::text AS ref
         FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
        WHERE w.ev_class = 'od.flow'::regclass AND d.refobjid <> 'od.flow'::regclass`,
    );
    expect(rows.map((r) => r.ref)).toEqual(["chain_day_shielding_flow"]);
  });
});

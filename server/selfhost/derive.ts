import type { Pool } from "pg";
import { DAY_SECONDS } from "@/domain/time";
import { computeMiningDay } from "../mining-daily";
import { epochDay } from "../opendata/parquet";
import { chainDayExtent } from "../pool-usage";
import { PostgresChainStore } from "../postgres-chain-store";
import { ADDRESS_RETENTION_DAYS, computeTransparentDay, monthOf } from "../transparent-daily";
import {
  dropValueStaging,
  foldValueExtremes,
  stageValueExtremes,
  ValueBackfillRefused,
} from "../value-extremes";
import { once } from "./state";

/**
 * Every table the follower and the API derive from blocks, transactions and the ledger, rebuilt by
 * the functions that keep them in production, never by a second derivation. The paced jobs'
 * pacers watch a follower's lag behind a node; here nothing ingests, so they run unpaced.
 *
 * The day-grained tables stop at the release's final day (three days before block N's day), like
 * the published daily tables: the trackers recompute only their newest three days, so a day
 * written short here would never be completed. The API starts those trackers only with
 * `NODE_RPC_URL` set (pool usage needs the node's note-tree sizes), and they carry on from there.
 */

export interface DeriveOptions {
  pool: Pool;
  height: number;
  /** The release's last final day, `YYYY-MM-DD`. */
  finalDay: string;
  /** Whether miner addresses were imported: without them every mining day would be wrong. */
  coinbase: boolean;
  nowSec: number;
  log: (line: string) => void;
}

export async function deriveTables(o: DeriveOptions): Promise<void> {
  const { pool, log } = o;
  // No rich-list maintenance and no sync-state writes: this store only runs the bootstrap.
  const store = new PostgresChainStore(pool, { maintainRichList: false, trackSyncState: false });

  await once(pool, "rich-list", log, async () => {
    // Balances, received totals, first/last heights and transaction counts in one aggregate;
    // `repair-tx-count` exists for rows made before `tx_count` did, and has none here.
    await store.bootstrapRichList();
    const { rows } = await pool.query<{ computed_height: number; io_top: number | null }>(
      `SELECT m.computed_height,
              (SELECT max(block_height) FROM tx_transparent_io) AS io_top
         FROM chain_rich_list_meta m`,
    );
    const r = rows[0];
    if (!r) throw new Error("the rich-list bootstrap wrote no watermark");
    // The bootstrap dates the balances by the highest ledger row. Every block from there to N has
    // no transparent row, so the balances are exactly those at N, and the follower must resume its
    // per-block deltas at N + 1.
    if (r.computed_height !== o.height) {
      if (r.io_top !== null && r.io_top > o.height) {
        throw new Error(`ledger rows above the release height ${o.height}`);
      }
      await pool.query("UPDATE chain_rich_list_meta SET computed_height = $1", [o.height]);
    }
  });

  await once(pool, "value-extremes", log, async () => {
    // Through N itself: the release is already final (cut 100 blocks below the tip it was read
    // at), so the follower's usual reorg margin would only leave its last 100 blocks uncovered.
    const stage = () => stageValueExtremes({ pool, log, reorgMargin: 0 });
    // Its scratch tables are UNLOGGED: a Postgres crash mid-walk empties them, and the walk then
    // refuses to resume. This step is not marked until the fold, so it starts the walk over.
    const staged = await stage().catch(async (e: unknown) => {
      if (!(e instanceof ValueBackfillRefused)) throw e;
      log(`value-extremes: ${e.message} — starting the walk over`);
      await dropValueStaging(pool);
      return stage();
    });
    if (!staged.complete) throw new Error("the value-extremes walk stopped short; run again");
    await foldValueExtremes(pool);
    await dropValueStaging(pool);
  });

  await once(pool, "rollups", log, async () => {
    // The import copied rows without the follower's ingest, so no period was marked: rebuild every
    // rollup from scratch, unpaced, since nothing reads the database yet. The follower's pass
    // keeps them current from there.
    const started = Date.now();
    if ((await store.rebuildRollups(log)) === null)
      throw new Error("the rollup tables are missing");
    log(`  rollups in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  });

  await once(pool, "materialized-views", log, async () => {
    // Whatever materialized views remain: none on a database this release created (the rollups
    // above are tables). Plain REFRESH: nothing reads the database yet.
    const { rows } = await pool.query<{ name: string }>(
      "SELECT matviewname AS name FROM pg_matviews WHERE schemaname = current_schema() ORDER BY 1",
    );
    const client = await pool.connect();
    try {
      await client.query("SET work_mem = '256MB'");
      for (const { name } of rows) {
        const started = Date.now();
        await client.query(`REFRESH MATERIALIZED VIEW "${name.replace(/"/g, '""')}"`);
        log(`  ${name} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
      }
    } finally {
      await client.query("RESET work_mem").catch(() => undefined);
      client.release();
    }
  });

  const final = epochDay(o.finalDay) * DAY_SECONDS;
  await once(pool, "transparent-days", log, async () => {
    // The published days carry no address rows, which a month's distinct count and the trailing
    // windows are counted from: without them the final day's month would never be counted. Its
    // days, and the retention window the trackers keep, are recomputed by the tracker's function,
    // which gives back the published row unless the release read a stale day (its inputs resolved
    // after the day's last recompute). The recomputed row is the same function on the same rows,
    // so it stands, and the day is named loudly; throwing would make every re-run throw again.
    // A day the release lacks stays the tracker's to fill.
    const from = Math.min(monthOf(final), final - (ADDRESS_RETENTION_DAYS - 1) * DAY_SECONDS);
    const published = (day: number) =>
      pool
        .query<{ row: string }>(
          `SELECT (to_jsonb(t) - 'computed_at')::text AS row FROM transparent_daily t
            WHERE day = (to_timestamp($1) AT TIME ZONE 'UTC')::date`,
          [day],
        )
        .then((r) => r.rows[0]?.row ?? null);
    for (let d = from; d <= final; d += DAY_SECONDS) {
      const before = await published(d);
      if (before === null) continue;
      await computeTransparentDay(pool, d, o.nowSec);
      if ((await published(d)) !== before) {
        const day = new Date(d * 1000).toISOString().slice(0, 10);
        log(
          `  NOTE transparent_daily on ${day} differs from the release; the recomputed row stands`,
        );
      }
    }
  });

  if (!o.coinbase) {
    log("mining days: SKIPPED — no block names its miner's address in this release");
    return;
  }
  await once(pool, "mining-days", log, async () => {
    const extent = await chainDayExtent(pool, o.nowSec);
    if (extent === null) return;
    for (let d = extent.first; d <= final; d += DAY_SECONDS) {
      await computeMiningDay(pool, d, o.nowSec);
    }
  });
}

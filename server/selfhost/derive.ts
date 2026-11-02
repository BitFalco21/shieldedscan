import type { Pool } from "pg";
import { DAY_SECONDS } from "@/domain/time";
import { computeMiningDay } from "../mining-daily";
import { chainDayExtent } from "../pool-usage";
import { PostgresChainStore } from "../postgres-chain-store";
import { dropValueStaging, foldValueExtremes, stageValueExtremes } from "../value-extremes";
import { once } from "./state";

/**
 * Every table the follower and the API derive from blocks, transactions and the ledger, rebuilt by
 * the functions that keep them in production, never by a second derivation. The paced jobs'
 * pacers watch a follower's lag behind a node; here nothing ingests, so they run unpaced.
 *
 * Not rebuilt here, because they need a node (`startChainTrackers`, run by the API when
 * `NODE_RPC_URL` is set): pool usage after the release's final day (the anonymity set is read from
 * the node), `address_tx_count`, the transparent address rows behind trailing windows. The days
 * the release publishes for those trackers were loaded from it.
 */

export interface DeriveOptions {
  pool: Pool;
  height: number;
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
    // Balances, received totals, first/last heights and transaction counts in one aggregate, then
    // the ranks; `repair-tx-count` exists for rows made before `tx_count` did, and has none here.
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
    const staged = await stageValueExtremes({ pool, log, reorgMargin: 0 });
    if (!staged.complete) throw new Error("the value-extremes walk stopped short; run again");
    await foldValueExtremes(pool);
    await dropValueStaging(pool);
  });

  await once(pool, "materialized-views", log, async () => {
    // Plain REFRESH, not CONCURRENTLY: nothing reads the database yet, and a first fill cannot be
    // concurrent anyway. Every view, the WITH NO DATA ones (fee extremes, pool analytics) too.
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

  if (!o.coinbase) {
    log(
      "mining days: SKIPPED — this release has no blocks_coinbase/, so no block names its miner's " +
        "address, and every day would file its blocks under no address",
    );
    return;
  }
  await once(pool, "mining-days", log, async () => {
    const extent = await chainDayExtent(pool, o.nowSec);
    if (extent === null) return;
    for (let d = extent.first; d <= extent.last; d += DAY_SECONDS) {
      await computeMiningDay(pool, d, o.nowSec);
    }
  });
}

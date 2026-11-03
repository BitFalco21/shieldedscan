import type { Client } from "pg";
import { POOL_COLUMNS } from "./tables";

/**
 * Reads the site's views for the precomputed series: the ones published as they are, and the
 * ones read only to check the export's own stream. Each read runs in its own savepoint, so a view
 * that is missing, or a matview never populated (`WITH NO DATA`), becomes a release failure with
 * its name instead of aborting the transaction and the run.
 */

type Row = Record<string, unknown>;

const POOLS = POOL_COLUMNS.join(", ");

/** Every view, its whole content, in a fixed order. Each is a few thousand rows at most. */
export const SITE_VIEW_SQL = {
  check_day_rollup:
    "SELECT day, ts, top_height, transparent, mixed, shielded FROM opendata.check_day_rollup ORDER BY day",
  check_day_supply_close: `SELECT day, top_height, hash, ${POOLS} FROM opendata.check_day_supply_close ORDER BY day`,
  check_day_network:
    "SELECT day, ts, blocks, avg_difficulty, avg_block_bytes FROM opendata.check_day_network ORDER BY day",
  check_day_fee_total:
    "SELECT day, ts, fee_zat, blocks, blocks_covered FROM opendata.check_day_fee_total ORDER BY day",
  check_day_pool_tx: `SELECT day, pool, txs, value_in_zat, value_out_zat FROM opendata.check_day_pool_tx
    ORDER BY day, pool COLLATE "C"`,
  check_mining_day:
    "SELECT day, blocks, unrecorded_blocks FROM opendata.check_mining_day ORDER BY day",
  shielding_daily: `SELECT day, shielding_txs, unshielding_txs, indeterminate_txs, migration_txs
    FROM opendata.shielding_daily ORDER BY day`,
  pool_boundary_daily: `SELECT day, pool, shielded_zat, shielded_txs, unshielded_zat, unshielded_txs,
    coinbase_zat, coinbase_txs, hub_zat, hub_txs FROM opendata.pool_boundary_daily
    ORDER BY day, pool COLLATE "C"`,
  shielding_flow_daily:
    "SELECT day, ts, shielded_zat, unshielded_zat FROM opendata.shielding_flow_daily ORDER BY day",
  pool_migration_daily: `SELECT day, destination, source, txs, zat FROM opendata.pool_migration_daily
    ORDER BY day, destination COLLATE "C", source COLLATE "C"`,
  fees_monthly: `SELECT month, ts, kind, txs, p25_zat, median_zat, p75_zat FROM opendata.fees_monthly
    ORDER BY month, kind COLLATE "C"`,
  shielding_records_daily: `SELECT day, max_shielding_zat, max_shielding_ties, max_shielding_txid,
    max_unshielding_zat, max_unshielding_ties, max_unshielding_txid,
    max_migration_zat, max_migration_ties, max_migration_txid
    FROM opendata.shielding_records_daily ORDER BY day`,
  mining_payouts_daily: `SELECT day, kind, address, blocks, reward_zat, fee_zat, fee_blocks
    FROM opendata.mining_payouts_daily ORDER BY day, kind COLLATE "C", address COLLATE "C" NULLS FIRST`,
} as const;

export type SiteView = keyof typeof SITE_VIEW_SQL;

/** A view's rows, or `null` when it could not be read (the reason is in `failures`). */
export type SiteViews = Record<SiteView, Row[] | null>;

/** SQLSTATEs that mean "not there yet", not "the database is broken". */
const NOT_READY: Record<string, string> = {
  "55000": "never populated (a WITH NO DATA matview not yet refreshed)",
  "42P01": "missing (apply server/schema-opendata.sql)",
};

/** Reads every view inside the caller's open transaction. */
export async function readSiteViews(
  client: Pick<Client, "query">,
): Promise<{ views: SiteViews; failures: string[] }> {
  const views = {} as SiteViews;
  const failures: string[] = [];
  for (const [name, sql] of Object.entries(SITE_VIEW_SQL) as [SiteView, string][]) {
    await client.query("SAVEPOINT site_view");
    try {
      const { rows } = await client.query<Row>(sql);
      views[name] = rows;
      await client.query("RELEASE SAVEPOINT site_view");
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      const reason = typeof code === "string" ? NOT_READY[code] : undefined;
      if (reason === undefined) throw e;
      await client.query("ROLLBACK TO SAVEPOINT site_view");
      views[name] = null;
      failures.push(`site view opendata.${name}: ${reason}`);
    }
  }
  return { views, failures };
}

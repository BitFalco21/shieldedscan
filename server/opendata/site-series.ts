import { Findings, scanStrings } from "./checks";
import { checkFresh, checkUtcMidnights, compareRows, daysOf, upTo } from "./site-checks";
import { boundaryTables } from "./site-boundary-tables";
import { miningPayouts } from "./site-mining";
import { addressBalances } from "./site-balances";
import type { SiteStream } from "./site-stream";
import type { SiteViews } from "./site-views";
import { POOL_COLUMNS, SMALL_TABLES, type SiteTable } from "./tables";

/**
 * The site's precomputed series as published tables, each with its cross-check. Block- and
 * transaction-derived numbers come from the export's own stream and the site's matviews only check
 * them; the others come from the site's views and the stream checks those. Any disagreement, and
 * any view that does not reach past the final day, fails the release.
 */

type Row = Record<string, unknown>;

export interface SiteInputs {
  finalDay: string;
  stream: SiteStream;
  /** The export's own daily series, already final-day cut. */
  blocksDaily: readonly Row[];
  poolFlows: readonly Row[];
  supply: readonly Row[];
}

export interface SiteSeries {
  tables: [SiteTable, Row[]][];
  failures: string[];
}

/** Columns published without the address scan, because each is validated by its own format. */
const FORMATTED: Partial<Record<SiteTable, readonly string[]>> = {
  pools_daily: ["hash"],
  shielding_records_daily: ["max_shielding_txid", "max_unshielding_txid", "max_migration_txid"],
  mining_payouts_daily: ["address"],
  address_balance_daily: ["address"],
};

/** The stream's tables, held to `chain_day_rollup`, `chain_day_supply_close` and the supply audit. */
function streamTables(f: Findings, v: SiteViews, x: SiteInputs): [SiteTable, Row[]][] {
  const kinds = x.stream.txKindRows(x.finalDay);
  const pools = x.stream.poolRows(x.finalDay);
  const topHeight = new Map(pools.map((p) => [p.day, p.top_height]));

  if (v.check_day_rollup) {
    checkFresh(f, "chain_day_rollup", daysOf(v.check_day_rollup), x.finalDay);
    checkUtcMidnights(
      f,
      "chain_day_rollup",
      v.check_day_rollup.map((r) => r.ts),
    );
    compareRows(
      f,
      {
        name: "tx_kinds_daily",
        against: "chain_day_rollup",
        key: ["day"],
        columns: ["top_height", "transparent", "mixed", "shielded"],
      },
      kinds.map((k) => ({
        day: k.day,
        top_height: topHeight.get(k.day),
        transparent: k.transparent_txs,
        mixed: k.mixed_txs,
        shielded: k.shielded_txs,
      })),
      upTo(v.check_day_rollup, x.finalDay),
    );
  }

  if (v.check_day_supply_close) {
    checkFresh(f, "chain_day_supply_close", daysOf(v.check_day_supply_close), x.finalDay);
    compareRows(
      f,
      {
        name: "pools_daily",
        against: "chain_day_supply_close",
        key: ["day"],
        columns: ["top_height", "hash", ...POOL_COLUMNS],
      },
      pools,
      upTo(v.check_day_supply_close, x.finalDay),
    );

    // The supply audit against the site's own closes, not the stream's (which it is computed
    // from): what exists at a day's last block is its pools plus the NSM. A missing close is
    // already a failure above.
    const closes = new Map(v.check_day_supply_close.map((p) => [String(p.day), p]));
    for (const s of x.supply) {
      const p = closes.get(String(s.day));
      if (s.issued_zat === null || s.nsm_total_zat === null || p === undefined) continue;
      const held = POOL_COLUMNS.reduce((sum, col) => sum + ((p[col] as bigint | null) ?? 0n), 0n);
      if (held + (s.nsm_total_zat as bigint) !== s.issued_zat) {
        f.add("chain_day_supply_close + NSM differs from supply_daily.issued_zat", String(s.day));
      }
    }
  }
  return [
    ["tx_kinds_daily", kinds],
    ["pools_daily", pools],
  ];
}

/** `blocks_daily` and `pool_flows_daily` (published in part 1) held to the site's own matviews. */
function checkPartOne(f: Findings, v: SiteViews, x: SiteInputs): void {
  if (v.check_day_network) {
    checkFresh(f, "chain_day_network", daysOf(v.check_day_network), x.finalDay);
    checkUtcMidnights(
      f,
      "chain_day_network",
      v.check_day_network.map((r) => r.ts),
    );
    compareRows(
      f,
      {
        name: "blocks_daily",
        against: "chain_day_network",
        key: ["day"],
        columns: ["blocks", "avg_size_bytes", "avg_difficulty"],
        floats: ["avg_size_bytes", "avg_difficulty"],
      },
      x.blocksDaily,
      upTo(v.check_day_network, x.finalDay).map((r) => ({
        day: r.day,
        blocks: r.blocks,
        avg_size_bytes: r.avg_block_bytes,
        avg_difficulty: r.avg_difficulty,
      })),
    );
  }
  if (v.check_day_fee_total) {
    checkFresh(f, "chain_day_fee_total", daysOf(v.check_day_fee_total), x.finalDay);
    checkUtcMidnights(
      f,
      "chain_day_fee_total",
      v.check_day_fee_total.map((r) => r.ts),
    );
    compareRows(
      f,
      {
        name: "blocks_daily",
        against: "chain_day_fee_total",
        key: ["day"],
        columns: ["blocks", "fees_zat", "blocks_with_fees"],
      },
      x.blocksDaily,
      upTo(v.check_day_fee_total, x.finalDay).map((r) => ({
        day: r.day,
        blocks: r.blocks,
        fees_zat: r.fee_zat,
        blocks_with_fees: r.blocks_covered,
      })),
    );
  }
  if (v.check_day_pool_tx) {
    checkFresh(f, "chain_day_pool_tx", daysOf(v.check_day_pool_tx), x.finalDay);
    compareRows(
      f,
      {
        name: "pool_flows_daily",
        against: "chain_day_pool_tx",
        key: ["day", "pool"],
        columns: ["txs", "inflow_zat", "outflow_zat"],
      },
      x.poolFlows,
      upTo(v.check_day_pool_tx, x.finalDay).map((r) => ({
        day: r.day,
        pool: r.pool,
        txs: r.txs,
        inflow_zat: r.value_in_zat,
        outflow_zat: r.value_out_zat,
      })),
    );
  }
}

export function siteSeries(views: SiteViews, inputs: SiteInputs): SiteSeries {
  const f = new Findings();
  checkPartOne(f, views, inputs);
  const tables: [SiteTable, Row[]][] = [
    ...streamTables(f, views, inputs),
    ...boundaryTables(f, views, inputs),
    ["mining_payouts_daily", miningPayouts(f, views, inputs)],
    ["address_balance_daily", addressBalances(f, views, inputs)],
  ];
  const failures = f.list();
  for (const [name, rows] of tables) {
    for (const c of SMALL_TABLES[name]) {
      if (c.type !== "utf8" || FORMATTED[name]?.includes(c.name)) continue;
      failures.push(
        ...scanStrings(
          name,
          c.name,
          rows.map((r) => (r[c.name] ?? null) as string | null),
        ),
      );
    }
  }
  return { tables, failures };
}

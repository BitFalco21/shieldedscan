import { Hono } from "hono";
import { Pool } from "pg";
import type {
  ActivityPoint,
  ChainMonthPoint,
  PoolName,
  PoolMigrationDayPoint,
  PoolUsageDayPoint,
  ShieldedSupplyPoint,
  Fees24h,
  IronwoodInflow,
  IronwoodMigrationBucket,
  IronwoodMigrations,
  IronwoodMigrationTotals,
  PoolMigrationPair,
  PoolMigrationWindow,
  ShieldingFlowPoint,
  FeeDistribution,
  FeeExtremes,
  ValueExtremes,
  FeeKindMonthPoint,
  FeeKindStats,
  NetworkDayPoint,
  FeeTotalPoint,
  FeeTotalSeries,
} from "@/domain";
import {
  parseChainWindowGroupBy,
  parseMigrationDestination,
  parseMigrationSource,
  parseMinUsdFilter,
  parseMinZecFilter,
  parseUtcDayStart,
} from "@/domain";
import { formatUsdExact, formatZatUsdApprox } from "@/lib/format";
import { formatZatMoneyApprox } from "@/lib/money";
import { REORG_DEPTH } from "./follow";
import { loadChainWindow } from "./chain-window";
import { POOL_NAMES } from "@/domain/pool";
import { createPool } from "./pg-pool";
import { DAY_SECONDS } from "@/domain/time";
import "./pg-types";
import { Cached } from "./cached";

/**
 * The analytics series, from the rollup `block` table and the daily/monthly matviews.
 *
 * Plain queries with a short in-process cache. The monthly series is a materialized view (in
 * `schema-chain.sql`, refreshed by the follower), because deriving it means two sequential scans
 * of `block` per read.
 *
 * `medianFeeZat` is null on every point; `/chain/analytics/fees24h` below is the fee figure this
 * module serves.
 */

/**
 * NU6.3 activation height, per network: it activated at different heights on mainnet and
 * testnet, and using the mainnet value on testnet would both misstate the activation block and
 * scan hundreds of thousands of irrelevant blocks.
 *
 * Read from each node's `getblockchaininfo.upgrades` and pinned rather than fetched: an activation
 * height is immutable once active, so a constant cannot rot, while a boot-time RPC would add a
 * failure mode needing a fallback anyway.
 *
 * The node reports no ironwood balance at the activation block itself, so the balance query
 * filters `ironwood_pool_zat IS NOT NULL` rather than assuming the pool starts at 0.
 *
 * Do not derive it from the data: `min(height) WHERE ironwood_pool_zat IS NOT NULL` is off by one
 * on mainnet and by hundreds of blocks on testnet.
 */
export const IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK = {
  mainnet: 3_428_143,
  testnet: 4_134_000,
} as const;

export type AnalyticsNetwork = keyof typeof IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK;

/**
 * The sum of the four shielded pools' columns in `chain_day_rollup`, for the activity series' net
 * flow and the supply series. Generated from the domain's `POOL_NAMES`, so a pool added there is
 * summed everywhere at once: a query missing a pool would read every migration into it as value
 * leaving the shielded pools. The rollup's columns are already COALESCEd to zero.
 */
export const SHIELDED_POOL_SUM_SQL = `(${[...POOL_NAMES].reverse().join(" + ")})`;

interface ActivityRow {
  ts: number;
  transparent: number;
  mixed: number;
  shielded: number;
  flow: number;
}

interface SupplyRow {
  ts: number;
  height: number;
  total: number;
}

export function toActivityPoint(row: ActivityRow): ActivityPoint {
  return {
    timestamp: row.ts,
    transparentTxs: row.transparent,
    mixedTxs: row.mixed,
    shieldedTxs: row.shielded,
    medianFeeZat: null,
    netPoolFlowZat: row.flow,
  };
}

export function toSupplyPoint(row: SupplyRow): ShieldedSupplyPoint {
  return { timestamp: row.ts, height: row.height, totalZat: row.total };
}

/** One pivoted (day × four pools) row — shared by both per-pool chart series. */
interface PoolPivotRow {
  ts: number;
  sprout: number;
  sapling: number;
  orchard: number;
  ironwood: number;
}

export function toPoolUsagePoint(row: PoolPivotRow): PoolUsageDayPoint {
  return {
    timestamp: row.ts,
    sproutTxs: row.sprout,
    saplingTxs: row.sapling,
    orchardTxs: row.orchard,
    ironwoodTxs: row.ironwood,
  };
}

export function toPoolMigrationPoint(row: PoolPivotRow): PoolMigrationDayPoint {
  return {
    timestamp: row.ts,
    toSproutZat: row.sprout,
    toSaplingZat: row.sapling,
    toOrchardZat: row.orchard,
    toIronwoodZat: row.ironwood,
  };
}

/**
 * The two per-pool chart series, pivoted (day × pool) into one row per day.
 *
 * Both matviews store rows only for (day, pool) pairs with activity, and both charts' x-axes are
 * positional (a missing day would compress time), so each query LEFT-joins a `generate_series` day
 * spine from its first to its last stored day and zero-fills quiet days. A zero is a measurement
 * (the view covers all of `tx`); an empty table yields an empty series, since `generate_series`
 * over NULL bounds emits nothing.
 *
 * Plain reads: the matview is the classification (`pool-matview-agreement.test.ts` holds it to the
 * live query). Exported so the real-database test runs these strings.
 */
export const POOL_USAGE_SERIES_SQL = `WITH spine AS (
    SELECT generate_series(MIN(day), MAX(day), interval '1 day')::date AS day
      FROM chain_day_pool_tx
  )
  SELECT EXTRACT(EPOCH FROM s.day)::bigint AS ts,
         COALESCE(SUM(p.txs) FILTER (WHERE p.pool = 'sprout'), 0)::bigint   AS sprout,
         COALESCE(SUM(p.txs) FILTER (WHERE p.pool = 'sapling'), 0)::bigint  AS sapling,
         COALESCE(SUM(p.txs) FILTER (WHERE p.pool = 'orchard'), 0)::bigint  AS orchard,
         COALESCE(SUM(p.txs) FILTER (WHERE p.pool = 'ironwood'), 0)::bigint AS ironwood
    FROM spine s
    LEFT JOIN chain_day_pool_tx p ON p.day = s.day
   GROUP BY s.day
   ORDER BY s.day`;

export const POOL_MIGRATION_SERIES_SQL = `WITH spine AS (
    SELECT generate_series(MIN(day), MAX(day), interval '1 day')::date AS day
      FROM chain_day_pool_migration
  )
  SELECT EXTRACT(EPOCH FROM s.day)::bigint AS ts,
         COALESCE(SUM(m.zat) FILTER (WHERE m.destination = 'sprout'), 0)::bigint   AS sprout,
         COALESCE(SUM(m.zat) FILTER (WHERE m.destination = 'sapling'), 0)::bigint  AS sapling,
         COALESCE(SUM(m.zat) FILTER (WHERE m.destination = 'orchard'), 0)::bigint  AS orchard,
         COALESCE(SUM(m.zat) FILTER (WHERE m.destination = 'ironwood'), 0)::bigint AS ironwood
    FROM spine s
    LEFT JOIN chain_day_pool_migration m ON m.day = s.day
   GROUP BY s.day
   ORDER BY s.day`;

/** Priced aggregates shared by both migration queries. Strings, from pg's bigint parser. */
interface PricedAggregates {
  txs: string | number;
  zat: string | number;
  /** How many of `txs` fell on a day with a stored close. */
  priced_txs: string | number;
  /** How much of `zat` those transactions carried. */
  priced_zat: string | number;
  /** SUM(amount_zat × that day's close) over the priced transactions — divide by 1e8 for $. */
  priced_usd: string | number;
}

/** One source bucket of the since-activation into-Ironwood query. */
export interface IronwoodMigrationRow extends PricedAggregates {
  source: string;
}

/** One (destination × source × smallest age bracket) cell of the matrix query. */
export interface PoolMigrationMatrixRow extends PricedAggregates {
  dest: string;
  source: string;
  bracket: string;
}

const MATRIX_BRACKETS = ["h24", "d7", "d30"] as const;

/**
 * The pricing join both migration queries share: each transaction at its own day's stored close.
 * LEFT, never inner: a day without a close (today, since closes exist only for ended days) must not
 * drop the transaction from the counts. The priced_* columns carry how much of each cell could be
 * valued, and the assembly prices the remainder at the live tracked price, naming both bases.
 */
const PRICED_COLUMNS = `COUNT(*)                                                         AS txs,
        SUM(amt)::bigint                                                 AS zat,
        COUNT(p.usd)                                                     AS priced_txs,
        COALESCE(SUM(amt) FILTER (WHERE p.usd IS NOT NULL), 0)::bigint   AS priced_zat,
        COALESCE(SUM(amt * p.usd) FILTER (WHERE p.usd IS NOT NULL), 0)   AS priced_usd`;

const PRICE_JOIN = `LEFT JOIN zec_price_daily p
     ON p.day = (to_timestamp(m.ts) AT TIME ZONE 'UTC')::date`;

/**
 * Pool migrations into Ironwood since activation, one row per source bucket: `poolMigration`'s
 * definition (src/domain/pool.ts) in SQL. No transparent side (`kind = 'shielded'`), Ironwood the
 * one pool gaining, at least one pool losing. The zero checks on the other pools enforce "exactly
 * one destination"; a second gaining pool is the shape the domain refuses to apportion.
 *
 * Signs: stored bundle balances are domain sign (positive = entering that pool), so a source pool
 * is `< 0`; `sprout_vpub_net_zat` is RPC sign (positive = leaving Sprout), so its source test is
 * `> 0`. Sprout is included even while it is zero.
 *
 * Exported so the real-database test runs this string. Parameter: $1 activation height.
 *
 * The MATERIALIZED fence keeps `kind = 'shielded'` away from the planner while it plans the read of
 * `tx`. Unfenced, the planner ANDs `tx_block_idx` with `tx_kind_keyset_idx` and reads the whole
 * 'shielded' part of a large, rarely cached index; that read is slow on a cold cache, and this
 * route's cache refresh is always cold. Behind the fence the scan is the activation-height range on
 * `tx_block_idx` alone, with identical rows. A text test pins the fence.
 */
export const IRONWOOD_MIGRATIONS_SQL = `WITH r AS MATERIALIZED (
   SELECT timestamp, kind, ironwood_value_balance_zat, orchard_value_balance_zat,
          sapling_value_balance_zat, sprout_vpub_net_zat
     FROM tx
    WHERE block_height >= $1
      AND COALESCE(ironwood_value_balance_zat, 0) > 0
 ),
 m AS (
   SELECT timestamp AS ts,
          ironwood_value_balance_zat                   AS amt,
          (COALESCE(orchard_value_balance_zat, 0) < 0) AS from_orchard,
          (COALESCE(sapling_value_balance_zat, 0) < 0) AS from_sapling,
          (COALESCE(sprout_vpub_net_zat, 0) > 0)       AS from_sprout
     FROM r
    WHERE kind = 'shielded'
      AND COALESCE(orchard_value_balance_zat, 0) <= 0
      AND COALESCE(sapling_value_balance_zat, 0) <= 0
      AND COALESCE(sprout_vpub_net_zat, 0) >= 0
      AND (COALESCE(orchard_value_balance_zat, 0) < 0
        OR COALESCE(sapling_value_balance_zat, 0) < 0
        OR COALESCE(sprout_vpub_net_zat, 0) > 0)
 )
 SELECT CASE WHEN (from_orchard::int + from_sapling::int + from_sprout::int) > 1 THEN 'multi'
             WHEN from_orchard THEN 'orchard'
             WHEN from_sapling THEN 'sapling'
             ELSE 'sprout' END AS source,
        ${PRICED_COLUMNS}
   FROM m ${PRICE_JOIN}
  GROUP BY 1`;

/**
 * The full directed migration matrix over the trailing 30 days, for every destination pool. Same
 * definition generalised: `kind = 'shielded'`, exactly one pool entering (the destination, whose
 * own published balance is the amount), at least one leaving. `sprout_vpub_net_zat` is negated into
 * domain sign up front so all four pools read alike.
 *
 * A trailing window is a `timestamp` range served by `tx_keyset_idx`, so 24h/7d/30d are cheap for
 * any pool; only Ironwood's history is bounded by an activation height, so `sinceActivation` above
 * stays Ironwood-only.
 *
 * Each row lands in its smallest age bracket; the assembly accumulates the nested windows.
 * `block_height IS NOT NULL` excludes mempool transactions. Parameters: $1/$2/$3 the 24h/7d/30d
 * cutoffs in unix seconds.
 */
export const POOL_MIGRATION_MATRIX_SQL = `WITH m AS (
   SELECT timestamp AS ts,
          COALESCE(ironwood_value_balance_zat, 0) AS iw,
          COALESCE(orchard_value_balance_zat, 0)  AS oc,
          COALESCE(sapling_value_balance_zat, 0)  AS sa,
          -COALESCE(sprout_vpub_net_zat, 0)       AS sr
     FROM tx
    WHERE timestamp >= $3
      AND block_height IS NOT NULL
      AND kind = 'shielded'
 ),
 mm AS (
   SELECT ts,
          CASE WHEN iw > 0 THEN 'ironwood'
               WHEN oc > 0 THEN 'orchard'
               WHEN sa > 0 THEN 'sapling'
               ELSE 'sprout' END AS dest,
          CASE WHEN iw > 0 THEN iw
               WHEN oc > 0 THEN oc
               WHEN sa > 0 THEN sa
               ELSE sr END AS amt,
          ((iw < 0)::int + (oc < 0)::int + (sa < 0)::int + (sr < 0)::int) AS nsrc,
          CASE WHEN iw < 0 THEN 'ironwood'
               WHEN oc < 0 THEN 'orchard'
               WHEN sa < 0 THEN 'sapling'
               ELSE 'sprout' END AS single_src
     FROM m
    WHERE ((iw > 0)::int + (oc > 0)::int + (sa > 0)::int + (sr > 0)::int) = 1
      AND ((iw < 0)::int + (oc < 0)::int + (sa < 0)::int + (sr < 0)::int) >= 1
 )
 SELECT dest,
        CASE WHEN nsrc > 1 THEN 'multi' ELSE single_src END AS source,
        CASE WHEN ts >= $1 THEN 'h24'
             WHEN ts >= $2 THEN 'd7'
             ELSE 'd30' END AS bracket,
        ${PRICED_COLUMNS}
   FROM mm m ${PRICE_JOIN}
  GROUP BY 1, 2, 3`;

/** Mutable accumulator behind both window shapes. */
interface PricedCell {
  txCount: number;
  amountZat: number;
  pricedTxs: number;
  pricedZat: number;
  /** In zat·usd — divided by 1e8 only when the text is built. */
  pricedUsd: number;
}

const emptyCell = (): PricedCell => ({
  txCount: 0,
  amountZat: 0,
  pricedTxs: 0,
  pricedZat: 0,
  pricedUsd: 0,
});

const addRow = (cell: PricedCell, row: PricedAggregates): void => {
  cell.txCount += Number(row.txs);
  cell.amountZat += Number(row.zat);
  cell.pricedTxs += Number(row.priced_txs);
  cell.pricedZat += Number(row.priced_zat);
  cell.pricedUsd += Number(row.priced_usd);
};

const addCell = (into: PricedCell, cell: PricedCell): void => {
  into.txCount += cell.txCount;
  into.amountZat += cell.amountZat;
  into.pricedTxs += cell.pricedTxs;
  into.pricedZat += cell.pricedZat;
  into.pricedUsd += cell.pricedUsd;
};

/**
 * The finished dollar string for one cell, computed here so a consumer never has to multiply a
 * spot price by a past amount.
 *
 * Each transaction is valued at its own day's stored close; transactions on days without a close
 * yet (today) at the live tracked price. `verbose` names both bases in the string, for the one text
 * per window that travels alone; pair-level texts stay short. With no spot price the unpriced
 * remainder makes the figure a "≥" floor, and a cell nothing in which could be priced is null,
 * never $0.
 */
export function migrationUsdText(
  cell: PricedCell,
  spotUsd: number | null,
  verbose: boolean,
): string | null {
  if (cell.txCount === 0) return null;
  const pricedUsd = cell.pricedUsd / 1e8;
  const unpricedZat = cell.amountZat - cell.pricedZat;
  const unpricedTxs = cell.txCount - cell.pricedTxs;
  if (unpricedTxs === 0) {
    const figure = `≈ ${formatUsdExact(pricedUsd)}`;
    return verbose
      ? `${figure} — each transaction at its own day's stored close, not the moment's price`
      : figure;
  }
  if (spotUsd !== null && Number.isFinite(spotUsd) && spotUsd > 0) {
    const total = pricedUsd + (unpricedZat / 1e8) * spotUsd;
    const figure = `≈ ${formatUsdExact(total)}`;
    return verbose
      ? `${figure} — days with a stored close at that close; the ${unpricedTxs} transaction${
          unpricedTxs === 1 ? "" : "s"
        } on days not yet closed at the current price (${formatUsdExact(spotUsd)}). Not each transfer's moment.`
      : figure;
  }
  if (cell.pricedTxs === 0) return null;
  const figure = `≥ ${formatUsdExact(pricedUsd)}`;
  return verbose
    ? `${figure} at each day's stored close — ${unpricedTxs} of ${cell.txCount} transactions are on days without a stored close and are unpriced`
    : figure;
}

/** One row of `IRONWOOD_INFLOW_SQL`: every term of Ironwood's balance, as Postgres returns it. */
export interface IronwoodInflowRow {
  balance: string;
  orchard: string;
  sapling: string;
  sprout: string;
  transparent: string;
  mined: string;
  fees: string;
  transparent_txs: string;
  tx_count: string;
}

/**
 * Ironwood's balance and the terms that account for it, since activation (`$1` is the
 * activation height). Shared by `/chain/analytics/ironwood` and the public
 * `/v1/analytics/ironwood`, so the two cannot disagree about where the pool's value came from.
 * The reasoning for each term is at the route.
 */
export const IRONWOOD_INFLOW_SQL = `WITH iwtx AS (
     SELECT txid, kind,
            COALESCE(ironwood_value_balance_zat, 0)  AS iw,
            -COALESCE(orchard_value_balance_zat, 0)  AS net_orchard,
            -COALESCE(sapling_value_balance_zat, 0)  AS net_sapling,
            COALESCE(sprout_vpub_net_zat, 0)         AS net_sprout,
            COALESCE(fee_zat, 0)                     AS fee,
            fee_zat IS NULL                          AS fee_unknown,
            -- Transparent in − out, by the balance identity: a transaction's fee is
            -- its transparent net plus every pool's RPC-sign balance, so the net is
            -- the fee plus the DOMAIN-sign balances (sprout is stored in RPC sign,
            -- hence subtracted) — the same expression chain_month_shielding_flow uses.
            COALESCE(fee_zat, 0)
              + COALESCE(sapling_value_balance_zat, 0)
              + COALESCE(orchard_value_balance_zat, 0)
              + COALESCE(ironwood_value_balance_zat, 0)
              - COALESCE(sprout_vpub_net_zat, 0)     AS tnet_identity
       FROM tx
      WHERE block_height >= $1
        AND COALESCE(ironwood_value_balance_zat, 0) <> 0
   ),
   -- The input join survives ONLY for a transaction whose fee is unknown, where the
   -- identity has no fee to start from (rare).
   tnet AS (
     SELECT i.txid,
            COALESCE(SUM(CASE WHEN x.io = 'in' THEN x.value_zat
                              ELSE -x.value_zat END), 0) AS tnet
       FROM iwtx i JOIN tx_transparent_io x ON x.txid = i.txid
      WHERE i.kind <> 'coinbase' AND i.fee_unknown
      GROUP BY i.txid
   )
   SELECT COALESCE(SUM(i.iw), 0)::bigint                          AS balance,
          COALESCE(SUM(i.net_orchard), 0)::bigint                 AS orchard,
          COALESCE(SUM(i.net_sapling), 0)::bigint                 AS sapling,
          COALESCE(SUM(i.net_sprout), 0)::bigint                  AS sprout,
          COALESCE(SUM(CASE WHEN i.kind = 'coinbase' THEN 0
                            WHEN i.fee_unknown THEN COALESCE(t.tnet, 0)
                            ELSE i.tnet_identity END), 0)::bigint AS transparent,
          COALESCE(SUM(i.iw) FILTER (WHERE i.kind = 'coinbase'), 0)::bigint AS mined,
          COALESCE(SUM(i.fee), 0)::bigint                         AS fees,
          COUNT(*) FILTER (
            WHERE i.kind <> 'coinbase' AND i.iw > 0
              AND i.net_orchard <= 0 AND i.net_sapling <= 0 AND i.net_sprout <= 0
          )                                                       AS transparent_txs,
          /*
           * Every transaction carrying an Ironwood BUNDLE, which is a wider population
           * than the iwtx CTE above and deliberately so: that CTE keys on a non-zero
           * value balance because the attribution terms are about value CROSSING the
           * pool boundary, while a fully shielded Ironwood-to-Ironwood transfer moves
           * nothing across it and still used the pool. Counting the CTE would undercount
           * exactly the transactions the pool exists for.
           *
           * Its own scalar subquery rather than a widened CTE: widening the filter would
           * pull zero-balance rows into the tnet join and change the transparent term,
           * which is a published figure. One indexed range scan on tx_block_idx, bounded
           * by the activation height, so it is cheap.
           */
          (SELECT COUNT(*) FROM tx
            WHERE block_height >= $1
              AND COALESCE(ironwood_actions, 0) > 0)               AS tx_count
     FROM iwtx i LEFT JOIN tnet t ON t.txid = i.txid`;

/**
 * Fold both queries' rows into the payload's migration block.
 *
 * The matrix SQL files each migration under its smallest bracket, so no row is counted twice; the
 * windows are nested (24h ⊂ 7d ⊂ 30d), so each window is the running sum of the brackets inside it,
 * and a window's totals are summed from its pairs, so pairs sum to the whole by construction.
 * Exported so this accumulation is testable without a database. An empty row set is a real answer
 * (no migrations in the window); an unreadable table fails the inflow query beside it.
 */
export function assembleIronwoodMigrations(
  sinceRows: readonly IronwoodMigrationRow[],
  matrixRows: readonly PoolMigrationMatrixRow[],
  nowSec: number,
  spotUsd: number | null,
): IronwoodMigrations {
  // Since-activation, into Ironwood, by source bucket.
  const since = new Map<string, PricedCell>();
  for (const row of sinceRows) {
    const cell = since.get(row.source) ?? emptyCell();
    addRow(cell, row);
    since.set(row.source, cell);
  }
  const sinceBucket = (source: string): PricedCell => since.get(source) ?? emptyCell();
  const sinceTotal = emptyCell();
  for (const source of ["orchard", "sapling", "sprout", "multi"]) {
    addCell(sinceTotal, sinceBucket(source));
  }
  // `verbose: false`, like the matrix pairs: the bases are named once on the block's own total.
  const toBucket = (cell: PricedCell): IronwoodMigrationBucket => ({
    txCount: cell.txCount,
    amountZat: cell.amountZat,
    valueUsdText: migrationUsdText(cell, spotUsd, false),
  });
  const sinceActivation: IronwoodMigrationTotals = {
    txCount: sinceTotal.txCount,
    amountZat: sinceTotal.amountZat,
    valueUsdText: migrationUsdText(sinceTotal, spotUsd, true),
    fromOrchard: toBucket(sinceBucket("orchard")),
    fromSapling: toBucket(sinceBucket("sapling")),
    fromSprout: toBucket(sinceBucket("sprout")),
    multiSource: toBucket(sinceBucket("multi")),
  };

  // The matrix, accumulated cumulatively through the nested brackets.
  const window = (brackets: number, fromTimestamp: number): PoolMigrationWindow => {
    const byPair = new Map<string, PricedCell>();
    for (const row of matrixRows) {
      if (!MATRIX_BRACKETS.slice(0, brackets).includes(row.bracket as never)) continue;
      const key = `${row.source}→${row.dest}`;
      const cell = byPair.get(key) ?? emptyCell();
      addRow(cell, row);
      byPair.set(key, cell);
    }
    const total = emptyCell();
    const pairs: PoolMigrationPair[] = [...byPair.entries()]
      .map(([key, cell]) => {
        addCell(total, cell);
        const [from, to] = key.split("→") as [PoolMigrationPair["from"], PoolName];
        return {
          from,
          to,
          txCount: cell.txCount,
          amountZat: cell.amountZat,
          valueUsdText: migrationUsdText(cell, spotUsd, false),
        };
      })
      // Largest flow first, so the pair a reader asks about is not buried under dust.
      .sort((a, b) => b.amountZat - a.amountZat);
    return {
      fromTimestamp,
      txCount: total.txCount,
      amountZat: total.amountZat,
      valueUsdText: migrationUsdText(total, spotUsd, true),
      pairs,
    };
  };
  return {
    sinceActivation,
    last24Hours: window(1, nowSec - DAY_SECONDS),
    last7Days: window(2, nowSec - 7 * DAY_SECONDS),
    last30Days: window(3, nowSec - 30 * DAY_SECONDS),
  };
}

/**
 * A currency code off the query string, or `usd`. A shape guard, not a membership check: whether a
 * rate exists is `fx_rate_daily`'s answer, and a code without one simply yields no conversion (the
 * record keeps its ZEC figure). Anything malformed means dollars.
 */
export function fxCurrencyParam(raw: string | undefined): string {
  const c = (raw ?? "").trim().toLowerCase();
  return /^[a-z]{3}$/.test(c) ? c : "usd";
}

/** A block's day, that day's stored ZEC close and its source, and the day's rate to `currency`. */
export interface DayClose {
  day: string;
  usd: number;
  source: string;
  rate: number | null;
}

/**
 * The day's close for each height, for "worth at the time" texts: each height is valued at its own
 * day's stored close from `zec_price_daily`, since a daily close is not the moment's spot price.
 *
 * Returns a map keyed by height; a height whose block or day's close is missing has no entry (the
 * valuation is lost, never the figure beside it). Callers guard it separately so an enrichment
 * failure costs the text, not the range.
 */
async function dayClosesByHeight(
  pool: Pool,
  heights: readonly (number | null)[],
  currency = "usd",
): Promise<Map<number, DayClose>> {
  const wanted = [...new Set(heights.filter((h): h is number => h !== null))];
  const out = new Map<number, DayClose>();
  if (wanted.length === 0) return out;
  const { rows } = await pool.query<DayClose & { height: number }>(
    // The FX rate is joined on the same day as the close, never on today. A LEFT JOIN, so a
    // currency with no rate that day costs the conversion and not the row; `usdAtCloseFor` then
    // declines to convert rather than falling back to dollars.
    `SELECT b.height, to_char(to_timestamp(b.timestamp) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            p.usd, p.source, f.rate
       FROM block b
       JOIN zec_price_daily p
         ON p.day = (to_timestamp(b.timestamp) AT TIME ZONE 'UTC')::date
       LEFT JOIN fx_rate_daily f
         ON f.day = p.day AND f.currency = $2
      WHERE b.height = ANY($1::int[])`,
    [wanted, currency],
  );
  for (const { height, day, usd, source, rate } of rows) {
    out.set(height, { day, usd, source, rate });
  }
  return out;
}

/**
 * One record's at-close valuation string, or null when no close exists for its day.
 *
 * In a non-dollar currency it is the day's close converted at that day's reference rate, and the
 * string names both. A day with a close but no rate returns null rather than a dollar figure under
 * a non-dollar heading.
 */
export function usdAtCloseFor(
  closes: Map<number, DayClose>,
  zat: number,
  height: number | null,
  currency = "usd",
): string | null {
  if (height === null) return null;
  const close = closes.get(height);
  if (close === undefined) return null;
  const { source, day } = close;
  const price = Number(close.usd);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (currency === "usd") {
    return `${formatZatUsdApprox(zat, price)} at that day's close ($${price.toFixed(2)}, ${source}, ${day}) — a daily close, not the moment's price, and not today's value`;
  }
  const rate = close.rate === null ? NaN : Number(close.rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const code = currency.toUpperCase();
  return `${formatZatMoneyApprox(zat, price, rate, currency)} at that day's close ($${price.toFixed(2)}, ${source}, ${day}) converted at that day's USD→${code} reference rate — a daily close, not the moment's price, and not today's value, and not a price quoted on a ${code} market`;
}

/**
 * Read `chain_fee_extremes`, or null.
 *
 * Never throws: this rides on `/chain/analytics/fee-kinds`, which live fee charts depend on, and
 * the matview is created WITH NO DATA, so on a fresh database querying it raises "materialized view
 * has not been populated". `null` means "we could not read it", rendered as an explicit read
 * failure, never as a zero.
 */
export async function readFeeExtremes(pool: Pool, currency = "usd"): Promise<FeeExtremes | null> {
  try {
    const { rows } = await pool.query<{
      scope: string;
      lowest_zat: string;
      lowest_count: string;
      highest_zat: string;
      highest_count: string;
      highest_id: string | null;
      highest_height: number | null;
      considered: string;
    }>("SELECT * FROM chain_fee_extremes");
    // The non-zero floor and the at-close valuations are enrichments, each in its own guard: either
    // failing (an unpopulated matview, a price-table error) costs that figure alone, never the
    // range.
    const floors = await pool
      .query<{
        scope: string;
        lowest_zat: string;
        lowest_count: string;
        lowest_id: string | null;
        lowest_height: number | null;
        considered: string;
      }>("SELECT * FROM chain_fee_nonzero_floor")
      .then((r) => r.rows)
      .catch(() => []);
    const closes = await dayClosesByHeight(
      pool,
      [
        ...rows.map((r) => (Number(r.highest_count) === 1 ? r.highest_height : null)),
        ...floors.map((f) => (Number(f.lowest_count) === 1 ? f.lowest_height : null)),
      ],
      currency,
    ).catch(() => new Map<number, DayClose>());
    const bind = (scope: string) => {
      const r = rows.find((row) => row.scope === scope);
      if (!r) return null;
      const floor = floors.find((row) => row.scope === scope);
      const highestZat = Number(r.highest_zat);
      return {
        lowest: {
          feeZat: Number(r.lowest_zat),
          count: Number(r.lowest_count),
          // Null: the view records an identifier only for the maximum. A minimum is shared by many
          // rows, so naming one would be arbitrary.
          id: null,
          height: null,
        },
        highest: {
          feeZat: highestZat,
          count: Number(r.highest_count),
          id: r.highest_id,
          height: r.highest_height,
          usdAtCloseText:
            Number(r.highest_count) === 1
              ? usdAtCloseFor(closes, highestZat, r.highest_height, currency)
              : null,
        },
        considered: Number(r.considered),
        // The smallest real fee. Its id is meaningful only when its count is 1, as for the maximum.
        lowestNonZero: floor
          ? {
              feeZat: Number(floor.lowest_zat),
              count: Number(floor.lowest_count),
              id: Number(floor.lowest_count) === 1 ? floor.lowest_id : null,
              height: Number(floor.lowest_count) === 1 ? floor.lowest_height : null,
              usdAtCloseText:
                Number(floor.lowest_count) === 1
                  ? usdAtCloseFor(closes, Number(floor.lowest_zat), floor.lowest_height, currency)
                  : null,
            }
          : null,
      };
    };
    const transaction = bind("transaction");
    const block = bind("block");
    // Both or neither: half an answer would leave a consumer guessing which half is missing.
    return transaction && block ? { transaction, block } : null;
  } catch {
    return null;
  }
}

/**
 * Read the transparent value range, or null.
 *
 * Never throws, like `readFeeExtremes`: it rides on a payload live fee charts read, and its table
 * is legitimately empty until the one-shot walk has run.
 *
 * Refuses a partial walk: a maximum over part of the chain may be the wrong row entirely, so the
 * range is served only once `covered_through_height` has reached the tip less the reorg margin.
 */
export async function readValueExtremes(
  pool: Pool,
  currency = "usd",
): Promise<ValueExtremes | null> {
  try {
    const { rows } = await pool.query<{
      lowest_zat: string | null;
      lowest_count: string | null;
      highest_zat: string | null;
      highest_count: string | null;
      highest_txid: string | null;
      highest_height: number | null;
      considered: string | null;
      covered_through_height: number;
      target: number | null;
    }>(
      `SELECT e.*, (SELECT GREATEST(0, max(height) - $1::int) FROM block) AS target
         FROM chain_value_extremes e WHERE e.scope = 'transaction'`,
      [REORG_DEPTH],
    );
    const r = rows[0];
    if (!r || r.lowest_zat === null || r.highest_zat === null) return null;
    // Behind the tip by more than the slack means the walk has not finished, or the top-up has
    // fallen behind far enough that the range is no longer all-time.
    if (r.target === null || r.covered_through_height < r.target - VALUE_COVERAGE_SLACK) {
      return null;
    }
    return {
      lowest: {
        feeZat: Number(r.lowest_zat),
        count: Number(r.lowest_count),
        // As with the fee range, an identifier is recorded only for the maximum: a minimum is a
        // tie.
        id: null,
        height: null,
      },
      highest: {
        feeZat: Number(r.highest_zat),
        count: Number(r.highest_count),
        id: r.highest_txid,
        height: r.highest_height,
        // "Worth at the time" for the record crossing, valued at its own day's close, in its own
        // guard.
        usdAtCloseText:
          Number(r.highest_count) === 1
            ? await dayClosesByHeight(pool, [r.highest_height], currency)
                .then((m) => usdAtCloseFor(m, Number(r.highest_zat), r.highest_height, currency))
                .catch(() => null)
            : null,
      },
      considered: Number(r.considered),
      coveredThroughHeight: r.covered_through_height,
    };
  } catch {
    return null;
  }
}

/**
 * How far behind the tip the range may fall and still be published, in blocks. The top-up runs
 * hourly and the chain produces about 48 blocks an hour, so a healthy deployment sits a few dozen
 * blocks back. Zero slack would make the range flicker between refreshes; two hours of blocks is
 * well below the gap a stalled walk would show.
 */
const VALUE_COVERAGE_SLACK = 100;

/**
 * Pivot period×kind fee rows into one point per period. A kind with no transactions in the
 * period stays null — the chart draws a gap, never a fabricated zero. Shared by the monthly
 * and daily fee routes so the two grains cannot pivot differently.
 */
export function pivotFeeKindRows(
  rows: { ts: string; kind: string; median_zat: string }[],
): FeeKindMonthPoint[] {
  const byPeriod = new Map<number, FeeKindMonthPoint>();
  for (const row of rows) {
    const ts = Number(row.ts);
    const point = byPeriod.get(ts) ?? {
      timestamp: ts,
      transparentZat: null,
      mixedZat: null,
      shieldedZat: null,
    };
    if (row.kind === "transparent") point.transparentZat = Number(row.median_zat);
    else if (row.kind === "mixed") point.mixedZat = Number(row.median_zat);
    else if (row.kind === "shielded") point.shieldedZat = Number(row.median_zat);
    byPeriod.set(ts, point);
  }
  return [...byPeriod.values()].sort((a, b) => a.timestamp - b.timestamp);
}

interface ShieldingFlowRow {
  ts: string;
  shielded: string;
  unshielded: string;
}

function toShieldingFlowPoint(r: ShieldingFlowRow): ShieldingFlowPoint {
  return {
    timestamp: Number(r.ts),
    shieldedZat: Number(r.shielded),
    unshieldedZat: Number(r.unshielded),
  };
}

interface FeeTotalRow {
  ts: string;
  fee_zat: string;
  blocks: number;
  blocks_covered: number;
}

function toFeeTotal(r: FeeTotalRow): FeeTotalPoint {
  return {
    timestamp: Number(r.ts),
    feeZat: Number(r.fee_zat),
    blocks: Number(r.blocks),
    blocksCovered: Number(r.blocks_covered),
  };
}

interface MonthRow {
  ts: string;
  top_height: number;
  transparent: number;
  mixed: number;
  shielded: number;
  sprout: string;
  sapling: string;
  orchard: string;
  ironwood: string;
}

/**
 * `difficulty` is `number | null` because `AVG` over an all-NULL day returns NULL (see
 * `toNetworkDay`). `bytes` averages a NOT NULL integer column, so Postgres returns NUMERIC, which
 * node-pg parses as a string; it is never null.
 */
export interface NetworkRow {
  ts: string;
  difficulty: number | null;
  bytes: string | number;
}

/**
 * One day of network health, with an unrecorded difficulty kept as `null`.
 *
 * `block.difficulty` is NULL for blocks written before the column existed until the repair fills
 * them, so an all-NULL day averages to NULL. `Number(null)` is 0, and a fabricated zero passes
 * every downstream `typeof === "number"` check, so the refusal belongs here, where the NULL is
 * still visible.
 *
 * `avgBlockBytes` is coerced directly: `size_bytes` is NOT NULL, so its average is never null.
 */
export function toNetworkDay(r: NetworkRow): NetworkDayPoint {
  return {
    timestamp: Number(r.ts),
    avgDifficulty: r.difficulty === null ? null : Number(r.difficulty),
    avgBlockBytes: Number(r.bytes),
  };
}

function toMonthPoint(r: MonthRow): ChainMonthPoint {
  return {
    timestamp: Number(r.ts),
    topHeight: Number(r.top_height),
    transparentTxs: r.transparent,
    mixedTxs: r.mixed,
    shieldedTxs: r.shielded,
    sproutZat: Number(r.sprout),
    saplingZat: Number(r.sapling),
    orchardZat: Number(r.orchard),
    ironwoodZat: Number(r.ironwood),
  };
}

/**
 * All-time transaction counts by privacy kind, and the two directions inside `mixed`.
 *
 * Exported so the agent dispatches against this module's own constant: a renamed private route
 * breaks the agent's tests in the same commit. The `/v1` paths beside it are literals, because a
 * published path must not follow an internal rename.
 */
export const TX_COUNTS_PATH = "/chain/analytics/tx-counts";

/**
 * Analytics queries are the heaviest the site issues, and they share a pool with trivial ones, so a
 * single slow query must not take unrelated pages down by holding every connection.
 *
 * - `statement_timeout` (30 s), so a runaway query dies instead of holding a connection. Longer
 *   than `/v1`'s 5 s because these series legitimately take seconds on a cold cache; the timeout
 *   must exceed honest work and still end a hang.
 * - A wider pool (6), so one slow series cannot monopolise every connection.
 *
 * Together they keep a slow analytics panel degrading to `DataUnavailable` without taking a list
 * page with it.
 */
export function analyticsRoutes(
  connection?: string,
  network: AnalyticsNetwork = "mainnet",
  deps: {
    /**
     * The live tracked ZEC price, for valuing migrations on days whose close is not stored yet
     * (today). A getter: the tracker warms after boot and ages out, so it is read per cache fill.
     * Absent (tests, testnet, where TAZ has no market) the unpriced remainder degrades the dollar
     * figure to a "≥" floor or null.
     */
    spotUsd?: () => number | null;
  } = {},
): Hono {
  // Defaulted, and to `mainnet`, which is what an unset ZCASH_NETWORK means everywhere else.
  const IRONWOOD_ACTIVATION_HEIGHT = IRONWOOD_ACTIVATION_HEIGHT_BY_NETWORK[network];
  const POOL = { max: 6, statement_timeout: 30_000 } as const;
  const pool = createPool(connection, POOL);
  const activity = new Cached<ActivityPoint[]>();
  const supply = new Cached<ShieldedSupplyPoint[]>();
  const months = new Cached<ChainMonthPoint[]>();
  // Same 10-minute TTL as the rest: a trailing-day total moves continuously, but not perceptibly
  // inside ten minutes.
  const fees24h = new Cached<Fees24h | null>();
  const ironwood = new Cached<IronwoodInflow | null>();
  const shieldingFlow = new Cached<ShieldingFlowPoint[]>();
  const feeDistribution = new Cached<FeeDistribution>();
  const txCounts = new Cached<Record<string, number>>();
  const networkDaily = new Cached<NetworkDayPoint[]>();
  const days = new Cached<ChainMonthPoint[]>();
  const shieldingFlowDays = new Cached<ShieldingFlowPoint[]>();
  const feeKindDays = new Cached<FeeKindMonthPoint[]>();
  const feeTotals = new Cached<FeeTotalSeries>();
  const poolUsage = new Cached<PoolUsageDayPoint[]>();
  const poolMigrations = new Cached<PoolMigrationDayPoint[]>();
  const app = new Hono();

  // The two per-pool chart series. The matviews are WITH NO DATA, and an unpopulated one raises
  // rather than returning zero rows, so a fresh database answers 500, the adapter treats it as
  // transient, and the chart renders DataUnavailable instead of an empty plot.
  app.get("/chain/analytics/pool-usage", async (c) =>
    c.json(
      await poolUsage.get(async () => {
        const { rows } = await pool.query<PoolPivotRow>(POOL_USAGE_SERIES_SQL);
        return rows.map(toPoolUsagePoint);
      }),
    ),
  );

  app.get("/chain/analytics/pool-migrations", async (c) =>
    c.json(
      await poolMigrations.get(async () => {
        const { rows } = await pool.query<PoolPivotRow>(POOL_MIGRATION_SERIES_SQL);
        return rows.map(toPoolMigrationPoint);
      }),
    ),
  );

  app.get("/chain/analytics/activity", async (c) =>
    c.json(
      await activity.get(async () => {
        /*
         * Reads `chain_day_rollup`, which stores each day's closing pool totals.
         *
         * Net pool flow is differenced from day-end pool totals rather than summed from per-block
         * deltas: the rollup carries no Sprout delta, so a delta sum would report zero flow for the
         * entire Sprout era. Totals are authoritative for all four pools at once, and the
         * day-over-day difference is the day's net flow.
         */
        const { rows } = await pool.query<ActivityRow>(
          `SELECT ts, transparent, mixed, shielded,
                  COALESCE(
                    ${SHIELDED_POOL_SUM_SQL}
                      - LAG${SHIELDED_POOL_SUM_SQL} OVER (ORDER BY ts),
                    ${SHIELDED_POOL_SUM_SQL}
                  )::bigint AS flow
             FROM chain_day_rollup
            ORDER BY ts`,
        );
        return rows.map(toActivityPoint);
      }),
    ),
  );

  app.get("/chain/analytics/supply", async (c) =>
    c.json(
      await supply.get(async () => {
        /*
         * Reads `chain_day_rollup`, which stores each day's closing pool balances at its highest
         * block. Pools the node was not monitoring are COALESCEd to zero there (before activation
         * the pool was zero in fact as well as in storage).
         *
         * Each point carries its day's timestamp, since the chart plots supply against time, and
         * the height it was read at, which makes the figure checkable against a node.
         */
        const { rows } = await pool.query<SupplyRow>(
          `SELECT ts, top_height AS height,
                  ${SHIELDED_POOL_SUM_SQL}::bigint AS total
             FROM chain_day_rollup
            ORDER BY ts`,
        );
        return rows.sort((a, b) => a.height - b.height).map(toSupplyPoint);
      }),
    ),
  );

  /**
   * Monthly chain history: transaction mix, and each pool's closing balance.
   *
   * One query serves all three analytics charts. Counts are summed across the month, while pool
   * balances are read at its highest block: a max or average would not be a closing value, since a
   * pool can fall within a month.
   *
   * `COALESCE(..., 0)` on the pools is correct here: a pool that did not yet exist held nothing,
   * and the node reports NULL only because it was not tracking it yet.
   */
  app.get("/chain/analytics/months", async (c) =>
    c.json(await months.get(() => loadMonthlySeries(pool))),
  );

  /**
   * Fees paid over the trailing day, with the coverage behind the figure.
   *
   * Coverage travels with the total: a block's fee total is NULL when any of its transactions has
   * an unresolved input, so a sum over the measurable blocks alone needs its denominator.
   * `blocksCovered < blocksTotal` tells the UI to say so.
   *
   * `SUM` skips NULLs and `COUNT(total_fee_zat)` counts exactly the rows it summed, so the two
   * always describe the same set. `COALESCE` on the sum turns "no measurable block" into 0 paired
   * with `blocksCovered = 0`, which the domain reads as unmeasured rather than free.
   */
  app.get("/chain/analytics/fees24h", async (c) =>
    c.json(
      await fees24h.get(async () => {
        const { rows } = await pool.query<{
          zat: string | number;
          covered: string | number;
          total: string | number;
        }>(
          `SELECT COALESCE(SUM(total_fee_zat), 0) AS zat,
                  COUNT(total_fee_zat)            AS covered,
                  COUNT(*)                        AS total
             FROM block
            WHERE timestamp > EXTRACT(EPOCH FROM now())::bigint - 86400`,
        );
        const row = rows[0];
        if (row === undefined) return null;
        const blocksTotal = Number(row.total);
        const blocksCovered = Number(row.covered);
        // No block in the window, or not one measurable: unmeasured, not zero fees.
        if (blocksTotal === 0 || blocksCovered === 0) return null;
        return { zat: Number(row.zat), blocksCovered, blocksTotal };
      }),
    ),
  );

  /**
   * What is filling Ironwood, since NU6.3 activated.
   *
   * Attribution is per transaction. Comparing pool balances at two heights cannot establish that
   * the same value moved between pools, because Orchard can unshield independently in the same
   * window; summing each transaction's own value balances has an exact answer.
   *
   * Stored balances are domain sign (positive = value entering that pool), so a source pool shows a
   * negative balance on a migrating transaction and `GREATEST(-x, 0)` picks out the outflow. Sprout
   * is included via `sprout_vpub_net_zat`, whose RPC sign is the opposite, even while it is zero.
   *
   * What remains after the shielded sources is transparent: value that was public and now is not,
   * i.e. new shielding rather than migration.
   */
  app.get("/chain/analytics/ironwood", async (c) =>
    c.json(
      await ironwood.get(async () => {
        // Anchored on the server's clock, not the newest row: a quiet chain must yield an empty
        // window rather than sliding back to the last migration. The edges travel in the payload.
        const nowSec = Math.floor(Date.now() / 1000);
        const [inflow, sinceRows, matrixRows, balance] = await Promise.all([
          /*
           * The pool's current balance and what accounts for it.
           *
           * Every term is the counterparty's own declared movement, netted across inflows and
           * outflows, so the parts sum to the whole exactly. Nothing is apportioned: where one
           * transaction draws on two pools, each pool's own balance is summed separately.
           *
           * Coinbase is separate: a ZIP-213 shielded coinbase mines newly issued ZEC straight into
           * the pool, neither a migration nor a shielding. The identity closes to the zatoshi
           * against the node's own `ironwood_pool_zat`.
           *
           * The transparent term uses the per-transaction balance identity (`tnet_identity`)
           * instead of joining `tx_transparent_io`: a probe per Ironwood transaction into the large
           * io table grows with the pool's age and eventually exceeds the statement timeout. The
           * join remains only for a row with an unknown fee.
           */
          pool.query<IronwoodInflowRow>(IRONWOOD_INFLOW_SQL, [IRONWOOD_ACTIVATION_HEIGHT]),
          // Pool migrations into Ironwood since activation, per source (see
          // IRONWOOD_MIGRATIONS_SQL). The trailing windows come from the matrix query below, and
          // both are folded in assembleIronwoodMigrations, so tests run the same strings this route
          // does.
          pool.query<IronwoodMigrationRow>(IRONWOOD_MIGRATIONS_SQL, [IRONWOOD_ACTIVATION_HEIGHT]),
          // The full directed migration matrix over the trailing 30 days, every destination pool: a
          // timestamp range on tx_keyset_idx, cheap for any pool.
          pool.query<PoolMigrationMatrixRow>(POOL_MIGRATION_MATRIX_SQL, [
            nowSec - DAY_SECONDS,
            nowSec - 7 * DAY_SECONDS,
            nowSec - 30 * DAY_SECONDS,
          ]),
          // Hourly, because the window is short. DISTINCT ON with height DESC takes the hour's
          // closing balance: a pool can fall within an hour, so an average or max would not be a
          // balance at any moment.
          pool.query<{ ts: string; zat: string }>(
            `SELECT DISTINCT ON (date_trunc('hour', to_timestamp(timestamp)))
                    EXTRACT(EPOCH FROM date_trunc('hour', to_timestamp(timestamp)))::bigint AS ts,
                    ironwood_pool_zat AS zat
               FROM block
              WHERE height >= $1 AND ironwood_pool_zat IS NOT NULL
              ORDER BY date_trunc('hour', to_timestamp(timestamp)), height DESC`,
            [IRONWOOD_ACTIVATION_HEIGHT],
          ),
        ]);

        const row = inflow.rows[0];
        if (row === undefined) return null;
        return {
          activationHeight: IRONWOOD_ACTIVATION_HEIGHT,
          balanceZat: Number(row.balance),
          netFromOrchardZat: Number(row.orchard),
          netFromSaplingZat: Number(row.sapling),
          // Its own field even at zero: folding a zero term into a neighbour would leave the label
          // wrong once it stops being zero, with the total still adding up.
          netFromSproutZat: Number(row.sprout),
          netFromTransparentZat: Number(row.transparent),
          fromTransparentTxCount: Number(row.transparent_txs),
          txCount: Number(row.tx_count),
          minedZat: Number(row.mined),
          feesPaidZat: Number(row.fees),
          balance: balance.rows.map((b) => ({
            timestamp: Number(b.ts),
            ironwoodZat: Number(b.zat),
          })),
          migrations: assembleIronwoodMigrations(
            sinceRows.rows,
            matrixRows.rows,
            nowSec,
            deps.spotUsd?.() ?? null,
          ),
        };
      }),
    ),
  );

  /**
   * Monthly gross shielding flow, both directions, read from the materialised view (definition and
   * sign conventions in `schema-chain.sql`; refreshed by the follower, which deploys first).
   */
  app.get("/chain/analytics/shielding-flow", async (c) =>
    c.json(
      await shieldingFlow.get(async () => {
        const { rows } = await pool.query<ShieldingFlowRow>(
          `SELECT ts, shielded_zat AS shielded, unshielded_zat AS unshielded
             FROM chain_month_shielding_flow
            ORDER BY ts`,
        );
        return rows.map(toShieldingFlowPoint);
      }),
    ),
  );

  /**
   * What a transaction costs, by privacy kind.
   *
   * The monthly trend reads the matview the follower refreshes. The recent window is a live
   * percentile over about 90 days of rows, affordable because `tx_keyset_idx (timestamp DESC, txid
   * DESC)` makes it an index range, and it runs once per cache window.
   *
   * Percentiles, never means: the distribution is heavy-tailed (it includes genuine fat-finger
   * fees), and a mean would let one mistake move a whole line. Each kind carries its own sample
   * size.
   */
  app.get("/chain/analytics/fee-kinds", async (c) => {
    /*
     * The dollar path keeps the shared cache; a non-dollar one computes uncached. `Cached` holds
     * one value with no key, so feeding other currencies through it would serve one currency's
     * figures under another's request. Not caching the rare case is smaller than keying, and leaves
     * the site's own `usd` path untouched.
     */
    const currency = fxCurrencyParam(c.req.query("currency"));
    const load = async () => {
      const windowDays = 90;
      const [recent, monthly] = await Promise.all([
        pool.query<{
          kind: FeeKindStats["kind"];
          median_zat: string;
          avg_zat: string;
          p25_zat: string;
          p75_zat: string;
          txs: string;
        }>(
          `SELECT kind,
                    percentile_cont(0.5)  WITHIN GROUP (ORDER BY fee_zat)::bigint AS median_zat,
                    AVG(fee_zat)::bigint AS avg_zat,
                    percentile_cont(0.25) WITHIN GROUP (ORDER BY fee_zat)::bigint AS p25_zat,
                    percentile_cont(0.75) WITHIN GROUP (ORDER BY fee_zat)::bigint AS p75_zat,
                    count(fee_zat) AS txs
               FROM tx
              WHERE kind <> 'coinbase' AND fee_zat IS NOT NULL AND block_height IS NOT NULL
                AND timestamp > EXTRACT(EPOCH FROM now())::bigint - $1 * 86400
              GROUP BY kind`,
          [windowDays],
        ),
        pool.query<{ ts: string; kind: string; median_zat: string }>(
          `SELECT ts, kind, median_zat FROM chain_month_fee_kind ORDER BY ts`,
        ),
      ]);

      return {
        windowDays,
        recent: recent.rows.map((r) => ({
          kind: r.kind,
          medianZat: Number(r.median_zat),
          avgZat: Number(r.avg_zat),
          p25Zat: Number(r.p25_zat),
          p75Zat: Number(r.p75_zat),
          txs: Number(r.txs),
        })),
        monthly: pivotFeeKindRows(monthly.rows),
        extremes: await readFeeExtremes(pool, currency),
        valueExtremes: await readValueExtremes(pool, currency),
      };
    };
    return c.json(currency === "usd" ? await feeDistribution.get(load) : await load());
  });

  /** Per-kind transaction totals off the matview, plus their sum, for the totals lines. */
  app.get(TX_COUNTS_PATH, async (c) =>
    c.json(
      await txCounts.get(async () => {
        /*
         * Two views, queried separately and folded here. `chain_tx_mixed_direction_count` counts
         * the two sub-filters of `mixed` and is deliberately not a second GROUP BY column on its
         * sibling (see its definition in `schema-chain.sql`).
         *
         * The direction rows are added alongside `mixed`, never instead of it, and are left out of
         * `all`: a shielding transaction is one `mixed` transaction, already counted.
         */
        const [kinds, directions] = await Promise.all([
          pool.query<{ kind: string; txs: number }>("SELECT kind, txs FROM chain_tx_kind_count"),
          pool.query<{ direction: string; txs: number }>(
            "SELECT direction, txs FROM chain_tx_mixed_direction_count",
          ),
        ]);
        let all = 0;
        const out: Record<string, number> = {};
        for (const r of kinds.rows) {
          out[r.kind] = Number(r.txs);
          all += Number(r.txs);
        }
        for (const r of directions.rows) out[r.direction] = Number(r.txs);
        out.all = all;
        return out;
      }),
    ),
  );

  /**
   * The daily siblings of `/months`, `/shielding-flow` and `/fee-kinds`, for the chart range
   * toggles: thirty days of a monthly series is one point, so every range short of "all" reads day
   * grain.
   *
   * Each serves the trailing 366 days only (the longest such range is a year). All three read
   * matviews the follower refreshes hourly; the WHERE is a seek on the view's unique ts index.
   */
  app.get("/chain/analytics/days", async (c) =>
    c.json(
      await days.get(async () => {
        const { rows } = await pool.query<MonthRow>(
          `SELECT ts, top_height, transparent, mixed, shielded,
                  sprout, sapling, orchard, ironwood
             FROM chain_day_rollup
            WHERE ts >= EXTRACT(EPOCH FROM now() - interval '366 days')::bigint
            ORDER BY ts`,
        );
        return rows.map(toMonthPoint);
      }),
    ),
  );

  app.get("/chain/analytics/shielding-flow-days", async (c) =>
    c.json(
      await shieldingFlowDays.get(async () => {
        const { rows } = await pool.query<ShieldingFlowRow>(
          `SELECT ts, shielded_zat AS shielded, unshielded_zat AS unshielded
             FROM chain_day_shielding_flow
            WHERE ts >= EXTRACT(EPOCH FROM now() - interval '366 days')::bigint
            ORDER BY ts`,
        );
        return rows.map(toShieldingFlowPoint);
      }),
    ),
  );

  app.get("/chain/analytics/fee-kinds-days", async (c) =>
    c.json(
      await feeKindDays.get(async () => {
        const { rows } = await pool.query<{ ts: string; kind: string; median_zat: string }>(
          `SELECT ts, kind, median_zat FROM chain_day_fee_kind
            WHERE ts >= EXTRACT(EPOCH FROM now() - interval '366 days')::bigint
            ORDER BY ts`,
        );
        return pivotFeeKindRows(rows);
      }),
    ),
  );

  /**
   * What the whole network paid in fees, per month and per day, both grains in one response so a
   * page never holds one without the other.
   *
   * Both read `chain_day_fee_total`; the monthly form re-aggregates the daily rows, which is
   * instant and avoids a second matview. Coverage travels with each point, because a block's fee
   * total is NULL when a transaction in it has an unresolved input.
   */
  app.get("/chain/analytics/fee-totals", async (c) =>
    c.json(
      await feeTotals.get(async () => {
        const [monthly, daily] = await Promise.all([
          pool.query<FeeTotalRow>(
            `SELECT EXTRACT(EPOCH FROM date_trunc('month', to_timestamp(ts)))::bigint AS ts,
                    SUM(fee_zat)::bigint        AS fee_zat,
                    SUM(blocks)::int            AS blocks,
                    SUM(blocks_covered)::int    AS blocks_covered
               FROM chain_day_fee_total
              GROUP BY 1 ORDER BY 1`,
          ),
          pool.query<FeeTotalRow>(
            `SELECT ts, fee_zat, blocks, blocks_covered
               FROM chain_day_fee_total
              WHERE ts >= EXTRACT(EPOCH FROM now() - interval '366 days')::bigint
              ORDER BY ts`,
          ),
        ]);
        return { monthly: monthly.rows.map(toFeeTotal), daily: daily.rows.map(toFeeTotal) };
      }),
    ),
  );

  /** Daily difficulty and block size. */
  app.get("/chain/analytics/network-daily", async (c) =>
    c.json(
      await networkDaily.get(async () => {
        // Reads `chain_day_network` rather than scanning `block` on every cache miss.
        const { rows } = await pool.query<NetworkRow>(
          `SELECT ts, avg_difficulty AS difficulty, avg_block_bytes AS bytes
             FROM chain_day_network
            ORDER BY ts`,
        );
        return rows.map(toNetworkDay);
      }),
    ),
  );

  /**
   * A window of chain activity: the one analytics route that narrows and totals rather than serving
   * a series.
   *
   * `from`/`to` are UTC calendar days and the window is half-open, so
   * `from=2026-07-01&to=2026-08-01` is exactly July. An unparseable day is dropped rather than
   * rejected, like every filter here, and the caller learns what survived from the `applied` echo.
   * Checking that echo is the caller's job: an older service would ignore an unknown `?from=` and
   * answer over all of history.
   *
   * Uncached; see `loadChainWindow`.
   */
  app.get("/chain/analytics/window", async (c) => {
    const q = c.req.query();
    const fromTimestamp = parseUtcDayStart(q.from);
    const toTimestamp = parseUtcDayStart(q.to);
    const currency = fxCurrencyParam(q.currency);
    // Value floors on shielded-boundary crossings, parsed like the cross-chain surface's: a
    // malformed number means "no floor". `minZec` arrives as a ZEC decimal and is converted to
    // zatoshi here. Both may be given, and then both bind.
    const minCrossingZat = parseMinZecFilter(q.minZec);
    const minCrossingValue = parseMinUsdFilter(q.minValue);
    // The migration pair filter: a closed set, so unrecognised means "no filter" here, while the
    // agent's dispatch rejects a typo with a message before sending it.
    const migrationSource = parseMigrationSource(q.migrationSource);
    const migrationDestination = parseMigrationDestination(q.migrationDestination);
    return c.json(
      await loadChainWindow(
        pool,
        {
          ...(fromTimestamp === null ? {} : { fromTimestamp }),
          ...(toTimestamp === null ? {} : { toTimestamp }),
          ...(minCrossingZat === null ? {} : { minCrossingZat }),
          ...(minCrossingValue === null ? {} : { minCrossingValue, crossingCurrency: currency }),
          ...(migrationSource === null ? {} : { migrationSource }),
          ...(migrationDestination === null ? {} : { migrationDestination }),
        },
        parseChainWindowGroupBy(q.groupBy),
        // Migrations and value floors are priced day by day, so the currency must reach the SQL: an
        // all-time total converted at one rate would be fiction.
        currency,
      ),
    );
  });

  return app;
}

/**
 * The monthly series, as a pool-taking function so /v1 reuses the exact query the private route
 * serves.
 */
export async function loadMonthlySeries(pool: Pool): Promise<ChainMonthPoint[]> {
  // Reads the materialised view rather than deriving the series (two sequential scans of `block`).
  // The view lives in `schema-chain.sql` and the follower refreshes it, so the follower deploys
  // before the API.
  const { rows } = await pool.query<MonthRow>(
    `SELECT ts, top_height, transparent, mixed, shielded,
            sprout, sapling, orchard, ironwood
       FROM chain_month_rollup
      ORDER BY ts`,
  );
  return rows.map(toMonthPoint);
}

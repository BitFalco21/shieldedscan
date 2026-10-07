import type { Pool } from "pg";
import type {
  ChainWindowAggregate,
  ChainWindowFilters,
  ChainWindowGroupBy,
  CrossChainAggregate,
  CrossChainGroupBy,
  CrossChainNarrowing,
} from "@/domain";
import {
  windowHeightRange,
  loadChainWindow,
  loadPoolMigrationRaw,
  type PoolMigrationRaw,
} from "../../chain-window";
import type { FxPort } from "../../fx-rates";
import type { AnalyticsPool } from "./dto";
import { zeroPoolCounts } from "./params";

/**
 * Everything the windowed analytics read, as a port, so their HTTP contract (parameter errors,
 * the envelope, coverage) is testable without a database. The Postgres implementation below is
 * thin: every figure comes from a query this service already runs for its own pages or for the
 * agent (`loadChainWindow`, `loadPoolMigrationRaw`, the cross-chain store's `aggregate`), plus
 * two reads of day matviews that already feed `/pulse` and the pool charts. Nothing here is a
 * second definition of what a figure means.
 */
export interface AnalyticsData {
  tip(): Promise<{ height: number; timestamp: number }>;
  heights(from: number, to: number): Promise<{ lo: number | null; hi: number | null }>;
  window(
    filters: ChainWindowFilters,
    groupBy: ChainWindowGroupBy,
    currency: string,
  ): Promise<ChainWindowAggregate>;
  /** Transactions that used each pool, per bucket — keyed by bucket-start (0 for "none"). */
  poolTxByBucket(
    from: number,
    to: number,
    interval: ChainWindowGroupBy,
  ): Promise<Map<number, Record<AnalyticsPool, number>>>;
  flows(from: number, to: number, interval: ChainWindowGroupBy): Promise<FlowRow[]>;
  migrations(
    from: number,
    to: number,
    interval: ChainWindowGroupBy,
    currency: string,
    source: string | null,
    destination: string | null,
  ): Promise<PoolMigrationRaw[]>;
  crosschain(
    filters: CrossChainNarrowing,
    groupBy: CrossChainGroupBy,
  ): Promise<CrossChainAggregate>;
  /**
   * The newest UTC day (start, unix seconds) a daily view holds, or null when it holds none.
   * Each view is asked separately because they refresh on separate timers.
   */
  dailyThrough(view: DailyView): Promise<number | null>;
  /** Currencies a fiat value can be stated in, `usd` always first. */
  currencies(): readonly string[];
}

/** The day matviews an endpoint reads, closed so no caller can name an arbitrary relation. */
export type DailyView =
  "chain_day_rollup" | "chain_day_pool_tx" | "chain_day_pool_boundary" | "chain_day_pool_migration";

/** How each view spells its day — `chain_day_rollup` keys on unix seconds, the rest on a date. */
const DAY_OF: Record<DailyView, string> = {
  chain_day_rollup: "max(ts)",
  chain_day_pool_tx: "EXTRACT(EPOCH FROM max(day))::bigint",
  chain_day_pool_boundary: "EXTRACT(EPOCH FROM max(day))::bigint",
  chain_day_pool_migration: "EXTRACT(EPOCH FROM max(day))::bigint",
};

/** One (bucket, pool) row of `chain_day_pool_boundary`, summed. `pool` "hub" is unattributed. */
export interface FlowRow {
  bucketTs: number;
  pool: AnalyticsPool | "hub";
  shieldedTxs: number;
  shieldedZat: number;
  unshieldedTxs: number;
  unshieldedZat: number;
  coinbaseTxs: number;
  coinbaseZat: number;
  hubTxs: number;
  hubZat: number;
}

/**
 * The bucket key for a `date` column. `none` collapses to 0; a day or month keys on its UTC
 * start, matching the timestamps `loadChainWindow` stamps on its buckets so the two line up.
 */
function bucketExpr(interval: ChainWindowGroupBy): string {
  switch (interval) {
    case "none":
      return "0::bigint";
    case "day":
      return "EXTRACT(EPOCH FROM day)::bigint";
    case "month":
      return "EXTRACT(EPOCH FROM date_trunc('month', day::timestamp))::bigint";
  }
}

/**
 * `$1`/`$2` are the window's unix-second edges, `to` exclusive: the `- 1` keeps a window ending
 * at midnight from including that midnight's day. Same edge rule as every day-matview read here.
 */
const DAY_RANGE = `day >= (to_timestamp($1) AT TIME ZONE 'UTC')::date
                AND day <= (to_timestamp($2 - 1) AT TIME ZONE 'UTC')::date`;

const n = (v: string | number | null): number => (v === null ? 0 : Number(v));

export class PostgresAnalyticsData implements AnalyticsData {
  constructor(
    private readonly pool: Pool,
    private readonly store: {
      aggregate(f: CrossChainNarrowing, g: CrossChainGroupBy): Promise<CrossChainAggregate>;
    },
    private readonly fx: FxPort,
  ) {}

  async tip(): Promise<{ height: number; timestamp: number }> {
    const { rows } = await this.pool.query<{ height: number; timestamp: string }>(
      "SELECT height, timestamp FROM block ORDER BY height DESC LIMIT 1",
    );
    const row = rows[0];
    if (row === undefined) throw new Error("the chain index holds no block");
    return { height: row.height, timestamp: Number(row.timestamp) };
  }

  heights(from: number, to: number) {
    return windowHeightRange(this.pool, from, to);
  }

  window(filters: ChainWindowFilters, groupBy: ChainWindowGroupBy, currency: string) {
    return loadChainWindow(this.pool, filters, groupBy, currency);
  }

  async poolTxByBucket(from: number, to: number, interval: ChainWindowGroupBy) {
    const { rows } = await this.pool.query<{
      bucket_ts: string;
      pool: AnalyticsPool;
      txs: string;
    }>(
      `SELECT ${bucketExpr(interval)} AS bucket_ts, pool, SUM(txs)::bigint AS txs
         FROM chain_day_pool_tx
        WHERE ${DAY_RANGE}
        GROUP BY 1, 2`,
      [from, to],
    );
    const out = new Map<number, Record<AnalyticsPool, number>>();
    for (const r of rows) {
      const key = Number(r.bucket_ts);
      const row = out.get(key) ?? zeroPoolCounts();
      row[r.pool] = Number(r.txs);
      out.set(key, row);
    }
    return out;
  }

  async flows(from: number, to: number, interval: ChainWindowGroupBy): Promise<FlowRow[]> {
    const { rows } = await this.pool.query<Record<string, string>>(
      `SELECT ${bucketExpr(interval)} AS bucket_ts, pool,
              SUM(shielded_txs)::bigint   AS shielded_txs,   SUM(shielded_zat)::bigint   AS shielded_zat,
              SUM(unshielded_txs)::bigint AS unshielded_txs, SUM(unshielded_zat)::bigint AS unshielded_zat,
              SUM(coinbase_txs)::bigint   AS coinbase_txs,   SUM(coinbase_zat)::bigint   AS coinbase_zat,
              SUM(hub_txs)::bigint        AS hub_txs,        SUM(hub_zat)::bigint        AS hub_zat
         FROM chain_day_pool_boundary
        WHERE ${DAY_RANGE}
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [from, to],
    );
    return rows.map((r) => ({
      bucketTs: n(r.bucket_ts ?? null),
      pool: r.pool as AnalyticsPool | "hub",
      shieldedTxs: n(r.shielded_txs ?? null),
      shieldedZat: n(r.shielded_zat ?? null),
      unshieldedTxs: n(r.unshielded_txs ?? null),
      unshieldedZat: n(r.unshielded_zat ?? null),
      coinbaseTxs: n(r.coinbase_txs ?? null),
      coinbaseZat: n(r.coinbase_zat ?? null),
      hubTxs: n(r.hub_txs ?? null),
      hubZat: n(r.hub_zat ?? null),
    }));
  }

  migrations(
    from: number,
    to: number,
    interval: ChainWindowGroupBy,
    currency: string,
    source: string | null,
    destination: string | null,
  ) {
    return loadPoolMigrationRaw(this.pool, from, to, interval, currency, source, destination);
  }

  crosschain(filters: CrossChainNarrowing, groupBy: CrossChainGroupBy) {
    return this.store.aggregate(filters, groupBy);
  }

  async dailyThrough(view: DailyView): Promise<number | null> {
    const { rows } = await this.pool.query<{ d: string | null }>(
      `SELECT ${DAY_OF[view]} AS d FROM ${view}`,
    );
    const d = rows[0]?.d ?? null;
    return d === null ? null : Number(d);
  }

  currencies(): readonly string[] {
    return this.fx.offered();
  }
}

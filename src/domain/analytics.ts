import { POOL_NAMES, type PoolName } from "./pool";
/**
 * One bucket of chain activity. Everything here is genuinely public on Zcash:
 * transaction counts by kind, the fee actually paid, and the net value crossing
 * a pool boundary (from public value balances). Amounts *inside* the pools are
 * not derivable and are never represented here.
 */
export interface ActivityPoint {
  /** Unix seconds at the start of the bucket. */
  timestamp: number;
  transparentTxs: number;
  mixedTxs: number;
  shieldedTxs: number;
  /**
   * null when unknown — a daily median needs per-transaction fees, which the rollup does
   * not carry. Never render as 0.
   */
  medianFeeZat: number | null;
  /** Net ZEC into (+) or out of (−) the shielded pools, in zatoshis. */
  netPoolFlowZat: number;
}

export function totalTxs(point: ActivityPoint): number {
  return point.transparentTxs + point.mixedTxs + point.shieldedTxs;
}

/** Share of a bucket's transactions that touch a shielded pool at all. */
export function shieldedSharePct(point: ActivityPoint): number {
  const total = totalTxs(point);
  if (total === 0) return 0;
  return ((point.shieldedTxs + point.mixedTxs) / total) * 100;
}

/**
 * One month of chain history: how people transacted, and where value sat at month end.
 *
 * Monthly rather than daily: a decade of daily points is a heavy payload, and adoption moves
 * over seasons, which daily noise obscures.
 *
 * Pool balances are the month's closing values, read at its highest block — not an average
 * and not a maximum. A pool can fall within a period, so `max()` is not a closing balance.
 */
export interface ChainMonthPoint {
  /** Unix seconds at the first instant of the month. */
  timestamp: number;
  /** Highest block in the month — the one the pool balances are read at. */
  topHeight: number;
  transparentTxs: number;
  mixedTxs: number;
  shieldedTxs: number;
  sproutZat: number;
  saplingZat: number;
  orchardZat: number;
  ironwoodZat: number;
}

/** Non-coinbase transactions in the month. Coinbase is excluded upstream, by design. */
export function monthTotalTxs(p: ChainMonthPoint): number {
  return p.transparentTxs + p.mixedTxs + p.shieldedTxs;
}

/**
 * Share of the month's transactions that were fully shielded — no transparent side at all.
 *
 * Deliberately stricter than `shieldedSharePct`, which also counts shielding and unshielding.
 * The two diverge sharply (fully shielded can fall while mixed rises), so a chart must not
 * conflate them.
 */
export function fullyShieldedPct(p: ChainMonthPoint): number {
  const total = monthTotalTxs(p);
  return total === 0 ? 0 : (p.shieldedTxs / total) * 100;
}

/** Total ZEC sitting in every shielded pool at month end, in zatoshis. */
export function pooledZat(p: ChainMonthPoint): number {
  return p.sproutZat + p.saplingZat + p.orchardZat + p.ironwoodZat;
}

/**
 * Net ZEC into (+) or out of (−) the shielded pools across the month.
 *
 * Differenced from closing balances rather than summed from per-block flows: the rollup has no
 * Sprout or Ironwood flow column, so a sum would report zero for those pools. The first month
 * has no predecessor, so its flow is its whole balance — the pools started empty.
 */
export function monthNetFlowZat(series: readonly ChainMonthPoint[], index: number): number {
  const current = series[index];
  if (current === undefined) return 0;
  const previous = index > 0 ? series[index - 1] : undefined;
  return pooledZat(current) - (previous === undefined ? 0 : pooledZat(previous));
}

// ------------------------------------------------------------- a window of chain activity

/** How a chain window is broken down. `none` returns the window's totals alone. */
export const CHAIN_WINDOW_GROUP_BYS = ["none", "day", "month"] as const;
export type ChainWindowGroupBy = (typeof CHAIN_WINDOW_GROUP_BYS)[number];

/**
 * The narrowing a chain-window aggregate was asked for — and, echoed back, the one it applied.
 *
 * `to` is exclusive, so a calendar month is `from` its first day `to` the first of the next and
 * no instant belongs to two windows. Omitting both bounds means all of recorded history.
 */
export interface ChainWindowFilters {
  /** Unix seconds at the first instant of the first UTC day included. */
  fromTimestamp?: number;
  /** Unix seconds at the first instant of the first UTC day EXCLUDED. */
  toTimestamp?: number;
  /**
   * A value floor on shielded-boundary crossings, in zatoshi. Narrows nothing else.
   *
   * Present only when asked for, so `!== undefined` is the single test for "a threshold
   * applies" and an unthresholded window stays byte-identical.
   */
  minCrossingZat?: number;
  /**
   * The same floor in `crossingCurrency`, evaluated against each transaction's own day's close.
   * Both floors may be given and they AND together, rather than one silently winning.
   */
  minCrossingValue?: number;
  /** The currency `minCrossingValue` is denominated in. Echoed so the two cannot drift. */
  crossingCurrency?: string;
  /**
   * Narrow the pool-to-pool migration matrix to one source pool (or `multi`), one destination
   * pool, or both. Narrows `poolMigrations` only; counts, fees and flows stay the whole window's.
   *
   * Present only when asked for. With a grouped window it also unlocks each bucket's own
   * `migrations` cells; the filter is required for that split because it bounds the payload
   * (one side fixed is a handful of cells per bucket, the unfiltered matrix would be thousands).
   */
  migrationSource?: string;
  migrationDestination?: string;
}

/**
 * The pools a migration filter may name, oldest first (the order the matrix is read in),
 * derived from `POOL_NAMES`. `multi` is a source only — the matrix files a migration with two
 * or more losing pools under it; a migration has exactly one destination by definition.
 */
export const POOL_MIGRATION_DESTINATIONS: readonly PoolName[] = [...POOL_NAMES].reverse();
export const POOL_MIGRATION_SOURCES: readonly (PoolName | "multi")[] = [
  ...POOL_MIGRATION_DESTINATIONS,
  "multi",
];

/**
 * One bucket of a chain-window aggregate: the whole window when `groupBy` is `none`, one day
 * or one month otherwise.
 *
 * Every field is summable, by design. Fee medians and quartiles are absent because a percentile
 * is not a function of the percentiles beneath it — a seven-day median cannot be built from
 * seven daily medians. Fee distributions come from `explorer_insights`, with their own windows.
 */
export interface ChainWindowBucket {
  /** Unix seconds at the first instant of the bucket. The window's own start when grouped `none`. */
  timestamp: number;
  /** Days with at least one block in them. A bucket has no row for a day the chain was silent. */
  daysCovered: number;
  transparentTxs: number;
  mixedTxs: number;
  shieldedTxs: number;
  /**
   * `mixedTxs` split by which way value crossed the shielded boundary. The three partition it
   * exactly; this relies on `tx.direction` being populated for every confirmed mixed
   * transaction — if that ever stops holding, these become a floor and must say so.
   *
   * `indeterminateTxs` is not a gap: it is the small share of mixed transactions whose pools
   * moved in opposite directions, where naming one direction would be the apportioning
   * `poolMigration` refuses.
   */
  shieldingTxs: number;
  unshieldingTxs: number;
  indeterminateTxs: number;
  blocks: number;
  /** Gross ZEC into the shielded set, in zatoshis. */
  shieldedZat: number;
  /** Gross ZEC out of the shielded set, in zatoshis. */
  unshieldedZat: number;
  /**
   * Fees paid across the bucket's blocks, in zatoshis, with the coverage behind it.
   *
   * A block's fee total is NULL when one of its inputs could not be resolved, and such a block
   * drops out of the sum. `blocksCovered` below `blocks` means the figure is a floor.
   */
  feeZat: number;
  blocksCovered: number;
  /**
   * Mean difficulty and block size over the bucket, weighted by block:
   * `SUM(mean × blocks) / SUM(blocks)`, which equals a scan of every block in the range. An
   * unweighted mean of daily means is a different quantity whenever block production varies.
   *
   * Null where no block in the bucket carries the column. Keep it null: `Number(null)` is 0,
   * and zero difficulty is not a possible measurement.
   */
  avgDifficulty: number | null;
  avgBlockBytes: number | null;
  /**
   * The two crossing counts narrowed to crossings at or above a value floor. Absent unless
   * `ChainWindowFilters.minCrossingZat`/`minCrossingValue` asked for one.
   *
   * A crossing's amount is `abs(ironwood + orchard + sapling + sprout_vpub_net)` — the pools'
   * own published value balances, public by construction.
   *
   *  - `indeterminateTxs` is outside this: its pools moved in opposite directions, so there is
   *    no single amount to compare. These two counts do not partition anything.
   *  - A currency floor excludes a transaction whose day has no stored close, since it was not
   *    measured. `pricedCrossings` below `consideredCrossings` makes the counts a floor.
   *  - Each transaction is valued at its own day's close, never today's price. A ZEC floor has
   *    no such caveat and covers every day including today.
   *  - Zero is a measurement, not an outage.
   *
   * Transparent transactions are not covered at any floor: there is no `tx.public_value_zat`,
   * so their amount lives only in `tx_transparent_io`. That is a limit of this index, not of
   * the chain.
   */
  shieldingTxsOverFloor?: number;
  unshieldingTxsOverFloor?: number;
  /** Crossings in the bucket that could be measured against the floor, and how many there were. */
  pricedCrossings?: number;
  consideredCrossings?: number;
  /**
   * This bucket's own pool-to-pool migration cells for the pair(s) a migration filter named.
   * Present only when a migration filter was given AND the window is grouped; an unfiltered
   * grouped window carries none and stays byte-identical.
   *
   * An empty array on a covered bucket is a measurement — no matching migration that period.
   */
  migrations?: PoolMigrationCell[];
}

/**
 * A window of chain activity, totalled and optionally broken down.
 *
 * `applied` echoes the filters actually applied. A service that ignores an unknown `?from=`
 * answers over all of history with nothing in the numbers to reveal it, so a caller that asked
 * for a window and does not see it echoed must refuse the payload.
 */
export interface ChainWindowAggregate {
  totals: ChainWindowBucket;
  groups: ChainWindowBucket[];
  groupBy: ChainWindowGroupBy;
  applied: ChainWindowFilters;
  /** First and last day carrying data inside the window, or null when it holds none. */
  firstAt: number | null;
  lastAt: number | null;
  /**
   * The shielded pools' closing balances on the window's last covered day — a level, never a
   * sum. Null when the window covers no day at all.
   */
  closingPools: {
    topHeight: number;
    sproutZat: number;
    saplingZat: number;
    orchardZat: number;
    ironwoodZat: number;
  } | null;
  /**
   * How many transactions in the window carried a bundle for each shielded pool.
   *
   *  - They do not sum to the transaction total: one transaction can carry two pools' bundles.
   *    The kind breakdown (`transparentTxs`/`mixedTxs`/`shieldedTxs`) is the partition.
   *  - They count carrying a bundle, not moving value across the pool's boundary: an
   *    Orchard-to-Orchard transfer used Orchard and crossed nothing.
   *  - Null means `poolTxCountsUnavailable` says why; a too-wide window is a cost limit of
   *    ours, not a gap in the data.
   */
  poolTxCounts: PoolTxCounts | null;
  /**
   * Why `poolTxCounts` is null, so a cost limit of ours is never reported as a gap in the
   * index or confused with a window that covers no block. Null when the counts are present.
   */
  poolTxCountsUnavailable: PoolTxCountsUnavailable | null;
  /**
   * Directed pool-to-pool migrations in the window, one entry per (source, destination) pair
   * actually observed — the full matrix.
   *
   * Empty is a real answer: no migration in that window. Null means the day totals have not
   * been built yet, an absence of our data rather than of migrations.
   */
  poolMigrations: PoolMigrationCell[] | null;
}

/** Per-pool transaction counts for a window, with the height range they were counted over. */
export interface PoolTxCounts {
  fromHeight: number;
  toHeight: number;
  sprout: number;
  sapling: number;
  orchard: number;
  ironwood: number;
  /**
   * Transactions carrying no shielded bundle at all — the complement, so the shape is checkable.
   * Null on the `whole-days` basis: the day totals hold one row per pool, so a transaction using
   * no pool has nowhere to be counted there. Unmeasured, never zero.
   */
  transparentOnly: number | null;
  /**
   * Which measurement this is; the two paths differ slightly.
   *
   * `exact-blocks` counts the block range the window resolves to (every window under
   * `POOL_TX_COUNT_MAX_BLOCKS`). `whole-days` sums `chain_day_pool_tx` over the UTC days the
   * window touches, with edges snapped outward to midnight. Required so the label never claims
   * a narrower range than the figure covers.
   */
  basis: "exact-blocks" | "whole-days";
  /** First UTC day summed. Present only on `whole-days`, where the snap is what needs stating. */
  fromDay?: string;
  /** Last UTC day summed, inclusive. Present only on `whole-days`. */
  toDay?: string;
}

/**
 * One directed pool-to-pool migration pair over a window, already priced.
 *
 * A migration is a transaction with no transparent side where exactly one pool gained and at
 * least one lost — `poolMigration`'s definition. Two pools gaining is refused rather than
 * apportioned, and multiple sources are filed under `source: "multi"` rather than split.
 */
export interface PoolMigrationCell {
  /** `sprout` | `sapling` | `orchard` | `ironwood` | `multi` — `multi` is two or more sources. */
  source: string;
  /** The pool that gained. Never `multi`: exactly one destination is the whole definition. */
  destination: string;
  txCount: number;
  amountZat: number;
  /**
   * The window's value in the requested currency, each day valued at its own day's close and
   * reference rate — never one rate across the whole span. Null when no day in the window had
   * a stored close.
   */
  valueText: string | null;
  /** How many of `txCount` fell on a day that had a stored close, so the figure is checkable. */
  pricedTxCount: number;
}

/**
 * Why per-pool counts are absent for a window. `window-too-wide` is a cost limit of ours;
 * `no-blocks` is a measurement — the window covers no block.
 */
export type PoolTxCountsUnavailable = "window-too-wide" | "no-blocks";

/**
 * The widest window counted exactly by block range, in blocks (~200 days). Wider windows use
 * the day totals instead.
 *
 * Measured with the height range resolved through `block_timestamp_idx`: one day 211 ms, one
 * month 348 ms, six months 669 ms, one year 2,526 ms. The cap sits below the jump at a year and
 * admits any half-year (~210,000 blocks, ~0.7–0.8 s). It bounds our query cost, not the data.
 */
export const POOL_TX_COUNT_MAX_BLOCKS = 230_000;

/** Non-coinbase transactions in a bucket. Coinbase is excluded upstream, as everywhere here. */
export function bucketTotalTxs(b: ChainWindowBucket): number {
  return b.transparentTxs + b.mixedTxs + b.shieldedTxs;
}

/**
 * The measures a window's buckets can be ranked by.
 *
 * A closed set of quantities a reader asks superlatives about. Denominators such as
 * `daysCovered` and `blocksCovered` are deliberately excluded.
 *
 * The volume measures name their unit (`zec-*`) because `shielding`/`unshielding` elsewhere
 * name a transaction class; an unqualified name let a count question be answered with a volume.
 * Note `shielded-transactions` (fully shielded, no transparent side) and
 * `shielding-transactions` (transparent into shielded) are different classes.
 */
export type ChainWindowMeasure =
  | "transactions"
  | "shielded-transactions"
  | "shielding-transactions"
  | "unshielding-transactions"
  | "zec-shielded"
  | "zec-unshielded"
  | "fees"
  | "blocks"
  | "block-size"
  | "difficulty";

/**
 * One bucket's value for a measure, or null where the bucket does not carry it.
 *
 * `avgDifficulty` and `avgBlockBytes` may be null, and `Number(null)` is 0 — in an ascending
 * ranking every unmeasured bucket would win. Callers must drop nulls, never coerce them.
 */
export function bucketMeasure(b: ChainWindowBucket, measure: ChainWindowMeasure): number | null {
  switch (measure) {
    case "transactions":
      return bucketTotalTxs(b);
    case "shielded-transactions":
      return b.shieldedTxs;
    case "shielding-transactions":
      return b.shieldingTxs;
    case "unshielding-transactions":
      return b.unshieldingTxs;
    case "zec-shielded":
      return b.shieldedZat;
    case "zec-unshielded":
      return b.unshieldedZat;
    case "fees":
      return b.feeZat;
    case "blocks":
      return b.blocks;
    case "block-size":
      return b.avgBlockBytes;
    case "difficulty":
      return b.avgDifficulty;
  }
}

export interface RankedBuckets {
  measure: ChainWindowMeasure;
  order: "highest" | "lowest";
  /** The top `limit` buckets, best first. Never longer than `limit`. */
  ranked: ChainWindowBucket[];
  /** Buckets that carried a value for the measure and so could be ranked at all. */
  considered: number;
  /**
   * Buckets dropped because the measure is null for them — unmeasured, never zero. Reported
   * because a ranking over part of a window is a different claim from one over all of it.
   */
  unmeasured: number;
  /**
   * How many buckets share the winning value. Above 1 there is no single winner, so a record
   * is a figure plus a count, never a name. Zero when nothing could be ranked.
   */
  tiedAtTop: number;
}

/**
 * Rank a window's buckets by one measure — the answer to every superlative about a period.
 *
 * Callers pass every bucket in the window and cap afterwards, so "the busiest day of 2019" is
 * a fact about all 365 days rather than whichever slice survived a display cap.
 *
 * Ties are broken by timestamp, oldest first, purely for determinism; `tiedAtTop` is what
 * reports a tie, and the tiebreak order carries no meaning.
 */
export function rankBuckets(
  buckets: readonly ChainWindowBucket[],
  measure: ChainWindowMeasure,
  order: "highest" | "lowest",
  limit: number,
): RankedBuckets {
  const measured: { bucket: ChainWindowBucket; value: number }[] = [];
  let unmeasured = 0;
  for (const bucket of buckets) {
    const value = bucketMeasure(bucket, measure);
    if (value === null) unmeasured += 1;
    else measured.push({ bucket, value });
  }
  measured.sort((a, b) =>
    a.value === b.value
      ? a.bucket.timestamp - b.bucket.timestamp
      : order === "highest"
        ? b.value - a.value
        : a.value - b.value,
  );
  const best = measured[0];
  return {
    measure,
    order,
    ranked: measured.slice(0, Math.max(0, limit)).map((m) => m.bucket),
    considered: measured.length,
    unmeasured,
    tiedAtTop: best === undefined ? 0 : measured.filter((m) => m.value === best.value).length,
  };
}

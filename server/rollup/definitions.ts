/**
 * The rollup tables: the chain's per-day and per-month series and its all-time figures.
 *
 * Each was a materialized view refreshed by re-scanning all of `tx` or `block`. A period's rows
 * depend only on that period's rows of `tx`/`block`, so each is now a table recomputed one period
 * at a time (`pass.ts`): the SELECT below is the view's own SELECT with a window on the source's
 * `timestamp`, and the same text serves the incremental pass and the full rebuild, so the two
 * cannot drift. `server/__tests__/rollup-equality.test.ts` holds every table equal to the frozen
 * view definitions (`__tests__/support/legacy-rollup-matviews.sql`).
 *
 * `$1`/`$2` bound a window `[lo, hi)` in unix seconds that is always a union of whole UTC periods
 * of the table's grain. Every caller pins `TimeZone = 'UTC'`, because `date_trunc` on a
 * timestamptz truncates in the session's zone.
 *
 * `{name}` in a SELECT is a dependency on another rollup table, replaced by the relation that
 * currently holds it (see `targets.ts`).
 *
 * Order matters: a table is computed after the tables it reads.
 */

export type RollupGrain = "day" | "month" | "all";

export interface RollupTable {
  /** The relation readers query. */
  readonly name: string;
  readonly grain: RollupGrain;
  /**
   * How a period is keyed, for the DELETE that precedes its recompute: `ts` is the period's start
   * in unix seconds, `day` its UTC date. `null` for the all-time tables, which are rewritten whole.
   */
  readonly key: "ts" | "day" | null;
  /** In table order, which is the matview's (readers `SELECT *`). */
  readonly columns: readonly string[];
  readonly select: string;
  /**
   * A table that replaced a materialized view of the same name. Until the swap, production holds
   * the view under this name and the table as `<name>_next`. Helpers never had a view.
   */
  readonly replacesView: boolean;
}

/** `date` of a unix timestamp, in UTC. */
const UTC_DAY = (column: string) => `(to_timestamp(${column}) AT TIME ZONE 'UTC')::date`;

/** The window on a source table's `timestamp`. */
const windowOn = (column = "timestamp") => `${column} >= $1::bigint AND ${column} < $2::bigint`;
const WINDOW = windowOn();

const POOL_CLOSES = `COALESCE(sprout_pool_zat, 0)   AS sprout,
           COALESCE(sapling_pool_zat, 0)  AS sapling,
           COALESCE(orchard_pool_zat, 0)  AS orchard,
           COALESCE(ironwood_pool_zat, 0) AS ironwood`;

/*
 * Activity counts and closing pool balances per UTC day. Coinbase is excluded from the counts at
 * ingest. Closing balances via DISTINCT ON ... height DESC, never max(): a pool can fall within a
 * day.
 */
const DAY_ROLLUP = `
  WITH counts AS (
    SELECT date_trunc('day', to_timestamp(timestamp)) AS d,
           SUM(transparent_tx_count)::int AS transparent,
           SUM(mixed_tx_count)::int       AS mixed,
           SUM(shielded_tx_count)::int    AS shielded
      FROM block
     WHERE ${WINDOW}
     GROUP BY 1
  ),
  closing AS (
    SELECT DISTINCT ON (date_trunc('day', to_timestamp(timestamp)))
           date_trunc('day', to_timestamp(timestamp)) AS d,
           height,
           ${POOL_CLOSES}
      FROM block
     WHERE ${WINDOW}
     ORDER BY date_trunc('day', to_timestamp(timestamp)), height DESC
  )
  SELECT EXTRACT(EPOCH FROM counts.d)::bigint AS ts,
         closing.height AS top_height,
         counts.transparent, counts.mixed, counts.shielded,
         closing.sprout, closing.sapling, closing.orchard, closing.ironwood
    FROM counts JOIN closing USING (d)`;

/*
 * Gross shielding flow: what crossed the privacy boundary, both directions, summed from each
 * transaction's own value balances (a pool total yields only the net). Value balances are domain
 * sign; `sprout_vpub_net_zat` is RPC sign, hence subtracted. Coinbase is issuance, not a choice of
 * privacy.
 */
const DAY_SHIELDING_FLOW = `
  WITH per_tx AS (
    SELECT date_trunc('day', to_timestamp(timestamp)) AS d,
           COALESCE(sapling_value_balance_zat, 0)
         + COALESCE(orchard_value_balance_zat, 0)
         + COALESCE(ironwood_value_balance_zat, 0)
         - COALESCE(sprout_vpub_net_zat, 0) AS net_in
      FROM tx
     WHERE kind <> 'coinbase' AND block_height IS NOT NULL AND ${WINDOW}
  )
  SELECT EXTRACT(EPOCH FROM d)::bigint                               AS ts,
         COALESCE(SUM(net_in) FILTER (WHERE net_in > 0), 0)::bigint  AS shielded_zat,
         COALESCE(-SUM(net_in) FILTER (WHERE net_in < 0), 0)::bigint AS unshielded_zat
    FROM per_tx
   GROUP BY d`;

/** Fee percentiles by kind, never means: one fat-finger fee must not move the line. */
const feeKind = (grain: "day" | "month") => `
  SELECT EXTRACT(EPOCH FROM date_trunc('${grain}', to_timestamp(timestamp)))::bigint AS ts,
         kind,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY fee_zat)::bigint AS median_zat,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY fee_zat)::bigint AS p25_zat,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY fee_zat)::bigint AS p75_zat,
         count(fee_zat)::int AS txs
    FROM tx
   WHERE kind <> 'coinbase' AND fee_zat IS NOT NULL AND block_height IS NOT NULL AND ${WINDOW}
   GROUP BY 1, 2`;

/** The network's fee bill per day, with its coverage: a block's total is NULL when unknowable. */
const DAY_FEE_TOTAL = `
  SELECT EXTRACT(EPOCH FROM date_trunc('day', to_timestamp(timestamp)))::bigint AS ts,
         COALESCE(SUM(total_fee_zat), 0)::bigint AS fee_zat,
         COUNT(*)::int                          AS blocks,
         COUNT(total_fee_zat)::int              AS blocks_covered
    FROM block
   WHERE ${WINDOW}
   GROUP BY 1`;

/*
 * Daily mean difficulty and block size. The view summed `difficulty` in whatever order its plan
 * read the rows; a float mean's last bits depend on that order, so it is fixed here (height).
 */
const DAY_NETWORK = `
  SELECT EXTRACT(EPOCH FROM date_trunc('day', to_timestamp(timestamp)))::bigint AS ts,
         AVG(difficulty ORDER BY height)  AS avg_difficulty,
         AVG(size_bytes)                  AS avg_block_bytes,
         COUNT(*)::int                    AS blocks
    FROM block
   WHERE ${WINDOW}
   GROUP BY 1`;

/*
 * The directed pool-to-pool migration matrix: `poolMigration` (src/domain/pool.ts) at day grain.
 * A second copy of `POOL_MIGRATION_MATRIX_SQL` (server/analytics-routes.ts), held to it by
 * `pool-matview-agreement.test.ts`.
 */
const DAY_POOL_MIGRATION = `
  WITH m AS (
    SELECT timestamp AS ts,
           COALESCE(ironwood_value_balance_zat, 0) AS iw,
           COALESCE(orchard_value_balance_zat, 0)  AS oc,
           COALESCE(sapling_value_balance_zat, 0)  AS sa,
           -COALESCE(sprout_vpub_net_zat, 0)       AS sr
      FROM tx
     WHERE block_height IS NOT NULL
       AND kind = 'shielded'
       AND ${WINDOW}
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
  SELECT ${UTC_DAY("mm.ts")}                                       AS day,
         mm.dest                                                   AS destination,
         CASE WHEN mm.nsrc > 1 THEN 'multi' ELSE mm.single_src END AS source,
         COUNT(*)                                                  AS txs,
         SUM(mm.amt)::bigint                                       AS zat
    FROM mm
   GROUP BY 1, 2, 3`;

/*
 * Per-pool transaction counts and gross value flow. `txs` counts transactions that used the pool,
 * not crossings. Sprout's flow is its public JoinSplit value, negated into domain sign.
 */
const DAY_POOL_TX = `
  WITH per_tx AS (
    SELECT ${UTC_DAY("t.timestamp")} AS day,
           pool.name AS pool,
           pool.bal  AS bal,
           pool.used AS used
      FROM tx t
      CROSS JOIN LATERAL (VALUES
        ('sprout',
         -COALESCE(t.sprout_vpub_net_zat, 0),
         COALESCE(t.sprout_joinsplits, 0) > 0),
        ('sapling',
         COALESCE(t.sapling_value_balance_zat, 0),
         COALESCE(t.sapling_spends, 0) > 0 OR COALESCE(t.sapling_outputs, 0) > 0),
        ('orchard',
         COALESCE(t.orchard_value_balance_zat, 0),
         COALESCE(t.orchard_actions, 0) > 0),
        ('ironwood',
         COALESCE(t.ironwood_value_balance_zat, 0),
         COALESCE(t.ironwood_actions, 0) > 0)
      ) AS pool(name, bal, used)
     WHERE t.block_height IS NOT NULL
       AND ${windowOn("t.timestamp")}
  )
  SELECT day,
         pool,
         COUNT(*) FILTER (WHERE used)                                       AS txs,
         COALESCE(SUM(bal) FILTER (WHERE used AND bal > 0), 0)::bigint      AS value_in_zat,
         COALESCE(SUM(-bal) FILTER (WHERE used AND bal < 0), 0)::bigint     AS value_out_zat
    FROM per_tx
   GROUP BY 1, 2
  HAVING COUNT(*) FILTER (WHERE used) > 0`;

/*
 * The shielded boundary per (day, pool) plus one 'hub' row per day: the SQL twin of
 * `boundaryCrossing` (src/domain/classify.ts), held to it by `pulse-matview-agreement.test.ts`.
 * A mixed row follows its stored direction only while no published pool contradicts it;
 * indeterminate or not-yet-backfilled directions are hub rows. Sprout is never part of the
 * contradiction test (it publishes no per-bundle balance). Presence is tested on the bundle
 * column, never on the balance.
 */
const DAY_POOL_BOUNDARY = `
  WITH per_tx AS (
    SELECT ${UTC_DAY("t.timestamp")} AS day,
           t.kind,
           t.direction,
           t.sprout_joinsplits,
           t.sapling_spends,
           t.orchard_actions,
           t.ironwood_actions,
           COALESCE(t.ironwood_value_balance_zat, 0) AS iw,
           COALESCE(t.orchard_value_balance_zat, 0)  AS oc,
           COALESCE(t.sapling_value_balance_zat, 0)  AS sa,
           -COALESCE(t.sprout_vpub_net_zat, 0)       AS sr
      FROM tx t
     WHERE t.block_height IS NOT NULL
       AND t.kind IN ('mixed', 'coinbase')
       AND ${windowOn("t.timestamp")}
  ),
  filed AS (
    SELECT p.*,
           CASE
             WHEN p.kind = 'coinbase' THEN 'coinbase'
             WHEN p.direction = 'shielding'   AND NOT (p.iw < 0 OR p.oc < 0 OR p.sa < 0)
               THEN 'shielding'
             WHEN p.direction = 'unshielding' AND NOT (p.iw > 0 OR p.oc > 0 OR p.sa > 0)
               THEN 'unshielding'
             ELSE 'hub'
           END AS bucket
      FROM per_tx p
  ),
  legs AS (
    SELECT f.day, f.bucket, pool.name AS pool, abs(pool.bal) AS amt
      FROM filed f
      CROSS JOIN LATERAL (VALUES
        ('sprout',   f.sr, f.sprout_joinsplits IS NOT NULL),
        ('sapling',  f.sa, f.sapling_spends    IS NOT NULL),
        ('orchard',  f.oc, f.orchard_actions   IS NOT NULL),
        ('ironwood', f.iw, f.ironwood_actions  IS NOT NULL)
      ) AS pool(name, bal, present)
     WHERE pool.present AND pool.bal <> 0
  )
  SELECT day,
         pool,
         COALESCE(SUM(amt) FILTER (WHERE bucket = 'shielding'), 0)::bigint    AS shielded_zat,
         COUNT(*) FILTER (WHERE bucket = 'shielding')::bigint                 AS shielded_txs,
         COALESCE(SUM(amt) FILTER (WHERE bucket = 'unshielding'), 0)::bigint  AS unshielded_zat,
         COUNT(*) FILTER (WHERE bucket = 'unshielding')::bigint               AS unshielded_txs,
         COALESCE(SUM(amt) FILTER (WHERE bucket = 'coinbase'), 0)::bigint     AS coinbase_zat,
         COUNT(*) FILTER (WHERE bucket = 'coinbase')::bigint                  AS coinbase_txs,
         0::bigint                                                            AS hub_zat,
         0::bigint                                                            AS hub_txs
    FROM legs
   GROUP BY 1, 2
  UNION ALL
  SELECT day,
         'hub'                                                  AS pool,
         0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
         SUM(abs(iw) + abs(oc) + abs(sa) + abs(sr))::bigint     AS hub_zat,
         COUNT(*)::bigint                                       AS hub_txs
    FROM filed
   WHERE bucket = 'hub'
   GROUP BY 1`;

/*
 * The six value-pool closes at each UTC day's last block, NULLs kept: the mined edge is a
 * difference of closes, and `issuanceZatBetween` refuses an answer with one absent.
 */
const DAY_SUPPLY_CLOSE = `
  SELECT DISTINCT ON (${UTC_DAY("timestamp")})
         ${UTC_DAY("timestamp")} AS day,
         height AS top_height,
         hash,
         prev_hash,
         timestamp,
         received_at,
         transparent_pool_zat,
         sprout_pool_zat,
         sapling_pool_zat,
         orchard_pool_zat,
         ironwood_pool_zat,
         lockbox_pool_zat
    FROM block
   WHERE ${WINDOW}
   ORDER BY ${UTC_DAY("timestamp")}, height DESC`;

/** Mined transactions per day and kind, summed into `chain_tx_kind_count`. */
const DAY_TX_KIND_COUNT = `
  SELECT ${UTC_DAY("timestamp")} AS day, kind, count(*)::bigint AS txs
    FROM tx
   WHERE block_height IS NOT NULL AND ${WINDOW}
   GROUP BY 1, 2`;

/** Mixed transactions per day and stored direction, summed into `chain_tx_mixed_direction_count`. */
const DAY_TX_DIRECTION_COUNT = `
  SELECT ${UTC_DAY("timestamp")} AS day, direction, count(*)::bigint AS txs
    FROM tx
   WHERE kind = 'mixed' AND block_height IS NOT NULL AND direction IS NOT NULL AND ${WINDOW}
   GROUP BY 1, 2`;

/*
 * Each day's fee extremes with their tie counts, the lowest txid/height among the ties at the
 * maximum, and the same for the lowest non-zero fee: the per-day parts `chain_fee_extremes` and
 * `chain_fee_nonzero_floor` combine. Minima, maxima, counts and minimum ids all combine exactly
 * across disjoint days. Coinbase is excluded: it collects fees, it does not pay one. A block's id
 * is its height as text, as the views had it, so ids compare as text in both.
 */
const feeBounds = (scope: "transaction" | "block") => {
  const rows =
    scope === "transaction"
      ? `SELECT ${UTC_DAY("timestamp")} AS day, fee_zat AS fee, txid AS id, block_height AS height
           FROM tx
          WHERE kind <> 'coinbase' AND fee_zat IS NOT NULL AND block_height IS NOT NULL
            AND ${WINDOW}`
      : `SELECT ${UTC_DAY("timestamp")} AS day, total_fee_zat AS fee, height::text AS id, height
           FROM block
          WHERE total_fee_zat IS NOT NULL AND ${WINDOW}`;
  return `(
  WITH f AS (${rows}),
  b AS (
    SELECT day, min(fee) AS lo, max(fee) AS hi, min(fee) FILTER (WHERE fee > 0) AS nz_lo
      FROM f GROUP BY day
  )
  SELECT f.day,
         '${scope}'::text                                   AS scope,
         count(*)::bigint                                   AS considered,
         b.lo,
         count(*) FILTER (WHERE f.fee = b.lo)::bigint       AS lo_count,
         b.hi,
         count(*) FILTER (WHERE f.fee = b.hi)::bigint       AS hi_count,
         min(f.id) FILTER (WHERE f.fee = b.hi)              AS hi_id,
         min(f.height) FILTER (WHERE f.fee = b.hi)          AS hi_height,
         count(*) FILTER (WHERE f.fee > 0)::bigint          AS nz_considered,
         b.nz_lo,
         count(*) FILTER (WHERE f.fee = b.nz_lo)::bigint    AS nz_lo_count,
         min(f.id) FILTER (WHERE f.fee = b.nz_lo)           AS nz_lo_id,
         min(f.height) FILTER (WHERE f.fee = b.nz_lo)       AS nz_lo_height
    FROM f JOIN b USING (day)
   GROUP BY f.day, b.lo, b.hi, b.nz_lo)`;
};

/*
 * A month is a union of whole UTC days, so its counts are sums of the day sums, and its closing
 * row is the day row with the highest top block. The day table is computed first in the same
 * transaction.
 */
const MONTH_ROLLUP = `
  WITH d AS (
    SELECT date_trunc('month', to_timestamp(ts)) AS m, *
      FROM {chain_day_rollup}
     WHERE ts >= $1::bigint AND ts < $2::bigint
  ),
  counts AS (
    SELECT m, SUM(transparent)::int AS transparent, SUM(mixed)::int AS mixed,
           SUM(shielded)::int AS shielded
      FROM d GROUP BY m
  ),
  closing AS (
    SELECT DISTINCT ON (m) m, top_height, sprout, sapling, orchard, ironwood
      FROM d ORDER BY m, top_height DESC
  )
  SELECT EXTRACT(EPOCH FROM counts.m)::bigint AS ts,
         closing.top_height,
         counts.transparent, counts.mixed, counts.shielded,
         closing.sprout, closing.sapling, closing.orchard, closing.ironwood
    FROM counts JOIN closing USING (m)`;

/** Sums of per-transaction positives and negatives, so a month is the sum of its days. */
const MONTH_SHIELDING_FLOW = `
  SELECT EXTRACT(EPOCH FROM date_trunc('month', to_timestamp(ts)))::bigint AS ts,
         SUM(shielded_zat)::bigint   AS shielded_zat,
         SUM(unshielded_zat)::bigint AS unshielded_zat
    FROM {chain_day_shielding_flow}
   WHERE ts >= $1::bigint AND ts < $2::bigint
   GROUP BY 1`;

const KIND_COUNT = `
  SELECT kind, SUM(txs)::bigint AS txs FROM chain_day_tx_kind_count GROUP BY kind`;

const DIRECTION_COUNT = `
  SELECT direction, SUM(txs)::bigint AS txs FROM chain_day_tx_direction_count GROUP BY direction`;

/*
 * All-time extremes from the per-day bounds. No row for a scope with nothing to consider, as the
 * view (a GROUP BY over zero rows) had none.
 */
const FEE_EXTREMES = `
  WITH g AS (
    SELECT scope, min(lo) AS lo, max(hi) AS hi, SUM(considered)::bigint AS considered
      FROM chain_day_fee_bounds GROUP BY scope
  )
  SELECT g.scope,
         g.lo                                                   AS lowest_zat,
         SUM(d.lo_count) FILTER (WHERE d.lo = g.lo)::bigint     AS lowest_count,
         g.hi                                                   AS highest_zat,
         SUM(d.hi_count) FILTER (WHERE d.hi = g.hi)::bigint     AS highest_count,
         min(d.hi_id) FILTER (WHERE d.hi = g.hi)                AS highest_id,
         min(d.hi_height) FILTER (WHERE d.hi = g.hi)            AS highest_height,
         g.considered
    FROM chain_day_fee_bounds d JOIN g USING (scope)
   GROUP BY g.scope, g.lo, g.hi, g.considered`;

const FEE_NONZERO_FLOOR = `
  WITH g AS (
    SELECT scope, min(nz_lo) AS lo, SUM(nz_considered)::bigint AS considered
      FROM chain_day_fee_bounds GROUP BY scope
    HAVING SUM(nz_considered) > 0
  )
  SELECT g.scope,
         g.lo                                                         AS lowest_zat,
         SUM(d.nz_lo_count) FILTER (WHERE d.nz_lo = g.lo)::bigint     AS lowest_count,
         min(d.nz_lo_id) FILTER (WHERE d.nz_lo = g.lo)                AS lowest_id,
         min(d.nz_lo_height) FILTER (WHERE d.nz_lo = g.lo)            AS lowest_height,
         g.considered
    FROM chain_day_fee_bounds d JOIN g USING (scope)
   GROUP BY g.scope, g.lo, g.considered`;

const FEE_BOUNDS_COLUMNS = [
  "day",
  "scope",
  "considered",
  "lo",
  "lo_count",
  "hi",
  "hi_count",
  "hi_id",
  "hi_height",
  "nz_considered",
  "nz_lo",
  "nz_lo_count",
  "nz_lo_id",
  "nz_lo_height",
] as const;

const ROLLUP_COLUMNS = [
  "ts",
  "top_height",
  "transparent",
  "mixed",
  "shielded",
  "sprout",
  "sapling",
  "orchard",
  "ironwood",
] as const;
const FLOW_COLUMNS = ["ts", "shielded_zat", "unshielded_zat"] as const;
const FEE_KIND_COLUMNS = ["ts", "kind", "median_zat", "p25_zat", "p75_zat", "txs"] as const;

export const ROLLUP_TABLES: readonly RollupTable[] = [
  // Day grain, from `block`.
  {
    name: "chain_day_rollup",
    grain: "day",
    key: "ts",
    columns: ROLLUP_COLUMNS,
    select: DAY_ROLLUP,
    replacesView: true,
  },
  {
    name: "chain_day_fee_total",
    grain: "day",
    key: "ts",
    columns: ["ts", "fee_zat", "blocks", "blocks_covered"],
    select: DAY_FEE_TOTAL,
    replacesView: true,
  },
  {
    name: "chain_day_network",
    grain: "day",
    key: "ts",
    columns: ["ts", "avg_difficulty", "avg_block_bytes", "blocks"],
    select: DAY_NETWORK,
    replacesView: true,
  },
  {
    name: "chain_day_supply_close",
    grain: "day",
    key: "day",
    columns: [
      "day",
      "top_height",
      "hash",
      "prev_hash",
      "timestamp",
      "received_at",
      "transparent_pool_zat",
      "sprout_pool_zat",
      "sapling_pool_zat",
      "orchard_pool_zat",
      "ironwood_pool_zat",
      "lockbox_pool_zat",
    ],
    select: DAY_SUPPLY_CLOSE,
    replacesView: true,
  },
  // Day grain, from `tx`.
  {
    name: "chain_day_shielding_flow",
    grain: "day",
    key: "ts",
    columns: FLOW_COLUMNS,
    select: DAY_SHIELDING_FLOW,
    replacesView: true,
  },
  {
    name: "chain_day_fee_kind",
    grain: "day",
    key: "ts",
    columns: FEE_KIND_COLUMNS,
    select: feeKind("day"),
    replacesView: true,
  },
  {
    name: "chain_day_pool_tx",
    grain: "day",
    key: "day",
    columns: ["day", "pool", "txs", "value_in_zat", "value_out_zat"],
    select: DAY_POOL_TX,
    replacesView: true,
  },
  {
    name: "chain_day_pool_migration",
    grain: "day",
    key: "day",
    columns: ["day", "destination", "source", "txs", "zat"],
    select: DAY_POOL_MIGRATION,
    replacesView: true,
  },
  {
    name: "chain_day_pool_boundary",
    grain: "day",
    key: "day",
    columns: [
      "day",
      "pool",
      "shielded_zat",
      "shielded_txs",
      "unshielded_zat",
      "unshielded_txs",
      "coinbase_zat",
      "coinbase_txs",
      "hub_zat",
      "hub_txs",
    ],
    select: DAY_POOL_BOUNDARY,
    replacesView: true,
  },
  // Day helpers the all-time tables combine.
  {
    name: "chain_day_tx_kind_count",
    grain: "day",
    key: "day",
    columns: ["day", "kind", "txs"],
    select: DAY_TX_KIND_COUNT,
    replacesView: false,
  },
  {
    name: "chain_day_tx_direction_count",
    grain: "day",
    key: "day",
    columns: ["day", "direction", "txs"],
    select: DAY_TX_DIRECTION_COUNT,
    replacesView: false,
  },
  {
    name: "chain_day_fee_bounds",
    grain: "day",
    key: "day",
    columns: FEE_BOUNDS_COLUMNS,
    select: `${feeBounds("transaction")}\n  UNION ALL\n  ${feeBounds("block")}`,
    replacesView: false,
  },
  // Month grain, after the days they are derived from.
  {
    name: "chain_month_rollup",
    grain: "month",
    key: "ts",
    columns: ROLLUP_COLUMNS,
    select: MONTH_ROLLUP,
    replacesView: true,
  },
  {
    name: "chain_month_shielding_flow",
    grain: "month",
    key: "ts",
    columns: FLOW_COLUMNS,
    select: MONTH_SHIELDING_FLOW,
    replacesView: true,
  },
  {
    name: "chain_month_fee_kind",
    grain: "month",
    key: "ts",
    columns: FEE_KIND_COLUMNS,
    select: feeKind("month"),
    replacesView: true,
  },
  // All time, from the day helpers.
  {
    name: "chain_tx_kind_count",
    grain: "all",
    key: null,
    columns: ["kind", "txs"],
    select: KIND_COUNT,
    replacesView: true,
  },
  {
    name: "chain_tx_mixed_direction_count",
    grain: "all",
    key: null,
    columns: ["direction", "txs"],
    select: DIRECTION_COUNT,
    replacesView: true,
  },
  {
    name: "chain_fee_extremes",
    grain: "all",
    key: null,
    columns: [
      "scope",
      "lowest_zat",
      "lowest_count",
      "highest_zat",
      "highest_count",
      "highest_id",
      "highest_height",
      "considered",
    ],
    select: FEE_EXTREMES,
    replacesView: true,
  },
  {
    name: "chain_fee_nonzero_floor",
    grain: "all",
    key: null,
    columns: ["scope", "lowest_zat", "lowest_count", "lowest_id", "lowest_height", "considered"],
    select: FEE_NONZERO_FLOOR,
    replacesView: true,
  },
];

/** The names that replaced a materialized view: the swap, the check and the readers' set. */
export const ROLLUP_VIEW_NAMES: readonly string[] = ROLLUP_TABLES.filter((t) => t.replacesView).map(
  (t) => t.name,
);

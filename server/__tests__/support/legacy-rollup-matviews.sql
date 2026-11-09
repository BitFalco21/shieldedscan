-- The 16 rollup materialized views exactly as production defines them, frozen from
-- server/schema-chain.sql before they became incrementally maintained tables. Test oracle only:
-- the equality tests evaluate these definitions from scratch and compare every rollup table with
-- them. Never applied by the follower, and never to be edited: it is the "before".

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_month_rollup AS
  WITH counts AS (
    SELECT date_trunc('month', to_timestamp(timestamp)) AS m,
           SUM(transparent_tx_count)::int AS transparent,
           SUM(mixed_tx_count)::int       AS mixed,
           SUM(shielded_tx_count)::int    AS shielded
      FROM block GROUP BY 1
  ),
  closing AS (
    SELECT DISTINCT ON (date_trunc('month', to_timestamp(timestamp)))
           date_trunc('month', to_timestamp(timestamp)) AS m,
           height,
           COALESCE(sprout_pool_zat, 0)   AS sprout,
           COALESCE(sapling_pool_zat, 0)  AS sapling,
           COALESCE(orchard_pool_zat, 0)  AS orchard,
           COALESCE(ironwood_pool_zat, 0) AS ironwood
      FROM block
     ORDER BY date_trunc('month', to_timestamp(timestamp)), height DESC
  )
  SELECT EXTRACT(EPOCH FROM counts.m)::bigint AS ts,
         closing.height AS top_height,
         counts.transparent, counts.mixed, counts.shielded,
         closing.sprout, closing.sapling, closing.orchard, closing.ironwood
    FROM counts JOIN closing USING (m)
   ORDER BY counts.m;

CREATE UNIQUE INDEX IF NOT EXISTS chain_month_rollup_ts_idx ON chain_month_rollup (ts);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_month_shielding_flow AS
  WITH per_tx AS (
    SELECT date_trunc('month', to_timestamp(timestamp)) AS m,
           COALESCE(sapling_value_balance_zat, 0)
         + COALESCE(orchard_value_balance_zat, 0)
         + COALESCE(ironwood_value_balance_zat, 0)
         - COALESCE(sprout_vpub_net_zat, 0) AS net_in
      FROM tx
     WHERE kind <> 'coinbase' AND block_height IS NOT NULL
  )
  SELECT EXTRACT(EPOCH FROM m)::bigint                        AS ts,
         COALESCE(SUM(net_in) FILTER (WHERE net_in > 0), 0)::bigint  AS shielded_zat,
         COALESCE(-SUM(net_in) FILTER (WHERE net_in < 0), 0)::bigint AS unshielded_zat
    FROM per_tx
   GROUP BY m
   ORDER BY m;

CREATE UNIQUE INDEX IF NOT EXISTS chain_month_shielding_flow_ts_idx
  ON chain_month_shielding_flow (ts);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_month_fee_kind AS
  SELECT EXTRACT(EPOCH FROM date_trunc('month', to_timestamp(timestamp)))::bigint AS ts,
         kind,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY fee_zat)::bigint AS median_zat,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY fee_zat)::bigint AS p25_zat,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY fee_zat)::bigint AS p75_zat,
         count(fee_zat)::int AS txs
    FROM tx
   WHERE kind <> 'coinbase' AND fee_zat IS NOT NULL AND block_height IS NOT NULL
   GROUP BY 1, 2
   ORDER BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS chain_month_fee_kind_idx
  ON chain_month_fee_kind (ts, kind);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_tx_kind_count AS
  SELECT kind, count(*)::bigint AS txs
    FROM tx
   WHERE block_height IS NOT NULL
   GROUP BY kind
   ORDER BY kind;

CREATE UNIQUE INDEX IF NOT EXISTS chain_tx_kind_count_idx ON chain_tx_kind_count (kind);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_tx_mixed_direction_count AS
  SELECT direction, count(*)::bigint AS txs
    FROM tx
   WHERE kind = 'mixed' AND block_height IS NOT NULL AND direction IS NOT NULL
   GROUP BY direction
   ORDER BY direction;

CREATE UNIQUE INDEX IF NOT EXISTS chain_tx_mixed_direction_count_idx
  ON chain_tx_mixed_direction_count (direction);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_day_rollup AS
  WITH counts AS (
    SELECT date_trunc('day', to_timestamp(timestamp)) AS d,
           SUM(transparent_tx_count)::int AS transparent,
           SUM(mixed_tx_count)::int       AS mixed,
           SUM(shielded_tx_count)::int    AS shielded
      FROM block GROUP BY 1
  ),
  closing AS (
    SELECT DISTINCT ON (date_trunc('day', to_timestamp(timestamp)))
           date_trunc('day', to_timestamp(timestamp)) AS d,
           height,
           COALESCE(sprout_pool_zat, 0)   AS sprout,
           COALESCE(sapling_pool_zat, 0)  AS sapling,
           COALESCE(orchard_pool_zat, 0)  AS orchard,
           COALESCE(ironwood_pool_zat, 0) AS ironwood
      FROM block
     ORDER BY date_trunc('day', to_timestamp(timestamp)), height DESC
  )
  SELECT EXTRACT(EPOCH FROM counts.d)::bigint AS ts,
         closing.height AS top_height,
         counts.transparent, counts.mixed, counts.shielded,
         closing.sprout, closing.sapling, closing.orchard, closing.ironwood
    FROM counts JOIN closing USING (d)
   ORDER BY counts.d;

CREATE UNIQUE INDEX IF NOT EXISTS chain_day_rollup_ts_idx ON chain_day_rollup (ts);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_day_shielding_flow AS
  WITH per_tx AS (
    SELECT date_trunc('day', to_timestamp(timestamp)) AS d,
           COALESCE(sapling_value_balance_zat, 0)
         + COALESCE(orchard_value_balance_zat, 0)
         + COALESCE(ironwood_value_balance_zat, 0)
         - COALESCE(sprout_vpub_net_zat, 0) AS net_in
      FROM tx
     WHERE kind <> 'coinbase' AND block_height IS NOT NULL
  )
  SELECT EXTRACT(EPOCH FROM d)::bigint                        AS ts,
         COALESCE(SUM(net_in) FILTER (WHERE net_in > 0), 0)::bigint  AS shielded_zat,
         COALESCE(-SUM(net_in) FILTER (WHERE net_in < 0), 0)::bigint AS unshielded_zat
    FROM per_tx
   GROUP BY d
   ORDER BY d;

CREATE UNIQUE INDEX IF NOT EXISTS chain_day_shielding_flow_ts_idx
  ON chain_day_shielding_flow (ts);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_day_fee_kind AS
  SELECT EXTRACT(EPOCH FROM date_trunc('day', to_timestamp(timestamp)))::bigint AS ts,
         kind,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY fee_zat)::bigint AS median_zat,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY fee_zat)::bigint AS p25_zat,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY fee_zat)::bigint AS p75_zat,
         count(fee_zat)::int AS txs
    FROM tx
   WHERE kind <> 'coinbase' AND fee_zat IS NOT NULL AND block_height IS NOT NULL
   GROUP BY 1, 2
   ORDER BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS chain_day_fee_kind_idx
  ON chain_day_fee_kind (ts, kind);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_day_fee_total AS
  SELECT EXTRACT(EPOCH FROM date_trunc('day', to_timestamp(timestamp)))::bigint AS ts,
         COALESCE(SUM(total_fee_zat), 0)::bigint AS fee_zat,
         COUNT(*)::int                          AS blocks,
         COUNT(total_fee_zat)::int              AS blocks_covered
    FROM block
   GROUP BY 1
   ORDER BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS chain_day_fee_total_ts_idx ON chain_day_fee_total (ts);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_day_pool_migration AS
  WITH m AS (
    SELECT timestamp AS ts,
           COALESCE(ironwood_value_balance_zat, 0) AS iw,
           COALESCE(orchard_value_balance_zat, 0)  AS oc,
           COALESCE(sapling_value_balance_zat, 0)  AS sa,
           -COALESCE(sprout_vpub_net_zat, 0)       AS sr
      FROM tx
     WHERE block_height IS NOT NULL
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
  SELECT (to_timestamp(mm.ts) AT TIME ZONE 'UTC')::date            AS day,
         mm.dest                                                   AS destination,
         CASE WHEN mm.nsrc > 1 THEN 'multi' ELSE mm.single_src END AS source,
         COUNT(*)                                                  AS txs,
         SUM(mm.amt)::bigint                                       AS zat
    FROM mm
   GROUP BY 1, 2, 3
  WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS chain_day_pool_migration_key_idx
  ON chain_day_pool_migration (day, destination, source);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_day_pool_tx AS
  WITH per_tx AS (
    SELECT (to_timestamp(t.timestamp) AT TIME ZONE 'UTC')::date AS day,
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
  )
  SELECT day,
         pool,
         COUNT(*) FILTER (WHERE used)                                       AS txs,
         COALESCE(SUM(bal) FILTER (WHERE used AND bal > 0), 0)::bigint      AS value_in_zat,
         COALESCE(SUM(-bal) FILTER (WHERE used AND bal < 0), 0)::bigint     AS value_out_zat
    FROM per_tx
   GROUP BY 1, 2
  HAVING COUNT(*) FILTER (WHERE used) > 0
  WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS chain_day_pool_tx_key_idx
  ON chain_day_pool_tx (day, pool);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_day_network AS
  SELECT EXTRACT(EPOCH FROM date_trunc('day', to_timestamp(timestamp)))::bigint AS ts,
         AVG(difficulty)                  AS avg_difficulty,
         AVG(size_bytes)                  AS avg_block_bytes,
         COUNT(*)::int                    AS blocks
    FROM block
   GROUP BY 1
   ORDER BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS chain_day_network_ts_idx ON chain_day_network (ts);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_fee_extremes AS
  WITH tx_bounds AS (
    SELECT min(fee_zat) AS lo, max(fee_zat) AS hi
      FROM tx
     WHERE kind <> 'coinbase' AND fee_zat IS NOT NULL AND block_height IS NOT NULL
  ),
  block_bounds AS (
    SELECT min(total_fee_zat) AS lo, max(total_fee_zat) AS hi
      FROM block WHERE total_fee_zat IS NOT NULL
  )
    -- Coinbase excluded: it pays no fee, it collects them, so including it would put a zero at the
    -- bottom that is not a fee.
  SELECT 'transaction'::text                                            AS scope,
         b.lo                                                           AS lowest_zat,
         count(*) FILTER (WHERE t.fee_zat = b.lo)::bigint               AS lowest_count,
         b.hi                                                           AS highest_zat,
         count(*) FILTER (WHERE t.fee_zat = b.hi)::bigint               AS highest_count,
         min(t.txid) FILTER (WHERE t.fee_zat = b.hi)                    AS highest_id,
         min(t.block_height) FILTER (WHERE t.fee_zat = b.hi)            AS highest_height,
         count(*)::bigint                                               AS considered
    FROM tx t CROSS JOIN tx_bounds b
   WHERE t.kind <> 'coinbase' AND t.fee_zat IS NOT NULL AND t.block_height IS NOT NULL
   GROUP BY b.lo, b.hi
  UNION ALL
  SELECT 'block'::text,
         b.lo,
         count(*) FILTER (WHERE k.total_fee_zat = b.lo)::bigint,
         b.hi,
         count(*) FILTER (WHERE k.total_fee_zat = b.hi)::bigint,
         min(k.height::text) FILTER (WHERE k.total_fee_zat = b.hi),
         min(k.height) FILTER (WHERE k.total_fee_zat = b.hi),
         count(*)::bigint
    FROM block k CROSS JOIN block_bounds b
   WHERE k.total_fee_zat IS NOT NULL
   GROUP BY b.lo, b.hi
  WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS chain_fee_extremes_scope_idx ON chain_fee_extremes (scope);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_fee_nonzero_floor AS
  WITH tx_lo AS (
    SELECT min(fee_zat) AS lo
      FROM tx
     WHERE kind <> 'coinbase' AND fee_zat > 0 AND block_height IS NOT NULL
  ),
  block_lo AS (
    SELECT min(total_fee_zat) AS lo FROM block WHERE total_fee_zat > 0
  )
  SELECT 'transaction'::text                                    AS scope,
         b.lo                                                   AS lowest_zat,
         count(*) FILTER (WHERE t.fee_zat = b.lo)::bigint       AS lowest_count,
         min(t.txid) FILTER (WHERE t.fee_zat = b.lo)            AS lowest_id,
         min(t.block_height) FILTER (WHERE t.fee_zat = b.lo)    AS lowest_height,
         count(*)::bigint                                       AS considered
    FROM tx t CROSS JOIN tx_lo b
   WHERE t.kind <> 'coinbase' AND t.fee_zat > 0 AND t.block_height IS NOT NULL
   GROUP BY b.lo
  UNION ALL
  SELECT 'block'::text,
         b.lo,
         count(*) FILTER (WHERE k.total_fee_zat = b.lo)::bigint,
         min(k.height::text) FILTER (WHERE k.total_fee_zat = b.lo),
         min(k.height) FILTER (WHERE k.total_fee_zat = b.lo),
         count(*)::bigint
    FROM block k CROSS JOIN block_lo b
   WHERE k.total_fee_zat > 0
   GROUP BY b.lo
  WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS chain_fee_nonzero_floor_scope_idx
  ON chain_fee_nonzero_floor (scope);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_day_pool_boundary AS
  WITH per_tx AS (
    SELECT (to_timestamp(t.timestamp) AT TIME ZONE 'UTC')::date AS day,
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
  ),
  filed AS (
    SELECT p.*,
           CASE
             WHEN p.kind = 'coinbase' THEN 'coinbase'
             -- Shielding, and no published pool moved the other way.
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
    -- The unsettled rows, counted once each rather than per pool: a hub transaction's legs do not
    -- pair, so attributing its count to each pool would report one movement several times.
    -- `hub_zat` is the total magnitude its pools moved, deliberately not a directed flow.
  SELECT day,
         'hub'                                                  AS pool,
         0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
         SUM(abs(iw) + abs(oc) + abs(sa) + abs(sr))::bigint     AS hub_zat,
         COUNT(*)::bigint                                       AS hub_txs
    FROM filed
   WHERE bucket = 'hub'
   GROUP BY 1
  WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS chain_day_pool_boundary_key_idx
  ON chain_day_pool_boundary (day, pool);

CREATE MATERIALIZED VIEW IF NOT EXISTS chain_day_supply_close AS
  SELECT DISTINCT ON ((to_timestamp(timestamp) AT TIME ZONE 'UTC')::date)
         (to_timestamp(timestamp) AT TIME ZONE 'UTC')::date AS day,
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
   ORDER BY (to_timestamp(timestamp) AT TIME ZONE 'UTC')::date, height DESC
  WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS chain_day_supply_close_day_idx
  ON chain_day_supply_close (day);

-- The open dataset's contract: exactly what the export may read, and nothing else.
--
-- Applied by hand with psql, never by a service on boot: a broken view must not be able to stop
-- the follower. Every view names its columns, so a column added to a base table is never
-- published by accident. Views run with their owner's rights (the PostgreSQL default), so the
-- export's role needs nothing on the base tables and cannot read them.
--
-- What is deliberately absent, and why, is listed in the dataset card: node IP addresses,
-- third-party price and GeoIP data, and any label on an address. Transparent addresses are
-- published: they are chain facts, as the chain shows them. So is the
-- coinbase text, in `blocks_coinbase/` only, as sanitised at parse and labelled miner-written.

CREATE SCHEMA IF NOT EXISTS opendata;

-- Not published as is: the export reads `height`, `timestamp` and the rest by name, filters to its
-- release height, and writes them typed.
CREATE OR REPLACE VIEW opendata.blocks AS
SELECT height, hash, prev_hash, timestamp, size_bytes, tx_count,
       transparent_tx_count, mixed_tx_count, shielded_tx_count, total_fee_zat,
       sapling_flow_zat, orchard_flow_zat,
       transparent_pool_zat, sprout_pool_zat, sapling_pool_zat, orchard_pool_zat,
       lockbox_pool_zat, ironwood_pool_zat,
       difficulty, miner_kind, miner_reward_zat
FROM block;

CREATE OR REPLACE VIEW opendata.pool_usage_daily AS
SELECT day, pool, txs, fully_shielded, mixed, shielding, unshielding, indeterminate, coinbase,
       spends, outputs, actions, joinsplits, notes_at_close, close_height
FROM pool_usage_daily;

-- The day's counts. Its maximum amounts and their txids are `shielding_records_daily` below.
CREATE OR REPLACE VIEW opendata.shielding_daily AS
SELECT day, shielding_txs, unshielding_txs, indeterminate_txs, migration_txs
FROM boundary_daily;

CREATE OR REPLACE VIEW opendata.transparent_daily AS
SELECT day, outputs, unaddressed_outputs, out_transparent_zat, out_mixed_zat,
       inputs, unresolved_inputs, in_transparent_zat, in_mixed_zat,
       active_addresses, sending_addresses, receiving_addresses
FROM transparent_daily;

CREATE OR REPLACE VIEW opendata.transparent_monthly AS
SELECT month, active_addresses, sending_addresses, receiving_addresses, days, complete
FROM transparent_monthly;

-- The raw user agent is read only to classify it into a release; it is never written out (the
-- published schema has no such column, and the export's schema gate enforces that).
CREATE OR REPLACE VIEW opendata.node_releases_daily AS
SELECT day, user_agent, protocol_version, nodes, behind_tip, tip_unknown
FROM net_release_day;

-- Block age on arrival, from the API's tracker. The export reads the every-block rows only: the
-- per-pool rows rest on the site's reviewed pool labels, and the dataset carries no label.
CREATE OR REPLACE VIEW opendata.block_arrival_daily AS
SELECT day, grp, blocks, measured, late, p50_seconds, p90_seconds
FROM block_arrival_day
WHERE grp = 'all';

CREATE OR REPLACE VIEW opendata.reorgs AS
SELECT height, depth, orphaned_hash, replaced_by
FROM reorg_event;

-- One row per mined transaction, with what each shielded part publicly moved into or out of its
-- pool. New columns go at the end: CREATE OR REPLACE VIEW can only append, and the export selects
-- by name, so the published column order is unaffected.
CREATE OR REPLACE VIEW opendata.transactions AS
SELECT txid, block_height, timestamp, kind, direction, version, size_bytes, expiry_height, fee_zat,
       sprout_joinsplits, sapling_spends, sapling_outputs, orchard_actions, ironwood_actions,
       sprout_vpub_net_zat, sapling_value_balance_zat, orchard_value_balance_zat,
       ironwood_value_balance_zat, binding_sig_valid
FROM tx
WHERE block_height IS NOT NULL;

-- The transparent ledger. The height comes from `tx` on purpose: filtering on the ledger's own
-- `block_height` would seq-scan it (no index leads on it), while `tx`'s height index plus the
-- ledger's primary key make each height range a nested loop.
CREATE OR REPLACE VIEW opendata.transparent_io AS
SELECT io.txid, t.block_height, io.io, io.ordinal, io.address, io.value_zat, io.script_type,
       io.prev_txid, io.prev_vout
FROM tx_transparent_io io JOIN tx t USING (txid)
WHERE t.block_height IS NOT NULL;

-- Fee percentiles per UTC day and transaction kind, the same view the site's fee charts read.
CREATE OR REPLACE VIEW opendata.fees_daily AS
SELECT (to_timestamp(ts) AT TIME ZONE 'UTC')::date AS day, kind, txs, p25_zat, median_zat, p75_zat
FROM chain_day_fee_kind;

-- The miner-written coinbase text, sanitised at parse (printable, collapsed, capped), and the
-- payout address: published in `blocks_coinbase/` and matched against the operators that name
-- themselves (`selfDeclaredMiner`). Columns are appended only: CREATE OR REPLACE cannot reorder.
CREATE OR REPLACE VIEW opendata.block_miners AS
SELECT height, timestamp, coinbase_tag, miner_address
FROM block;

-- The release height comes from here; the lag probe reads it on its own connection.
CREATE OR REPLACE VIEW opendata.sync_state AS
SELECT tip_height, tip_hash, updated_at
FROM chain_sync_state;

-- ---------------------------------------------------------------------------------------
-- The site's precomputed series (open data part 2).
--
-- Block- and transaction-derived numbers are published from the export's own stream; the
-- `check_*` views below are read only to hold that stream to the site's matviews, day by day, and
-- are never written out. The other views here are published as they are, each checked against
-- the stream. Every matview the views read must be populated: one that is not, or that does not
-- reach past the release's final day, fails the release (it is stale, never published as current).
--
-- `ts` rides along wherever the matview truncated a day or month with the refresher's own time
-- zone (`date_trunc` on a timestamptz): the export requires it to be a UTC midnight.

CREATE OR REPLACE VIEW opendata.check_day_rollup AS
SELECT (to_timestamp(ts) AT TIME ZONE 'UTC')::date AS day, ts, top_height,
       transparent, mixed, shielded
FROM chain_day_rollup;

-- Without `received_at`: our node's receive time, operational, not a chain fact.
CREATE OR REPLACE VIEW opendata.check_day_supply_close AS
SELECT day, top_height, hash, transparent_pool_zat, sprout_pool_zat, sapling_pool_zat,
       orchard_pool_zat, lockbox_pool_zat, ironwood_pool_zat
FROM chain_day_supply_close;

-- AVG over an integer is NUMERIC, which the export refuses to read: both averages as float8.
CREATE OR REPLACE VIEW opendata.check_day_network AS
SELECT (to_timestamp(ts) AT TIME ZONE 'UTC')::date AS day, ts, blocks,
       avg_difficulty::float8 AS avg_difficulty, avg_block_bytes::float8 AS avg_block_bytes
FROM chain_day_network;

CREATE OR REPLACE VIEW opendata.check_day_fee_total AS
SELECT (to_timestamp(ts) AT TIME ZONE 'UTC')::date AS day, ts, fee_zat, blocks, blocks_covered
FROM chain_day_fee_total;

CREATE OR REPLACE VIEW opendata.check_day_pool_tx AS
SELECT day, pool, txs, value_in_zat, value_out_zat
FROM chain_day_pool_tx;

-- Read for one fact: no published day still has blocks without a recorded miner.
CREATE OR REPLACE VIEW opendata.check_mining_day AS
SELECT day, blocks, unrecorded_blocks
FROM mining_day;

-- Per (day, pool): what crossed at each pool, with a 'hub' row per day for the transactions
-- whose pools moved in opposite directions. Counts cast to int4, the published type.
CREATE OR REPLACE VIEW opendata.pool_boundary_daily AS
SELECT day, pool, shielded_zat, shielded_txs::integer AS shielded_txs,
       unshielded_zat, unshielded_txs::integer AS unshielded_txs,
       coinbase_zat, coinbase_txs::integer AS coinbase_txs,
       hub_zat, hub_txs::integer AS hub_txs
FROM chain_day_pool_boundary;

CREATE OR REPLACE VIEW opendata.shielding_flow_daily AS
SELECT (to_timestamp(ts) AT TIME ZONE 'UTC')::date AS day, ts, shielded_zat, unshielded_zat
FROM chain_day_shielding_flow;

CREATE OR REPLACE VIEW opendata.pool_migration_daily AS
SELECT day, destination, source, txs::integer AS txs, zat
FROM chain_day_pool_migration;

-- The export keeps complete months only; percentiles are not derivable from the daily rows.
CREATE OR REPLACE VIEW opendata.fees_monthly AS
SELECT (to_timestamp(ts) AT TIME ZONE 'UTC')::date AS month, ts, kind, txs,
       p25_zat, median_zat, p75_zat
FROM chain_month_fee_kind;

-- The day's largest shielding, unshielding and migration: public per-transaction values; a txid
-- only where that maximum is unique, so a tie never names one of several.
CREATE OR REPLACE VIEW opendata.shielding_records_daily AS
SELECT day,
       max_shielding_zat, max_shielding_ties,
       CASE WHEN max_shielding_ties = 1 THEN max_shielding_txid END AS max_shielding_txid,
       max_unshielding_zat, max_unshielding_ties,
       CASE WHEN max_unshielding_ties = 1 THEN max_unshielding_txid END AS max_unshielding_txid,
       max_migration_zat, max_migration_ties,
       CASE WHEN max_migration_ties = 1 THEN max_migration_txid END AS max_migration_txid
FROM boundary_daily;

-- Blocks per (day, miner kind, payout address): the address is in the coinbase, a chain fact.
-- '' (a shielded coinbase, or a bare key) becomes NULL, never an empty string.
CREATE OR REPLACE VIEW opendata.mining_payouts_daily AS
SELECT day, kind, NULLIF(address, '') AS address, blocks, reward_zat, fee_zat, fee_blocks
FROM mining_day_payout;

-- The daily balances of the addresses carrying an exchange label on the site, from its own table
-- (an address taken off the list is deleted by its tracker). No label and no
-- grouping: an address is its own name here, as everywhere in this dataset.
CREATE OR REPLACE VIEW opendata.address_balance_daily AS
SELECT address, day, balance_zat, close_height
FROM address_balance_daily;

-- The transparent balances behind the site's rich list, published as `addresses`: a snapshot
-- replaced by each release. No `rank`: it is derived (a position in this very table), not stored.
-- `tx_count` is NULL on rows the backfill has not counted yet.
CREATE OR REPLACE VIEW opendata.addresses AS
SELECT address, balance_zat, tx_count
FROM chain_address_balance;

-- The height those balances cover and the value no single address holds, read in the same
-- snapshot: together they must equal the transparent pool at that height.
CREATE OR REPLACE VIEW opendata.addresses_meta AS
SELECT computed_height, unattributed_zat
FROM chain_rich_list_meta;

-- The export's role. Created separately with its password on the box (never in this file):
--   CREATE ROLE opendata_reader LOGIN CONNECTION LIMIT 2 PASSWORD '…';
-- Then these grants, which are the whole of what it can do.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opendata_reader') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM opendata_reader';
    EXECUTE 'REVOKE ALL ON SCHEMA public FROM opendata_reader';
    EXECUTE 'REVOKE TEMP ON DATABASE ' || quote_ident(current_database()) || ' FROM opendata_reader';
    EXECUTE 'GRANT USAGE ON SCHEMA opendata TO opendata_reader';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA opendata TO opendata_reader';
    EXECUTE 'ALTER ROLE opendata_reader SET default_transaction_read_only = on';
    EXECUTE 'ALTER ROLE opendata_reader SET statement_timeout = ''10min''';
    EXECUTE 'ALTER ROLE opendata_reader SET idle_in_transaction_session_timeout = ''15min''';
  END IF;
END
$$;

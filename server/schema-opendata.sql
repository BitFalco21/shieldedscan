-- The open dataset's contract: exactly what the export may read, and nothing else.
--
-- Applied by hand with psql, never by a service on boot: a broken view must not be able to stop
-- the follower. Every view names its columns, so a column added to a base table is never
-- published by accident. Views run with their owner's rights (the PostgreSQL default), so the
-- export's role needs nothing on the base tables and cannot read them.
--
-- What is deliberately absent, and why, is listed in the dataset card: per-transaction amounts,
-- addresses, miner-written text, node IP addresses, third-party price and GeoIP data.

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

-- Counts only: the per-day maximum amounts and their txids would point at single transactions.
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

CREATE OR REPLACE VIEW opendata.reorgs AS
SELECT height, depth, orphaned_hash, replaced_by
FROM reorg_event;

-- One row per mined transaction, without its amounts: no pool value balances and no Sprout public
-- value. Kind, direction, fee, size and how many shielded parts it has are public facts about
-- its shape; how much moved through which pool is not exported transaction by transaction.
CREATE OR REPLACE VIEW opendata.transactions AS
SELECT txid, block_height, timestamp, kind, direction, version, size_bytes, expiry_height, fee_zat,
       sprout_joinsplits, sapling_spends, sapling_outputs, orchard_actions, ironwood_actions
FROM tx
WHERE block_height IS NOT NULL;

-- Fee percentiles per UTC day and transaction kind, the same view the site's fee charts read.
CREATE OR REPLACE VIEW opendata.fees_daily AS
SELECT (to_timestamp(ts) AT TIME ZONE 'UTC')::date AS day, kind, txs, p25_zat, median_zat, p75_zat
FROM chain_day_fee_kind;

-- The miner-written coinbase text is read only to match it against the fixed list of operators that
-- name themselves (`selfDeclaredMiner`); it is never written out.
CREATE OR REPLACE VIEW opendata.block_miners AS
SELECT height, timestamp, coinbase_tag
FROM block;

-- The release height comes from here; the lag probe reads it on its own connection.
CREATE OR REPLACE VIEW opendata.sync_state AS
SELECT tip_height, tip_hash, updated_at
FROM chain_sync_state;

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

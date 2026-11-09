-- Chain data: blocks, transactions, transparent I/O, and the follower's resume point.
--
-- Conventions match server/schema.sql: zatoshis BIGINT, timestamps BIGINT unix seconds,
-- idempotent and safe to re-run on boot. Applied by the follower and the backfiller on every
-- start, alongside schema.sql.

-- ---------------------------------------------------------------------------- blocks
-- One row per block: the domain Block, plus the per-block rollup every chart reads, plus the six
-- pool totals the node reports. The rollup columns are cheap at ingest and expensive to
-- recompute, which is why they are denormalised here.
CREATE TABLE IF NOT EXISTS block (
  height               INTEGER PRIMARY KEY,
  hash                 TEXT    NOT NULL UNIQUE,
  prev_hash            TEXT    NOT NULL,
  timestamp            BIGINT  NOT NULL,
  size_bytes           INTEGER NOT NULL,
  tx_count             INTEGER NOT NULL,

    -- Activity buckets, coinbase excluded: folding coinbase into transparent would add a constant
    -- +1/block that deflates every shielded-share figure. "Shielded" means fully shielded: a t->z
    -- shielding transaction has transparent inputs and counts as mixed.
  transparent_tx_count INTEGER NOT NULL DEFAULT 0,
  mixed_tx_count       INTEGER NOT NULL DEFAULT 0,
  shielded_tx_count    INTEGER NOT NULL DEFAULT 0,

    -- NULL when any transaction's fee could not be derived. Never a partial sum.
  total_fee_zat        BIGINT,

    -- Domain sign (positive = value entering the pool), from the node's own
    -- valuePools[].valueDeltaZat, which already uses that convention.
  sapling_flow_zat     BIGINT  NOT NULL DEFAULT 0,
  orchard_flow_zat     BIGINT  NOT NULL DEFAULT 0,

    -- All six pools the node reports. `ironwood` is 0 and unmonitored until NU6.3 activates at
    -- height 3,428,143.
  transparent_pool_zat BIGINT,
  sprout_pool_zat      BIGINT,
  sapling_pool_zat     BIGINT,
  orchard_pool_zat     BIGINT,
  lockbox_pool_zat     BIGINT,
  ironwood_pool_zat    BIGINT
);

-- ------------------------------------------------------------------ mining columns
-- Each of these is computed by `parseBlock` for every ingested block, so this stores the domain's
-- own output rather than a second derivation, as `tx.kind` does. Never recompute them in SQL.
--
-- In particular `miner_kind` must be written from `blockMiner()`, never inferred as "the largest
-- coinbase output" in a query: SQL cannot see the ZIP-213 rule, so it would name a funding stream
-- as the miner of every shielded-coinbase block.
ALTER TABLE block ADD COLUMN IF NOT EXISTS miner_kind       TEXT;
ALTER TABLE block ADD COLUMN IF NOT EXISTS miner_address    TEXT;
-- Attacker-controlled bytes: miners write what they like here. Already stripped to printable
-- characters and length-capped by `decodeCoinbaseTag` at the parse boundary. Stored as text and
-- rendered as text, never as markup.
ALTER TABLE block ADD COLUMN IF NOT EXISTS coinbase_tag     TEXT;
-- The header's difficulty as the node computes it from `bits`. DOUBLE PRECISION because that is
-- what the RPC returns and it is a ratio, not an amount.
ALTER TABLE block ADD COLUMN IF NOT EXISTS difficulty       DOUBLE PRECISION;
-- What the miner was paid, not the whole coinbase: funding-stream outputs are someone else's
-- money. NULL for a shielded coinbase, where the amount is not public.
ALTER TABLE block ADD COLUMN IF NOT EXISTS miner_reward_zat BIGINT;
-- When this indexer first stored the block, unix seconds: an observation of ours, not chain data.
-- Stamped only by the live follower (`stampReceivedAt`); the backfiller leaves it NULL, because a
-- historical walk's write time says nothing about propagation. Never backfill it. It exists
-- because header timestamps can lag a block's real arrival by tens of seconds, and this column is
-- the only way to tell those two clocks apart.
ALTER TABLE block ADD COLUMN IF NOT EXISTS received_at      BIGINT;

DO $$
BEGIN
  ALTER TABLE block ADD CONSTRAINT miner_kind_known
    CHECK (miner_kind IS NULL OR miner_kind IN ('transparent','shielded','unknown'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- listBlocks sorts by height, which is unique and is the sort key, so the PK already serves its
-- single-column seek.
CREATE INDEX IF NOT EXISTS block_timestamp_idx ON block (timestamp DESC);

-- No index on miner_address: /mining groups by it over a time range, so the range predicate is the
-- selective half (`block_timestamp_idx`), and the grouping is a hash aggregate over rows already
-- fetched. Add one only with an EXPLAIN showing the planner wants it.

-- ---------------------------------------------------------------------- transactions
-- block_height NULL means "in the mempool", as the domain Transaction documents.
-- ON DELETE CASCADE is what makes a reorg rollback a single DELETE on `block`.
CREATE TABLE IF NOT EXISTS tx (
  txid                      TEXT PRIMARY KEY,
  block_height              INTEGER REFERENCES block(height) ON DELETE CASCADE,
  timestamp                 BIGINT  NOT NULL,
  is_coinbase               BOOLEAN NOT NULL,
  version                   INTEGER NOT NULL,
  size_bytes                INTEGER NOT NULL,
  expiry_height             INTEGER,
    -- NULL = unknown, never 0. Derived from the balance equation after input resolution;
    -- unresolvable inputs leave it NULL.
  fee_zat                   BIGINT,
  binding_sig_valid         BOOLEAN,

    -- Written by the TypeScript domain classifier (`txKind`), never recomputed in SQL.
    -- `tx_kind_keyset_idx` serves the `?kind=` filter from it.
  kind                      TEXT NOT NULL CHECK (kind IN ('transparent','shielded','mixed','coinbase')),

    -- Which way a mixed transaction moved value across the shielded boundary, from the domain
    -- classifier (`txDirection`), as `kind` comes from `txKind`. Serves `?kind=shielding` and
    -- `?kind=unshielding` on /txs, through `tx_direction_keyset_idx`. Stored because `txDirection`
    -- needs the transparent input/output counts from `tx_transparent_io`, which would otherwise
    -- mean a join on every page, and deriving it in SQL would be a second derivation.
    --
    --  1. Only `kind = 'mixed'` rows carry a value. For every other kind `txDirection` restates
    --     `kind`, and storing that would duplicate a fact.
    --  2. 'indeterminate' rather than NULL for a mixed transaction whose pools moved in opposite
    --     directions. `txDirection` returns null there rather than apportioning; storing NULL would
    --     make "the pools disagree" indistinguishable from "not yet backfilled", and
    --     `repair-direction` finds its remaining work with `direction IS NULL`.
    --  3. No CHECK tying it to `kind`: the backfill fills mixed rows progressively, so "every mixed
    --     row has a direction" is not true until it finishes. Tests and the repair's verification
    --     assert the invariant instead.
  direction                 TEXT CHECK (direction IN ('shielding','unshielding','indeterminate')),

    -- Bundles: all-NULL or all-present per pool, mirroring `SaplingBundle | null`, which keeps "no
    -- bundle" distinguishable from "empty bundle" without faking zeros.
  sprout_joinsplits         INTEGER,
    -- Sprout's public value across the joinsplits: SUM(vpub_new) − SUM(vpub_old), in RPC sign
    -- (positive = value leaving the pool).
    --
    -- Not named `sprout_value_balance_zat` and not in the domain sign its neighbours use: Sprout
    -- publishes no bundle value balance (`reportsValueBalance` excludes it, so a Sprout-only
    -- transaction never renders a net shielded figure). This is a fee term, not a pool balance, and
    -- must not be surfaced as one. It matches `rpcSproutVB` exactly, sign included, so the fee
    -- repair needs no translation.
  sprout_vpub_net_zat       BIGINT,
  sapling_spends            INTEGER,
  sapling_outputs           INTEGER,
  sapling_value_balance_zat BIGINT,
  orchard_actions           INTEGER,
  orchard_value_balance_zat BIGINT,
    -- Ironwood, the fourth shielded pool (NU6.3, active at height 3,428,143). Every pool needs its
    -- columns here; a pool missing from this table would silently drop out of every net shielded
    -- flow and fee derived from it.
  ironwood_actions          INTEGER,
  ironwood_value_balance_zat BIGINT,

  CONSTRAINT sapling_bundle_whole CHECK (
    (sapling_spends IS NULL AND sapling_outputs IS NULL AND sapling_value_balance_zat IS NULL)
    OR (sapling_spends IS NOT NULL AND sapling_outputs IS NOT NULL AND sapling_value_balance_zat IS NOT NULL)
  ),
  CONSTRAINT orchard_bundle_whole CHECK (
    (orchard_actions IS NULL AND orchard_value_balance_zat IS NULL)
    OR (orchard_actions IS NOT NULL AND orchard_value_balance_zat IS NOT NULL)
  ),
  CONSTRAINT ironwood_bundle_whole CHECK (
    (ironwood_actions IS NULL AND ironwood_value_balance_zat IS NULL)
    OR (ironwood_actions IS NOT NULL AND ironwood_value_balance_zat IS NOT NULL)
  )
);

-- Migrations for an existing database, where CREATE TABLE IF NOT EXISTS above is a no-op. Every
-- column added later needs its own idempotent ALTER, or a fresh database and an upgraded one end
-- up with different schemas. The DO block exists because Postgres has no ADD CONSTRAINT IF NOT
-- EXISTS; on a fresh database the constraint already exists inline and the exception is
-- swallowed. The writer only ever stores whole bundles, so validating existing rows is safe.
ALTER TABLE tx ADD COLUMN IF NOT EXISTS ironwood_actions           INTEGER;
ALTER TABLE tx ADD COLUMN IF NOT EXISTS ironwood_value_balance_zat BIGINT;
-- Sprout's fee term. NULL means "not yet derived", a different statement from 0 ("derived, and
-- this transaction has no joinsplit"); the fee repair relies on telling them apart.
ALTER TABLE tx ADD COLUMN IF NOT EXISTS sprout_vpub_net_zat        BIGINT;
-- `direction`: see the column definition above. Never add a `DROP COLUMN direction` to this file:
-- the follower and the backfiller re-apply it on every start, so it would silently destroy the
-- column and its backfill on the next restart.
--
-- An older column of this name used a different vocabulary under a CHECK, so a database restored
-- from an old dump could still carry that constraint; it is normalised explicitly below rather
-- than assumed.
ALTER TABLE tx ADD COLUMN IF NOT EXISTS direction TEXT;
-- Guarded on the catalogue, and `NOT VALID`, because this file runs on every container start
-- against a large table:
--
--  * `ADD CONSTRAINT ... CHECK` validates every existing row under an ACCESS EXCLUSIVE lock;
--    `NOT VALID` skips that scan and still enforces the constraint on every new row.
--  * The `EXCEPTION WHEN duplicate_object` idiom used above does not help here: the exception
--    fires only after the validation scan has run. Checking `pg_constraint` first avoids it.
--
-- On a fresh database the column-level CHECK already exists under this name, so this is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tx_direction_check' AND conrelid = 'tx'::regclass
  ) THEN
    ALTER TABLE tx ADD CONSTRAINT tx_direction_check
      CHECK (direction IN ('shielding','unshielding','indeterminate')) NOT VALID;
  END IF;
END $$;
DO $$
BEGIN
  ALTER TABLE tx ADD CONSTRAINT ironwood_bundle_whole CHECK (
    (ironwood_actions IS NULL AND ironwood_value_balance_zat IS NULL)
    OR (ironwood_actions IS NOT NULL AND ironwood_value_balance_zat IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- listTransactions sorts by timestamp, which is not unique, so the cursor and the index are both
-- the (timestamp, txid) tuple. Both DESC so the keyset predicate is one index scan with no sort.
CREATE INDEX IF NOT EXISTS tx_keyset_idx     ON tx (timestamp DESC, txid DESC);
CREATE INDEX IF NOT EXISTS tx_block_idx      ON tx (block_height DESC);
CREATE INDEX IF NOT EXISTS tx_kind_keyset_idx ON tx (kind, timestamp DESC, txid DESC);
-- The `?kind=shielding` / `?kind=unshielding` keyset. Partial on `kind = 'mixed'`, the only kind
-- that stores a direction, so the index is a fraction of the table, and the planner can prove the
-- predicate from the query's own `kind = 'mixed' AND direction = $n`.
CREATE INDEX IF NOT EXISTS tx_direction_keyset_idx
  ON tx (direction, timestamp DESC, txid DESC) WHERE kind = 'mixed';
-- The mempool is every row without a height; a partial index keeps that scan tiny.
CREATE INDEX IF NOT EXISTS tx_mempool_idx    ON tx (timestamp DESC) WHERE block_height IS NULL;
-- The `?pool=` keyset: one partial index per shielded pool, each predicate the matching string in
-- `server/pool-sql.ts` (`POOL_USED_SQL`), so a list narrowed to a pool seeks its own index rather
-- than walking `tx_keyset_idx`. On a live database, build them by hand with
-- `CREATE INDEX CONCURRENTLY`, one at a time, so these lines are then no-ops.
CREATE INDEX IF NOT EXISTS tx_pool_ironwood_keyset_idx
  ON tx (timestamp DESC, txid DESC) WHERE ironwood_actions > 0;
CREATE INDEX IF NOT EXISTS tx_pool_orchard_keyset_idx
  ON tx (timestamp DESC, txid DESC) WHERE orchard_actions > 0;
CREATE INDEX IF NOT EXISTS tx_pool_sapling_keyset_idx
  ON tx (timestamp DESC, txid DESC) WHERE (sapling_spends > 0 OR sapling_outputs > 0);
CREATE INDEX IF NOT EXISTS tx_pool_sprout_keyset_idx
  ON tx (timestamp DESC, txid DESC) WHERE sprout_joinsplits > 0;

-- ------------------------------------------------------------------- transparent I/O
-- Inputs and outputs in one table, so a single address index serves both "received" and "sent".
--
-- Inputs arrive with prev_txid/prev_vout only: getblock gives no address or value for a vin. They
-- are resolved against previously stored `out` rows in the same table, which is correct because
-- ingest is strictly in block order. Coinbase inputs reference no previous output and are never
-- inserted.
CREATE TABLE IF NOT EXISTS tx_transparent_io (
  txid         TEXT    NOT NULL REFERENCES tx(txid) ON DELETE CASCADE,
  io           TEXT    NOT NULL CHECK (io IN ('in','out')),
  ordinal      INTEGER NOT NULL,
    -- NULL for an unresolved input, and for outputs whose script names zero addresses (OP_RETURN)
    -- or several (multisig): value is never attributed to one of many parties.
  address      TEXT,
  value_zat    BIGINT,
  script_type  TEXT,
  prev_txid    TEXT,
  prev_vout    INTEGER,
  block_height INTEGER,
  PRIMARY KEY (txid, io, ordinal)
);

-- The address-page index; without it every address query scans the whole table.
--
-- Size a rebuild from row count and key width, not from an existing (bloated) index: a fresh build
-- packs pages tightly.
--
-- `IF NOT EXISTS` is required because the follower and backfiller re-apply this file on every
-- start. Not `CONCURRENTLY` here, since that cannot run inside the schema transaction. For a manual
-- rebuild against a live table:
--   CREATE INDEX CONCURRENTLY io_address_idx
--     ON tx_transparent_io (address, block_height DESC) WHERE address IS NOT NULL;
CREATE INDEX IF NOT EXISTS io_address_idx
  ON tx_transparent_io (address, block_height DESC) WHERE address IS NOT NULL;

-- ------------------------------------------------- n_distinct(txid), set by hand
-- ANALYZE cannot estimate this column, and its error is severe: it can underestimate
-- `n_distinct(txid)` by orders of magnitude, so the planner believes every txid maps to thousands
-- of rows and chooses a sequential scan of the whole table over a modest number of index lookups.
-- A plain ANALYZE does not fix it: Postgres's distinct estimator systematically underestimates
-- high-cardinality columns from a sample.
--
-- Derived, not hardcoded, because the correct ratio differs per network (io rows per transaction
-- differ several-fold between mainnet and testnet), and a literal would be a false statistic on
-- the other network. A negative value means "fraction of rows", so it stays correct as the table
-- grows.
--
-- `reltuples` rather than `count(*)`: a catalogue read, so this costs microseconds on every boot.
-- It is an estimate, but the ratio of two estimates is accurate enough for a selectivity hint.
--
-- The override lands in `pg_statistic` at the next ANALYZE, which the statement below forces so a
-- fresh database does not wait for autovacuum.
DO $$
DECLARE tx_rows real; io_rows real; ratio real;
BEGIN
  SELECT reltuples INTO tx_rows FROM pg_class WHERE relname = 'tx';
  SELECT reltuples INTO io_rows FROM pg_class WHERE relname = 'tx_transparent_io';
  /*
   * Both counts must be genuinely POSITIVE. Postgres 14+ reports `reltuples = -1` for a
   * relation it has never vacuumed or analysed, which is every table on a fresh database —
   * and -1 / -1 = 1, a ratio that passes a naive sanity check and writes "every txid is
   * unique". Caught by running this against an empty database rather than only a populated
   * one: the first version did exactly that.
   *
   * On a fresh database the right move is to write nothing and let ANALYZE guess, because the
   * follower re-applies this file on every boot and will compute the real ratio as soon as
   * there is data to measure.
   */
  IF tx_rows IS NULL OR io_rows IS NULL OR tx_rows <= 0 OR io_rows <= 0 THEN
    RAISE NOTICE 'n_distinct(txid): tx=% io=% not yet measurable, leaving ANALYZE''s estimate',
      tx_rows, io_rows;
    RETURN;
  END IF;
  ratio := tx_rows / io_rows;
  IF ratio <= 0 OR ratio > 1 THEN
    RAISE NOTICE 'n_distinct(txid): ratio % is not a usable fraction, leaving it alone', ratio;
    RETURN;
  END IF;
  EXECUTE format('ALTER TABLE tx_transparent_io ALTER COLUMN txid SET (n_distinct = %s)', -ratio);
  RAISE NOTICE 'n_distinct(tx_transparent_io.txid) set to -%', ratio;
    -- Inside the DO block so it runs only when a value was written. ANALYZE is legal in a
    -- transaction (VACUUM is not) and samples rather than scans, so it takes about a second.
  ANALYZE tx_transparent_io;
END $$;

-- No index on (prev_txid, prev_vout): input resolution finds its input rows by `txid = ANY(...)`
-- and the outputs they spend by `(txid, ordinal)`, both primary-key prefixes. Such an index would
-- cost a sizeable fraction of the table for nothing; add it only with an EXPLAIN showing the
-- planner wants it.

-- --------------------------------------------------------------------- sync state
-- Single row. The follower's resume point and its reorg detector: on each pass the stored hash at
-- a height is compared against the node's, and any divergence is rolled back rather than merged.
CREATE TABLE IF NOT EXISTS chain_sync_state (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  tip_height INTEGER NOT NULL,
  tip_hash   TEXT    NOT NULL,
  updated_at BIGINT  NOT NULL
);

-- ----------------------------------------------------------------- backfill state
-- Single row: the one-shot backfiller's resume point, the next height it has not yet ingested.
-- Separate from chain_sync_state because the live follower and the backfiller run at the same time
-- against the same database; a shared row would make each resume from the other's position. The
-- backfiller never writes chain_sync_state (see PostgresChainStore's trackSyncState) and the
-- follower never reads this.
CREATE TABLE IF NOT EXISTS chain_backfill_state (
  id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  next_height INTEGER NOT NULL,
  updated_at  BIGINT  NOT NULL
);

-- ----------------------------------------------------------------- reorg audit log
-- Reorgs this follower observed and rolled back. An audit log of rollbacks, so no foreign key to
-- block and no cascade: a rollback must not erase the record of itself. Both hashes are captured
-- at detection time, inside the same transaction as the rollback, since the orphaned block's row is
-- deleted moments later. Two distinct hashes at one height is a fact a reader can verify.
CREATE TABLE IF NOT EXISTS reorg_event (
  id             BIGSERIAL PRIMARY KEY,
  detected_at    BIGINT NOT NULL,   -- unix seconds, follower's clock
  height         BIGINT NOT NULL,   -- lowest height rolled back
  depth          INT    NOT NULL,   -- blocks discarded
  orphaned_hash  TEXT   NOT NULL,   -- the hash WE held at `height`
  replaced_by    TEXT   NOT NULL    -- the hash the node reports there now
);

-- detected_at is not unique, so the cursor and this index both carry the composite
-- (detected_at, id) tuple.
CREATE INDEX IF NOT EXISTS reorg_event_detected_idx ON reorg_event (detected_at DESC, id DESC);

-- When observation began. The page says "observed since <date>", and the only honest date is the
-- moment this log first existed: inserted once, never backdated.
CREATE TABLE IF NOT EXISTS reorg_observation (
  id              BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  observing_since BIGINT NOT NULL
);
INSERT INTO reorg_observation (observing_since)
SELECT EXTRACT(EPOCH FROM now())::BIGINT
WHERE NOT EXISTS (SELECT 1 FROM reorg_observation);


-- ---------------------------------------------------------------------------------------
-- The rollups: the chain's day and month series and its all-time figures, as plain tables.
--
-- Each was a materialized view whose refresh re-read all of `tx` or `block`. A period's rows depend
-- only on that period's source rows, so each is now a table recomputed one period at a time. The
-- definitions (one windowed SELECT per table) are in `server/rollup/definitions.ts`, where the same
-- text serves the follower's incremental pass and the full rebuild.
--
-- Which periods to recompute comes from `chain_rollup_dirty`. Every write to a `block` or `tx` row
-- a rollup reads marks the timestamp it touched, and the one it leaves, in the same transaction:
--   * `ingestBlock` (follower and backfiller) and `rollbackAbove`;
--   * the fee, direction and difficulty repairs.
-- Nothing else writes those rows. A new writer must mark (`server/rollup/marks.ts`); a change made
-- by hand must be followed by an INSERT here or by `fill-rollups --restart`, or its periods stay
-- stale. Mempool rows (`block_height IS NULL`) are in no rollup and need no mark.
CREATE TABLE IF NOT EXISTS chain_rollup_dirty (
  ts_lo BIGINT NOT NULL,   -- unix seconds, inclusive
  ts_hi BIGINT NOT NULL,   -- unix seconds, inclusive; a point mark has ts_lo = ts_hi
  CHECK (ts_lo <= ts_hi)
);

-- The paced full fill's resume point (`server/fill-rollups-main.ts`): one UTC month per chunk.
CREATE TABLE IF NOT EXISTS chain_rollup_fill (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  next_ts      BIGINT NOT NULL,
  end_ts       BIGINT NOT NULL,
  started_at   BIGINT NOT NULL,
  completed_at BIGINT
);

-- The rollup tables, column for column and type for type the views they replaced (some readers
-- `SELECT *`), each keyed by its period. Only primary keys: never a view's old index name, which
-- stays with the view until it is dropped.
--
-- A fresh database creates each under its own name. Where the view still holds the name, the table
-- is created beside it as `<name>_next`: the follower keeps it current, nobody reads it, and
-- `swap-rollups` later renames the view to `<name>_old` and the table into its place. This file
-- runs at every follower start, so this is cheap DDL only: nothing here scans or fills.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('chain_month_rollup', 'ts BIGINT PRIMARY KEY, top_height INTEGER, transparent INTEGER,
       mixed INTEGER, shielded INTEGER, sprout BIGINT, sapling BIGINT, orchard BIGINT,
       ironwood BIGINT'),
    ('chain_month_shielding_flow', 'ts BIGINT PRIMARY KEY, shielded_zat BIGINT,
       unshielded_zat BIGINT'),
    ('chain_month_fee_kind', 'ts BIGINT, kind TEXT, median_zat BIGINT, p25_zat BIGINT,
       p75_zat BIGINT, txs INTEGER, PRIMARY KEY (ts, kind)'),
    ('chain_tx_kind_count', 'kind TEXT PRIMARY KEY, txs BIGINT'),
    ('chain_tx_mixed_direction_count', 'direction TEXT PRIMARY KEY, txs BIGINT'),
    ('chain_day_rollup', 'ts BIGINT PRIMARY KEY, top_height INTEGER, transparent INTEGER,
       mixed INTEGER, shielded INTEGER, sprout BIGINT, sapling BIGINT, orchard BIGINT,
       ironwood BIGINT'),
    ('chain_day_shielding_flow', 'ts BIGINT PRIMARY KEY, shielded_zat BIGINT,
       unshielded_zat BIGINT'),
    ('chain_day_fee_kind', 'ts BIGINT, kind TEXT, median_zat BIGINT, p25_zat BIGINT,
       p75_zat BIGINT, txs INTEGER, PRIMARY KEY (ts, kind)'),
    ('chain_day_fee_total', 'ts BIGINT PRIMARY KEY, fee_zat BIGINT, blocks INTEGER,
       blocks_covered INTEGER'),
    -- `avg_block_bytes` is NUMERIC because AVG over an integer is.
    ('chain_day_network', 'ts BIGINT PRIMARY KEY, avg_difficulty DOUBLE PRECISION,
       avg_block_bytes NUMERIC, blocks INTEGER'),
    ('chain_day_pool_migration', 'day DATE, destination TEXT, source TEXT, txs BIGINT,
       zat BIGINT, PRIMARY KEY (day, destination, source)'),
    ('chain_day_pool_tx', 'day DATE, pool TEXT, txs BIGINT, value_in_zat BIGINT,
       value_out_zat BIGINT, PRIMARY KEY (day, pool)'),
    ('chain_day_pool_boundary', 'day DATE, pool TEXT, shielded_zat BIGINT, shielded_txs BIGINT,
       unshielded_zat BIGINT, unshielded_txs BIGINT, coinbase_zat BIGINT, coinbase_txs BIGINT,
       hub_zat BIGINT, hub_txs BIGINT, PRIMARY KEY (day, pool)'),
    ('chain_day_supply_close', 'day DATE PRIMARY KEY, top_height INTEGER, hash TEXT,
       prev_hash TEXT, timestamp BIGINT, received_at BIGINT, transparent_pool_zat BIGINT,
       sprout_pool_zat BIGINT, sapling_pool_zat BIGINT, orchard_pool_zat BIGINT,
       ironwood_pool_zat BIGINT, lockbox_pool_zat BIGINT'),
    -- `*_id` and `*_height` are meaningful only when the matching count is 1: fees tie.
    ('chain_fee_extremes', 'scope TEXT PRIMARY KEY, lowest_zat BIGINT, lowest_count BIGINT,
       highest_zat BIGINT, highest_count BIGINT, highest_id TEXT, highest_height INTEGER,
       considered BIGINT'),
    ('chain_fee_nonzero_floor', 'scope TEXT PRIMARY KEY, lowest_zat BIGINT,
       lowest_count BIGINT, lowest_id TEXT, lowest_height INTEGER, considered BIGINT')
  ) AS v(name, columns)
  LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I (%s)',
      CASE (SELECT relkind FROM pg_class WHERE oid = to_regclass(r.name))
        WHEN 'm' THEN r.name || '_next' ELSE r.name END,
      r.columns);
  END LOOP;
END $$;

-- Per-day parts of the all-time figures, which combine exactly across disjoint days: counts sum,
-- and extremes combine by min/max with their tie counts and minimum ids. Internal; no reader.
CREATE TABLE IF NOT EXISTS chain_day_tx_kind_count (
  day  DATE,
  kind TEXT,
  txs  BIGINT NOT NULL,
  PRIMARY KEY (day, kind)
);

CREATE TABLE IF NOT EXISTS chain_day_tx_direction_count (
  day       DATE,
  direction TEXT,
  txs       BIGINT NOT NULL,
  PRIMARY KEY (day, direction)
);

-- `scope` is 'transaction' or 'block'; `nz_*` is the same over non-zero fees only.
CREATE TABLE IF NOT EXISTS chain_day_fee_bounds (
  day           DATE,
  scope         TEXT,
  considered    BIGINT NOT NULL,
  lo            BIGINT,
  lo_count      BIGINT,
  hi            BIGINT,
  hi_count      BIGINT,
  hi_id         TEXT,
  hi_height     INTEGER,
  nz_considered BIGINT NOT NULL,
  nz_lo         BIGINT,
  nz_lo_count   BIGINT,
  nz_lo_id      TEXT,
  nz_lo_height  INTEGER,
  PRIMARY KEY (day, scope)
);

-- ---------------------------------------------------------- column rename to unshielded_zat
-- Renames the older column name on a database old enough to carry it. `ALTER MATERIALIZED VIEW`
-- also renames a table's column, so this is right whichever kind of relation holds the name.
--
-- The exception form is required: a guard on `information_schema.columns` would silently do
-- nothing, because materialized views do not appear in `information_schema`.
DO $$
BEGIN
  ALTER MATERIALIZED VIEW chain_month_shielding_flow
    RENAME COLUMN deshielded_zat TO unshielded_zat;
EXCEPTION WHEN undefined_column OR wrong_object_type THEN NULL;
END $$;

DO $$
BEGIN
  ALTER MATERIALIZED VIEW chain_day_shielding_flow
    RENAME COLUMN deshielded_zat TO unshielded_zat;
EXCEPTION WHEN undefined_column OR wrong_object_type THEN NULL;
END $$;

-- ---------------------------------------------------------------------------------------
-- The transparent value range.
--
-- A table, not a materialized view: a REFRESH would re-read `tx_transparent_io` from genesis. A
-- paced job walks the chain once and then tops up only new blocks, which is exact because extrema
-- combine across disjoint height ranges (see `server/value-extremes.ts`, including why there is no
-- `tx.public_value_zat` column). Its scratch tables are not declared here, since this file is
-- re-applied on every boot.
--
-- Every figure covers transparent value only: `publicValueZat` is null for a fully shielded
-- transaction, so this is never "the largest transaction on Zcash". Coinbase is excluded, matching
-- the fee extremes.
--
-- `covered_through_height` is a correctness field: a maximum over part of the chain may be the
-- wrong row entirely. Consumers must refuse to publish until it reaches the target, which is why it
-- defaults to 0 rather than NULL.
CREATE TABLE IF NOT EXISTS chain_value_extremes (
  scope                  TEXT PRIMARY KEY,
  lowest_zat             BIGINT,
  lowest_count           BIGINT,
  highest_zat            BIGINT,
  highest_count          BIGINT,
    -- Arbitrary among ties, and meaningful only when `highest_count` is 1.
  highest_txid           TEXT,
  highest_height         INTEGER,
  considered             BIGINT,
  covered_through_height INTEGER NOT NULL DEFAULT 0,
  updated_at             BIGINT
);

-- ---------------------------------------------------------------------------------------
-- The transparent rich list.
--
-- A balance is `sum(outputs to the address) − sum(inputs from it)`, exact: it matches the node's
-- own `getaddressbalance`, and the whole list reconciles with the node's transparent value pool
-- once value belonging to no single address (bare-pubkey, OP_RETURN and multisig outputs) is added.
--
-- These are tables maintained per block, not materialized views: a full aggregate over
-- `tx_transparent_io` reads the whole table off disk on every pass and cannot keep up. Maintained
-- forward, the cost does not grow with the chain: `applyBalanceDelta` aggregates one block's own
-- I/O rows by `txid` (the primary-key prefix, as `#deriveFees` uses) and upserts them. There is no
-- index on `block_height`, so keying the delta on a height range would reintroduce the full scan.
--
-- Rollback recomputes rather than reverses: `balance_zat` and `received_zat` would reverse by
-- arithmetic, but `first_height`/`last_height` are MIN/MAX with no inverse. `recomputeAddresses`
-- re-derives every affected address from `io_address_idx` after the delete.
--
-- Only addresses with a positive balance are held. A negative balance would mean a missing input,
-- so none should ever appear. A balance reaching exactly zero is deleted: the page lists holders,
-- and `recomputeAddresses` re-derives `received_zat` and `first_height` if the address is credited
-- again.
--
-- A rank is not stored: crediting one address renumbers everyone below it, so a stored rank meant
-- rewriting most of the table to keep it true. Readers count it from the keyset index instead
-- (`countAhead` in `network-routes.ts`). The `rank` column is no longer read or written; it stays
-- until a separate migration drops it, so an API image older than that change keeps working.
--
-- Do not size a plan over `tx_transparent_io` from EXPLAIN: the planner badly underestimates
-- n_distinct(address), as it does for `txid` above.
CREATE TABLE IF NOT EXISTS chain_address_balance (
  address      TEXT PRIMARY KEY,
  balance_zat  BIGINT NOT NULL,
  received_zat BIGINT NOT NULL,
  first_height INTEGER NOT NULL,
  last_height  INTEGER NOT NULL,
    -- Unread and unwritten (see above); left for a separate migration to drop.
  rank         BIGINT NOT NULL DEFAULT 0,
    -- Transactions this address appears in, either side. Nullable, unlike `rank`: an address in
    -- this table has at least one transaction, so 0 is never true and NULL is the honest "not
    -- computed yet". The delta adds to this column and `NULL + n` stays NULL, so an unfilled row
    -- stays visibly unknown instead of starting a running total from zero.
  tx_count     BIGINT
);

-- Existing rows get NULL when this column is added; `repair-tx-count.mjs` fills them online while
-- the follower keeps ingesting, and until then a NULL renders as "unknown".
--
-- That job walks block height, not address space (reasoning in `server/tx-count-backfill.ts`): a
-- txid belongs to exactly one block, so per-address counts are additive across disjoint height
-- ranges, and a height range's rows are physically clustered.
--
-- Its staging tables are created by the job and deliberately not declared here, since this file is
-- re-applied on every boot.
ALTER TABLE chain_address_balance ADD COLUMN IF NOT EXISTS tx_count BIGINT;

-- The keyset. `balance_zat` is not unique (round balances are common), so the address is the
-- tiebreak and both columns are in the cursor.
CREATE INDEX IF NOT EXISTS chain_address_balance_keyset_idx
  ON chain_address_balance (balance_zat DESC, address);

-- The two facts the rich list needs beside the balances, as a single row.
--
-- `unattributed_zat` is transparent value belonging to no single address (bare-pubkey outputs,
-- OP_RETURN, multisig), so the page can state the gap between its total and the node's transparent
-- value pool. A running total, like the balances.
--
-- `computed_height` is the height the balances cover. Read it from here, never from the live tip:
-- the two diverge whenever ingestion stalls. Reconciling against the node's transparent pool has
-- the same requirement: compare at a fixed height.
--
-- `id` pins the table to one row.
CREATE TABLE IF NOT EXISTS chain_rich_list_meta (
  id               BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  unattributed_zat BIGINT NOT NULL DEFAULT 0,
  computed_height  INTEGER NOT NULL DEFAULT 0
);

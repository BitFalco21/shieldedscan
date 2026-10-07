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
-- The monthly series, materialised: about a hundred rows derived from millions, which would
-- otherwise be two sequential scans of `block` on every analytics read (raising `work_mem` does
-- not help; the cost is the scan).
--
-- In the follower's schema rather than the API's: the follower owns `block` and is its only writer,
-- so it is the process that knows when a refresh is due. The follower therefore ships before the
-- API reads a new view.
--
-- The unique index is required: REFRESH ... CONCURRENTLY needs one, and without CONCURRENTLY a
-- refresh takes an ACCESS EXCLUSIVE lock that would block every analytics read for its duration.
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

-- ---------------------------------------------------------------------------------------
-- Monthly gross shielding flow: what crossed the privacy boundary, in both directions.
--
-- Net flow hides the volume: a day with roughly equal shielding and unshielding nets to nearly
-- zero while large amounts moved. Both directions are stored and the net is derived from them.
--
-- Summed from each transaction's own value balances, not differenced from day-end pool totals (a
-- total can only yield the net). Its own view rather than columns on `chain_month_rollup`, because
-- that one aggregates `block` and this one `tx`, so a combined refresh would make the cheap view
-- pay for the expensive one.
--
-- Sign conventions (getting either wrong inverts the chart):
--   * `*_value_balance_zat` are stored in domain sign: positive = value entering that pool.
--   * `sprout_vpub_net_zat` is stored in RPC sign: positive = value leaving Sprout, so it is
--     subtracted to match its neighbours.
--
-- Sprout is included: omitting it would report zero shielding for the whole 2016-2018 era.
--
-- Coinbase is excluded: a block subsidy paid into a shielded pool is issuance, not a user choosing
-- privacy.
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

-- ---------------------------------------------------------------------------------------
-- Monthly fee distribution by privacy kind. ZIP-317 prices logical actions, so a transparent sweep
-- of many UTXOs typically costs more than a small shielded spend. The matview carries the monthly
-- trend; the endpoint adds a live recent window.
--
-- Percentiles, never means: the fee distribution is heavy-tailed (it includes genuine fat-finger
-- fees), and a mean would let one mistake move a whole year's line.
--
-- Same conventions as its siblings: derived from `tx`, so its own refresh; unique index for
-- CONCURRENTLY; refreshed by the follower. Coinbase is excluded because a coinbase has no fee.
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

-- Transaction counts by privacy kind, for the "A total of X transactions" lines. A COUNT(*) over
-- `tx` per page view is unaffordable; a matview refreshed on the follower's cadence makes it one
-- index seek, and a headline total that is minutes stale is honest for a figure that only grows.
-- Blocks need no counterpart (their total is tip+1), and cross-chain counts query live.
CREATE MATERIALIZED VIEW IF NOT EXISTS chain_tx_kind_count AS
  SELECT kind, count(*)::bigint AS txs
    FROM tx
   WHERE block_height IS NOT NULL
   GROUP BY kind
   ORDER BY kind;

CREATE UNIQUE INDEX IF NOT EXISTS chain_tx_kind_count_idx ON chain_tx_kind_count (kind);

-- The same totals for the two sub-filters `mixed` refines into.
--
-- A separate view rather than a second GROUP BY column on `chain_tx_kind_count`, because that view
-- is written by the follower and read by the API, deployed at different moments: adding
-- `direction` to its GROUP BY would, during a deploy window, return several rows for 'mixed' and
-- the route's fold would publish a fraction of the MIXED total as the whole. An API that does not
-- know this view simply does not query it.
--
-- `direction IS NOT NULL` excludes not-yet-backfilled rows and makes the column non-null, which
-- lets the unique index below exist (REFRESH ... CONCURRENTLY requires one).
CREATE MATERIALIZED VIEW IF NOT EXISTS chain_tx_mixed_direction_count AS
  SELECT direction, count(*)::bigint AS txs
    FROM tx
   WHERE kind = 'mixed' AND block_height IS NOT NULL AND direction IS NOT NULL
   GROUP BY direction
   ORDER BY direction;

CREATE UNIQUE INDEX IF NOT EXISTS chain_tx_mixed_direction_count_idx
  ON chain_tx_mixed_direction_count (direction);

-- ---------------------------------------------------------------------------------------
-- The daily siblings of the three monthly views above, for the chart range toggles: thirty days
-- of a monthly series is one point, so every range short of "all" needs day grain, materialised
-- for the same reason as the monthly views (the derivations scan `block` and `tx`).
--
-- Same contracts as their monthly siblings: closing pool balances via DISTINCT ON (never max, a
-- pool can fall within a day), the shielding-flow sign conventions (domain sign for value
-- balances, RPC sign for Sprout's vpub net, coinbase excluded), fee percentiles never means, and a
-- unique index on each because REFRESH ... CONCURRENTLY requires one.
--
-- The follower refreshes these hourly (see follow-main.ts), slower than the monthly set: a
-- day-grain series changes perceptibly once a day.
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

-- ---------------------------------------------------------- column rename to unshielded_zat
-- Renames the older column name to `unshielded_zat` on existing databases, where the
-- `CREATE MATERIALIZED VIEW IF NOT EXISTS` above is a no-op. Metadata-only: the data, the unique
-- `ts` index and `REFRESH ... CONCURRENTLY` all survive, so neither view is rebuilt.
--
-- The exception form is required: a guard on `information_schema.columns` would silently do
-- nothing, because materialized views do not appear in `information_schema`. Catching
-- `undefined_column` cannot be fooled that way, and matches the `duplicate_object` blocks above.
DO $$
BEGIN
  ALTER MATERIALIZED VIEW chain_month_shielding_flow
    RENAME COLUMN deshielded_zat TO unshielded_zat;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER MATERIALIZED VIEW chain_day_shielding_flow
    RENAME COLUMN deshielded_zat TO unshielded_zat;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

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

-- ---------------------------------------------------------------------------------------
-- Total fees paid per day: what the whole network pays (miner revenue beyond the subsidy), as
-- opposed to `chain_day_fee_kind`'s percentiles of what one transaction costs.
--
-- A SUM, so derived from `block` rather than `tx`: `total_fee_zat` is already the block's summed
-- figure. Coverage travels with the total: a block's fee total is NULL when one of its
-- transactions has an unresolvable input, and a sum over the measurable blocks alone needs its
-- denominator beside it.
--
-- Daily only: the monthly grain is aggregated from these rows at query time, which is instant.
CREATE MATERIALIZED VIEW IF NOT EXISTS chain_day_fee_total AS
  SELECT EXTRACT(EPOCH FROM date_trunc('day', to_timestamp(timestamp)))::bigint AS ts,
         COALESCE(SUM(total_fee_zat), 0)::bigint AS fee_zat,
         COUNT(*)::int                          AS blocks,
         COUNT(total_fee_zat)::int              AS blocks_covered
    FROM block
   GROUP BY 1
   ORDER BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS chain_day_fee_total_ts_idx ON chain_day_fee_total (ts);

-- ---------------------------------------------------------------------------------------
-- The directed pool-to-pool migration matrix, one row per (day, destination, source).
--
-- `poolMigration`'s definition (src/domain/pool.ts) in SQL at day grain: no transparent side
-- (`kind = 'shielded'`), exactly one pool gaining (the destination, whose own published balance is
-- the amount) and at least one losing. Two pools gaining is the shape the domain refuses to
-- apportion and is excluded; two or more sources are filed under 'multi' rather than split.
--
-- Signs: stored bundle balances are domain sign (positive = value entering that pool) while
-- `sprout_vpub_net_zat` is RPC sign (positive = leaving Sprout), so it is negated up front and all
-- four pools then read alike.
--
-- A deliberate second copy of the classification in `POOL_MIGRATION_MATRIX_SQL`
-- (server/analytics-routes.ts): a TypeScript constant cannot be interpolated into a .sql file the
-- follower applies verbatim, so `server/__tests__/pool-matview-agreement.test.ts` runs both over
-- one window and asserts identical rows. Do not edit one without the other.
--
-- No prices are stored: `zec_price_daily` lives in `schema.sql`, which the API applies, so a join
-- here would make two separately applied schemas depend on each other. USD is a read-time join on
-- `day`, which also stays current when a close is revised; `fx_rate_daily` converts each era at its
-- own rate the same way.
--
-- WITH NO DATA is required: this file is re-applied in one transaction on every container start,
-- so populating a large aggregate here would hold locks through a boot. It is filled by
-- `npm run fill:pool-analytics` and refreshed by `refreshPoolAnalytics()`.
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

-- Required by REFRESH ... CONCURRENTLY, and it is the natural key.
CREATE UNIQUE INDEX IF NOT EXISTS chain_day_pool_migration_key_idx
  ON chain_day_pool_migration (day, destination, source);

-- ---------------------------------------------------------------------------------------
-- Per-pool transaction counts and gross value flow, one row per (day, pool), so windows wider than
-- the exact `tx` scan can afford (`POOL_TX_COUNT_MAX_BLOCKS`) are a sum over day rows.
--
-- Gross, not net: a single transaction's balance is one signed number and is never split; the
-- gross figures sum positives and negatives separately across the day's transactions.
--
-- `txs` counts transactions that used the pool, including fully shielded transfers that never
-- crossed its boundary. It is neither inflow nor shielding.
--
-- Sprout is a different quantity: it publishes no per-bundle value balance (`reportsValueBalance`),
-- so its flow here is the public JoinSplit value (`sprout_vpub_net_zat`, negated into domain sign).
-- The read layer names the difference.
--
-- No prices here either (see the view above).
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

-- ---------------------------------------------------------------------------------------
-- Daily difficulty and average block size, materialised like its daily siblings so the series is
-- not a GROUP BY over all of `block` on every cache miss.
--
-- AVG, not a closing value: difficulty and block size are properties of each block rather than a
-- running total, so the day's mean is the honest summary.
CREATE MATERIALIZED VIEW IF NOT EXISTS chain_day_network AS
  SELECT EXTRACT(EPOCH FROM date_trunc('day', to_timestamp(timestamp)))::bigint AS ts,
         AVG(difficulty)                  AS avg_difficulty,
         AVG(size_bytes)                  AS avg_block_bytes,
         COUNT(*)::int                    AS blocks
    FROM block
   GROUP BY 1
   ORDER BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS chain_day_network_ts_idx ON chain_day_network (ts);

-- ---------------------------------------------------------------------------------------
-- Fee extremes: the lowest and highest fee ever paid, by a transaction and by a block. The fee
-- views serve percentiles, and a percentile is not a minimum.
--
-- Its own view rather than columns on `chain_day_fee_kind`: changing an existing matview's
-- definition means DROP + CREATE, and this file is re-applied on every start, so a redefinition
-- would re-scan `tx` on every restart; per-day tie counts would also slow views live charts depend
-- on.
--
-- WITH NO DATA, like `chain_address_balance`: populating at CREATE time would put the scan inside
-- the schema transaction. `refreshFeeExtremes` fills it, and the route answers 503 until it has.
--
-- The tie counts matter: both minima are zero and shared by very many transactions and blocks, so
-- "the lowest-fee transaction" has no single answer. `*_id` is meaningful only when the matching
-- count is 1, and every consumer must check that.
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

-- Required for REFRESH ... CONCURRENTLY; `scope` is the natural key (two rows).
CREATE UNIQUE INDEX IF NOT EXISTS chain_fee_extremes_scope_idx ON chain_fee_extremes (scope);

-- ---------------------------------------------------------------------------------------
-- The non-zero fee floor, which the extremes above cannot answer: their minimum is 0 with many
-- ties.
--
-- A separate view rather than columns on `chain_fee_extremes`: changing an existing matview means
-- DROP + CREATE, and `IF NOT EXISTS` would leave existing databases on the old definition while a
-- fresh one got the new. Same WITH NO DATA reasoning; `refreshFeeExtremes` fills both.
--
-- The id/height columns are meaningful only when `lowest_count` is 1 (small fees repeat), so every
-- consumer must check the count before naming anything.
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
-- `rank` is stored, because a keyset has no offset to count an absolute rank from. A per-block
-- delta cannot maintain it (crediting one address renumbers everyone below it), so
-- `refreshRichListRanks` rewrites it hourly from this table alone. It reads the ordering in one
-- pass and applies it in rank-order batches: a single `UPDATE … FROM (SELECT row_number() …)` would
-- hold row locks the per-block delta needs for its whole duration. The keyset index below is that
-- window's ORDER BY, so the read is an index-only scan with no sort, and rank-order batches leave a
-- partly applied pass as a prefix/suffix split.
--
-- Do not size a plan over `tx_transparent_io` from EXPLAIN: the planner badly underestimates
-- n_distinct(address), as it does for `txid` above.
CREATE TABLE IF NOT EXISTS chain_address_balance (
  address      TEXT PRIMARY KEY,
  balance_zat  BIGINT NOT NULL,
  received_zat BIGINT NOT NULL,
  first_height INTEGER NOT NULL,
  last_height  INTEGER NOT NULL,
    -- 0 until the first rank pass. Never NULL: a NULL would render as a blank rank rather than a
    -- stale one.
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

-- ---------------------------------------------------------------------------------------
-- The shielded boundary at day grain, one row per (day, pool), plus one 'hub' row per day, for
-- `/pulse`'s ribbons: how much crossed at each pool.
--
-- The SQL twin of `boundaryCrossing` (src/domain/classify.ts), a deliberate second copy because a
-- TypeScript function cannot be interpolated into a .sql file applied verbatim.
-- `server/__tests__/pulse-matview-agreement.test.ts` checks agreement by summing
-- `pulseEventForTx`'s own legs over a UTC day and comparing row for row.
--
-- The classification, in the order the domain applies it:
--
--  * `kind = 'coinbase'` is issuance, never a crossing. Its pool legs are filed under
--    `coinbase_zat` and its transparent outputs are not here at all: the mined edges are measured
--    from `chain_day_supply_close`, because coinbase outputs include collected fees.
--  * A `mixed` row follows its stored `direction` (written by the domain's `txDirection`) only
--    while no published pool contradicts it. A transaction spending transparent and Sapling into
--    Orchard is net shielding while Sapling fell; that is `boundaryCrossing`'s withdrawal, filed
--    under 'hub'.
--  * `direction = 'indeterminate'` (pools moved opposite ways) is a hub row by definition, and so
--    is a NULL direction (not yet backfilled).
--  * Sprout is not part of the contradiction test, as `publishedBalances` excludes it: it publishes
--    no per-bundle balance, so it cannot contradict anything. It still gets a leg, filed under the
--    row's direction and sized on its public JoinSplit value, a different accounting that the read
--    layer marks (`vpubDerived`).
--
-- Signs: stored bundle balances are domain sign (positive = entering) and `sprout_vpub_net_zat` is
-- RPC sign (positive = leaving), so it is negated once up front. Sprout's sign does not affect any
-- figure in this view (a leg is a magnitude filed under the row's direction), but the negation is
-- kept so a future edit that reads a sign does not inherit the RPC convention.
--
-- A pool that is present but moved nothing contributes no leg, and an absent pool contributes none
-- either: presence is tested on the bundle column, never on the balance.
--
-- WITH NO DATA, as for `chain_day_pool_migration`.
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

-- Required by REFRESH ... CONCURRENTLY, and it is the natural key.
CREATE UNIQUE INDEX IF NOT EXISTS chain_day_pool_boundary_key_idx
  ON chain_day_pool_boundary (day, pool);

-- ---------------------------------------------------------------------------------------
-- The six value-pool closes at the last block of each UTC day, for `/pulse`.
--
-- `chain_day_rollup` carries four of them but coalesces each to zero, right for a chart and wrong
-- here: the mined edge is the difference of the six closes, so a pool read as zero would make the
-- difference wrong. `issuanceZatBetween` refuses the whole answer when any close is absent, which
-- needs the absence to survive the view.
--
-- DISTINCT ON (day) ... ORDER BY day, height DESC is the closing balance, never max(): a pool can
-- fall within a day.
--
-- The hash and header time ride along so a reader of this view is a `PulseBlockPools` without
-- inventing anything: a figure names the block it was measured at.
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

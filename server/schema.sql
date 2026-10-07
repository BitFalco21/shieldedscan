-- Cross-chain transfers, and the ingest bookkeeping that lets a restart resume.
--
-- Zatoshis are BIGINT and timestamps BIGINT unix seconds, consistent with the `tx` table, so
-- crosschain_transfer.zcash_txid -> tx.txid is a plain SQL join.
--
-- Applied idempotently on service boot; safe to re-run.

CREATE TABLE IF NOT EXISTS crosschain_transfer (
  id                  TEXT PRIMARY KEY,          -- venue-prefixed, the upsert key
  protocol            TEXT   NOT NULL,
  direction           TEXT   NOT NULL CHECK (direction IN ('in', 'out')),
  status              TEXT   NOT NULL CHECK (status IN ('completed', 'pending', 'refunded')),
  timestamp           BIGINT NOT NULL,           -- unix seconds

  counterpart_chain   TEXT   NOT NULL,
  counterpart_asset   TEXT   NOT NULL,
  counterpart_amount  DOUBLE PRECISION,          -- decimal asset units; NULL = unsettled
  counterpart_tx_hash TEXT,
  counterpart_address TEXT,
  -- A wrapped claim (Maya synth `ZEC/ZEC`) rather than the asset itself.
  counterpart_is_synthetic BOOLEAN NOT NULL DEFAULT false,

  zcash_txid          TEXT,
  zcash_address       TEXT,
    -- Derived at ingest by classifyZcashAddress, not by a SQL regex: the TypeScript classifier is
    -- the single source of truth (it also drives the UI). Stored so "what share of inbound ZEC
    -- lands somewhere shielded-capable" is a GROUP BY.
  zcash_address_kind  TEXT CHECK (zcash_address_kind IN ('transparent', 'sapling', 'unified')),

  zec_amount_zat      BIGINT NOT NULL,
  usd_value_at_swap   DOUBLE PRECISION,          -- venue's own price at swap time

  first_seen_at       BIGINT NOT NULL,           -- when WE first stored it, not chain time
  updated_at          BIGINT NOT NULL
);

-- Migrations for tables that already exist. `CREATE TABLE IF NOT EXISTS` is a no-op once the
-- table exists, so every later column needs its own idempotent ALTER, or a fresh database and an
-- upgraded one would end up with different schemas.
ALTER TABLE crosschain_transfer
  ADD COLUMN IF NOT EXISTS counterpart_is_synthetic BOOLEAN NOT NULL DEFAULT false;

-- The counterpart leg's venue-published USD value. NULL on rows ingested before the column
-- existed: honest gaps, not zeros.
ALTER TABLE crosschain_transfer
  ADD COLUMN IF NOT EXISTS counterpart_usd_at_swap DOUBLE PRECISION;

-- The venue's own deposit address: the key NEAR Intents' explorer indexes by (see
-- `lib/venue-links.ts`). NULL on rows ingested before the column existed; the head poller's
-- re-upserts fill recent rows, and older ones need a venue re-backfill.
ALTER TABLE crosschain_transfer
  ADD COLUMN IF NOT EXISTS venue_deposit_address TEXT;

-- The keyset index. Both columns DESC so `WHERE (timestamp, id) < ($ts, $id)
-- ORDER BY timestamp DESC, id DESC` is one index scan with no sort.
CREATE INDEX IF NOT EXISTS crosschain_transfer_keyset_idx
  ON crosschain_transfer (timestamp DESC, id DESC);

-- The default read path hides venue settlement legs (ZEC<->CACAO, ZEC<->RUNE), so that predicate
-- gets its own index. Filtered by asset, not chain: wrapped ZEC lives on MAYA too, and a chain
-- filter would drop every ZEC-to-wrapped-ZEC transfer. `IF NOT EXISTS` keeps an existing index's
-- predicate, so changing this one needs a one-off DROP, not a permanent one here.
CREATE INDEX IF NOT EXISTS crosschain_transfer_public_keyset_idx
  ON crosschain_transfer (timestamp DESC, id DESC)
  WHERE counterpart_asset NOT IN ('CACAO', 'RUNE');

-- The `/tx` page asks "is this transaction a swap's Zcash leg?" on every view, so the lookup is one
-- seek. Partial: a pending leg's txid is NULL and is never looked up.
CREATE INDEX IF NOT EXISTS crosschain_transfer_zcash_txid_idx
  ON crosschain_transfer (zcash_txid)
  WHERE zcash_txid IS NOT NULL;

-- Supports the shielded-capable-destination statistic and per-chain rollups.
CREATE INDEX IF NOT EXISTS crosschain_transfer_kind_idx
  ON crosschain_transfer (direction, zcash_address_kind);

-- Per-venue liveness and resumable backfill offsets. One row per key, JSON payload so a
-- new ingest job does not need a migration.
CREATE TABLE IF NOT EXISTS ingest_state (
  key        TEXT PRIMARY KEY,
  state      JSONB  NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Daily ZEC/USD closes, one row per day since launch.
--
-- `source` matters: there is no canonical daily ZEC price. Free aggregators (Yahoo Finance's
-- daily close and CoinCodex) typically differ by a couple of percent on the same day, and by far
-- more in thin early periods, because they aggregate different exchanges by different methods.
-- Storing a price without naming its source would publish one aggregator's figure as the price.
--
-- The primary source is `yahoo` (true daily closes) from 2017-11-09; `coincodex` fills
-- 2016-10-29..2017-11-08, the launch year no free source covers with real closes.
CREATE TABLE IF NOT EXISTS zec_price_daily (
  day        DATE PRIMARY KEY,
  usd        DOUBLE PRECISION NOT NULL CHECK (usd >= 0),
  source     TEXT NOT NULL,
  fetched_at BIGINT NOT NULL
);

-- Daily USD→currency rates, so a ZEC amount can be valued in another currency without a second
-- price history per currency:
--
--     ZEC in X on day D  =  zec_price_daily.usd(D)  ×  fx_rate_daily.rate(D, X)
--
-- `rate` is always units of the currency per one USD, fiat and BTC alike. `rate_day` is the day
-- the rate was published: the ECB quotes business days only, and a carried day shows the previous
-- publication here instead of silently duplicating it.
CREATE TABLE IF NOT EXISTS fx_rate_daily (
  day        DATE NOT NULL,
  currency   TEXT NOT NULL,
  rate       DOUBLE PRECISION NOT NULL CHECK (rate > 0),
  rate_day   DATE NOT NULL,
  source     TEXT NOT NULL,
  fetched_at BIGINT NOT NULL,
  PRIMARY KEY (day, currency)
);

-- The /ai-agent endpoint's daily token meter. One row per UTC day.
--
-- A keyless LLM endpoint is the one surface here where a request costs real money, so it needs a
-- bound a per-IP rate limit cannot provide against a distributed caller.
--
-- A per-day counter, not a per-client quota: a quota means storing usage against an identity,
-- which keeping no visitor logs rules out. It lives in Postgres rather than memory so a
-- container restart does not reset the budget.
CREATE TABLE IF NOT EXISTS agent_budget (
  day        DATE   PRIMARY KEY,
  tokens_in  BIGINT NOT NULL DEFAULT 0,
  tokens_out BIGINT NOT NULL DEFAULT 0,
  requests   BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

-- The admission bucket beside the meter: capacity = the daily budget, refilling at budget/86400
-- tokens per second, so a drain costs everyone else at most an hour rather than the rest of the
-- UTC day. One row, no caller identity. Mirrored in `agent/budget.ts`.
CREATE TABLE IF NOT EXISTS agent_budget_bucket (
  id         SMALLINT PRIMARY KEY CHECK (id = 1),
  level      BIGINT   NOT NULL,
  updated_at BIGINT   NOT NULL
);

-- Market capitalisations for `/compare`, refreshed every few minutes by `MarketCapTracker`.
--
-- The whole table is replaced on every successful poll: rows absent from the latest response are
-- deleted, so an asset that drops out of the upstream's top 250 cannot linger at its last market
-- cap as if current.
--
-- `market_cap_usd` is the upstream's own figure, never recomputed as
-- `price_usd * circulating_supply` (the two come from different snapshots).
--
-- `is_stablecoin` comes from the upstream's own category, so a new stablecoin is excluded from the
-- picker with no code change.
CREATE TABLE IF NOT EXISTS coin_market (
  id                 TEXT PRIMARY KEY,
  symbol             TEXT NOT NULL,
  name               TEXT NOT NULL,
  market_cap_usd     DOUBLE PRECISION NOT NULL CHECK (market_cap_usd > 0),
  price_usd          DOUBLE PRECISION NOT NULL,
  circulating_supply DOUBLE PRECISION NOT NULL,
  market_cap_rank    INTEGER,
  is_stablecoin      BOOLEAN NOT NULL,
  fetched_at         BIGINT NOT NULL
);

-- What the X account has published, and what it deliberately did not.
--
-- `claimed` is written before the X call and is never retried: after a crash mid-post we cannot
-- tell whether X accepted it, and a duplicate post is worse than a missed one.
--
-- `figures` is the snapshot exactly as published. The card route re-renders from this row, so the
-- image, the text and the audit record are one set of numbers.
CREATE TABLE IF NOT EXISTS social_post (
  kind       TEXT   NOT NULL,          -- daily | swap | shielding | unshielding
  event_key  TEXT   NOT NULL,          -- Paris day for daily; txid or transfer id for events
  status     TEXT   NOT NULL           -- claimed | posted | skipped | superseded | failed
             CHECK (status IN ('claimed','posted','skipped','superseded','failed')),
  reason     TEXT,
  figures    JSONB,
  tweet_id   TEXT,
  created_at BIGINT NOT NULL,
  posted_at  BIGINT,
  PRIMARY KEY (kind, event_key)
);

-- How far the poster has considered each kind of event. Separate from `social_post` because that
-- table records what was decided and this one what was looked at. A kind with no row has
-- considered nothing.
--
-- The value is opaque to this table (a timestamp for a venue feed, a height for a chain walk), so
-- a new kind needs no migration.
CREATE TABLE IF NOT EXISTS social_watermark (
  kind       TEXT PRIMARY KEY,
  value      TEXT   NOT NULL,
  updated_at BIGINT NOT NULL
);

-- How each shielded pool was used, per UTC day, and how many notes it held at the day's last block.
-- Written by the API's `PoolUsageTracker` (`server/pool-usage.ts`), not a follower matview, so no
-- follower redeploy is needed. The last three days are recomputed on every pass, absorbing late
-- blocks and reorgs. One row per (day, pool).
--
-- `txs` counts transactions that used the pool (carried a bundle in it), as `chain_day_pool_tx`
-- does, so the two can be held against each other; the kind columns partition it (fully shielded,
-- mixed or coinbase). The bundle columns are per pool (Sapling spends and outputs, Orchard and
-- Ironwood actions, Sprout JoinSplits); the others are NULL, never 0. `notes_at_close` is the
-- note commitment tree size at `close_height`: NULL for Sprout (the node reports none) and before
-- a pool activated.
CREATE TABLE IF NOT EXISTS pool_usage_daily (
  day            DATE    NOT NULL,
  pool           TEXT    NOT NULL CHECK (pool IN ('sprout', 'sapling', 'orchard', 'ironwood')),
  txs            INTEGER NOT NULL,
  fully_shielded INTEGER NOT NULL,
  mixed          INTEGER NOT NULL,
  shielding      INTEGER NOT NULL,
  unshielding    INTEGER NOT NULL,
  indeterminate  INTEGER NOT NULL,
  coinbase       INTEGER NOT NULL,
  spends         BIGINT,
  outputs        BIGINT,
  actions        BIGINT,
  joinsplits     BIGINT,
  notes_at_close BIGINT,
  close_height   INTEGER,
  computed_at    BIGINT  NOT NULL,
  PRIMARY KEY (day, pool)
);

-- What crossed the shielded boundary, per UTC day, kept by the same paced tracker as
-- `pool_usage_daily`. Two jobs:
--  - the per-transaction direction counts that `loadChainWindow` reads for every covered day,
--    reading `tx` only for the newest two days or wherever coverage stops;
--  - the day's largest shielding, unshielding and pool migration, the source of the all-time
--    records. A txid is stored only when that day's maximum is unique (`*_ties` = 1).
-- Amounts follow `chain_day_pool_migration`'s signs: value-balance columns in domain sign,
-- Sprout's `vpub_net` negated. A migration is that view's predicate, held to it by a parity test:
-- one pool gaining, at least one losing, no transparent side (`kind = 'shielded'`).
CREATE TABLE IF NOT EXISTS boundary_daily (
  day                  DATE    PRIMARY KEY,
  shielding_txs        BIGINT  NOT NULL,
  unshielding_txs      BIGINT  NOT NULL,
  indeterminate_txs    BIGINT  NOT NULL,
  migration_txs        BIGINT  NOT NULL,
  max_shielding_zat    BIGINT,
  max_shielding_ties   INTEGER NOT NULL,
  max_shielding_txid   TEXT,
  max_unshielding_zat  BIGINT,
  max_unshielding_ties INTEGER NOT NULL,
  max_unshielding_txid TEXT,
  max_migration_zat    BIGINT,
  max_migration_ties   INTEGER NOT NULL,
  max_migration_txid   TEXT,
  computed_at          BIGINT  NOT NULL
);

-- Who mined each UTC day, by payout address, kept by the same paced tracker as the two tables
-- above, for `/v1/analytics/miners`: any window, all of history included, is a sum over these rows
-- instead of a scan of `block`. Built from the miner columns written from `parseBlock`, so nothing
-- here re-derives a miner.
--
-- `mining_day` is one row per computed day; a day whose blocks still had no recorded miner keeps
-- its count in `unrecorded_blocks` and is recomputed (hourly at most) until that reaches zero.
CREATE TABLE IF NOT EXISTS mining_day (
  day               DATE    PRIMARY KEY,
  blocks            INTEGER NOT NULL,
  unrecorded_blocks INTEGER NOT NULL,
  computed_at       BIGINT  NOT NULL
);
-- The day's first and last block, over all its blocks: a window of whole days has exactly the
-- bounds of its days, so `windowHeightRange` reads these instead of scanning every block in the
-- window. NULL only on a row computed before they existed, which is recomputed.
ALTER TABLE mining_day ADD COLUMN IF NOT EXISTS first_height INTEGER;
ALTER TABLE mining_day ADD COLUMN IF NOT EXISTS last_height INTEGER;
-- One row per (day, kind, payout address). `address` is '' for a shielded coinbase (ZIP 213) and
-- for one whose largest output names no address (a bare public key, used by some early miners):
-- neither has an address to group by. Two addresses are never merged.
-- `reward_zat` is the miner's own outputs, NULL unless every block in the row carries one (NULL
-- for both address-less kinds, `minerRewardZat`'s rule); fees are summed over the blocks whose fee
-- total is known, and `fee_blocks` says how many those were.
CREATE TABLE IF NOT EXISTS mining_day_payout (
  day          DATE    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('transparent', 'shielded', 'unknown')),
  address      TEXT    NOT NULL,
  blocks       INTEGER NOT NULL,
  reward_zat   BIGINT,
  fee_zat      BIGINT  NOT NULL,
  fee_blocks   INTEGER NOT NULL,
  first_height INTEGER NOT NULL,
  last_height  INTEGER NOT NULL,
  PRIMARY KEY (day, kind, address)
);

-- Transparent volume and active addresses, kept by `TransparentTracker` in
-- `server/transparent-daily.ts` and read by `/v1/analytics/transparent`. API-owned, like the
-- tables above: a rollup of `tx` and `tx_transparent_io`, so the follower is untouched.
--
-- One row per UTC day. Volume is the day's non-coinbase transparent outputs and the inputs they
-- spent, split by the transaction's kind (`transparent` has no shielded side, `mixed` crosses the
-- boundary); the three address counts are exact distinct counts for that day.
CREATE TABLE IF NOT EXISTS transparent_daily (
  day                 DATE    PRIMARY KEY,
  outputs             INTEGER NOT NULL,
  unaddressed_outputs INTEGER NOT NULL,
  out_transparent_zat BIGINT  NOT NULL,
  out_mixed_zat       BIGINT  NOT NULL,
  inputs              INTEGER NOT NULL,
  unresolved_inputs   INTEGER NOT NULL,
  in_transparent_zat  BIGINT  NOT NULL,
  in_mixed_zat        BIGINT  NOT NULL,
  active_addresses    INTEGER NOT NULL,
  sending_addresses   INTEGER NOT NULL,
  receiving_addresses INTEGER NOT NULL,
  computed_at         BIGINT  NOT NULL
);

-- Each day's distinct addresses, which a month and a trailing window are counted from: a distinct
-- count never adds across days. A final month's rows are deleted once its days are older than the
-- retention window (`ADDRESS_RETENTION_DAYS`), so this holds about three months, not the chain.
CREATE TABLE IF NOT EXISTS transparent_day_address (
  day      DATE    NOT NULL,
  address  TEXT    NOT NULL,
  sent     BOOLEAN NOT NULL,
  received BOOLEAN NOT NULL,
  PRIMARY KEY (day, address)
);

-- One row per calendar month: exact distinct counts over the month's days. `complete` once the
-- month has ended outside the newest three days; until then the count is the month so far, over
-- `days` days.
CREATE TABLE IF NOT EXISTS transparent_monthly (
  month               DATE    PRIMARY KEY,
  active_addresses    INTEGER NOT NULL,
  sending_addresses   INTEGER NOT NULL,
  receiving_addresses INTEGER NOT NULL,
  days                INTEGER NOT NULL,
  complete            BOOLEAN NOT NULL,
  computed_at         BIGINT  NOT NULL
);

-- The trailing 7, 30 and 90 complete UTC days, ending `last_day`: exact distinct counts.
CREATE TABLE IF NOT EXISTS transparent_trailing (
  days                INTEGER PRIMARY KEY,
  last_day            DATE    NOT NULL,
  active_addresses    INTEGER NOT NULL,
  sending_addresses   INTEGER NOT NULL,
  receiving_addresses INTEGER NOT NULL,
  computed_at         BIGINT  NOT NULL
);

-- How many transactions every transparent address appears in, kept by `AddressCountTracker` in
-- `server/address-counts.ts` for all addresses, emptied ones included. Additive: a transaction is
-- in one block, so counts over disjoint height ranges sum. Stored only through `applied_height`,
-- at least the reorg depth below the tip, moved in the same transaction as the counts it covers;
-- blocks above it are counted live when read. Each pass rewrites only the count of each address it
-- touches, so pages keep room for an updated row beside the old one (a HOT update writes no index
-- entry).
CREATE TABLE IF NOT EXISTS address_tx_count (
  address  TEXT    PRIMARY KEY,
  tx_count INTEGER NOT NULL
) WITH (fillfactor = 90);

CREATE TABLE IF NOT EXISTS address_tx_count_state (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  applied_height INTEGER NOT NULL,
  updated_at     BIGINT  NOT NULL
);

-- The address-count backfill's append-only log: one (address, n) row per address per range, no
-- index, folded into address_tx_count once by `foldAddressLog`. Appending costs only the range's
-- own reads, where an upsert into the large table costs random page reads per address. UNLOGGED,
-- with an UNLOGGED watermark, so a crash empties both together and the backfill resumes from
-- address_tx_count_state: counts can be lost to a crash, never doubled.
CREATE UNLOGGED TABLE IF NOT EXISTS address_tx_count_log (
  address TEXT    NOT NULL,
  n       INTEGER NOT NULL
);

CREATE UNLOGGED TABLE IF NOT EXISTS address_tx_count_log_state (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  applied_height INTEGER NOT NULL
);

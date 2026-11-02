import type { ColumnSpec } from "./parquet";

/**
 * The published schema of every file, in order. The export reads exactly these columns from the
 * `opendata` views (`server/schema-opendata.sql`), and the schema gate holds every release to them:
 * a column added here is a deliberate decision, never a side effect of a base table changing.
 */

const c = (name: string, type: ColumnSpec["type"], nullable = false): ColumnSpec => ({
  name,
  type,
  nullable,
});

export const BLOCK_COLUMNS: readonly ColumnSpec[] = [
  c("height", "int32"),
  c("hash", "utf8"),
  c("prev_hash", "utf8"),
  c("timestamp", "int64"),
  c("size_bytes", "int32"),
  c("tx_count", "int32"),
  c("transparent_tx_count", "int32"),
  c("mixed_tx_count", "int32"),
  c("shielded_tx_count", "int32"),
  c("total_fee_zat", "int64", true),
  c("sapling_flow_zat", "int64"),
  c("orchard_flow_zat", "int64"),
  c("transparent_pool_zat", "int64", true),
  c("sprout_pool_zat", "int64", true),
  c("sapling_pool_zat", "int64", true),
  c("orchard_pool_zat", "int64", true),
  c("lockbox_pool_zat", "int64", true),
  c("ironwood_pool_zat", "int64", true),
  c("difficulty", "float64", true),
  c("miner_kind", "utf8", true),
  c("miner_reward_zat", "int64", true),
];

export const POOL_COLUMNS = [
  "transparent_pool_zat",
  "sprout_pool_zat",
  "sapling_pool_zat",
  "orchard_pool_zat",
  "lockbox_pool_zat",
  "ironwood_pool_zat",
] as const;

export const POOL_USAGE_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("pool", "utf8"),
  c("txs", "int32"),
  c("fully_shielded", "int32"),
  c("mixed", "int32"),
  c("shielding", "int32"),
  c("unshielding", "int32"),
  c("indeterminate", "int32"),
  c("coinbase", "int32"),
  c("spends", "int64", true),
  c("outputs", "int64", true),
  c("actions", "int64", true),
  c("joinsplits", "int64", true),
  c("notes_at_close", "int64", true),
  c("close_height", "int32", true),
];

export const SHIELDING_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("shielding_txs", "int64"),
  c("unshielding_txs", "int64"),
  c("indeterminate_txs", "int64"),
  c("migration_txs", "int64"),
];

export const TRANSPARENT_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("outputs", "int32"),
  c("unaddressed_outputs", "int32"),
  c("out_transparent_zat", "int64"),
  c("out_mixed_zat", "int64"),
  c("inputs", "int32"),
  c("unresolved_inputs", "int32"),
  c("in_transparent_zat", "int64"),
  c("in_mixed_zat", "int64"),
  c("active_addresses", "int32"),
  c("sending_addresses", "int32"),
  c("receiving_addresses", "int32"),
];

export const TRANSPARENT_MONTHLY_COLUMNS: readonly ColumnSpec[] = [
  c("month", "date"),
  c("active_addresses", "int32"),
  c("sending_addresses", "int32"),
  c("receiving_addresses", "int32"),
  c("days", "int32"),
];

export const NODE_RELEASES_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("client", "utf8"),
  c("version", "utf8", true),
  c("protocol_version", "int32", true),
  c("nodes", "int32"),
  c("behind_tip", "int32"),
  c("tip_unknown", "int32"),
];

export const REORG_COLUMNS: readonly ColumnSpec[] = [
  c("height", "int32"),
  c("depth", "int32"),
  c("orphaned_hash", "utf8"),
  c("replaced_by", "utf8"),
];

/** Heights per `blocks` file. Partitioned by height, never by date: miner timestamps can cross a year. */
export const BLOCKS_PER_FILE = 500_000;

/** File name for the `blocks` partition starting at `start`, zero-padded so names sort in order. */
export const blocksFile = (start: number) =>
  `blocks/${String(start).padStart(7, "0")}-${String(start + BLOCKS_PER_FILE - 1).padStart(7, "0")}.parquet`;

/**
 * One row per mined transaction: kind, direction, fee, size, and each shielded part with the value
 * it publicly moved into or out of its pool. Shielded amounts inside a pool are never known.
 */
export const TRANSACTION_COLUMNS: readonly ColumnSpec[] = [
  c("txid", "utf8"),
  c("block_height", "int32"),
  c("timestamp", "int64"),
  c("kind", "utf8"),
  c("direction", "utf8", true),
  c("version", "int32"),
  c("size_bytes", "int32"),
  c("expiry_height", "int32", true),
  c("fee_zat", "int64", true),
  c("sprout_joinsplits", "int32", true),
  c("sprout_vpub_net_zat", "int64", true),
  c("sapling_spends", "int32", true),
  c("sapling_outputs", "int32", true),
  c("sapling_value_balance_zat", "int64", true),
  c("orchard_actions", "int32", true),
  c("orchard_value_balance_zat", "int64", true),
  c("ironwood_actions", "int32", true),
  c("ironwood_value_balance_zat", "int64", true),
];

/** Heights per `transactions` file: small enough that the daily re-upload of the newest stays small. */
export const HEIGHTS_PER_TX_FILE = 100_000;

export const transactionsFile = (start: number) =>
  `transactions/${String(start).padStart(7, "0")}-${String(start + HEIGHTS_PER_TX_FILE - 1).padStart(7, "0")}.parquet`;

/** Computed from the exported blocks themselves, so it costs the database nothing. */
export const BLOCKS_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("blocks", "int32"),
  c("median_interval_s", "int32", true),
  c("p90_interval_s", "int32", true),
  c("max_interval_s", "int32", true),
  c("avg_size_bytes", "float64"),
  c("avg_difficulty", "float64", true),
  c("fees_zat", "int64"),
  c("blocks_with_fees", "int32"),
];

export const FEES_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("kind", "utf8"),
  c("txs", "int32"),
  c("p25_zat", "int64"),
  c("median_zat", "int64"),
  c("p75_zat", "int64"),
];

export const MINING_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("miner", "utf8"),
  c("blocks", "int32"),
];

/**
 * The transparent ledger: every input and output, one row each. Each range of
 * `HEIGHTS_PER_LEDGER_FILE` heights is split into parts of about `LEDGER_PART_ROWS` rows, cut at
 * block boundaries: some early-2017 ranges hold several times the 1.41M rows of the genesis range,
 * and a whole range in memory is what took the box down on 2026-11-01. Rows never change, so the
 * cut points never move. The span and the part size can never change once published.
 */
export const TRANSPARENT_IO_COLUMNS: readonly ColumnSpec[] = [
  c("txid", "utf8"),
  c("block_height", "int32"),
  c("io", "utf8"),
  c("ordinal", "int32"),
  c("address", "utf8", true),
  c("value_zat", "int64"),
  c("script_type", "utf8", true),
  c("prev_txid", "utf8", true),
  c("prev_vout", "int32", true),
];

/**
 * Per transaction, the transparent totals and the input/output counts by script type, so a
 * transaction's transparent side and its ZIP 317 bounds need no join with the ledger.
 */
export const TRANSACTIONS_EXTRA_COLUMNS: readonly ColumnSpec[] = [
  c("txid", "utf8"),
  c("block_height", "int32"),
  c("inputs", "int32"),
  c("outputs", "int32"),
  c("transparent_in_zat", "int64"),
  c("transparent_out_zat", "int64"),
  c("inputs_p2pkh", "int32"),
  c("inputs_p2sh", "int32"),
  c("inputs_p2pk", "int32"),
  c("inputs_other", "int32"),
  c("outputs_p2pkh", "int32"),
  c("outputs_p2sh", "int32"),
  c("outputs_p2pk", "int32"),
  c("outputs_other", "int32"),
  c("binding_sig_valid", "bool", true),
];

export const HEIGHTS_PER_LEDGER_FILE = 10_000;
/** Rows per ledger part, at most one block over: the memory a part costs is bounded by this. */
export const LEDGER_PART_ROWS = 500_000;

/** Bumped when the ledger's columns, span or writer change: a cache built for another is ignored. */
export const LEDGER_CACHE_VERSION = 2;

const ledgerRange = (start: number) =>
  `${String(start).padStart(7, "0")}-${String(start + HEIGHTS_PER_LEDGER_FILE - 1).padStart(7, "0")}`;
export const transparentIoFile = (start: number, part: number) =>
  `transparent_io/${ledgerRange(start)}-${String(part).padStart(3, "0")}.parquet`;
export const transactionsExtraFile = (start: number) =>
  `transactions_extra/${ledgerRange(start)}.parquet`;

/** Network solution rate per day, estimated from difficulty: never a measurement. */
export const HASHRATE_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("solutions_per_second", "float64", true),
];

export const SUPPLY_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("schedule_zat", "int64"),
  c("issued_zat", "int64", true),
  c("unclaimed_zat", "int64", true),
  c("nsm_zat", "int64", true),
  c("nsm_total_zat", "int64", true),
];

export const TX_VERSIONS_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("version", "int32"),
  c("txs", "int32"),
];

export const POOL_FLOWS_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("pool", "utf8"),
  c("inflow_zat", "int64"),
  c("outflow_zat", "int64"),
  c("txs", "int32"),
];

export const COINBASE_SHIELDED_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("coinbase_txs", "int32"),
  c("shielded_coinbase_txs", "int32"),
  c("to_sapling_zat", "int64"),
  c("to_orchard_zat", "int64"),
  c("to_ironwood_zat", "int64"),
];

/**
 * The site's precomputed series. Block- and transaction-derived ones are computed from the
 * export's own stream and the site's views are only their cross-checks; the rest are read from
 * the views (`server/opendata/site-views.ts`), where the stream does not hold the classification.
 */
export const TX_KINDS_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("transparent_txs", "int32"),
  c("mixed_txs", "int32"),
  c("shielded_txs", "int32"),
];

export const POOLS_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("top_height", "int32"),
  c("hash", "utf8"),
  c("transparent_pool_zat", "int64", true),
  c("sprout_pool_zat", "int64", true),
  c("sapling_pool_zat", "int64", true),
  c("orchard_pool_zat", "int64", true),
  c("lockbox_pool_zat", "int64", true),
  c("ironwood_pool_zat", "int64", true),
];

export const POOL_BOUNDARY_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("pool", "utf8"),
  c("shielded_zat", "int64"),
  c("shielded_txs", "int32"),
  c("unshielded_zat", "int64"),
  c("unshielded_txs", "int32"),
  c("coinbase_zat", "int64"),
  c("coinbase_txs", "int32"),
  c("hub_zat", "int64"),
  c("hub_txs", "int32"),
];

export const SHIELDING_FLOW_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("shielded_zat", "int64"),
  c("unshielded_zat", "int64"),
];

export const POOL_MIGRATION_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("destination", "utf8"),
  c("source", "utf8"),
  c("txs", "int32"),
  c("zat", "int64"),
];

export const FEES_MONTHLY_COLUMNS: readonly ColumnSpec[] = [
  c("month", "date"),
  c("kind", "utf8"),
  c("txs", "int32"),
  c("p25_zat", "int64"),
  c("median_zat", "int64"),
  c("p75_zat", "int64"),
];

export const SHIELDING_RECORDS_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("max_shielding_zat", "int64", true),
  c("max_shielding_ties", "int32"),
  c("max_shielding_txid", "utf8", true),
  c("max_unshielding_zat", "int64", true),
  c("max_unshielding_ties", "int32"),
  c("max_unshielding_txid", "utf8", true),
  c("max_migration_zat", "int64", true),
  c("max_migration_ties", "int32"),
  c("max_migration_txid", "utf8", true),
];

export const MINING_PAYOUTS_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("kind", "utf8"),
  c("address", "utf8", true),
  c("blocks", "int32"),
  c("reward_zat", "int64", true),
  c("fee_zat", "int64"),
  c("fee_blocks", "int32"),
];

/** The site's series, in the order they are written; each is also in `SMALL_TABLES`. */
export const SITE_TABLES = [
  "tx_kinds_daily",
  "pools_daily",
  "pool_boundary_daily",
  "shielding_flow_daily",
  "pool_migration_daily",
  "fees_monthly",
  "shielding_records_daily",
  "mining_payouts_daily",
] as const;

export type SiteTable = (typeof SITE_TABLES)[number];

/** Every daily or event table: its file and its published columns. */
export const SMALL_TABLES = {
  pool_usage_daily: POOL_USAGE_DAILY_COLUMNS,
  shielding_daily: SHIELDING_DAILY_COLUMNS,
  transparent_daily: TRANSPARENT_DAILY_COLUMNS,
  transparent_monthly: TRANSPARENT_MONTHLY_COLUMNS,
  node_releases_daily: NODE_RELEASES_DAILY_COLUMNS,
  reorgs: REORG_COLUMNS,
  blocks_daily: BLOCKS_DAILY_COLUMNS,
  fees_daily: FEES_DAILY_COLUMNS,
  mining_daily: MINING_DAILY_COLUMNS,
  hashrate_daily: HASHRATE_DAILY_COLUMNS,
  supply_daily: SUPPLY_DAILY_COLUMNS,
  tx_versions_daily: TX_VERSIONS_DAILY_COLUMNS,
  pool_flows_daily: POOL_FLOWS_DAILY_COLUMNS,
  coinbase_shielded_daily: COINBASE_SHIELDED_DAILY_COLUMNS,
  tx_kinds_daily: TX_KINDS_DAILY_COLUMNS,
  pools_daily: POOLS_DAILY_COLUMNS,
  pool_boundary_daily: POOL_BOUNDARY_DAILY_COLUMNS,
  shielding_flow_daily: SHIELDING_FLOW_DAILY_COLUMNS,
  pool_migration_daily: POOL_MIGRATION_DAILY_COLUMNS,
  fees_monthly: FEES_MONTHLY_COLUMNS,
  shielding_records_daily: SHIELDING_RECORDS_DAILY_COLUMNS,
  mining_payouts_daily: MINING_PAYOUTS_DAILY_COLUMNS,
} as const satisfies Record<string, readonly ColumnSpec[]>;

export type SmallTable = keyof typeof SMALL_TABLES;

/** The clients whose names are published; any other self-declared name becomes `other`. */
export const PUBLISHED_CLIENTS = new Set(["Zebra", "Zakura", "zcashd", "Seeder"]);

/**
 * A version as published: a plain `x.y.z`, optionally with one of the suffixes real releases use.
 * A node writes its own user agent, so anything else could carry arbitrary text into the dataset:
 * it is published as unknown (null) instead.
 */
export const PUBLISHED_VERSION =
  /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-(?:rc\d{1,3}|alpha\d{0,3}|beta\d{0,3}|modified))?$/;

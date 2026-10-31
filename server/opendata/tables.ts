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
 * One row per mined transaction, without its amounts. Kind, direction, fee, size and the count of
 * each kind of shielded part describe its shape; how much moved through which pool is never
 * exported transaction by transaction.
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
  c("sapling_spends", "int32", true),
  c("sapling_outputs", "int32", true),
  c("orchard_actions", "int32", true),
  c("ironwood_actions", "int32", true),
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

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

const blocksRange = (start: number) =>
  `${String(start).padStart(7, "0")}-${String(start + BLOCKS_PER_FILE - 1).padStart(7, "0")}`;

/** File name for the `blocks` partition starting at `start`, zero-padded so names sort in order. */
export const blocksFile = (start: number) => `blocks/${blocksRange(start)}.parquet`;

/**
 * Per block, the coinbase's payout address and the miner's own text, in files spanning exactly
 * the heights of the `blocks` file of the same name. A table of its own because published
 * `blocks` files never change, and so that miner-written text stays out of the default table.
 * The self-host importer reads it as is: its columns and layout are frozen.
 */
export const BLOCK_COINBASE_COLUMNS: readonly ColumnSpec[] = [
  c("height", "int32"),
  c("miner_address", "utf8", true),
  c("coinbase_tag", "utf8", true),
];

export const blocksCoinbaseFile = (start: number) =>
  `blocks_coinbase/${blocksRange(start)}.parquet`;

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
 * Block production over the 30 UTC days ending each day, by payout address. Shares are over every
 * block in the window, so blocks with no public payee (shielded, or no address) dilute them
 * rather than being attributed to anyone.
 */
export const MINING_CONCENTRATION_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("blocks", "int32"),
  c("transparent_blocks", "int32"),
  c("shielded_blocks", "int32"),
  c("no_address_blocks", "int32"),
  c("distinct_addresses", "int32", true),
  c("top1_share", "float64", true),
  c("top3_share", "float64", true),
  c("top5_share", "float64", true),
];

/**
 * The transparent ledger: every input and output, one row each. Each range of
 * `HEIGHTS_PER_LEDGER_FILE` heights is split into parts of about `LEDGER_PART_ROWS` rows, cut at
 * block boundaries: some early-2017 ranges hold several times the 1.41M rows of the genesis range,
 * and a whole range in memory exceeds the container. Rows never change, so the
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

/**
 * How old the day's blocks were, by header timestamp, when this project's follower stored them.
 * Every block only: the per-pool split rests on the site's reviewed pool labels, and the dataset
 * carries no label on an address.
 */
export const BLOCK_ARRIVAL_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("blocks", "int32"),
  c("measured", "int32"),
  c("late", "int32"),
  c("p50_seconds", "int32", true),
  c("p90_seconds", "int32", true),
];

/** ZIP 235's fee removal per UTC day, from NU7; no rows before it. */
export const NSM_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("day", "date"),
  c("nsm_inflow_zat", "int64", true),
  c("nsm_total_zat", "int64", true),
];

export const NU7_CAPABLE_RELEASES_COLUMNS: readonly ColumnSpec[] = [
  c("client", "utf8"),
  c("min_version", "utf8"),
  c("source_url", "utf8"),
];

/**
 * The first stable release of each client whose own notes schedule NU7 on mainnet at 3,543,405,
 * read 2026-11-02. Stable only: the dataset makes no claim about release candidates (the site's
 * `NU7_RELEASES` tracks those). Per client because the protocol version cannot tell: Zakura 1.5.0 to 1.6.0 already
 * declare NU7's 170190 without carrying its height. Published so `node_releases_daily` can be
 * joined against it; readiness is never a daily table of its own.
 */
export const NU7_CAPABLE_RELEASES: readonly {
  client: string;
  min_version: string;
  source_url: string;
}[] = [
  {
    client: "Zakura",
    min_version: "1.7.0",
    source_url: "https://github.com/zakura-core/zakura/releases/tag/v1.7.0",
  },
  {
    client: "Zebra",
    min_version: "7.0.0",
    source_url: "https://zfnd.org/zebra-7-0-0-release/",
  },
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

export const ADDRESS_BALANCE_DAILY_COLUMNS: readonly ColumnSpec[] = [
  c("address", "utf8"),
  c("day", "date"),
  c("balance_zat", "int64"),
  c("close_height", "int32"),
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
  "address_balance_daily",
] as const;

export type SiteTable = (typeof SITE_TABLES)[number];

/**
 * Every transparent output ever made, summed by the UTC day of the block that created it and the
 * UTC day of the block that spent it (NULL: unspent at the release's final day). A snapshot:
 * spends move value out of a creation day's NULL row, so each release replaces the file
 * (`REPLACED` in `history.ts`).
 */
export const COIN_AGE_MATRIX_COLUMNS: readonly ColumnSpec[] = [
  c("creation_day", "date"),
  c("spend_day", "date", true),
  c("value_zat", "int64"),
  c("outputs", "int64"),
];

/** Every daily, event or reference table: its file and its published columns. */
export const SMALL_TABLES = {
  pool_usage_daily: POOL_USAGE_DAILY_COLUMNS,
  shielding_daily: SHIELDING_DAILY_COLUMNS,
  transparent_daily: TRANSPARENT_DAILY_COLUMNS,
  transparent_monthly: TRANSPARENT_MONTHLY_COLUMNS,
  coin_age_matrix: COIN_AGE_MATRIX_COLUMNS,
  node_releases_daily: NODE_RELEASES_DAILY_COLUMNS,
  nu7_capable_releases: NU7_CAPABLE_RELEASES_COLUMNS,
  reorgs: REORG_COLUMNS,
  blocks_daily: BLOCKS_DAILY_COLUMNS,
  fees_daily: FEES_DAILY_COLUMNS,
  mining_daily: MINING_DAILY_COLUMNS,
  mining_concentration_daily: MINING_CONCENTRATION_DAILY_COLUMNS,
  hashrate_daily: HASHRATE_DAILY_COLUMNS,
  supply_daily: SUPPLY_DAILY_COLUMNS,
  nsm_daily: NSM_DAILY_COLUMNS,
  block_arrival_daily: BLOCK_ARRIVAL_DAILY_COLUMNS,
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
  address_balance_daily: ADDRESS_BALANCE_DAILY_COLUMNS,
} as const satisfies Record<string, readonly ColumnSpec[]>;

export type SmallTable = keyof typeof SMALL_TABLES;

/**
 * Every transparent address with a positive balance at the release height. A snapshot, replaced
 * whole by each release (`REPLACED` in `history.ts`), in address order. No rank column: users sort
 * by (balance_zat DESC, address), the site's own order.
 */
export const ADDRESS_COLUMNS: readonly ColumnSpec[] = [
  c("address", "utf8"),
  c("balance_zat", "int64"),
  c("tx_count", "int64", true),
];

export const ADDRESSES_FILE = "addresses.parquet";

/** The clients whose names are published; any other self-declared name becomes `other`. */
export const PUBLISHED_CLIENTS = new Set(["Zebra", "Zakura", "zcashd", "Seeder"]);

/**
 * A version as published: a plain `x.y.z`, optionally with one of the suffixes real releases use.
 * A node writes its own user agent, so anything else could carry arbitrary text into the dataset:
 * it is published as unknown (null) instead.
 */
export const PUBLISHED_VERSION =
  /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-(?:rc\d{1,3}|alpha\d{0,3}|beta\d{0,3}|modified))?$/;

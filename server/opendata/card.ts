import type { ColumnSpec } from "./parquet";
import {
  ADDRESS_COLUMNS,
  BLOCK_COINBASE_COLUMNS,
  BLOCK_COLUMNS,
  BLOCKS_PER_FILE,
  HEIGHTS_PER_LEDGER_FILE,
  LEDGER_PART_ROWS,
  SMALL_TABLES,
  TRANSACTION_COLUMNS,
  TRANSACTIONS_EXTRA_COLUMNS,
  TRANSPARENT_IO_COLUMNS,
} from "./tables";

/**
 * The dataset card (the README on Hugging Face), generated from the same table definitions the
 * export writes, so the documented columns are always the published ones. It holds no release
 * values: those are in `manifest.json`, so the card only changes when the schema or the wording
 * does, or when the transparent ledger first appears.
 */

const DESCRIPTIONS: Record<string, string> = {
  height: "Block height.",
  hash: "Block hash, hex.",
  prev_hash: "Hash of the previous block, hex.",
  timestamp: "Block header time, unix seconds (set by the miner; can be slightly out of order).",
  size_bytes: "Serialized block size in bytes.",
  tx_count: "Transactions in the block, coinbase included.",
  transparent_tx_count:
    "Transactions touching only transparent inputs and outputs (coinbase excluded).",
  mixed_tx_count:
    "Transactions crossing between the transparent and shielded sides (coinbase excluded).",
  shielded_tx_count: "Fully shielded transactions (coinbase excluded).",
  total_fee_zat: "Total fees in the block, zatoshis. NULL where not yet computed.",
  sapling_flow_zat:
    "Net change of the Sapling pool in this block, zatoshis (positive: value entered).",
  orchard_flow_zat: "Net change of the Orchard pool in this block, zatoshis.",
  transparent_pool_zat:
    "Transparent pool balance after this block, zatoshis, as the node reports it.",
  sprout_pool_zat:
    "Sprout pool balance after this block, zatoshis. NULL where the node reports the pool as not monitored (before it existed, and heights 407–415, when it had emptied).",
  sapling_pool_zat:
    "Sapling pool balance after this block, zatoshis. NULL before Sapling activated.",
  orchard_pool_zat:
    "Orchard pool balance after this block, zatoshis. NULL before Orchard activated.",
  lockbox_pool_zat: "Deferred development fund lockbox balance, zatoshis. NULL before NU6.",
  ironwood_pool_zat:
    "Ironwood pool balance after this block, zatoshis. NULL before Ironwood activated.",
  difficulty: "Difficulty as the node computes it from the header bits.",
  miner_kind:
    "Where the miner was paid: transparent, shielded (a shielded coinbase, ZIP 213) or unknown. The address is in `blocks_coinbase`.",
  miner_reward_zat:
    "What the miner was paid, zatoshis, excluding funding-stream outputs. Only for a transparent coinbase; NULL otherwise, because a shielded amount is not public.",
  day: "UTC day.",
  month: "First day of the UTC month.",
  pool: "Shielded pool: sprout, sapling, orchard or ironwood.",
  txs: "Transactions that carried a bundle in the pool that day; fully_shielded, mixed and coinbase partition it.",
  fully_shielded: "Of those, fully shielded.",
  mixed: "Of those, crossing between transparent and shielded.",
  shielding:
    "Mixed transactions moving value into the shielded side; with unshielding and indeterminate, it partitions mixed.",
  unshielding: "Mixed transactions moving value out of the shielded side.",
  indeterminate: "Mixed transactions whose direction the chain does not settle.",
  coinbase: "Of those, coinbase transactions.",
  spends: "Sapling spends that day; NULL for the other pools.",
  outputs: "Sapling outputs that day; NULL for the other pools.",
  actions: "Orchard or Ironwood actions that day; NULL for the other pools.",
  joinsplits: "Sprout JoinSplits that day; NULL for the other pools.",
  notes_at_close:
    "Size of the pool's note commitment tree at the day's last block; NULL for Sprout and before the pool activated.",
  close_height: "Height of the day's last block.",
  shielding_txs: "Transactions moving value into the shielded side that day.",
  unshielding_txs: "Transactions moving value out of the shielded side that day.",
  indeterminate_txs: "Mixed transactions whose direction the chain does not settle, that day.",
  migration_txs:
    "Transactions moving value between shielded pools that day (one pool gaining, at least one losing, no transparent side).",
  inputs: "Transparent inputs spent that day.",
  unresolved_inputs:
    "Of those, inputs the indexer could not resolve to a prior output (an indexer fact, not a chain fact).",
  in_transparent_zat:
    "Value of the inputs spent by the day's non-coinbase transparent-only transactions, zatoshis.",
  in_mixed_zat: "Value of the inputs spent by the day's non-coinbase mixed transactions, zatoshis.",
  out_transparent_zat:
    "Value of the non-coinbase outputs of transparent-only transactions, zatoshis.",
  out_mixed_zat: "Value of the non-coinbase outputs of mixed transactions, zatoshis.",
  unaddressed_outputs: "Outputs with no single address (an indexer fact, not a chain fact).",
  active_addresses: "Distinct transparent addresses that sent or received.",
  sending_addresses: "Distinct transparent addresses that sent.",
  receiving_addresses: "Distinct transparent addresses that received.",
  days: "Days of the month covered.",
  client: "Node software: Zebra, Zakura, zcashd, Seeder, or other.",
  version: "Release, as the nodes declare it; NULL when absent or not a plain version.",
  protocol_version: "P2P protocol version the nodes declare.",
  nodes: "Answering nodes running that release that day.",
  behind_tip: "Of those, nodes well behind the chain tip at their last answer.",
  tip_unknown: "Of those, nodes whose distance to the tip could not be stated.",
  depth: "Blocks rolled back.",
  orphaned_hash: "Hash the indexer held at that height before the reorganisation.",
  replaced_by: "Hash the node reported there afterwards.",
};

/** Where a column name means something different in one table, its meaning there. */
const TABLE_DESCRIPTIONS: Record<string, Record<string, string>> = {
  blocks_coinbase: {
    miner_address:
      "Payout address: the coinbase's largest transparent output, the NU6.1 lockbox disbursement (ZIP 271) set aside. NULL for a shielded coinbase, when that output names no address, or where the block's miner is not recorded yet.",
    coinbase_tag:
      "Text the miner wrote in the coinbase, sanitised at parse. NULL when none is printable, or where not recorded yet.",
  },
  transactions: {
    txid: "Transaction id, hex.",
    block_height: "Height of the block that mined it.",
    timestamp: "Its block's header time, unix seconds.",
    kind: "transparent, shielded, mixed (crossing between the two sides) or coinbase.",
    direction:
      "For a mixed transaction: shielding, unshielding, or indeterminate when its pools moved in opposite directions. NULL for every other kind.",
    version: "Transaction format version.",
    size_bytes: "Serialized transaction size in bytes.",
    expiry_height: "Height after which it could no longer be mined, when set (ZIP 203).",
    fee_zat: "Fee, zatoshis. NULL where an input could not be resolved, and for coinbase.",
    sprout_joinsplits: "Sprout JoinSplits; NULL when it has no Sprout part.",
    sprout_vpub_net_zat:
      "Sprout's public value, zatoshis: vpub_new minus vpub_old, so positive means value leaving Sprout (the node's sign, the opposite of the balances below).",
    sapling_spends: "Sapling spends; NULL when it has no Sapling part.",
    sapling_outputs: "Sapling outputs; NULL when it has no Sapling part.",
    sapling_value_balance_zat:
      "Net value into the Sapling pool, zatoshis: positive entering, negative leaving.",
    orchard_actions: "Orchard actions; NULL when it has no Orchard part.",
    orchard_value_balance_zat:
      "Net value into the Orchard pool, zatoshis: positive entering, negative leaving.",
    ironwood_actions: "Ironwood actions; NULL when it has no Ironwood part.",
    ironwood_value_balance_zat:
      "Net value into the Ironwood pool, zatoshis: positive entering, negative leaving.",
  },
  transparent_io: {
    txid: "Transaction id, hex.",
    block_height: "Height of the block that mined it.",
    io: "in (a transparent input) or out (a transparent output).",
    ordinal: "Position among the transaction's inputs, or among its outputs, from 0.",
    address:
      "Transparent address the output pays, or that the input's spent output paid. NULL when the script names no address (OP_RETURN) or several (multisig).",
    value_zat: "Value, zatoshis. For an input, the value of the output it spends.",
    script_type:
      "Script type as the node names it (pubkeyhash, scripthash, pubkey, nulldata, multisig, nonstandard, …).",
    prev_txid: "For an input, the transaction whose output it spends, hex; NULL for an output.",
    prev_vout: "For an input, that output's index; NULL for an output.",
  },
  transactions_extra: {
    txid: "Transaction id, hex.",
    block_height: "Height of the block that mined it.",
    inputs: "Transparent inputs.",
    outputs: "Transparent outputs.",
    transparent_in_zat: "Value of the transparent inputs, zatoshis.",
    transparent_out_zat: "Value of the transparent outputs, zatoshis.",
    inputs_p2pkh: "Inputs spending pay-to-public-key-hash outputs.",
    inputs_p2sh: "Inputs spending pay-to-script-hash outputs.",
    inputs_p2pk: "Inputs spending pay-to-public-key outputs.",
    inputs_other: "Inputs spending any other script type.",
    outputs_p2pkh: "Pay-to-public-key-hash outputs.",
    outputs_p2sh: "Pay-to-script-hash outputs.",
    outputs_p2pk: "Pay-to-public-key outputs.",
    outputs_other: "Outputs of any other script type.",
    binding_sig_valid:
      "Whether its binding signature verified, as the indexer recorded it; NULL where not recorded.",
  },
  blocks_daily: {
    blocks: "Blocks with a header time on that day.",
    median_interval_s: "Median seconds since the previous block (nearest rank).",
    p90_interval_s: "90th-percentile seconds since the previous block (nearest rank).",
    max_interval_s: "Longest gap since the previous block, seconds.",
    avg_size_bytes: "Average block size in bytes.",
    avg_difficulty: "Average difficulty.",
    fees_zat: "Fees in the day's blocks whose fee total is known, zatoshis.",
    blocks_with_fees: "Blocks whose fee total is known.",
  },
  fees_daily: {
    kind: "transparent, shielded or mixed (coinbase has no fee).",
    txs: "Transactions of that kind with a known fee that day.",
    p25_zat: "25th-percentile fee, zatoshis.",
    median_zat: "Median fee, zatoshis.",
    p75_zat: "75th-percentile fee, zatoshis.",
  },
  mining_daily: {
    miner:
      "An operator that names itself in its coinbase text, from a fixed list (a claim, not proof), or unidentified.",
    blocks: "Blocks it mined that day.",
  },
  mining_concentration_daily: {
    blocks:
      "Blocks in the 30 UTC days ending that day. The three counts below add up to it unless a block's miner is not recorded yet.",
    transparent_blocks: "Of those, paid to a transparent address.",
    shielded_blocks: "Of those, a shielded coinbase (ZIP 213): the payee is not public.",
    no_address_blocks: "Of those, a coinbase whose largest output names no address.",
    distinct_addresses:
      "Distinct payout addresses in the window. NULL if a block's miner is not recorded yet.",
    top1_share:
      "Share of `blocks` paid to the most frequent address, 0 to 1. NULL if a block's miner is not recorded yet.",
    top3_share: "Share of `blocks` paid to the three most frequent addresses.",
    top5_share: "Share of `blocks` paid to the five most frequent addresses.",
  },
  nsm_daily: {
    nsm_inflow_zat:
      "Fees moved into the NSM that day, zatoshis. NULL if a block's fee total is unknown.",
    nsm_total_zat:
      "All fees moved into the NSM since NU7, zatoshis. NULL from the first block with an unknown fee total.",
  },
  block_arrival_daily: {
    blocks: "Blocks with a header timestamp that UTC day.",
    measured:
      "Of those, stored by this project's follower within 600 seconds of their header timestamp: the blocks the percentiles are over.",
    late: "Of those, stored more than 600 seconds after: almost always an outage of ours (a restart, a node swap), left out of the percentiles.",
    p50_seconds:
      "Median seconds from header timestamp to storage, nearest rank. Negative when a miner's clock ran ahead. NULL below 10 measured blocks.",
    p90_seconds: "90th percentile of the same, nearest rank. NULL below 10 measured blocks.",
  },
  nu7_capable_releases: {
    client: "Node software, as in `node_releases_daily`.",
    min_version: "The first stable release whose own notes activate NU7 on mainnet.",
    source_url: "Those release notes.",
  },
  hashrate_daily: {
    solutions_per_second:
      "Estimated network solutions per second: the day's difficulty × 8,192 per block over the time since the previous day's last block. NULL where miner clocks make that span zero or negative.",
  },
  supply_daily: {
    schedule_zat:
      "Subsidy the protocol allowed from genesis to the day's last block, zatoshis (slow start, halvings and block-time changes included).",
    issued_zat:
      "ZEC that exists at the day's last block: every pool, the lockbox and the NSM, zatoshis. NULL if a pool's balance is unknown.",
    unclaimed_zat:
      "schedule_zat − issued_zat: subsidy miners left unclaimed, which never came into existence.",
    nsm_zat:
      "Fees moved into the NSM that day (six tenths of each block's fees from NU7, ZIP 235).",
    nsm_total_zat: "All fees moved into the NSM up to that day.",
  },
  tx_versions_daily: {
    version: "Transaction format version.",
    txs: "Mined transactions of that version that day.",
  },
  pool_flows_daily: {
    pool: "sprout, sapling, orchard or ironwood.",
    inflow_zat: "Value that entered the pool that day, zatoshis, summed per transaction.",
    outflow_zat: "Value that left the pool that day, zatoshis, summed per transaction.",
    txs: "Transactions that used the pool that day (at least one spend, output, action or JoinSplit).",
  },
  coinbase_shielded_daily: {
    coinbase_txs: "Coinbase transactions that day (one per block).",
    shielded_coinbase_txs: "Coinbase transactions that paid into a shielded pool.",
    to_sapling_zat: "Block rewards paid straight into Sapling, zatoshis.",
    to_orchard_zat: "Block rewards paid straight into Orchard, zatoshis.",
    to_ironwood_zat: "Block rewards paid straight into Ironwood, zatoshis.",
  },
  tx_kinds_daily: {
    transparent_txs: "Transactions touching only transparent inputs and outputs.",
    mixed_txs: "Transactions crossing between the transparent and shielded sides.",
    shielded_txs: "Fully shielded transactions.",
  },
  pools_daily: {
    top_height: "Height of the day's last block (the highest stamped that day).",
    hash: "Hash of that block, hex.",
    transparent_pool_zat: "Transparent pool balance at the day's last block, zatoshis.",
    sprout_pool_zat:
      "Sprout pool balance at the day's last block, zatoshis; NULL where the node reports it as not monitored.",
    sapling_pool_zat:
      "Sapling pool balance at the day's last block, zatoshis; NULL before Sapling activated.",
    orchard_pool_zat:
      "Orchard pool balance at the day's last block, zatoshis; NULL before Orchard activated.",
    lockbox_pool_zat: "Lockbox balance at the day's last block, zatoshis; NULL before NU6.",
    ironwood_pool_zat:
      "Ironwood pool balance at the day's last block, zatoshis; NULL before Ironwood activated.",
  },
  pool_boundary_daily: {
    pool: "sprout, sapling, orchard or ironwood; or hub, one row per day for the transactions the pools do not settle.",
    shielded_zat: "Value shielding transactions moved into this pool, zatoshis.",
    shielded_txs: "Shielding transactions with a leg in this pool.",
    unshielded_zat: "Value unshielding transactions moved out of this pool, zatoshis.",
    unshielded_txs: "Unshielding transactions with a leg in this pool.",
    coinbase_zat:
      "Block rewards paid straight into this pool, zatoshis (issuance, not a crossing).",
    coinbase_txs: "Coinbase transactions paying into this pool.",
    hub_zat:
      "On the hub row: all value its transactions' pools moved, either way, zatoshis (not a directed flow); 0 elsewhere.",
    hub_txs:
      "On the hub row: mixed transactions with no settled direction, each counted once; 0 elsewhere.",
  },
  shielding_flow_daily: {
    shielded_zat: "Sum of the positive per-transaction nets, zatoshis.",
    unshielded_zat: "Sum of the negative per-transaction nets, as a positive amount, zatoshis.",
  },
  pool_migration_daily: {
    destination: "The pool that gained.",
    source: "The pool that lost, or multi when more than one did.",
    txs: "Such transactions that day.",
    zat: "Value the destination gained, zatoshis.",
  },
  fees_monthly: {
    kind: "transparent, shielded or mixed (coinbase has no fee).",
    txs: "Transactions of that kind with a known fee that month.",
    p25_zat: "25th-percentile fee, zatoshis.",
    median_zat: "Median fee, zatoshis.",
    p75_zat: "75th-percentile fee, zatoshis.",
  },
  shielding_records_daily: {
    max_shielding_zat:
      "Largest net value one shielding transaction moved into the shielded pools that day, zatoshis; NULL with none.",
    max_shielding_ties: "Transactions sharing that largest value.",
    max_shielding_txid: "That transaction when it alone holds the maximum; NULL otherwise.",
    max_unshielding_zat:
      "Largest net value one unshielding transaction moved out of the shielded pools that day, zatoshis; NULL with none.",
    max_unshielding_ties: "Transactions sharing that largest value.",
    max_unshielding_txid: "That transaction when it alone holds the maximum; NULL otherwise.",
    max_migration_zat:
      "Largest value one pool migration moved into its destination that day, zatoshis; NULL with none.",
    max_migration_ties: "Transactions sharing that largest value.",
    max_migration_txid: "That transaction when it alone holds the maximum; NULL otherwise.",
  },
  addresses: {
    address: "Transparent address, t1… or t3….",
    balance_zat: "Its balance at the release height, zatoshis; always positive.",
    tx_count:
      "Transactions it appears in, either side, up to the release height. NULL where not known: not yet counted, or the address emptied after the release height.",
  },
  mining_payouts_daily: {
    kind: "transparent, shielded (a shielded coinbase, ZIP 213) or unknown (the coinbase names no address).",
    address:
      "Payout address: the coinbase's largest transparent output, the NU6.1 lockbox disbursement (ZIP 271) set aside. NULL unless kind is transparent. One operator can use several.",
    blocks: "Blocks paid that way that day.",
    reward_zat:
      "The miner's own outputs, excluding funding streams, zatoshis; NULL unless known for every block (never for shielded).",
    fee_zat:
      "The miner's share of fees, over the blocks with a known fee total, zatoshis: all of them before NU7, four tenths (rounded in the miner's favour) from NU7 (ZIP 235).",
    fee_blocks: "Blocks whose fee total is known.",
  },
};

const TABLE_INTROS: Record<string, string> = {
  transactions:
    "Every mined transaction since 2016: kind, direction, fee, size, and what each shielded part publicly moved into or out of its pool, in files of 100,000 heights.",
  transparent_io: `Every transparent input and output since 2016, one row each. Files cover ${HEIGHTS_PER_LEDGER_FILE.toLocaleString("en-US")} heights each, split at block boundaries into parts of about ${LEDGER_PART_ROWS.toLocaleString("en-US")} rows: \`transparent_io/<start>-<end>-<part>.parquet\`. The Hugging Face viewer previews only the first ~5 GB; query the files for the rest.`,
  transactions_extra: `Per transaction, its transparent totals and its inputs and outputs by script type, in files of ${HEIGHTS_PER_LEDGER_FILE.toLocaleString("en-US")} heights: \`transactions_extra/<start>-<end>.parquet\`.`,
  blocks_daily: "Block spacing, size, difficulty and fees per UTC day, computed from `blocks`.",
  fees_daily: "Fee percentiles per UTC day and transaction kind.",
  mining_daily:
    "Blocks per UTC day by self-named mining operator. Few operators name themselves, so most blocks are unidentified.",
  mining_concentration_daily:
    "Block production over the 30 UTC days ending each day, by payout address. One operator can use several addresses, so this understates concentration. Shielded coinbases and coinbases naming no address count in `blocks` but in no address's share. The chain's first 29 days have shorter windows.",
  nsm_daily:
    "Fees removed from circulation into the Network Sustainability Mechanism per UTC day: from NU7 (height 3,543,405), floor(6 × fees / 10) of each block (ZIP 235). Empty before NU7 activates. Equal to `supply_daily`'s NSM columns.",
  block_arrival_daily:
    "How old each UTC day's blocks were, by their own header timestamp, when this project's follower first stored them. Recording began 2026-08-17: blocks indexed before then, or written by the backfiller, carry no stamp and are counted in `blocks` only. The age adds the miner's timestamp lag, propagation and about 5 to 10 seconds of our own latency; it is not a clock-skew measurement, and it cannot separate a miner's lag from its propagation. Percentiles do not add up across days.",
  nu7_capable_releases:
    "The first stable release of each node client that activates NU7 on mainnet. Join with `node_releases_daily` on `client`; a release is capable when its `version` is at least `min_version`, compared number by number. Release candidates are not covered. The protocol version alone is not enough: Zakura 1.5.0 to 1.6.0 also declare 170190.",
  hashrate_daily: "Estimated network solution rate per UTC day, from difficulty.",
  supply_daily:
    "The supply audit per UTC day: what the schedule allowed, what exists, and what miners never claimed.",
  tx_versions_daily:
    "Transactions per UTC day by format version (v4 is disallowed from NU7, ZIP 2003).",
  pool_flows_daily: "Value into and out of each shielded pool per UTC day, gross, never netted.",
  coinbase_shielded_daily: "Block rewards paid straight into shielded pools per UTC day.",
  tx_kinds_daily: "Transactions per UTC day by kind, coinbase excluded, summed from `blocks`.",
  pools_daily: "Every value pool at each UTC day's last block, from `blocks`.",
  pool_boundary_daily:
    "What crossed the shielded boundary at each pool per UTC day, one leg per pool a transaction moved value in. A mixed transaction counts under its direction unless a pool moved the other way; such transactions go to the day's `hub` row. Sprout legs are its public JoinSplit value.",
  shielding_flow_daily:
    "Each non-coinbase transaction's net change across all shielded pools, summed per UTC day by sign.",
  pool_migration_daily:
    "Value moved between shielded pools per UTC day: no transparent side, exactly one pool gaining, at least one losing. A day with none has no row.",
  fees_monthly:
    "Fee percentiles per complete UTC month and transaction kind (percentiles do not add up from `fees_daily`).",
  shielding_records_daily:
    "The day's largest shielding, unshielding and pool migration per UTC day. A transaction is named only when it alone holds the maximum.",
  mining_payouts_daily:
    "Blocks per UTC day by miner kind and payout address, with what the miners were paid.",
  addresses:
    "Every transparent address with a positive balance at the release height, in address order. A snapshot: each release replaces the file, and the repository's history keeps the earlier ones. For the site's rich-list order, sort by `balance_zat` descending, then `address`.",
  blocks: `Every block from genesis to the release height, one row per block, in files of ${BLOCKS_PER_FILE.toLocaleString("en-US")} heights.`,
  blocks_coinbase:
    "Per block, the payout address and the coinbase text, in files covering the same heights as `blocks`. The text is miner-written: whoever mines a block chooses it. It is sanitised at parse (printable characters, whitespace collapsed, at most 120 characters); treat it as untrusted text, never markup.",
  pool_usage_daily: "Each shielded pool's activity per UTC day.",
  shielding_daily:
    "Value crossing between the transparent and shielded sides, counted per UTC day.",
  transparent_daily: "Transparent activity per UTC day.",
  transparent_monthly: "Distinct transparent addresses per complete UTC month.",
  node_releases_daily:
    "Answering nodes per day by software release, from this project's crawler. A floor: nodes that accept no incoming connections cannot be counted.",
  reorgs: "Chain reorganisations this indexer observed.",
};

const LEDGER_CHECKS = `

The transparent ledger is held to the chain block by block: the transparent pool's change equals
the block's outputs less its inputs; the coinbase claims no more than the subsidy and fees, and
what coinbases left unclaimed, summed, equals \`supply_daily\`'s unclaimed figure; each
transaction's fee equals its value balance. Only the newest range's files grow from one release to
the next; a range the chain has passed is written once and never changes. If one is ever rebuilt
by hand, any change to its rows is listed in \`manifest.json\`, like any other correction.`;

function columnTable(table: string, columns: readonly ColumnSpec[]): string {
  const rows = columns.map((c) => {
    const desc = TABLE_DESCRIPTIONS[table]?.[c.name] ?? DESCRIPTIONS[c.name];
    if (!desc) throw new Error(`no description for column ${c.name}`);
    return `| \`${c.name}\` | ${c.type}${c.nullable ? ", nullable" : ""} | ${desc} |`;
  });
  return ["| Column | Type | Meaning |", "| --- | --- | --- |", ...rows].join("\n");
}

export interface CardOptions {
  /** The transparent ledger is in this release (it is published whole or not at all). */
  ledger: boolean;
}

export function datasetCard({ ledger }: CardOptions): string {
  const tables: [string, readonly ColumnSpec[], string][] = [
    ["blocks", BLOCK_COLUMNS, "blocks/*.parquet"],
    ["blocks_coinbase", BLOCK_COINBASE_COLUMNS, "blocks_coinbase/*.parquet"],
    ["transactions", TRANSACTION_COLUMNS, "transactions/*.parquet"],
    ...(ledger
      ? ([
          ["transparent_io", TRANSPARENT_IO_COLUMNS, "transparent_io/*.parquet"],
          ["transactions_extra", TRANSACTIONS_EXTRA_COLUMNS, "transactions_extra/*.parquet"],
        ] as [string, readonly ColumnSpec[], string][])
      : []),
    ...Object.entries(SMALL_TABLES).map(
      ([name, cols]) => [name, cols, `${name}.parquet`] as [string, readonly ColumnSpec[], string],
    ),
    ["addresses", ADDRESS_COLUMNS, "addresses.parquet"],
  ];
  const configs = tables
    .map(
      ([name, , glob], i) =>
        `- config_name: ${name}\n  data_files: "${glob}"${i === 0 ? "\n  default: true" : ""}`,
    )
    .join("\n");
  const sections = tables
    .map(([name, cols]) => `### \`${name}\`\n\n${TABLE_INTROS[name]}\n\n${columnTable(name, cols)}`)
    .join("\n\n");

  return `---
license: cc-by-4.0
pretty_name: Zcash mainnet chain index (ShieldedScan)
tags:
- zcash
- blockchain
- privacy
size_categories:
- ${ledger ? "100M<n<1B" : "10M<n<100M"}
configs:
${configs}
---

# Zcash mainnet chain index

The chain index behind [ShieldedScan](https://shieldedscan.xyz), a privacy-first Zcash explorer,
as plain Parquet files: every block since 2016 with every pool's balance, every transaction's
public values, every transparent address's balance, and the daily series behind the site's charts. Refreshed daily. Query it on your own machine: nobody sees your questions.

## Loading

DuckDB, straight from the Hub:

\`\`\`sql
SELECT height, ironwood_pool_zat / 1e8 AS ironwood_zec
FROM 'hf://datasets/Shieldedscanxyz/zcash-mainnet/blocks/*.parquet'
ORDER BY height DESC LIMIT 5;
\`\`\`

Python:

\`\`\`python
from datasets import load_dataset
blocks = load_dataset("Shieldedscanxyz/zcash-mainnet", "blocks", split="train")
\`\`\`

Amounts are integer zatoshis (1 ZEC = 100,000,000 zatoshis); keep them as integers until you
display them. NULL means unknown, never zero.

## Tables

${sections}

## Shielding, four ways

Four tables count shielding, each exact under its own definition:

- \`shielding_daily\`: mixed transactions by direction, counted once each.
- \`pool_usage_daily\`: per pool, the transactions that used it, by kind and direction.
- \`pool_boundary_daily\`: per pool, the value each crossing moved there, coinbase apart.
- \`shielding_flow_daily\`: per transaction, its net into or out of the shielded side.

One transaction shielding into two pools is one count, two legs and one net.

## Releases and verification

Each release stops 100 blocks below the chain tip, far deeper than any Zcash reorganisation, and
includes a day only once it is three days behind the release's last block. \`manifest.json\` gives
the release height and its block hash (check it against any node), the indexer version that
produced it, each file's SHA-256 and row count, and any corrections. Published rows do not change,
except a value that was unknown becoming known, which the manifest records, and \`addresses\`, a
snapshot that each release replaces.

Every release passes checks before it is published: no missing heights, each block linked to the
previous one, each pool's recorded flow equal to its balance change, the pools growing by no more
than the block subsidy, the daily counts agreeing with the blocks, and each block's transactions
matching its own count, kinds, fee total and pool flows. The address balances, plus the
transparent value no single address holds, equal the transparent pool at the release height.${ledger ? LEDGER_CHECKS : ""}

The site's precomputed series are held to the same blocks and transactions day by day; one that
has not caught up with the release is not published.

The indexer is open source: [github.com/BitFalco21/shieldedscan](https://github.com/BitFalco21/shieldedscan).
Anyone with a Zcash node can rebuild these tables and compare.

## What is not here

Shielded amounts: the chain encrypts them, and only what crosses a pool's boundary is public.
${ledger ? "" : "Transparent inputs and outputs by address are not in this release yet. "}Node IP addresses
and third-party price and location data are left out.

No transaction is singled out, except a day's largest shielding, unshielding or pool
migration when it alone holds that maximum (\`shielding_records_daily\`). Addresses are as the
chain shows them: no labels, owners or groupings.

## Licence and citation

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): use it freely, credit ShieldedScan.

> ShieldedScan, *Zcash mainnet chain index*, https://huggingface.co/datasets/Shieldedscanxyz/zcash-mainnet

The same data is available live through ShieldedScan's [API](https://shieldedscan.xyz/api-docs),
[MCP server](https://shieldedscan.xyz/mcp) and AI analyst [Zeno](https://shieldedscan.xyz/ai-agent).
`;
}

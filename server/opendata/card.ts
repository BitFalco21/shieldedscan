import type { ColumnSpec } from "./parquet";
import { BLOCK_COLUMNS, BLOCKS_PER_FILE, SMALL_TABLES, TRANSACTION_COLUMNS } from "./tables";

/**
 * The dataset card (the README on Hugging Face), generated from the same table definitions the
 * export writes, so the documented columns are always the published ones. It holds no release
 * values: those are in `manifest.json`, so the card only changes when the schema or the wording
 * does.
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
    "Where the miner was paid: transparent, shielded (a shielded coinbase, ZIP 213) or unknown. No address is published.",
  miner_reward_zat:
    "What the miner was paid, zatoshis, excluding funding-stream outputs. Only for a transparent coinbase; NULL otherwise, because a shielded amount is not public.",
  day: "UTC day.",
  month: "First day of the UTC month.",
  pool: "Shielded pool: sprout, sapling, orchard or ironwood.",
  txs: "Transactions that carried a bundle in the pool that day; the next four columns partition it.",
  fully_shielded: "Of those, fully shielded.",
  mixed: "Of those, crossing between transparent and shielded.",
  shielding: "Mixed transactions moving value into the shielded side.",
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
    sapling_spends: "Sapling spends; NULL when it has no Sapling part.",
    sapling_outputs: "Sapling outputs; NULL when it has no Sapling part.",
    orchard_actions: "Orchard actions; NULL when it has no Orchard part.",
    ironwood_actions: "Ironwood actions; NULL when it has no Ironwood part.",
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
};

const TABLE_INTROS: Record<string, string> = {
  transactions:
    "Every mined transaction since 2016, without amounts: kind, direction, fee, size and how many shielded parts it has, in files of 100,000 heights.",
  blocks_daily: "Block spacing, size, difficulty and fees per UTC day, computed from `blocks`.",
  fees_daily: "Fee percentiles per UTC day and transaction kind.",
  mining_daily:
    "Blocks per UTC day by self-named mining operator. Few operators name themselves, so most blocks are unidentified.",
  blocks: `Every block from genesis to the release height, one row per block, in files of ${BLOCKS_PER_FILE.toLocaleString("en-US")} heights.`,
  pool_usage_daily: "Each shielded pool's activity per UTC day.",
  shielding_daily:
    "Value crossing between the transparent and shielded sides, counted per UTC day.",
  transparent_daily: "Transparent activity per UTC day.",
  transparent_monthly: "Distinct transparent addresses per complete UTC month.",
  node_releases_daily:
    "Answering nodes per day by software release, from this project's crawler. A floor: nodes that accept no incoming connections cannot be counted.",
  reorgs: "Chain reorganisations this indexer observed.",
};

function columnTable(table: string, columns: readonly ColumnSpec[]): string {
  const rows = columns.map((c) => {
    const desc = TABLE_DESCRIPTIONS[table]?.[c.name] ?? DESCRIPTIONS[c.name];
    if (!desc) throw new Error(`no description for column ${c.name}`);
    return `| \`${c.name}\` | ${c.type}${c.nullable ? ", nullable" : ""} | ${desc} |`;
  });
  return ["| Column | Type | Meaning |", "| --- | --- | --- |", ...rows].join("\n");
}

export function datasetCard(): string {
  const tables: [string, readonly ColumnSpec[], string][] = [
    ["blocks", BLOCK_COLUMNS, "blocks/*.parquet"],
    ["transactions", TRANSACTION_COLUMNS, "transactions/*.parquet"],
    ...Object.entries(SMALL_TABLES).map(
      ([name, cols]) => [name, cols, `${name}.parquet`] as [string, readonly ColumnSpec[], string],
    ),
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
- 10M<n<100M
configs:
${configs}
---

# Zcash mainnet chain index

The chain index behind [ShieldedScan](https://shieldedscan.xyz), a privacy-first Zcash explorer,
as plain Parquet files: every block since 2016 with every pool's balance, every transaction's
shape (never its amounts), and the daily series behind the site's charts. Refreshed daily. Query it on your own machine: nobody sees your questions.

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

## Releases and verification

Each release stops 100 blocks below the chain tip, far deeper than any Zcash reorganisation, and
includes a day only once it is three days behind the release's last block. \`manifest.json\` gives
the release height and its block hash (check it against any node), the indexer version that
produced it, each file's SHA-256 and row count, and any corrections. Published rows do not change,
except a value that was unknown becoming known, which the manifest records.

Every release passes checks before it is published: no missing heights, each block linked to the
previous one, each pool's recorded flow equal to its balance change, the pools growing by no more
than the block subsidy, the daily counts agreeing with the blocks, and each block's transactions
matching its own count, kinds and fee total.

The indexer is open source: [github.com/BitFalco21/shieldedscan](https://github.com/BitFalco21/shieldedscan).
Anyone with a Zcash node can rebuild these tables and compare.

## What is not here, and why

No per-transaction amounts (the \`transactions\` table says what each transaction was, never how much
it moved), no addresses, no miner-written text, no node IP addresses. On a
privacy chain, per-transaction amounts with timestamps are the raw material for linking money
going into the shielded pools to money coming out, and bulk address data is what chain analysis
is built from. This dataset describes the chain; it does not help anyone trace its users. Price
and location data from third parties are also left out.

## Licence and citation

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): use it freely, credit ShieldedScan.

> ShieldedScan, *Zcash mainnet chain index*, https://huggingface.co/datasets/Shieldedscanxyz/zcash-mainnet

The same data is available live through ShieldedScan's [API](https://shieldedscan.xyz/api-docs),
[MCP server](https://shieldedscan.xyz/mcp) and AI analyst [Zeno](https://shieldedscan.xyz/ai-agent).
`;
}

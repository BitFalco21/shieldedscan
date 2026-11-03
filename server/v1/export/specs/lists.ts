import { POOL_NAMES } from "@/domain/pool";
import { at, listRows } from "../table";
import { col, type ExportSpec } from "../spec";

/**
 * Keyset lists, exported one page per request, exactly the page the JSON answer holds: a file
 * here is never "the whole list" (the open dataset is), and the next page's URL travels in the
 * `Link` header. Third-party text (a block's coinbase tag) is left out of every file: a cell a
 * stranger wrote can open with `=` and run as a formula in a spreadsheet, and the JSON answer
 * already carries it.
 */

const items = (body: unknown) => listRows(body, "items");

export const BLOCKS_SPEC: ExportSpec = {
  dataset: "blocks",
  rows: items,
  paged: true,
  columns: [
    col("height", "int", "height", "Block height."),
    col("hash", "text", "hash", "Block hash, hex."),
    col("prev_hash", "text", "prevHash", "The previous block's hash."),
    col("time_utc", "utc", "timestamp", "The block header's time."),
    col("size_bytes", "int", "sizeBytes", "Serialized size."),
    col("tx_count", "int", "txCount", "Transactions, coinbase included."),
    col("difficulty", "decimal", "difficulty", "Difficulty."),
    col("miner_kind", "text", "minerKind", "transparent | shielded (ZIP 213 coinbase) | unknown."),
    {
      // The wire's own null carries no reason: miner_kind already says which case it is.
      ...col(
        "miner_address",
        "text",
        "minerAddress",
        "The payout address. Empty unless miner_kind is transparent: shielded means the payee is encrypted on-chain, unknown that no single address was paid.",
      ),
      emptyIsAnswer: true as const,
    },
    col(
      "transparent_txs",
      "int",
      "contents.transparent",
      "Transparent transactions, the coinbase among them.",
    ),
    col("mixed_txs", "int", "contents.mixed", "Mixed transactions."),
    col("shielded_txs", "int", "contents.shielded", "Fully shielded transactions."),
    ...POOL_NAMES.map((p) =>
      col(`${p}_txs`, "int", `contents.pools.${p}`, `Transactions that used the ${p} pool.`, [
        "unmeasured",
      ]),
    ),
    col(
      "total_fee_zat",
      "zat",
      "totalFeeZat",
      "Fees, zatoshi. Empty: omitted on a page read from the node (the block's own endpoint has it), indeterminate where an input could not be resolved.",
      ["omitted", "indeterminate"],
    ),
    col(
      "block_reward_zat",
      "zat",
      "blockRewardZat",
      "What the coinbase paid out. Empty: shielded when miner_kind is shielded (encrypted on-chain), otherwise indeterminate.",
      ["shielded", "indeterminate"],
    ),
    col(
      "miner_reward_zat",
      "zat",
      "minerRewardZat",
      "The miner's share: block_reward_zat less the funding streams. Empty as block_reward_zat.",
      ["shielded", "indeterminate"],
    ),
  ],
};

/**
 * `/v1/transactions`, a block's transactions and an address's: one item shape. `pools` is a list
 * on the wire; here it is one true/false column per pool, so no cell has to encode a list and an
 * empty list never reads as an empty (NULL) cell.
 */
const TX_COLUMNS = [
  col("txid", "text", "txid", "Transaction id, hex."),
  col("block_height", "int", "blockHeight", "The block that mined it."),
  col("block_hash", "text", "blockHash", "That block's hash."),
  col("time_utc", "utc", "timestamp", "The block header's time."),
  col("size_bytes", "int", "sizeBytes", "Serialized size."),
  col("kind", "text", "kind", "transparent | shielded | mixed | coinbase."),
  {
    ...col(
      "direction",
      "text",
      "direction",
      "shielding | unshielding | shielded. Empty when it crossed no boundary one way: no shielded pool (transparent, coinbase), or a mixed transaction whose pools moved both ways.",
    ),
    emptyIsAnswer: true as const,
  },
  ...POOL_NAMES.map((p) =>
    col(`uses_${p}`, "bool", `usesPool.${p}`, `true when it carries a ${p} bundle.`),
  ),
  col(
    "fee_zat",
    "zat",
    "feeZat",
    "Fee, zatoshi. Empty: nonexistent for a coinbase (it pays none), indeterminate where an input could not be resolved.",
    ["nonexistent", "indeterminate"],
  ),
];

function withPoolFlags(body: unknown) {
  return items(body).map((row) => {
    const pools = at(row.value, "pools");
    if (!Array.isArray(pools)) throw new Error("export: a transaction without its pools");
    return {
      ...row,
      value: {
        ...(row.value as object),
        usesPool: Object.fromEntries(POOL_NAMES.map((p) => [p, pools.includes(p)])),
      },
    };
  });
}

const txList = (dataset: string): ExportSpec => ({
  dataset,
  rows: withPoolFlags,
  paged: true,
  columns: TX_COLUMNS,
});

export const TRANSACTIONS_SPEC = txList("transactions");
export const BLOCK_TRANSACTIONS_SPEC = txList("block-transactions");
export const ADDRESS_TRANSACTIONS_SPEC = txList("address-transactions");

export const RICH_LIST_SPEC: ExportSpec = {
  dataset: "rich-list",
  rows: items,
  paged: true,
  columns: [
    col("rank", "int", "rank", "Rank by balance."),
    col("address", "text", "address", "Transparent address."),
    col("balance_zat", "zat", "balanceZat", "Balance at the list's height."),
    col("received_zat", "zat", "receivedZat", "Lifetime received (outputs only)."),
    col("first_height", "int", "firstHeight", "First block it appears in."),
    col("last_height", "int", "lastHeight", "Last block it appears in."),
    col("tx_count", "int", "txCount", "Transactions it appears in. Empty while not computed yet.", [
      "unmeasured",
    ]),
  ],
  provenance: (body) => {
    const h = at(body, "height");
    return { height: typeof h === "number" ? h : null };
  },
};

export const REORGS_SPEC: ExportSpec = {
  dataset: "reorgs",
  rows: items,
  paged: true,
  columns: [
    col("detected_at_utc", "utc", "detectedAt", "When this explorer's node observed it."),
    col("height", "int", "height", "The height whose block was replaced."),
    col("depth", "int", "depth", "Blocks rolled back."),
    col("orphaned_hash", "text", "orphanedHash", "The block no longer in the chain."),
    col("replaced_by", "text", "replacedBy", "The block that replaced it."),
  ],
};

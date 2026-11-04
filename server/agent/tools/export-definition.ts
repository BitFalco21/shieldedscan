import {
  CHART_RANGES,
  FEE_STATS,
  FLOW_DIRECTIONS,
  MINING_METRICS,
  NETWORK_METRICS,
  PLOT_TX_KINDS,
  POOL_METRICS,
  POOL_NAMES,
  SUPPLY_PARTS,
} from "@/domain";
import { EXPORT_FAMILIES, EXPORT_INTERVALS } from "./export-args";

/**
 * `export_data`'s description and parameters: flat enums, no `oneOf` (some providers drop it), the
 * pairing rules in the descriptions and enforced by the server, which refuses a wrong one by name.
 */

export const EXPORT_DATA_DESCRIPTION =
  // The words a reader uses for wanting the data itself, and what the tool hands back.
  "Give the reader a DATA FILE: a download card beneath your answer with a CSV (and JSON) link to this explorer's public API, the file's columns, its row count and a preview. Use it when the reader asks for data as a file, CSV, JSON, spreadsheet, download, export or dataset ('give me daily Orchard balances for 2026 as CSV', 'export the last 100 blocks', 'download the price history'). You choose only WHAT to export: a family and its parameters (the same lists as make_chart), a window and a grain. You never supply a link, a figure or a row: this explorer builds the URL and reads every value. Cross-chain data is not offered as a file. One address's history only for a transparent address the reader typed. When the tool refuses, its reply names the closest export it can make.";

const FAMILY_GUIDE = [
  "series (one file per series family; the file holds every sibling column): pool + pool + metric (balance | transactions | migrated-in | notes); supply + part (shielded only has a history file); shielding + direction; transactions + kind; fees + stat (total | median + kind); mining + metric (blocks | difficulty); network + metric (block-size | active-addresses); price (USD daily close, at most 1,000 days per file)",
  "lists (the newest page of 100 rows): blocks; transaction-list (+ kind, pool, window); block-transactions + block; rich-list; reorgs; supply-by-pool (today's split); miners (+ window: each payout address with its share)",
  "address-history + address: one transparent address's whole history, the address exactly as the reader typed it",
].join("; ");

const word = (values: readonly string[], description: string) => ({
  type: "string",
  enum: [...values],
  description,
});

export const EXPORT_DATA_PARAMETERS = {
  family: word(EXPORT_FAMILIES, `What to export. ${FAMILY_GUIDE}.`),
  pool: word(POOL_NAMES, "pool family, or transaction-list's pool filter."),
  metric: word(
    [...new Set([...POOL_METRICS, ...MINING_METRICS, ...NETWORK_METRICS])],
    "pool, mining or network: which measure.",
  ),
  part: word(SUPPLY_PARTS, "supply only."),
  direction: word(FLOW_DIRECTIONS, "shielding only: in = ZEC shielded, out = unshielded."),
  kind: word(PLOT_TX_KINDS, "transactions, fees median, or transaction-list's kind filter."),
  stat: word(FEE_STATS, "fees only."),
  address: {
    type: "string",
    description: "address-history only: the t1… or t3… address, exactly as the reader typed it.",
  },
  block: {
    type: "string",
    description: "block-transactions only: a block height or 64-hex block hash.",
  },
  range: {
    type: "string",
    enum: CHART_RANGES.map((r) => r.value),
    description:
      "A trailing window ending today: 30d, 60d, 90d, 180d, 1y, or all. Use instead of from/to.",
  },
  from: {
    type: "string",
    description: "Start of an absolute window, a UTC day as YYYY-MM-DD. Inclusive.",
  },
  to: {
    type: "string",
    description: "End of the window, YYYY-MM-DD, EXCLUSIVE. Only with from; omit to run to today.",
  },
  interval: word(
    EXPORT_INTERVALS,
    "Series only: one row per day (a window of at most 366 days) or per month. Omit to let the window decide.",
  ),
} as const;

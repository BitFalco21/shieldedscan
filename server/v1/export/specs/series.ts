import { POOL_NAMES } from "@/domain/pool";
import { at, explode, listRows, type SourceRow } from "../table";
import { PERIOD_START, col, shareColumns, type ExportSpec } from "../spec";

/**
 * The memo-backed daily series (`analytics-series.ts`, `transparent-series.ts`, the monthly
 * rollup). Tables with a second dimension (a pool, a fee kind) are long: one row per period and
 * key, so a column never stands for "this pool's figure" by position alone.
 */

const points = (body: unknown) => listRows(body, "data.points");

/**
 * The newest closing block among the points, for provenance. The newest, not the last: `sort` and
 * `top` reorder and trim the points before the file is written.
 */
function newestClose(body: unknown): { height: number | null; through: string | null } {
  const list = at(body, "data.points");
  let newest: { height: number; day: string } | null = null;
  for (const p of Array.isArray(list) ? list : []) {
    const height = at(p, "closing.height");
    const day = at(p, "closing.day");
    if (typeof height !== "number" || typeof day !== "string") continue;
    if (newest === null || height > newest.height) newest = { height, day };
  }
  return { height: newest?.height ?? null, through: newest?.day ?? null };
}

export const POOLS_SPEC: ExportSpec = {
  dataset: "pool-balances",
  rows: points,
  columns: [
    PERIOD_START,
    col("closing_day", "day", "closing.day", "The UTC day whose last block closes the period."),
    col(
      "closing_height",
      "int",
      "closing.height",
      "That block's height: the balances are read there.",
    ),
    ...POOL_NAMES.map((p) =>
      col(`${p}_zat`, "zat", `pools.${p}.zat`, `The ${p} pool's balance at the closing block.`),
    ),
    col(
      "total_shielded_zat",
      "zat",
      "totalShielded.zat",
      "The four pools' sum. A level: never sum rows.",
    ),
  ],
  provenance: newestClose,
};

const count = (name: string, path: string, what: string) => col(name, "int", path, what);

export const POOL_USAGE_SPEC: ExportSpec = {
  dataset: "pool-usage",
  rows: (body) => explode(points(body), "pools", "pool"),
  columns: [
    PERIOD_START,
    col("pool", "text", "pool", "sprout | sapling | orchard | ironwood."),
    count(
      "txs",
      "value.transactions.total",
      "Transactions that used the pool (a migration counts in both of its pools).",
    ),
    count("fully_shielded_txs", "value.transactions.fullyShielded", "Of those, fully shielded."),
    count(
      "mixed_txs",
      "value.transactions.mixed",
      "Of those, mixed (crossing the transparent boundary).",
    ),
    count("coinbase_txs", "value.transactions.coinbase", "Of those, coinbase."),
    count(
      "shielding_txs",
      "value.transactions.mixedByDirection.shielding",
      "Mixed, value entering the pools.",
    ),
    count(
      "unshielding_txs",
      "value.transactions.mixedByDirection.unshielding",
      "Mixed, value leaving the pools.",
    ),
    count(
      "indeterminate_txs",
      "value.transactions.mixedByDirection.indeterminate",
      "Mixed, pools moving both ways.",
    ),
    col(
      "sapling_spends",
      "int",
      "value.bundle.spends",
      "Sapling spends; empty for the other pools.",
      ["nonexistent"],
    ),
    col(
      "sapling_outputs",
      "int",
      "value.bundle.outputs",
      "Sapling outputs; empty for the other pools.",
      ["nonexistent"],
    ),
    col(
      "actions",
      "int",
      "value.bundle.actions",
      "Orchard or Ironwood actions; empty for Sapling and Sprout.",
      ["nonexistent"],
    ),
    col(
      "joinsplits",
      "int",
      "value.bundle.joinsplits",
      "Sprout JoinSplits; empty for the other pools.",
      ["nonexistent"],
    ),
    col(
      "notes_at_close",
      "int",
      "value.notes.atClose",
      "Note commitment tree size at the period's last block. Empty: unmeasured for Sprout (not reported), nonexistent before the pool's first tree.",
      ["unmeasured", "nonexistent"],
    ),
    col(
      "notes_created",
      "int",
      "value.notes.created",
      "Notes created in the period (difference of two closes). Empty as notes_at_close.",
      ["unmeasured", "nonexistent"],
    ),
    col("close_day", "day", "value.notes.closeDay", "The UTC day of the close.", ["nonexistent"]),
    col("close_height", "int", "value.notes.closeHeight", "The block height of the close.", [
      "nonexistent",
    ]),
  ],
};

export const NETWORK_SPEC: ExportSpec = {
  dataset: "network",
  rows: points,
  columns: [
    PERIOD_START,
    count("blocks", "blocks", "Blocks in the period."),
    col(
      "avg_difficulty",
      "decimal",
      "avgDifficulty",
      "Difficulty, averaged over the period's blocks.",
      ["unmeasured"],
    ),
    col(
      "avg_block_bytes",
      "int",
      "avgBlockBytes",
      "Block size in bytes, averaged over the period's blocks.",
      ["unmeasured"],
    ),
  ],
};

const FEE = (q: string, path: string) =>
  col(
    `${q}_zat`,
    "zat",
    `value.${path}.zat`,
    `The ${q.replace("p", "")}th percentile fee, zatoshi.`,
    ["nonexistent"],
  );

export const FEES_SPEC: ExportSpec = {
  dataset: "fees",
  rows: (body) => explode(points(body), "byKind", "kind"),
  columns: [
    PERIOD_START,
    col(
      "kind",
      "text",
      "kind",
      "transparent | mixed | fullyShielded. Coinbase pays no fee and is excluded.",
    ),
    col(
      "median_zat",
      "zat",
      "value.median.zat",
      "Median fee, zatoshi. Empty when no transaction of this kind paid one that period.",
      ["nonexistent"],
    ),
    FEE("p25", "p25"),
    FEE("p75", "p75"),
    col("txs", "int", "value.txs", "Transactions the percentiles are over.", ["nonexistent"]),
  ],
};

const flowZat = (name: string, path: string, what: string) => col(name, "zat", `${path}.zat`, what);

export const TRANSPARENT_SPEC: ExportSpec = {
  dataset: "transparent",
  rows: points,
  columns: [
    PERIOD_START,
    count("days", "days", "Days computed in the period."),
    count("outputs", "outputs.count", "Transparent outputs."),
    count("unaddressed_outputs", "outputs.unaddressed", "Of those, naming no single address."),
    flowZat(
      "outputs_transparent_zat",
      "outputs.value.transparent",
      "Paid to transparent outputs by transparent-only transactions (change included).",
    ),
    flowZat(
      "outputs_mixed_zat",
      "outputs.value.mixed",
      "Paid to transparent outputs by mixed transactions (change included).",
    ),
    flowZat("outputs_total_zat", "outputs.value.total", "The two above."),
    count("inputs", "inputs.count", "Transparent inputs."),
    count("unresolved_inputs", "inputs.unresolved", "Of those, with no resolved value."),
    flowZat(
      "inputs_transparent_zat",
      "inputs.value.transparent",
      "Spent by transparent inputs of transparent-only transactions.",
    ),
    flowZat(
      "inputs_mixed_zat",
      "inputs.value.mixed",
      "Spent by transparent inputs of mixed transactions.",
    ),
    flowZat("inputs_total_zat", "inputs.value.total", "The two above."),
    ...(["active", "sending", "receiving"] as const).map((k) =>
      col(
        `${k}_addresses`,
        "int",
        `addresses.${k}`,
        `Distinct ${k} transparent addresses. Empty: omitted for a month the window cuts, unmeasured for a month not counted yet.`,
        ["omitted", "unmeasured"],
      ),
    ),
  ],
};

/** `/v1/analytics/monthly`, the older monthly rollup: `periodStart` is unix seconds there. */
export const MONTHLY_SPEC: ExportSpec = {
  dataset: "monthly",
  rows: (body): SourceRow[] => listRows(body, "points"),
  columns: [
    PERIOD_START,
    count("top_height", "topHeight", "The month's highest block: the balances are read there."),
    count("transparent_txs", "txs.transparent", "Transparent transactions (coinbase excluded)."),
    count("mixed_txs", "txs.mixed", "Mixed transactions."),
    count("shielded_txs", "txs.shielded", "Fully shielded transactions."),
    ...POOL_NAMES.map((p) =>
      col(`${p}_zat`, "zat", `balances.${p}`, `The ${p} pool's balance at top_height.`),
    ),
    col(
      "net_flow_zat",
      "zat",
      "netFlowZat",
      "Change in the four pools' total since the previous month.",
    ),
    ...shareColumns("fully_shielded", "fullyShieldedShare", "Fully shielded transactions"),
    ...shareColumns("pool_touching", "poolTouchingShare", "Transactions touching a shielded pool"),
  ],
};

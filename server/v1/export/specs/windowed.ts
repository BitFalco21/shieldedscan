import { POOL_NAMES } from "@/domain/pool";
import { at, explode, listRows, objectRow, type SourceRow } from "../table";
import { PERIOD_START, col, shareColumns, type ExportSpec } from "../spec";

/**
 * The windowed analytics (`windowed/routes.ts`) and the miners over a window. A window asked for
 * with `interval=none` has no periods, so its table is the one totals row, dated by the window's
 * first day; otherwise the rows are the periods and the totals stay in the JSON answer.
 */

/** The periods, or the totals as one row starting on the window's first day. */
function periods(body: unknown): SourceRow[] {
  if (at(body, "data.interval") !== "none") return listRows(body, "data.buckets");
  const totals = objectRow(body, "data.totals");
  return [
    { ...totals, value: { ...(totals.value as object), periodStart: at(body, "window.from") } },
  ];
}

/** The chain height a windowed answer was read at: the index's own tip. */
const indexed = (body: unknown) => {
  const height = at(body, "indexed.height");
  const time = at(body, "indexed.time");
  return {
    height: typeof height === "number" ? height : null,
    through: typeof time === "string" ? time : null,
  };
};

const count = (name: string, path: string, what: string) => col(name, "int", path, what);

export const ACTIVITY_SPEC: ExportSpec = {
  dataset: "activity",
  rows: periods,
  columns: (body) => [
    PERIOD_START,
    count("blocks", "blocks", "Blocks in the period."),
    count("txs", "transactions.total", "Transactions, coinbase excluded."),
    count("transparent_txs", "transactions.byKind.transparent", "Transparent-only."),
    count("mixed_txs", "transactions.byKind.mixed", "Mixed: crossing the shielded boundary."),
    count("fully_shielded_txs", "transactions.byKind.fullyShielded", "Fully shielded."),
    count(
      "shielding_txs",
      "transactions.mixedByDirection.shielding",
      "Mixed, value entering the pools.",
    ),
    count(
      "unshielding_txs",
      "transactions.mixedByDirection.unshielding",
      "Mixed, value leaving the pools.",
    ),
    count(
      "indeterminate_txs",
      "transactions.mixedByDirection.indeterminate",
      "Mixed, pools moving both ways.",
    ),
    ...POOL_NAMES.map((p) =>
      col(
        `${p}_txs`,
        "int",
        `transactions.byPool.${p}`,
        `Transactions that used the ${p} pool. Empty when not measured for the period.`,
        ["unmeasured"],
      ),
    ),
    ...shareColumns("fully_shielded", "fullyShieldedShare", "Fully shielded transactions"),
    col("fee_zat", "zat", "fees.feeZat", "Fees paid, zatoshi."),
    count(
      "fee_blocks_covered",
      "fees.blocksCovered",
      "Blocks whose fees are known; fee_zat covers these.",
    ),
    // Only when a value floor was asked for: otherwise the answer has no such figures.
    ...(at(body, "query.minZec") !== null || at(body, "query.minFiat") !== null
      ? [
          count("over_floor_shielding", "overFloor.shielding", "Shieldings at or over the floor."),
          count(
            "over_floor_unshielding",
            "overFloor.unshielding",
            "Unshieldings at or over the floor.",
          ),
          count("over_floor_priced", "overFloor.priced", "Transactions with a price on their day."),
          count(
            "over_floor_considered",
            "overFloor.considered",
            "Transactions tested against the floor.",
          ),
        ]
      : []),
  ],
  provenance: indexed,
};

const amountCols = (name: string, path: string, what: string) => [
  col(`${name}_txs`, "int", `value.${path}.txs`, `${what}: transactions.`),
  col(`${name}_zat`, "zat", `value.${path}.amountZat`, `${what}: zatoshi.`),
];

export const SHIELDING_FLOW_SPEC: ExportSpec = {
  dataset: "shielding-flow",
  rows: (body) => explode(periods(body), "pools", "pool"),
  columns: [
    PERIOD_START,
    col("pool", "text", "pool", "sprout | sapling | orchard | ironwood."),
    ...amountCols("shielded", "shielded", "Value entering the pool from the transparent side"),
    ...amountCols("unshielded", "unshielded", "Value leaving the pool to the transparent side"),
    col("net_zat", "zat", "value.netZat", "shielded_zat minus unshielded_zat."),
    ...amountCols("coinbase", "coinbase", "Shielded coinbase paid into the pool"),
  ],
  provenance: indexed,
};

/** One row per period, source and destination. */
function migrationRows(body: unknown): SourceRow[] {
  if (at(body, "data.interval") === "none") {
    const cells = listRows(body, "data.totals");
    return cells.map((r) => ({
      ...r,
      value: { ...(r.value as object), periodStart: at(body, "window.from") },
    }));
  }
  const buckets = at(body, "data.buckets");
  if (!Array.isArray(buckets)) throw new Error("export: no buckets");
  return buckets.flatMap((_, i) =>
    listRows(body, `data.buckets.${i}.cells`).map((r) => ({
      ...r,
      value: { ...(r.value as object), periodStart: at(buckets[i], "periodStart") },
    })),
  );
}

export const MIGRATIONS_SPEC: ExportSpec = {
  dataset: "migrations",
  rows: migrationRows,
  columns: [
    PERIOD_START,
    col("source", "text", "source", "The pool value left (multi: several)."),
    col("destination", "text", "destination", "The pool value entered."),
    count("txs", "txs", "Migration transactions."),
    col("amount_zat", "zat", "amountZat", "Value migrated, zatoshi."),
    col("value_currency", "text", "value.currency", "The currency value_amount is in."),
    col(
      "value_amount",
      "decimal",
      "value.amount",
      "Value at each day's close. Empty when no migrated transaction had a price that day.",
      ["unmeasured"],
    ),
    count("value_priced_txs", "value.pricedTxs", "Transactions value_amount covers."),
  ],
  provenance: indexed,
};

const MINER_SHARE_ABSENT = ["nonexistent"] as const;

export const MINERS_SPEC: ExportSpec = {
  dataset: "miners",
  rows: (body) => listRows(body, "data.miners"),
  columns: [
    count("rank", "rank", "Rank by blocks in the window."),
    col("address", "text", "address", "The payout address of each coinbase's largest output."),
    count("blocks", "blocks", "Blocks it mined in the window."),
    ...shareColumns("share", "share", "Its share of every block in the window", MINER_SHARE_ABSENT),
    col(
      "reward_zat",
      "zat",
      "reward.zat",
      "Everything its coinbase outputs paid it, fees included.",
      ["unmeasured"],
    ),
    col("fees_zat", "zat", "fees.zat", "The fees part of reward_zat; never add the two.", [
      "unmeasured",
    ]),
    count("first_height", "firstHeight", "Its first block in the window."),
    count("last_height", "lastHeight", "Its last block in the window."),
  ],
  provenance: (body) => {
    const height = at(body, "data.toHeight");
    return { height: typeof height === "number" ? height : null };
  },
};

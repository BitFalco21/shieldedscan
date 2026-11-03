import { at, listRows } from "../table";
import { col, shareColumns, type ExportSpec } from "../spec";

/** The supply by pool, and the daily ZEC price. */

export const SUPPLY_SPEC: ExportSpec = {
  dataset: "supply",
  rows: (body) => listRows(body, "pools"),
  columns: [
    col("pool", "text", "pool", "transparent | sprout | sapling | orchard | ironwood | lockbox."),
    col(
      "balance_zat",
      "zat",
      "balanceZat",
      "The pool's balance at height_read_at (the X-Data-Height header).",
    ),
    col("shielded", "bool", "shielded", "Whether it is a shielded pool."),
    col("spendable", "bool", "spendable", "False for the lockbox and for a pool closed to spends."),
    ...shareColumns(
      "share_of_shielded",
      "shareOfShielded",
      "Its share of the shielded pools' total; empty for transparent and lockbox",
      ["nonexistent"],
    ),
  ],
  provenance: (body) => {
    const h = at(body, "heightReadAt");
    return { height: typeof h === "number" ? h : null };
  },
};

export const PRICES_SPEC: ExportSpec = {
  dataset: "prices-daily",
  rows: (body) => listRows(body, "items"),
  columns: (body) => {
    const currency = at(body, "currency");
    const other = typeof currency === "string" && currency !== "usd" ? currency : null;
    return [
      col("day", "day", "day", "The UTC day."),
      col("close_usd", "decimal", "usd", "The day's closing price in US dollars."),
      col("source", "text", "source", "The aggregator the close came from."),
      ...(other === null
        ? []
        : [
            col(
              `close_${other}`,
              "decimal",
              "close",
              `The close in ${other.toUpperCase()}: close_usd times that day's reference rate. Empty when the day has no rate.`,
              ["unmeasured"],
            ),
            col("rate_day", "day", "rateDay", "The day the reference rate was published.", [
              "unmeasured",
            ]),
          ]),
    ];
  },
  provenance: (body) => {
    const last = at(body, "lastDay");
    return { through: typeof last === "string" ? last : null };
  },
  truncated: (body) => at(body, "truncated") === true,
};

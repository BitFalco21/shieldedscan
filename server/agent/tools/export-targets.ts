import { DAY_SECONDS, utcDayFromSeconds, type PlotSeriesSpec } from "@/domain";
import type { ExportInterval, ExportRequest } from "./export-args";
import type { DayWindow } from "./day-window";
import type { ExportRefusal } from "./export-refusal";

/**
 * Where each export lives on the public API: a route the export registry serves, its path and its
 * query, built only from validated enums, parsed day strings and checked identifiers. Nothing the
 * model wrote is concatenated: every value here was matched against a closed list or a pattern
 * first, and `URLSearchParams` encodes it.
 */

export interface ExportTarget {
  /** The route pattern as `EXPORTS` keys it (or the address export's), held there by test. */
  pattern: string;
  path: string;
  /** In a fixed order, so one request has one URL and one file name. */
  query: [string, string][];
  /** Which rows or columns answer the question, for the model's description of the file. */
  hint: string;
  /** Lists move with every block; series with the hourly rollup. */
  volatile: boolean;
}

const day = (t: number) => utcDayFromSeconds(t);

/** A memo-backed series: the whole series when asked for all of it by month. */
function seriesQuery(w: DayWindow, interval: ExportInterval): [string, string][] {
  if (w.range === "all" && interval === "month") return [["interval", interval]];
  return [
    ["from", day(w.fromDay)],
    ["to", day(w.toDay)],
    ["interval", interval],
  ];
}

/** A windowed route needs both edges. */
const windowedQuery = (w: DayWindow, interval: ExportInterval): [string, string][] => [
  ["from", day(w.fromDay)],
  ["to", day(w.toDay)],
  ["interval", interval],
];

/** Optional edges: none for the whole history. */
const optionalEdges = (w: DayWindow | null): [string, string][] =>
  w === null || w.range === "all"
    ? []
    : [
        ["from", day(w.fromDay)],
        ["to", day(w.toDay)],
      ];

const series = (path: string, query: [string, string][], hint: string): ExportTarget => ({
  pattern: path,
  path,
  query,
  hint,
  volatile: false,
});

const noFile = (message: string, closest: Record<string, unknown>[]): ExportRefusal => ({
  reason: "not-exportable",
  message,
  closest,
});

/** The series' file, or why `/v1` has none and what it has instead. */
export function seriesTarget(
  spec: PlotSeriesSpec,
  w: DayWindow,
  interval: ExportInterval,
): ExportTarget | ExportRefusal {
  const q = seriesQuery(w, interval);
  const windowed = windowedQuery(w, interval);
  switch (spec.family) {
    case "pool":
      switch (spec.metric) {
        case "balance":
          return series(
            "/v1/analytics/pools",
            q,
            `the ${spec.pool}_zat column: the pool's balance at each period's closing block (all four pools are in the file)`,
          );
        case "transactions":
          return series(
            "/v1/analytics/pool-usage",
            [["pool", spec.pool], ...q],
            "the txs column: transactions that used the pool, per period",
          );
        case "notes":
          return series(
            "/v1/analytics/pool-usage",
            [["pool", spec.pool], ...q],
            "notes_at_close (the note tree size at the period's close) and notes_created",
          );
        case "migrated-in":
          return series(
            "/v1/analytics/migrations",
            [["destination", spec.pool], ...windowed],
            "amount_zat and txs: value migrated into the pool, one row per period and source pool",
          );
      }
      break;
    case "supply":
      if (spec.part === "shielded") {
        return series(
          "/v1/analytics/pools",
          q,
          "the total_shielded_zat column: the shielded pools' sum at each period's closing block",
        );
      }
      return noFile(
        `the ${spec.part} supply has no history file on the public API: the file of today's supply by pool, or the shielded pools over time, are the nearest`,
        [{ family: "supply-by-pool" }, { family: "supply", part: "shielded", ...rangeOf(w) }],
      );
    case "shielding":
      return series(
        "/v1/analytics/shielding-flow",
        windowed,
        `${spec.direction === "in" ? "shielded_zat" : "unshielded_zat"}: one row per period and pool, so a period's total is its pool rows together`,
      );
    case "transactions":
      return series(
        "/v1/analytics/activity",
        windowed,
        `the ${spec.kind === "shielded" ? "fully_shielded_txs" : `${spec.kind}_txs`} column (every privacy kind is in the file)`,
      );
    case "fees":
      return spec.stat === "total"
        ? series("/v1/analytics/activity", windowed, "the fee_zat column: fees paid per period")
        : series(
            "/v1/analytics/fees",
            q,
            `rows of kind ${spec.kind === "shielded" ? "fullyShielded" : spec.kind}: median_zat, with p25_zat and p75_zat`,
          );
    case "mining":
      if (spec.metric === "blocks" || spec.metric === "difficulty") {
        return series(
          "/v1/analytics/network",
          q,
          spec.metric === "blocks" ? "the blocks column" : "the avg_difficulty column",
        );
      }
      return noFile(
        "miner shares per month have no file on the public API; the miners over a window, each with its share of the blocks, are the nearest",
        [{ family: "miners", ...rangeOf(w) }],
      );
    case "network":
      return spec.metric === "block-size"
        ? series("/v1/analytics/network", q, "the avg_block_bytes column")
        : series(
            "/v1/analytics/transparent",
            q,
            "the active_addresses column (distinct active transparent addresses)",
          );
    case "price":
      // The route's `to` is inclusive, and it never serves today's unfinished day.
      return series(
        "/v1/prices/daily",
        [
          ["from", day(w.fromDay)],
          ["to", day(w.toDay - DAY_SECONDS)],
        ],
        "close_usd: each UTC day's closing price, with the aggregator it came from",
      );
    case "crosschain":
      break;
  }
  return noFile("that series has no file on the public API", []);
}

/** A window as arguments again, for a closest that keeps it. */
function rangeOf(w: DayWindow): Record<string, unknown> {
  return w.range !== null ? { range: w.range } : { from: day(w.fromDay), to: day(w.toDay) };
}

const PAGE = ["limit", "100"] as const;

const list = (pattern: string, path: string, query: [string, string][], hint: string) => ({
  pattern,
  path,
  query,
  hint,
  volatile: true,
});

/** A list's newest page (or a miner ranking over a window). */
export function listTarget(req: Extract<ExportRequest, { kind: "list" }>): ExportTarget {
  switch (req.family) {
    case "blocks":
      return list("/v1/blocks", "/v1/blocks", [[...PAGE]], "the newest 100 blocks");
    case "transaction-list":
      return list(
        "/v1/transactions",
        "/v1/transactions",
        [
          [...PAGE],
          ...(req.txKind === null ? [] : [["kind", req.txKind] as [string, string]]),
          ...(req.pool === null ? [] : [["pool", req.pool] as [string, string]]),
          ...optionalEdges(req.window),
        ],
        "the newest 100 transactions matching the filters",
      );
    case "block-transactions":
      return list(
        "/v1/blocks/:id/transactions",
        `/v1/blocks/${encodeURIComponent(req.block ?? "")}/transactions`,
        [[...PAGE]],
        "the block's transactions, 100 per page",
      );
    case "rich-list":
      return list(
        "/v1/rich-list",
        "/v1/rich-list",
        [[...PAGE]],
        "the 100 largest transparent balances",
      );
    case "reorgs":
      return list(
        "/v1/reorgs",
        "/v1/reorgs",
        [[...PAGE]],
        "the newest 100 reorgs this explorer saw",
      );
    case "supply-by-pool":
      return list(
        "/v1/supply",
        "/v1/supply",
        [],
        "one row per pool: its balance at the height read, and its share of the shielded total",
      );
    case "miners":
      return {
        ...list(
          "/v1/analytics/miners",
          "/v1/analytics/miners",
          [...optionalEdges(req.window), [...PAGE]],
          "one row per payout address, ranked by blocks mined in the window, with its share",
        ),
        volatile: false,
      };
  }
}

/** One transparent address's whole history (checked transparent before it reaches here). */
export function addressTarget(address: string): ExportTarget {
  return {
    pattern: "/v1/addresses/:address/export",
    path: `/v1/addresses/${encodeURIComponent(address)}/export`,
    query: [],
    hint: "every transaction paying or spending from the address, oldest first",
    volatile: true,
  };
}

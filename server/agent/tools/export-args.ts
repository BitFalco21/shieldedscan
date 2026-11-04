import {
  DAY_SECONDS,
  isOneOf,
  parseSeriesSpec,
  PLOT_FAMILIES,
  PLOT_PARAM_NAMES,
  PLOT_TX_KINDS,
  POOL_NAMES,
  utcDayFromSeconds,
  type PlotSeriesSpec,
  type PlotTxKind,
  type PoolName,
} from "@/domain";
import { CROSSCHAIN_EXPORT_ENABLED, CROSSCHAIN_EXPORT_REFUSAL } from "../../v1/export/policy";
import { closestForUnknown } from "./chart-refusal";
import { isWindowRefusal, parseDayWindow, type DayWindow } from "./day-window";
import type { ExportRefusal } from "./export-refusal";

/**
 * `export_data`'s arguments, validated. The model chooses WHAT to export: a family from make_chart's
 * lists (or a list of rows), its parameters, a window and a grain. Nothing it sends is a figure or a
 * URL, and an argument outside these keys is refused by name, so a call carrying `url` or `values`
 * fails loudly instead of looking like it worked.
 */

/** Exports that are lists of rows rather than a series over time. */
export const EXPORT_LIST_FAMILIES = [
  "blocks",
  "transaction-list",
  "block-transactions",
  "rich-list",
  "reorgs",
  "supply-by-pool",
  "miners",
  "address-history",
] as const;
export type ExportListFamily = (typeof EXPORT_LIST_FAMILIES)[number];

export const EXPORT_FAMILIES = [...PLOT_FAMILIES, ...EXPORT_LIST_FAMILIES] as const;
export const EXPORT_INTERVALS = ["day", "month"] as const;
export type ExportInterval = (typeof EXPORT_INTERVALS)[number];

export const EXPORT_ARG_KEYS = [
  "family",
  ...PLOT_PARAM_NAMES,
  "address",
  "block",
  "range",
  "from",
  "to",
  "interval",
] as const;

/** `interval=day` answers at most this many days per request (`server/v1/params.ts`). */
export const MAX_DAILY_EXPORT_DAYS = 366;
/** The daily price route keeps the newest this many rows of a longer window (`v1/prices.ts`). */
export const MAX_PRICE_EXPORT_DAYS = 1_000;

const WINDOW_KEYS = ["range", "from", "to"] as const;

/** What each list family takes besides `family`. */
const LIST_PARAMS: Readonly<Record<ExportListFamily, readonly string[]>> = {
  blocks: [],
  "transaction-list": ["kind", "pool", ...WINDOW_KEYS],
  "block-transactions": ["block"],
  "rich-list": [],
  reorgs: [],
  "supply-by-pool": [],
  miners: [...WINDOW_KEYS],
  "address-history": ["address"],
};

export type ExportRequest =
  | { kind: "series"; spec: PlotSeriesSpec; window: DayWindow; interval: ExportInterval }
  | {
      kind: "list";
      family: Exclude<ExportListFamily, "address-history">;
      window: DayWindow | null;
      txKind: PlotTxKind | null;
      pool: PoolName | null;
      block: string | null;
    }
  | { kind: "address"; address: string };

const refuse = (
  reason: ExportRefusal["reason"],
  message: string,
  closest?: Record<string, unknown>[],
): ExportRefusal => (closest === undefined ? { reason, message } : { reason, message, closest });

const BLOCK_ID = /^(\d{1,9}|[0-9a-f]{64})$/;

/** The request, or the refusal the model should see to correct its call or answer in words. */
export function parseExportArgs(
  args: Record<string, unknown>,
  nowMs: number,
): ExportRequest | ExportRefusal {
  const unknown = Object.keys(args).filter((k) => !isOneOf(EXPORT_ARG_KEYS, k));
  if (unknown.length > 0) {
    return refuse(
      "bad-parameter",
      `unknown argument ${unknown.join(", ")} — export_data takes no figures, links or rows: name the data and this explorer builds the file. Arguments are ${EXPORT_ARG_KEYS.join(", ")}`,
    );
  }
  const family = typeof args.family === "string" ? args.family.trim().toLowerCase() : null;
  if (family === null || !isOneOf(EXPORT_FAMILIES, family)) {
    const nearest = closestForUnknown(args);
    if (nearest?.reason === "per-address") {
      return refuse(
        "bad-parameter",
        "one address's history is family address-history, with the transparent (t1…/t3…) address the reader typed",
      );
    }
    return refuse(
      "not-exportable",
      `${family === null ? "export_data needs a family" : `no export family "${family.slice(0, 40)}"`} — families are ${EXPORT_FAMILIES.join(", ")}`,
      nearest?.closest?.map((c) => {
        const series = (c.series as Record<string, unknown>[] | undefined)?.[0];
        return series === undefined ? c : { ...series };
      }),
    );
  }
  if (family === "crosschain") {
    // Checked before its parameters: no spelling of a cross-chain series makes a file today.
    return refuse(
      "policy",
      CROSSCHAIN_EXPORT_ENABLED
        ? "cross-chain series have no file on the public API yet; answer from the crosschain tool in words"
        : CROSSCHAIN_EXPORT_REFUSAL,
    );
  }
  return isOneOf(PLOT_FAMILIES, family)
    ? seriesRequest(family, args, nowMs)
    : listRequest(family as ExportListFamily, args, nowMs);
}

function seriesRequest(
  family: string,
  args: Record<string, unknown>,
  nowMs: number,
): ExportRequest | ExportRefusal {
  const listOnly = ["address", "block"].filter((k) => args[k] !== undefined);
  if (listOnly.length > 0) {
    return refuse(
      "bad-parameter",
      `${listOnly.join(", ")} belongs to the list exports (address-history, block-transactions), not to ${family}`,
    );
  }
  const params = Object.fromEntries(
    Object.entries(args).filter(([k]) => k === "family" || isOneOf(PLOT_PARAM_NAMES, k)),
  );
  const parsed = parseSeriesSpec(params);
  if (!parsed.ok) {
    return refuse(
      parsed.reason === "names-nothing" ? "names-nothing" : "bad-parameter",
      parsed.message,
    );
  }
  const spec = parsed.spec;
  const asked = { ...params, family: spec.family };
  const window = parseDayWindow(args, nowMs, (patch) => ({ ...asked, ...patch }));
  if (isWindowRefusal(window)) return window;
  const days = (window.toDay - window.fromDay) / DAY_SECONDS;
  const today = Math.floor(nowMs / 1000 / DAY_SECONDS) * DAY_SECONDS;

  if (spec.family === "price") {
    if (args.interval !== undefined && args.interval !== "day") {
      return refuse("bad-parameter", "the price file is daily closes; it takes no interval");
    }
    if (days > MAX_PRICE_EXPORT_DAYS) {
      return refuse(
        "window",
        `one daily price file holds at most ${MAX_PRICE_EXPORT_DAYS.toLocaleString("en-US")} days; that window is ${days.toLocaleString("en-US")}. Offer the newest ${MAX_PRICE_EXPORT_DAYS.toLocaleString("en-US")} days, or split the window by from/to`,
        [
          {
            family: "price",
            from: utcDayFromSeconds(today - (MAX_PRICE_EXPORT_DAYS - 1) * DAY_SECONDS),
          },
        ],
      );
    }
    return { kind: "series", spec, window, interval: "day" };
  }

  const interval = args.interval ?? (days <= MAX_DAILY_EXPORT_DAYS ? "day" : "month");
  if (typeof interval !== "string" || !isOneOf(EXPORT_INTERVALS, interval)) {
    return refuse("bad-parameter", `interval must be one of ${EXPORT_INTERVALS.join(", ")}`);
  }
  if (interval === "day" && days > MAX_DAILY_EXPORT_DAYS) {
    return refuse(
      "window",
      `a daily file covers at most ${MAX_DAILY_EXPORT_DAYS} days; that window is ${days.toLocaleString("en-US")}`,
      [
        { ...asked, ...windowArgs(args), interval: "month" },
        { ...asked, range: "1y", interval: "day" },
      ],
    );
  }
  return { kind: "series", spec, window, interval };
}

/** The window as it was asked, for a closest that keeps it. */
function windowArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    WINDOW_KEYS.flatMap((k) => (args[k] === undefined ? [] : [[k, args[k]]])),
  );
}

function listRequest(
  family: ExportListFamily,
  args: Record<string, unknown>,
  nowMs: number,
): ExportRequest | ExportRefusal {
  const allowed = LIST_PARAMS[family];
  const extra = Object.keys(args).filter((k) => k !== "family" && !allowed.includes(k));
  if (extra.length > 0) {
    return refuse(
      "bad-parameter",
      `${family} takes ${allowed.length === 0 ? "no parameters: it is the newest page" : allowed.join(", ")}, not ${extra.join(", ")}`,
    );
  }
  if (family === "address-history") {
    if (typeof args.address !== "string" || args.address.trim() === "") {
      return refuse("bad-parameter", "address-history needs address: the t1… or t3… address");
    }
    return { kind: "address", address: args.address.trim() };
  }

  let block: string | null = null;
  if (family === "block-transactions") {
    const raw = typeof args.block === "string" ? args.block.trim().toLowerCase() : args.block;
    const id = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : raw;
    if (typeof id !== "string" || !BLOCK_ID.test(id)) {
      return refuse("bad-parameter", "block must be a block height or a 64-hex block hash");
    }
    block = id;
  }

  let txKind: PlotTxKind | null = null;
  let pool: PoolName | null = null;
  if (family === "transaction-list") {
    const kind = typeof args.kind === "string" ? args.kind.trim().toLowerCase() : args.kind;
    if (kind !== undefined) {
      if (typeof kind !== "string" || !isOneOf(PLOT_TX_KINDS, kind)) {
        return refuse("bad-parameter", `kind must be one of ${PLOT_TX_KINDS.join(", ")}`);
      }
      txKind = kind;
    }
    const p = typeof args.pool === "string" ? args.pool.trim().toLowerCase() : args.pool;
    if (p !== undefined) {
      if (typeof p !== "string" || !isOneOf(POOL_NAMES, p)) {
        return refuse("bad-parameter", `pool must be one of ${POOL_NAMES.join(", ")}`);
      }
      pool = p;
    }
  }

  let window: DayWindow | null = null;
  if (allowed.includes("range") && WINDOW_KEYS.some((k) => args[k] !== undefined)) {
    const parsed = parseDayWindow(args, nowMs, (patch) => ({ family, ...patch }));
    if (isWindowRefusal(parsed)) return parsed;
    window = parsed;
  }
  return { kind: "list", family, window, txKind, pool, block };
}

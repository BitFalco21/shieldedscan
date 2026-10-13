import { DAY_MS, DAY_SECONDS, ZATS_PER_ZEC, parseUtcDayStart, utcDayFromMs } from "@/domain";
import { type ToolArgs, windowDays } from "./args";
import { isOneOf, orList } from "./json";
import {
  CROSSCHAIN_AGGREGATE_NOTE,
  CROSSCHAIN_DESTINATIONS_NOTE,
  CROSSCHAIN_TRANSFERS_NOTE,
} from "./notes";
import {
  CROSSCHAIN_AGGREGATE_PATH,
  CROSSCHAIN_DESTINATIONS_PATH,
  CROSSCHAIN_DIRECTIONS,
  CROSSCHAIN_GROUP_BY,
  CROSSCHAIN_MODES,
  CROSSCHAIN_RANK_UNITS,
  CROSSCHAIN_SORTS,
  CROSSCHAIN_TOP_PATH,
  CROSSCHAIN_TRANSFERS_PATH,
  CROSSCHAIN_VENUES,
  type CrossChainMode,
  MAX_CROSSCHAIN_ROWS,
} from "./specs";
import type { ToolCall } from "./types";
import { withoutDirection } from "./enrich";
import { thresholdNote, verifyCrossChainQueryEcho, verifyRowsClearThreshold } from "./verify";

/** Zcash's first day: an aggregate with no lower edge starts here, so it misses no crossing. */
const ZCASH_FIRST_DAY = "2016-10-28";

/** The public route's cap on daily groups per request. */
const MAX_CROSSCHAIN_DAY_GROUPS = 366;

/** The public route calls a venue a protocol. */
const V1_GROUP_BY: Readonly<Record<(typeof CROSSCHAIN_GROUP_BY)[number], string>> = {
  none: "none",
  chain: "chain",
  venue: "protocol",
  month: "month",
  day: "day",
};

const opposite = (direction: "in" | "out"): "in" | "out" => (direction === "in" ? "out" : "in");

/**
 * A threshold as the plain decimal the public route parses, never exponent notation. Eight places,
 * the most a ZEC amount has; a dollar threshold finer than that is not a question anyone asks.
 */
function decimalText(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, "");
}

/**
 * The `crosschain` tool's three modes, each turned into one fixed-template request.
 *
 * Every argument is validated and URL-encoded into a template, so nothing a model writes can build a
 * host or path segment of its own choosing. A rejected argument is an error message for the model,
 * which is better than a silently widened query it would describe as the narrow one.
 */
export function crossChainCalls(args: ToolArgs, nowMs: number): ToolCall[] | string {
  const { str, int, num } = args;
  const mode = str("mode");
  if (mode === null || !isOneOf(CROSSCHAIN_MODES, mode)) {
    return `mode must be one of ${CROSSCHAIN_MODES.join(", ")}`;
  }

  const direction = str("direction");
  if (direction !== null && !isOneOf(CROSSCHAIN_DIRECTIONS, direction)) {
    return `direction must be ${orList(CROSSCHAIN_DIRECTIONS, true)}, or omitted for both`;
  }
  const venue = str("venue");
  if (venue !== null && !isOneOf(CROSSCHAIN_VENUES, venue)) {
    return `venue must be ${orList(CROSSCHAIN_VENUES, true)}, or omitted for every venue`;
  }
  // Upper-cased so "btc" and "BTC" are the same question; tickers are stored upper-case.
  const chain = str("chain")?.toUpperCase() ?? null;
  const days = windowDays(args, nowMs);
  if (typeof days === "string") return days;
  /*
   * The value threshold the site's `/cross-chain` chips apply (`usd_value_at_swap >= $n`, `min` on
   * both `/v1` transfer routes), so "worth more than $10k" questions can be asked.
   *
   * Zero is a real threshold (every priced crossing, excluding unpriced ones), hence `< 0` rather than
   * `<= 0`. A negative one has no reading.
   */
  const minUsdAtSwap = args.raw.minUsdAtSwap === undefined ? null : num("minUsdAtSwap");
  if (args.raw.minUsdAtSwap !== undefined && (minUsdAtSwap === null || minUsdAtSwap < 0)) {
    return `minUsdAtSwap must be a number of US dollars, 0 or greater — the venues' own price at the moment of the swap`;
  }

  /*
   * The ZEC sibling, for thresholds stated in ZEC. Travels in ZEC and is converted to zatoshi on the
   * API side, so the model never multiplies by 1e8.
   */
  const minZec = args.raw.minZec === undefined ? null : num("minZec");
  if (args.raw.minZec !== undefined && (minZec === null || minZec < 0)) {
    return `minZec must be a number of ZEC, 0 or greater`;
  }
  const minZecZat = minZec === null ? null : Math.round(minZec * ZATS_PER_ZEC);

  const query = new URLSearchParams();
  if (direction !== null) query.set("direction", direction);
  if (venue !== null) query.set("protocol", venue);
  if (chain !== null) query.set("chain", chain);
  if (days.from !== null) query.set("from", days.from);
  if (days.to !== null) query.set("to", days.to);
  if (minUsdAtSwap !== null) query.set("min", String(minUsdAtSwap));
  if (minZec !== null) query.set("minZec", String(minZec));
  const thresholdAsked = minUsdAtSwap !== null || minZecZat !== null;

  switch (mode as CrossChainMode) {
    case "aggregate": {
      const groupBy = str("groupBy") ?? "none";
      if (!isOneOf(CROSSCHAIN_GROUP_BY, groupBy)) {
        return `groupBy must be one of ${CROSSCHAIN_GROUP_BY.join(", ")}`;
      }
      // The public route takes only a threshold above zero. "Only the priced crossings" needs none:
      // every total carries how many of its transfers were priced.
      if (minUsdAtSwap === 0 || minZec === 0) {
        return `a threshold for 'aggregate' must be above 0; omit it to count every crossing, and read usdPricedTransfers beside each total for how many carried a price`;
      }
      // The public route needs both edges. An open edge means all of history: from Zcash's first
      // day, which no crossing predates, to the end of today.
      const from = days.from ?? ZCASH_FIRST_DAY;
      const to = days.to ?? utcDayFromMs(nowMs + DAY_MS);
      const spanDays = ((parseUtcDayStart(to) ?? 0) - (parseUtcDayStart(from) ?? 0)) / DAY_SECONDS;
      if (groupBy === "day" && spanDays > MAX_CROSSCHAIN_DAY_GROUPS) {
        return `groupBy 'day' covers at most ${MAX_CROSSCHAIN_DAY_GROUPS} days: narrow the window with from/to or lastDays, or group by month`;
      }
      const minUsd = minUsdAtSwap === null ? null : decimalText(minUsdAtSwap);
      const minZecText = minZec === null ? null : decimalText(minZec);
      const v1Query = new URLSearchParams({ from, to, groupBy: V1_GROUP_BY[groupBy] });
      if (direction !== null) v1Query.set("direction", direction);
      if (venue !== null) v1Query.set("protocol", venue);
      if (chain !== null) v1Query.set("chain", chain);
      if (minUsd !== null) v1Query.set("minUsd", minUsd);
      if (minZecText !== null) v1Query.set("minZec", minZecText);
      return [
        {
          path: `${CROSSCHAIN_AGGREGATE_PATH}?${v1Query.toString()}`,
          surface: "v1",
          aggregate: {
            note: thresholdNote(CROSSCHAIN_AGGREGATE_NOTE, minUsdAtSwap, minZecZat),
            // A narrowing that matched nothing is a measurement, not an outage.
            emptyIsAnAnswer: true,
            ...(direction === null
              ? {}
              : { enrich: (payload: unknown) => withoutDirection(payload, opposite(direction)) }),
            verify: (payload) =>
              verifyCrossChainQueryEcho(payload, {
                from,
                to,
                chain,
                venue,
                direction,
                minUsd,
                minZec: minZecText,
              }),
          },
        },
      ];
    }
    case "transfers": {
      const sort = str("sort") ?? "newest";
      if (!isOneOf(CROSSCHAIN_SORTS, sort)) return `sort must be ${orList(CROSSCHAIN_SORTS, true)}`;
      const rank = sort === "newest" ? undefined : sort;
      const by = str("by") ?? "zec";
      if (!isOneOf(CROSSCHAIN_RANK_UNITS, by)) {
        return `by must be ${orList(CROSSCHAIN_RANK_UNITS, true)}`;
      }
      const limit = int("limit") ?? 5;
      if (limit < 1 || limit > MAX_CROSSCHAIN_ROWS) {
        return `limit must be between 1 and ${MAX_CROSSCHAIN_ROWS}`;
      }
      query.set("limit", String(limit));
      // Both ends are the ranked endpoint; `newest` is the plain chronological list.
      if (rank !== undefined) {
        query.set("by", by);
        query.set("order", rank);
      }
      return [
        {
          path: `${rank !== undefined ? CROSSCHAIN_TOP_PATH : CROSSCHAIN_TRANSFERS_PATH}?${query.toString()}`,
          surface: "v1",
          aggregate: {
            note: thresholdNote(CROSSCHAIN_TRANSFERS_NOTE, minUsdAtSwap, minZecZat),
            // An empty page is a real answer here too: no crossing matched the narrowing.
            emptyIsAnAnswer: true,
            // The threshold is verified from the rows, because these two routes publish no `applied` echo — and
            // rows are the stronger check: they are the data rather than a claim about it. Only reachable when a
            // threshold was asked for.
            ...(thresholdAsked
              ? {
                  verify: (payload: unknown) =>
                    verifyRowsClearThreshold(payload, minUsdAtSwap, minZecZat),
                }
              : {}),
          },
        },
      ];
    }
    case "destinations":
      // `direction` is the only narrowing this endpoint takes, defaulting to inbound: "where does bridged
      // ZEC land" is a question about arrivals.
      return [
        {
          path: `${CROSSCHAIN_DESTINATIONS_PATH}?direction=${direction ?? "in"}`,
          surface: "v1",
          aggregate: { note: CROSSCHAIN_DESTINATIONS_NOTE, emptyIsAnAnswer: true },
        },
      ];
  }
}

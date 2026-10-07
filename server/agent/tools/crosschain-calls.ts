import { ZATS_PER_ZEC } from "@/domain";
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
import { thresholdNote, verifyAggregateEcho, verifyRowsClearThreshold } from "./verify";

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
      query.set("groupBy", groupBy);
      return [
        {
          path: `${CROSSCHAIN_AGGREGATE_PATH}?${query.toString()}`,
          surface: "chain",
          aggregate: {
            note: thresholdNote(CROSSCHAIN_AGGREGATE_NOTE, minUsdAtSwap, minZecZat),
            // A narrowing that matched nothing is a measurement, not an outage.
            emptyIsAnAnswer: true,
            verify: (payload) =>
              verifyAggregateEcho(payload, {
                chain,
                venue,
                direction,
                days,
                minUsdAtSwap,
                minZecZat,
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

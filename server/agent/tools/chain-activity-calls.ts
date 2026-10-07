import {
  type ChainWindowMeasure,
  POOL_MIGRATION_DESTINATIONS,
  POOL_MIGRATION_SOURCES,
  POOL_NAMES,
} from "@/domain";
import { USD } from "../../fx-rates";
import { MINERS_MAX_LIMIT, V1_MINERS_PATH } from "../../v1/miners";
import { V1_TRANSPARENT_PATH } from "../../v1/transparent-series";
import { type ToolArgs, windowDays } from "./args";
import { withoutPoints, withPoolCountReason, withRanking, withThroughput } from "./enrich";
import { isOneOf, orList } from "./json";
import {
  CHAIN_WINDOW_FLOOR_NOTE,
  CHAIN_WINDOW_MIGRATION_FILTER_NOTE,
  CHAIN_WINDOW_NOTE,
  CHAIN_WINDOW_RANKED_NOTE,
  MINERS_NOTE,
  POOL_BALANCES_NOTE,
  POOL_USAGE_NOTE,
  RECENT_NOTE,
  TRANSPARENT_NOTE,
} from "./notes";
import {
  CHAIN_ACTIVITY_MODES,
  CHAIN_WINDOW_PATH,
  type ChainActivityMode,
  DEFAULT_MINER_ROWS,
  DEFAULT_RECENT_ROWS,
  DEFAULT_WINDOW_TOP,
  MAX_MINER_ROWS,
  MAX_RECENT_ROWS,
  MAX_WINDOW_FLOOR,
  MAX_WINDOW_TOP,
  RANK_ORDERS,
  RECENT_BLOCKS_PATH,
  RECENT_TRANSACTIONS_PATH,
  RECENT_TX_KINDS,
  TRANSPARENT_MEASURES,
  WINDOW_GROUP_BY,
  WINDOW_MEASURES,
} from "./specs";
import type { ToolCall } from "./types";
import {
  verifyMinersEcho,
  verifySeriesEcho,
  verifyTransparentEcho,
  verifyWindowEcho,
} from "./verify";

/**
 * The `chain_activity` tool's modes.
 *
 * They dispatch at different surfaces. `window` reads the private `/chain/analytics/window`, an
 * aggregate this explorer derives from its own index. The `recent-*` modes read `/v1`, because a list
 * of blocks or transactions is entity detail whose shielded nulls must arrive labelled with their
 * `unknowns` reason rather than as bare nulls a model might read as zero.
 */
export function chainActivityCalls(
  args: ToolArgs,
  nowMs: number,
  currency: string,
): ToolCall[] | string {
  const { str, int, num } = args;
  const mode = str("mode");
  if (mode === null || !isOneOf(CHAIN_ACTIVITY_MODES, mode)) {
    return `mode must be one of ${CHAIN_ACTIVITY_MODES.join(", ")}`;
  }

  switch (mode as ChainActivityMode) {
    case "window": {
      const days = windowDays(args, nowMs);
      if (typeof days === "string") return days;
      const groupBy = str("groupBy") ?? "none";
      if (!isOneOf(WINDOW_GROUP_BY, groupBy)) {
        return `groupBy must be one of ${WINDOW_GROUP_BY.join(", ")}`;
      }

      const sort = str("sort");
      if (sort !== null && sort in TRANSPARENT_MEASURES) {
        return `${sort} is a ranking of mode 'transparent', not 'window'`;
      }
      if (sort !== null && !WINDOW_MEASURES.includes(sort as ChainWindowMeasure)) {
        return `sort must be one of ${WINDOW_MEASURES.join(", ")}`;
      }
      const order = str("order") ?? "highest";
      if (!isOneOf(RANK_ORDERS, order)) {
        return `order must be ${orList(RANK_ORDERS)}`;
      }
      // A ranking needs something to rank. Grouped `none` is one bucket covering the whole window, so
      // sorting it would return that bucket and call it the busiest day. An error the model can correct is
      // better than a well-formed answer to a question nobody asked.
      if (sort !== null && groupBy === "none") {
        return `sort needs groupBy day or month — ranking one bucket that covers the whole window would report the window itself as the top period`;
      }
      const top = int("top") ?? DEFAULT_WINDOW_TOP;
      if (top < 1 || top > MAX_WINDOW_TOP) {
        return `top must be between 1 and ${MAX_WINDOW_TOP}`;
      }

      // The value floors. Rejected here rather than dropped: the route treats a malformed number as "no
      // floor", right for a hand-edited URL but wrong for a model, which would then describe an
      // unthresholded count as a thresholded one. Both may be given and both then bind.
      const floors: Record<"minValue" | "minZec", number | null> = { minValue: null, minZec: null };
      for (const key of ["minValue", "minZec"] as const) {
        if (args.raw[key] === undefined) continue;
        const value = num(key);
        if (value === null || !(value > 0) || value > MAX_WINDOW_FLOOR) {
          return `${key} must be a positive number below ${MAX_WINDOW_FLOOR}`;
        }
        floors[key] = value;
      }
      const thresholded = floors.minValue !== null || floors.minZec !== null;

      // The migration pair filter, rejected rather than dropped for the floors' reason: the route reads an
      // unrecognised pool as "no filter", and the model would describe the whole matrix as one pair's.
      const migrationFrom = str("migrationFrom");
      if (migrationFrom !== null && !isOneOf(POOL_MIGRATION_SOURCES, migrationFrom)) {
        return `migrationFrom must be one of ${POOL_MIGRATION_SOURCES.join(", ")}`;
      }
      const migrationTo = str("migrationTo");
      if (migrationTo !== null && !isOneOf(POOL_MIGRATION_DESTINATIONS, migrationTo)) {
        return `migrationTo must be one of ${POOL_MIGRATION_DESTINATIONS.join(", ")}`;
      }
      if (migrationFrom !== null && migrationFrom === migrationTo) {
        return `a pool never migrates into itself — migrationFrom and migrationTo must differ`;
      }
      const migrationFiltered = migrationFrom !== null || migrationTo !== null;

      const query = new URLSearchParams();
      if (days.from !== null) query.set("from", days.from);
      if (days.to !== null) query.set("to", days.to);
      query.set("groupBy", groupBy);
      // The migration matrix is priced day by day, so the currency has to reach the SQL: an all-time total
      // converted at one rate is fiction across a span where ZEC moved tenfold. Omitted for USD so an
      // unfiltered request stays byte-identical and shares one cache key.
      if (currency !== USD) query.set("currency", currency);
      if (floors.minValue !== null) query.set("minValue", String(floors.minValue));
      if (floors.minZec !== null) query.set("minZec", String(floors.minZec));
      if (migrationFrom !== null) query.set("migrationSource", migrationFrom);
      if (migrationTo !== null) query.set("migrationDestination", migrationTo);
      const measure = sort as ChainWindowMeasure | null;
      return [
        {
          path: `${CHAIN_WINDOW_PATH}?${query.toString()}`,
          surface: "chain",
          aggregate: {
            // The two notes are alternatives, never both: the base note says `groups` is ordered oldest first,
            // which a ranking makes false. The floor caveat is appended rather than replacing either, since a
            // threshold makes nothing in the base note false; conditional to keep every payload short.
            note:
              (measure === null ? CHAIN_WINDOW_NOTE : CHAIN_WINDOW_RANKED_NOTE) +
              (thresholded ? CHAIN_WINDOW_FLOOR_NOTE : "") +
              (migrationFiltered ? CHAIN_WINDOW_MIGRATION_FILTER_NOTE : ""),
            // A window that matched nothing is a measurement ("no transactions that day"); reporting it as an
            // outage would refuse a question the index answers exactly. A whole series defaults the other way,
            // since `[]` there would claim Zcash never shielded anything.
            emptyIsAnAnswer: true,
            // Throughput first, so a ranked row still carries its own rate; the ranking then chooses which rows
            // survive. Both run before `capSeries`, so a ranking is a fact about the whole window.
            enrich: (payload) => {
              const withRate = withPoolCountReason(withThroughput(payload, nowMs));
              return measure === null
                ? withRate
                : withRanking(withRate, measure, order as "highest" | "lowest", top);
            },
            verify: (payload) =>
              verifyWindowEcho(payload, days, floors, currency, {
                source: migrationFrom,
                destination: migrationTo,
              }),
          },
        },
      ];
    }
    case "recent-blocks": {
      const limit = int("limit") ?? DEFAULT_RECENT_ROWS;
      if (limit < 1 || limit > MAX_RECENT_ROWS) {
        return `limit must be between 1 and ${MAX_RECENT_ROWS}`;
      }
      return [
        {
          path: `${RECENT_BLOCKS_PATH}?limit=${limit}`,
          surface: "v1",
          aggregate: { note: RECENT_NOTE, emptyIsAnAnswer: true },
        },
      ];
    }
    case "recent-transactions": {
      const limit = int("limit") ?? DEFAULT_RECENT_ROWS;
      if (limit < 1 || limit > MAX_RECENT_ROWS) {
        return `limit must be between 1 and ${MAX_RECENT_ROWS}`;
      }
      const kind = str("kind") ?? "all";
      if (!isOneOf(RECENT_TX_KINDS, kind)) {
        // An error rather than degrading to "all": a degraded filter would hand the model every transaction
        // on the chain under a heading naming one kind.
        return `kind must be one of ${RECENT_TX_KINDS.join(", ")}`;
      }
      const query = new URLSearchParams({ limit: String(limit) });
      // Omitted for "all" so an unfiltered request stays byte-identical and shares one cache key.
      if (kind !== "all") query.set("kind", kind);
      return [
        {
          path: `${RECENT_TRANSACTIONS_PATH}?${query.toString()}`,
          surface: "v1",
          aggregate: { note: RECENT_NOTE, emptyIsAnAnswer: true },
        },
      ];
    }
    case "miners": {
      // The public `/v1/analytics/miners`, read exactly as a stranger with curl reads it.
      const days = windowDays(args, nowMs);
      if (typeof days === "string") return days;
      const limit = int("limit") ?? DEFAULT_MINER_ROWS;
      if (limit < 1 || limit > Math.min(MAX_MINER_ROWS, MINERS_MAX_LIMIT)) {
        return `limit must be between 1 and ${MAX_MINER_ROWS}`;
      }
      const query = new URLSearchParams();
      if (days.from !== null) query.set("from", days.from);
      if (days.to !== null) query.set("to", days.to);
      query.set("limit", String(limit));
      return [
        {
          path: `${V1_MINERS_PATH}?${query.toString()}`,
          surface: "v1",
          aggregate: {
            note: MINERS_NOTE,
            // A window in which nothing was mined is a measurement, not a failed read.
            emptyIsAnAnswer: true,
            verify: (payload) => verifyMinersEcho(payload, days, limit),
          },
        },
      ];
    }
    case "transparent": {
      // The public `/v1/analytics/transparent`, read exactly as a stranger with curl reads it.
      const days = windowDays(args, nowMs);
      if (typeof days === "string") return days;
      const groupBy = str("groupBy") ?? "none";
      if (!isOneOf(WINDOW_GROUP_BY, groupBy)) {
        return `groupBy must be ${orList(WINDOW_GROUP_BY)}`;
      }
      // The endpoint always carries the window's totals; a month grain keeps the points few.
      const interval = groupBy === "day" ? "day" : "month";
      const query = new URLSearchParams();
      if (days.from !== null) query.set("from", days.from);
      if (days.to !== null) query.set("to", days.to);
      query.set("interval", interval);
      const sort = str("sort");
      if (sort !== null) {
        const field = TRANSPARENT_MEASURES[sort];
        if (field === undefined) {
          return `sort for 'transparent' must be one of ${Object.keys(TRANSPARENT_MEASURES).join(", ")}`;
        }
        if (groupBy === "none") {
          return `sort needs groupBy day or month — ranking one bucket that covers the whole window would report the window itself as the top period`;
        }
        const order = str("order") ?? "highest";
        if (!isOneOf(RANK_ORDERS, order)) return `order must be ${orList(RANK_ORDERS)}`;
        const top = int("top") ?? DEFAULT_WINDOW_TOP;
        if (top < 1 || top > MAX_WINDOW_TOP) return `top must be between 1 and ${MAX_WINDOW_TOP}`;
        // Ranked by the endpoint over EVERY period, before any display trim.
        query.set("sort", field);
        query.set("order", order === "lowest" ? "asc" : "desc");
        query.set("top", String(top));
      }
      return [
        {
          path: `${V1_TRANSPARENT_PATH}?${query.toString()}`,
          surface: "v1",
          aggregate: {
            note: TRANSPARENT_NOTE,
            emptyIsAnAnswer: true,
            verify: (payload) => verifyTransparentEcho(payload, days, interval),
          },
        },
      ];
    }
    case "pools": {
      // The public `/v1/analytics/pool-usage`. It carries per-period points whatever is asked, so an
      // ungrouped call keeps only the totals, and a grouped one takes a single pool: four pools' nested
      // counts for every month of history would be ~150 KB, read twice per turn.
      const days = windowDays(args, nowMs);
      if (typeof days === "string") return days;
      const groupBy = str("groupBy") ?? "none";
      if (!isOneOf(WINDOW_GROUP_BY, groupBy)) {
        return `groupBy must be ${orList(WINDOW_GROUP_BY)}`;
      }
      const poolName = str("pool");
      if (poolName !== null && !isOneOf(POOL_NAMES, poolName)) {
        return `pool must be one of ${POOL_NAMES.join(", ")}`;
      }
      if (groupBy !== "none" && poolName === null) {
        return `per-period pool usage needs one pool: pass pool, and call again for another pool. Without a grouping, all four pools come back together.`;
      }
      const interval = groupBy === "day" ? "day" : "month";
      const query = new URLSearchParams();
      if (days.from !== null) query.set("from", days.from);
      if (days.to !== null) query.set("to", days.to);
      query.set("interval", interval);
      if (poolName !== null) query.set("pool", poolName);
      return [
        {
          path: `/v1/analytics/pool-usage?${query.toString()}`,
          surface: "v1",
          aggregate: {
            note: POOL_USAGE_NOTE,
            emptyIsAnAnswer: true,
            verify: (payload) => verifySeriesEcho(payload, days, interval, poolName),
            ...(groupBy === "none" ? { enrich: withoutPoints } : {}),
          },
        },
      ];
    }
    case "pool-balances": {
      // The public `/v1/analytics/pools`. A balance is a series by nature, so an ungrouped call reads
      // months; the window's closing balance alone is what mode 'window' already carries.
      const days = windowDays(args, nowMs);
      if (typeof days === "string") return days;
      const groupBy = str("groupBy") ?? "month";
      if (!isOneOf(WINDOW_GROUP_BY, groupBy)) {
        return `groupBy must be ${orList(WINDOW_GROUP_BY)} — for pool balances none lists months`;
      }
      const interval = groupBy === "day" ? "day" : "month";
      const query = new URLSearchParams();
      if (days.from !== null) query.set("from", days.from);
      if (days.to !== null) query.set("to", days.to);
      query.set("interval", interval);
      return [
        {
          path: `/v1/analytics/pools?${query.toString()}`,
          surface: "v1",
          aggregate: {
            note: POOL_BALANCES_NOTE,
            emptyIsAnAnswer: true,
            verify: (payload) => verifySeriesEcho(payload, days, interval, null),
          },
        },
      ];
    }
  }
}

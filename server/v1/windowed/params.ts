import { POOL_NAMES, parseUtcDayStart, type CrossChainProtocol } from "@/domain";
import { DAY_SECONDS } from "@/domain/time";
import { MAX_DAY_BUCKETS, ParamError } from "../params";
import type { CrossChainGroupKey, AnalyticsInterval, AnalyticsPool } from "./dto";

/** Query parsing for the windowed analytics, strict like every `/v1` parameter (`../params.ts`). */

/**
 * The shielded pools, oldest first: the order every windowed answer lists them in. Typed as the
 * wire's own pool name, so a pool added to the domain is a compile error here until the wire type
 * names it too.
 */
export const ANALYTICS_POOLS: readonly AnalyticsPool[] = [...POOL_NAMES].reverse();

/** A zero count for every pool, in wire order: a pool that saw nothing is a measured zero. */
export function zeroPoolCounts(): Record<AnalyticsPool, number> {
  return Object.fromEntries(ANALYTICS_POOLS.map((p) => [p, 0])) as Record<AnalyticsPool, number>;
}
export const MIGRATION_SOURCES = [...ANALYTICS_POOLS, "multi"] as const;
/** The `protocol` filter, in the order its 400 has always listed them. */
export const CROSSCHAIN_PROTOCOLS = [
  "near-intents",
  "maya",
  "thorchain",
] as const satisfies readonly CrossChainProtocol[];
const INTERVALS: readonly AnalyticsInterval[] = ["none", "day", "month"];
const GROUP_KEYS: readonly CrossChainGroupKey[] = ["none", "chain", "protocol", "day", "month"];

export interface ParsedWindow {
  from: string;
  to: string;
  fromTimestamp: number;
  toTimestamp: number;
}

/** `from` and `to` are both required UTC days, `from` inclusive, `to` exclusive. */
export function parseWindow(query: Record<string, string>): ParsedWindow {
  const fromTimestamp = parseUtcDayStart(query.from);
  const toTimestamp = parseUtcDayStart(query.to);
  if (fromTimestamp === null) {
    throw new ParamError("invalid_parameter", "from is required, as a UTC day: YYYY-MM-DD");
  }
  if (toTimestamp === null) {
    throw new ParamError(
      "invalid_parameter",
      "to is required, as a UTC day: YYYY-MM-DD (exclusive, so to=2026-10-01 ends on 30 September)",
    );
  }
  if (toTimestamp <= fromTimestamp) {
    throw new ParamError("invalid_parameter", "to must be a later day than from (to is exclusive)");
  }
  return { from: query.from as string, to: query.to as string, fromTimestamp, toTimestamp };
}

export function parseInterval(raw: string | undefined, window: ParsedWindow): AnalyticsInterval {
  const interval = (raw ?? "none") as AnalyticsInterval;
  if (!INTERVALS.includes(interval)) {
    throw new ParamError("invalid_parameter", `interval must be one of ${INTERVALS.join(", ")}`);
  }
  if (interval === "day") {
    const days = (window.toTimestamp - window.fromTimestamp) / DAY_SECONDS;
    if (days > MAX_DAY_BUCKETS) {
      throw new ParamError(
        "invalid_parameter",
        `interval=day covers at most ${MAX_DAY_BUCKETS} days per request (this window is ${days}); use interval=month or a shorter window`,
      );
    }
  }
  return interval;
}

export function parseGroupBy(raw: string | undefined): CrossChainGroupKey {
  const key = (raw ?? "none") as CrossChainGroupKey;
  if (!GROUP_KEYS.includes(key)) {
    throw new ParamError("invalid_parameter", `groupBy must be one of ${GROUP_KEYS.join(", ")}`);
  }
  return key;
}

/** A comma-separated list of pools; absent means all four. Duplicates collapse, order is fixed. */
export function parsePools(raw: string | undefined): AnalyticsPool[] {
  if (raw === undefined || raw === "") return [...ANALYTICS_POOLS];
  const asked = raw.split(",").map((p) => p.trim().toLowerCase());
  const bad = asked.filter((p) => !(ANALYTICS_POOLS as readonly string[]).includes(p));
  if (bad.length > 0) {
    throw new ParamError(
      "invalid_parameter",
      `unknown pool${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}; pool accepts ${ANALYTICS_POOLS.join(", ")}`,
    );
  }
  return ANALYTICS_POOLS.filter((p) => asked.includes(p));
}

export function parseOneOf<T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
): T | null {
  if (raw === undefined || raw === "") return null;
  const value = raw.trim().toLowerCase();
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ParamError("invalid_parameter", `${name} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

/** Counterpart chain tickers: uppercase, deduplicated, sorted, each a plausible ticker. */
export function parseChains(raw: string | undefined): string[] {
  if (raw === undefined || raw === "") return [];
  const chains = [...new Set(raw.split(",").map((c) => c.trim().toUpperCase()))].sort();
  const bad = chains.filter((c) => !/^[A-Z0-9_-]{1,24}$/.test(c));
  if (bad.length > 0 || chains.length > 16) {
    throw new ParamError(
      "invalid_parameter",
      "chain takes up to 16 comma-separated chain tickers, e.g. BTC,ETH",
    );
  }
  return chains;
}

/**
 * A positive decimal amount. Returned both as the caller's normalised string (for the echo) and
 * as a number. ZEC is converted to zatoshi by the caller, so no client ever multiplies by 1e8.
 */
export function parseAmount(
  name: string,
  raw: string | undefined,
): { text: string; value: number } | null {
  if (raw === undefined || raw === "") return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new ParamError("invalid_parameter", `${name} must be a positive decimal number`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ParamError("invalid_parameter", `${name} must be a positive decimal number`);
  }
  return { text: raw, value };
}

/** Exact ZEC decimal to zatoshi, without a float multiplication. */
export function zecTextToZat(text: string): number {
  const [whole = "0", frac = ""] = text.split(".");
  if (frac.length > 8) {
    throw new ParamError("invalid_parameter", "a ZEC amount has at most 8 decimal places");
  }
  if (Number(whole) > 21_000_000) {
    throw new ParamError("invalid_parameter", "a ZEC amount cannot exceed 21,000,000");
  }
  return Number(whole) * 100_000_000 + Number(frac.padEnd(8, "0"));
}

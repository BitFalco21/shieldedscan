import { ZATS_PER_ZEC, type Transaction } from "./transaction";
import type { TxKind } from "./classify";
import { txDirection, txKind } from "./classify";
import type { CrossChainDirection, CrossChainGroupBy, CrossChainProtocol } from "./crosschain";
import { CROSS_CHAIN_GROUP_BYS, protocolLabel } from "./crosschain";
import type { ChainWindowGroupBy } from "./analytics";
import {
  CHAIN_WINDOW_GROUP_BYS,
  POOL_MIGRATION_DESTINATIONS,
  POOL_MIGRATION_SOURCES,
} from "./analytics";
import { isOneOf } from "./closed-set";
import type { PoolName } from "./pool";
import { utcDayFromMs } from "./time";

/**
 * Which transactions a list should show. "all" is the default.
 *
 * `shielding`/`unshielding` are directions, not kinds: they narrow `mixed` by which way value
 * crossed the shielded boundary. They live in the same `?kind=` parameter rather than a separate
 * `?direction=` so that impossible combinations (`kind=transparent&direction=shielding`) are
 * unreachable, and so one selection has one URL and one CDN cache key.
 */
export type TxKindFilter = TxKind | "all" | "shielding" | "unshielding";

const FILTERS: TxKindFilter[] = [
  "all",
  "transparent",
  "shielded",
  "mixed",
  "shielding",
  "unshielding",
  "coinbase",
];

/** Parse an untrusted `?kind=` value; anything unrecognised means "all". */
export function parseTxKindFilter(raw: string | undefined): TxKindFilter {
  return FILTERS.find((filter) => filter === raw) ?? "all";
}

export function txKindFilterLabel(filter: TxKindFilter): string {
  return filter === "all" ? "ALL" : filter.toUpperCase();
}

export const TX_KIND_FILTERS = FILTERS;

/**
 * The sub-filters `mixed` refines into, in menu order. Shared by the chip menu and the store's
 * SQL so the two cannot drift.
 */
export const TX_MIXED_DIRECTION_FILTERS = ["shielding", "unshielding"] as const;

export type TxMixedDirectionFilter = (typeof TX_MIXED_DIRECTION_FILTERS)[number];

/** Whether a filter narrows `mixed` by direction rather than naming a kind outright. */
export function isMixedDirectionFilter(filter: TxKindFilter): filter is TxMixedDirectionFilter {
  return filter === "shielding" || filter === "unshielding";
}

/**
 * Does this transaction belong in a list filtered to `filter`?
 *
 * The single in-memory answer, shared by the fixture source and the node-walk fallback. The
 * Postgres store filters in SQL (before the cursor slice), so its agreement with this function
 * is asserted by a test.
 *
 * `mixed` includes every mixed transaction, including the ~0.09% whose pools moved in opposite
 * directions. Those have no direction, so they appear under `mixed` and under nothing narrower.
 */
export function matchesTxKindFilter(tx: Transaction, filter: TxKindFilter): boolean {
  if (filter === "all") return true;
  if (isMixedDirectionFilter(filter)) {
    return txKind(tx) === "mixed" && txDirection(tx) === filter;
  }
  return txKind(tx) === filter;
}

/** Which cross-chain transfers a list should show. "all" is the default. */
export type CrossChainProtocolFilter = CrossChainProtocol | "all";

// The venues a reader may choose. Only list a venue that carries ZEC: a filter that can only
// return an empty list is a dead control.
const PROTOCOLS: CrossChainProtocolFilter[] = ["all", "maya", "thorchain", "near-intents"];

/** Parse an untrusted `?protocol=` value; anything unrecognised means "all". */
export function parseProtocolFilter(raw: string | undefined): CrossChainProtocolFilter {
  return PROTOCOLS.find((p) => p === raw) ?? "all";
}

export function protocolFilterLabel(filter: CrossChainProtocolFilter): string {
  return filter === "all" ? "ALL VENUES" : protocolLabel(filter);
}

export const CROSSCHAIN_PROTOCOL_FILTERS = PROTOCOLS;

/** Which side of the boundary a cross-chain list should show. "all" is the default. */
export type CrossChainDirectionFilter = CrossChainDirection | "all";

const DIRECTIONS: CrossChainDirectionFilter[] = ["all", "in", "out"];

/** Parse an untrusted `?direction=` value; anything unrecognised means "all". */
export function parseDirectionFilter(raw: string | undefined): CrossChainDirectionFilter {
  return DIRECTIONS.find((d) => d === raw) ?? "all";
}

/** Inbound/outbound, always relative to Zcash. */
export function directionFilterLabel(filter: CrossChainDirectionFilter): string {
  if (filter === "all") return "ALL";
  return filter === "in" ? "INBOUND" : "OUTBOUND";
}

export const CROSSCHAIN_DIRECTION_FILTERS = DIRECTIONS;

/**
 * A chain ticker as it may appear in a `?source=`/`?destination=` list.
 *
 * A shape check rather than an allow-list: the chain set is open (venues add chains without
 * warning), so a compiled-in list would silently drop the newest one. Values reach Postgres as a
 * bound array parameter, never interpolated; the guard mainly bounds their length.
 */
const CHAIN_TICKER = /^[A-Z0-9_-]{1,24}$/;

/**
 * How many chains one side of the filter may name. Generous for a reader (there are ~23
 * counterpart chains) while bounding the URL and the `= ANY($n)` array.
 */
const MAX_CHAIN_FILTER = 16;

/**
 * Parse an untrusted `?source=`/`?destination=` value into a set of chain tickers.
 *
 * Empty means "all". A malformed token is dropped; a well-formed ticker we hold no rows for is
 * kept and yields an honest empty page. Because the set is open, an unknown ticker is never
 * coerced to "all" — that would show rows the reader excluded.
 *
 * Sorted and deduped so one selection has one URL, and therefore one CDN cache key.
 */
export function parseChainFilter(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const chain = part.trim().toUpperCase();
    if (CHAIN_TICKER.test(chain)) seen.add(chain);
    if (seen.size >= MAX_CHAIN_FILTER) break;
  }
  return [...seen].sort();
}

/** The inverse of `parseChainFilter`; `""` for an empty selection, which callers omit. */
export function serializeChainFilter(chains: readonly string[]): string {
  return [...chains].sort().join(",");
}

/**
 * Minimum swap-time USD value a transfer must carry. `null` means every transfer.
 *
 * Swap-time means the venue's own published price when the swap happened, never today's price
 * times a historical amount. Rows in one filtered list are therefore priced in different eras'
 * dollars, which is why the UI labels the chips "VALUE AT SWAP".
 */
export const CROSSCHAIN_MIN_USD_FILTERS: (number | null)[] = [null, 10_000, 100_000, 1_000_000];

/**
 * A ceiling on what a URL may ask for: far above the largest crossing observed (~$13.2M), so it
 * excludes nothing real while keeping an absurd value out of a bind parameter.
 */
const MAX_MIN_USD = 1e12;

/**
 * Parse an untrusted `?min=` value: swap-time USD, as a plain number of dollars.
 *
 * A malformed number (negative, NaN, infinite, junk) means "all". Unlike a chain ticker, a bad
 * number has no honest interpretation. A well-formed value outside the presets is kept, so any
 * amount works from a URL.
 */
export function parseMinUsdFilter(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_MIN_USD) return null;
  return value;
}

/** Nothing on the chain moves more ZEC than exist; a floor above that is a malformed number. */
const MAX_MIN_ZEC = 21_000_000;

/**
 * Parse an untrusted `?minZec=` value — a ZEC amount, as a decimal — into zatoshi, or null.
 *
 * Same contract as `parseMinUsdFilter`. Returned as an integer number of zatoshi (rounded) so
 * the comparison against `zecAmountZat` is exact.
 */
export function parseMinZecFilter(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_MIN_ZEC) return null;
  return Math.round(value * ZATS_PER_ZEC);
}

/** "ALL" / "≥ $10K" / "≥ $100K" / "≥ $1M" — short enough for a chip. */
export function minUsdFilterLabel(min: number | null): string {
  if (min === null) return "ALL";
  if (min >= 1_000_000) return `≥ $${min / 1_000_000}M`;
  if (min >= 1_000) return `≥ $${min / 1_000}K`;
  return `≥ $${min}`;
}

/**
 * A UTC calendar day (`YYYY-MM-DD`) as the unix second it begins at, or null.
 *
 * `Date.parse` rolls an impossible day over (`2026-02-31` becomes March 3rd), so the result is
 * round-tripped back to a string and must match the input.
 */
export function parseUtcDayStart(raw: string | undefined): number | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const ms = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return utcDayFromMs(ms) === raw ? Math.floor(ms / 1000) : null;
}

/**
 * The axis a narrowed aggregate groups along. Unrecognised means `none` (whole-slice totals);
 * a caller that needs to know its axis survived reads the echo.
 */
export function parseCrossChainGroupBy(raw: string | undefined): CrossChainGroupBy {
  return isOneOf(CROSS_CHAIN_GROUP_BYS, raw) ? raw : "none";
}

/**
 * The grain a chain window is broken down by. Unrecognised means `none`.
 *
 * Separate from `parseCrossChainGroupBy` because a chain window has no `chain` or `venue` column
 * to group along.
 */
export function parseChainWindowGroupBy(raw: string | undefined): ChainWindowGroupBy {
  return isOneOf(CHAIN_WINDOW_GROUP_BYS, raw) ? raw : "none";
}

/**
 * The pool a migration filter names, against a closed set. Null means "no filter": a hand-edited
 * URL degrades to the unfiltered matrix, and the agent validates its arguments before sending.
 */
export function parseMigrationSource(raw: string | undefined): PoolName | "multi" | null {
  return isOneOf(POOL_MIGRATION_SOURCES, raw) ? raw : null;
}

export function parseMigrationDestination(raw: string | undefined): PoolName | null {
  return isOneOf(POOL_MIGRATION_DESTINATIONS, raw) ? raw : null;
}

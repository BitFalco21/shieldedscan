import { formatUsdCompact } from "@/lib/format";
import { finiteOrNull } from "@/lib/finite";

/**
 * DeFiLlama's yield index, filtered to the liquidity pools that hold wrapped or bridged ZEC
 * on other chains.
 *
 * A pure parser, like `data/crosschain/`: a foreign payload in, our own type out, no fetch
 * and no clock, so the filter is testable against a captured response.
 *
 *  - The filter is the product. A substring search for "zec" or "zcash" matches unrelated
 *    tokens such as `YZCASH`, so the test is an exact `ZEC` token inside DeFiLlama's own
 *    `symbol`, split on its separators.
 *  - A venue that never published a name gets no invented one. Upstream placeholders such
 *    as `project-0` map to `venue: null`, never a guess and never the chain's name.
 *  - `symbol`, `project` and `chain` are strings a stranger wrote. They are stripped of
 *    control characters and capped at parse time, once; the visible text survives so an
 *    injection attempt can be reported rather than silently deleted.
 *
 * This is not cross-chain transfer data. `/cross-chain` measures ZEC moving through public
 * swap venues; this is a stock of wrapped ZEC sitting in pools at one instant, valued in
 * dollars by a third party.
 */

/** DeFiLlama's own separators inside a pool symbol: `ZEC-USDC`, `WBTC.B-USDC`, `ZEC/ZEC`. */
const TOKEN_SPLIT = /[-/\s+.,()]+/;

/** The one token that means Zcash. Compared exactly, never as a substring. */
export const ZEC_SYMBOL_TOKEN = "ZEC";

/**
 * The upstream's placeholder for "this pool's protocol is unnamed": a literal
 * `project-<n>`. Such a source published no name, so the caller emits `null`.
 */
const UNNAMED_VENUE = /^project-\d+$/i;

/** Longest text this module will pass on from a stranger. Real symbols run to 59 characters. */
const MAX_TEXT = 120;

/**
 * Pools handed to a caller, most wrapped ZEC first.
 *
 * Capped because the set grows without warning and the payload is read by a language model,
 * where every row costs tokens. Ranked by TVL rather than yield: size describes liquidity,
 * while ranking by APY would order the list by the one figure this site does not endorse.
 *
 * The true count travels with it (`matchedPools`), and `totalTvlUsd` sums every match, not
 * only the rows shown.
 */
export const MAX_POOLS = 30;

const DEFAULT_YIELDS_BASE = "https://yields.llama.fi";

/**
 * The base URL is configuration, never a constant: third-party hosts go away. The default
 * is `yields.llama.fi`, not the `api.llama.fi/pools` DeFiLlama's documentation gives, which
 * returns 404.
 */
export function defillamaYieldsBase(env: Record<string, string | undefined> = process.env): string {
  const raw = env.DEFILLAMA_YIELDS_URL?.trim();
  return raw ? normaliseYieldsBase(raw) : DEFAULT_YIELDS_BASE;
}

/** Accepts a base with or without a trailing slash or a trailing `/pools`. */
export function normaliseYieldsBase(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/pools$/, "");
}

/** Does this symbol name ZEC as one of its tokens? `YZCASH` and `RENZEC` do not. */
export function symbolHoldsZec(symbol: string): boolean {
  return symbol
    .toUpperCase()
    .split(TOKEN_SPLIT)
    .some((token) => token === ZEC_SYMBOL_TOKEN);
}

/** Did the source publish a protocol name for this pool, or its own placeholder? */
export function venueIsNamed(project: string): boolean {
  return !UNNAMED_VENUE.test(project.trim());
}

export interface WrappedZecPool {
  /** DeFiLlama's own `symbol`, sanitised but not reworded. */
  symbol: string;
  /** DeFiLlama's `project`, or null where it published none. Never inferred. */
  venue: string | null;
  /** The chain the pool lives on, as the source names it. */
  chain: string | null;
  /** DeFiLlama's dollar valuation of the pool, or null where it published none. */
  tvlUsd: number | null;
  /** The same figure pre-formatted, so no consumer converts or rounds it. */
  tvlUsdText: string | null;
  /** DeFiLlama's own annualised yield. Null is "they published none" — never a zero. */
  apyPct: number | null;
  apyPctText: string | null;
}

export interface WrappedZecPoolSnapshot {
  /** Provenance travels IN the payload, not only in a note above it. */
  source: "DeFiLlama";
  sourceApi: string;
  /** Unix seconds at which this snapshot was read. TVL and APY move continuously. */
  asOf: number;
  /** How many pools the source published in total — the denominator for `matchedPools`. */
  poolsScanned: number;
  /** Every pool matching the ZEC-token filter, whether or not it is listed below. */
  matchedPools: number;
  pools: WrappedZecPool[];
  /** Present only when the list was capped, so a short list cannot be mistaken for one. */
  poolsWithheld?: string;
  /** Summed over every match, by us, so nothing downstream adds a column. */
  totalTvlUsd: number;
  totalTvlUsdText: string;
  /** How many of `matchedPools` carried a TVL figure at all — the total's own denominator. */
  totalCoversPools: number;
}

export interface SelectWrappedZecPoolsOptions {
  /** Unix seconds. Supplied by the caller so this module holds no clock. */
  asOf: number;
  /** The host the payload came from, for the provenance field. */
  sourceApi: string;
  maxPools?: number;
}

/**
 * Filter, rank and cap DeFiLlama's index.
 *
 * Returns null when the payload is not a shape this parser understands — a shape change is
 * not an empty result, and the caller must turn it into an error. An empty `pools` array is
 * also the caller's decision: zero matches is ambiguous between a delisting and a broken
 * filter.
 */
export function selectWrappedZecPools(
  payload: unknown,
  options: SelectWrappedZecPoolsOptions,
): WrappedZecPoolSnapshot | null {
  const rows = poolRowsOf(payload);
  if (rows === null) return null;

  const matched: WrappedZecPool[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const symbol = cleanText(record.symbol);
    if (symbol === null || !symbolHoldsZec(symbol)) continue;
    const venue = cleanText(record.project);
    const tvlUsd = finiteOrNull(record.tvlUsd);
    const apyPct = finiteOrNull(record.apy);
    matched.push({
      symbol,
      venue: venue !== null && venueIsNamed(venue) ? venue : null,
      chain: cleanText(record.chain),
      tvlUsd,
      tvlUsdText: tvlUsd === null ? null : formatUsdCompact(tvlUsd),
      apyPct,
      // Two decimals rather than the source's twelve: a yield quoted to a picopercent asserts a
      // precision no venue's data carries.
      apyPctText: apyPct === null ? null : `${apyPct.toFixed(2)}%`,
    });
  }

  // Deterministic beyond the TVL ordering, so the same index produces the same payload and an
  // answer does not reshuffle between two identical questions.
  matched.sort(
    (a, b) =>
      (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1) ||
      a.symbol.localeCompare(b.symbol) ||
      (a.chain ?? "").localeCompare(b.chain ?? "") ||
      (a.venue ?? "").localeCompare(b.venue ?? ""),
  );

  const withTvl = matched.filter((pool) => pool.tvlUsd !== null);
  const totalTvlUsd = withTvl.reduce((sum, pool) => sum + (pool.tvlUsd ?? 0), 0);
  const maxPools = options.maxPools ?? MAX_POOLS;
  const shown = matched.slice(0, maxPools);
  return {
    source: "DeFiLlama",
    sourceApi: options.sourceApi,
    asOf: options.asOf,
    poolsScanned: rows.length,
    matchedPools: matched.length,
    pools: shown,
    ...(matched.length > shown.length
      ? {
          poolsWithheld: `showing the ${shown.length} largest of ${matched.length} matching pools by TVL; the remaining ${matched.length - shown.length} are not listed here. totalTvlUsd below still covers ALL of them.`,
        }
      : {}),
    totalTvlUsd,
    totalTvlUsdText: formatUsdCompact(totalTvlUsd),
    totalCoversPools: withTvl.length,
  };
}

/** The pool array, from either the documented envelope or a bare array. Null if neither. */
function poolRowsOf(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object" || payload === null) return null;
  const data = (payload as Record<string, unknown>).data;
  return Array.isArray(data) ? data : null;
}

/**
 * A stranger's string, made safe to carry without being reworded. Control and format
 * characters (line breaks, bidirectional overrides) are removed and the length is capped;
 * the visible text is otherwise untouched so an injection attempt can be reported.
 */
function cleanText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const printable = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (printable === "") return null;
  return printable.length > MAX_TEXT ? `${printable.slice(0, MAX_TEXT)}…` : printable;
}

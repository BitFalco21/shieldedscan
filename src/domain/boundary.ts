import { ZATS_PER_ZEC } from "./transaction";
import { crossingFromBalances } from "./classify";
import type { PoolName } from "./pool";
import { isCanonicalTxid } from "./txid";
import { formatUsdExact } from "@/lib/format";

/**
 * One large crossing of the shielded boundary, as published on X.
 *
 * Terms only: every label and total the card and the post print is derived by a function
 * below, so the image and the text cannot state different figures.
 */
export interface BoundaryFigures {
  /** The ledger key. Exactly-once falls out of the `(kind, event_key)` primary key. */
  txid: string;
  blockHeight: number;
  timestamp: number;
  /**
   * Every pool whose value balance actually moved, in RPC sign (positive = into the pool).
   * Never a pool whose bundle merely appears with a zero balance. The producer filters
   * zeros; `boundaryIsComplete` refuses any that slip through.
   */
  pools: BoundaryPoolMove[];
  /**
   * ZEC/USD read when the post was claimed, stored so the card renders the price the text
   * was composed against. The event is minutes old, so a live price is contemporaneous.
   * Null when the tracker was cold, which means no post.
   */
  priceUsd: number | null;
}

export interface BoundaryPoolMove {
  pool: PoolName;
  /** Signed zatoshi, RPC convention: positive into the pool, negative out of it. */
  valueBalanceZat: number;
}

export type BoundaryDirection = "shielding" | "unshielding";

export const SHIELDING_KIND = "shielding";
export const SHIELDING_DRYRUN_KIND = "shielding-dryrun";
export const UNSHIELDING_KIND = "unshielding";
export const UNSHIELDING_DRYRUN_KIND = "unshielding-dryrun";

/**
 * Which way this transaction moved value across the boundary, or `null` when the pools
 * disagree (e.g. a net unshielding from Sapling while Orchard gains a little). Such a
 * transaction posts nothing. Delegates to `crossingFromBalances`, the sign rule shared with
 * `boundaryCrossing` and `txDirection`.
 */
export function boundaryDirection(f: BoundaryFigures): BoundaryDirection | null {
  const crossing = crossingFromBalances(f.pools.map((p) => p.valueBalanceZat));
  if (crossing === "in") return "shielding";
  if (crossing === "out") return "unshielding";
  return null;
}

/**
 * The ledger kind for a direction, real or dry-run. One mapping, no second copy.
 *
 * Also imported by the social-post service, which is maintained outside this repository.
 */
export function boundaryKind(direction: BoundaryDirection, dryRun: boolean): string {
  if (direction === "shielding") return dryRun ? SHIELDING_DRYRUN_KIND : SHIELDING_KIND;
  return dryRun ? UNSHIELDING_DRYRUN_KIND : UNSHIELDING_KIND;
}

/**
 * How much crossed, as an unsigned zatoshi total. Derived from the legs rather than stored,
 * so a multi-pool card's legs always add up to its total.
 */
export function boundaryAmountZat(f: BoundaryFigures): number {
  return Math.abs(f.pools.reduce((sum, p) => sum + p.valueBalanceZat, 0));
}

/** The pools that moved, largest movement first — the order every surface renders. */
export function boundaryPoolsRanked(f: BoundaryFigures): BoundaryPoolMove[] {
  return [...f.pools].sort((a, b) => Math.abs(b.valueBalanceZat) - Math.abs(a.valueBalanceZat));
}

/**
 * "Ironwood pool", or "Orchard + Sapling" when more than one moved. Natural case; the card's
 * CSS uppercases it, so screen readers announce a phrase.
 */
export function boundaryPoolLabel(f: BoundaryFigures): string {
  const ranked = boundaryPoolsRanked(f);
  if (ranked.length === 1) return `${poolTitle(ranked[0]!.pool)} pool`;
  return ranked.map((p) => poolTitle(p.pool)).join(" + ");
}

/**
 * The phrase the post uses: "the Ironwood pool", or "two pools" when several moved.
 *
 * Not the card's "+"-joined label: the post already lists each pool with its amount, so it
 * would name them twice. The count is spelled out so it does not read as another figure.
 *
 * Also imported by the social-post service, which is maintained outside this repository.
 */
export function boundaryPoolPhrase(f: BoundaryFigures): string {
  const ranked = boundaryPoolsRanked(f);
  if (ranked.length === 1) return `the ${poolTitle(ranked[0]!.pool)} pool`;
  return `${countWord(ranked.length)} pools`;
}

/** Title case for a pool: the tweet has no stylesheet to uppercase it in. */
export function poolTitle(pool: PoolName): string {
  return `${pool[0]!.toUpperCase()}${pool.slice(1)}`;
}

/** Small counts as words; falls back to the numeral rather than throwing. */
function countWord(n: number): string {
  return ["", "one", "two", "three", "four"][n] ?? String(n);
}

/**
 * ZEC at a fixed two decimals, the figure both the card and the post print.
 *
 * A headline on a social graphic, not a ledger amount: the site itself always shows eight
 * decimals (`formatZecAmount`), and the txid travels with every post. Shared by card and
 * composer so they cannot round differently.
 *
 * Also imported by the social-post service, which is maintained outside this repository.
 */
export function formatBoundaryZec(zat: number): string {
  return (Math.abs(zat) / ZATS_PER_ZEC).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * The crossing's value at the stored price, to a whole dollar — a headline, where cents are
 * noise. Rounds first, then formats with `formatUsdExact`, as `formatSwapUsdAtSwap` does.
 *
 * Also imported by the social-post service, which is maintained outside this repository.
 */
export function formatBoundaryUsd(value: number): string {
  return formatUsdExact(Math.round(value)).slice(0, -3);
}

/** The crossing's USD value, or null when no price was stored. */
export function boundaryUsdValue(f: BoundaryFigures): number | null {
  if (f.priceUsd === null || !Number.isFinite(f.priceUsd) || f.priceUsd <= 0) return null;
  return (boundaryAmountZat(f) / ZATS_PER_ZEC) * f.priceUsd;
}

/** Does this crossing carry every figure the card prints? A missing one means no post. */
export function boundaryIsComplete(f: BoundaryFigures): boolean {
  return missingBoundaryFigure(f) === "none";
}

/**
 * Which figure is missing, for the ledger's `reason` column, so a skipped post can be
 * explained later, or `"none"` when the crossing is complete.
 *
 * Also imported by the social-post service, which is maintained outside this repository.
 */
export function missingBoundaryFigure(f: BoundaryFigures): string {
  if (!isCanonicalTxid(f.txid)) return "txid";
  if (!Number.isInteger(f.blockHeight) || f.blockHeight < 0) return "blockHeight";
  if (!Number.isFinite(f.timestamp) || f.timestamp <= 0) return "timestamp";
  if (f.pools.length === 0) return "pools";
  // A zero leg would name a pool that did not move. `Number.isFinite` because `NaN <= 0` and
  // `Infinity <= 0` are both false, so a bound check alone would let either through.
  if (f.pools.some((p) => !Number.isFinite(p.valueBalanceZat) || p.valueBalanceZat === 0)) {
    return "poolValueBalance";
  }
  if (boundaryDirection(f) === null) return "contradictoryPools";
  if (boundaryUsdValue(f) === null) return "priceUsd";
  if (boundaryAmountZat(f) <= 0) return "amountZat";
  return "none";
}

/**
 * How many confirmations a crossing waits before it is eligible, so the X poster never
 * announces a block that is later orphaned. Ten blocks is ~12.5 minutes at the 75-second
 * target. Lives in the domain (like `SWAP_SETTLE_SECONDS`) because the poster has no
 * database connection and imports nothing from `server/`.
 */
export const BOUNDARY_CONFIRMATIONS = 10;

import type { Transaction } from "./transaction";
import { POOL_BUNDLE, POOL_NAMES, poolBalances } from "./pool";

export type TxKind = "transparent" | "shielded" | "mixed" | "coinbase";

/**
 * What a transaction did to the shielded boundary, in the protocol's own verbs. These are
 * also the `/v1` wire values; {@link txDirectionLabel} is their uppercasing and nothing else,
 * so the page and the API use one vocabulary.
 *
 * `"shielded"` is not a crossing: value stayed inside the pools. It duplicates
 * `txKind(tx) === "shielded"` on purpose — the same fact on a second axis.
 *
 * `null` covers two situations, neither a gap: no pool is involved (transparent, coinbase),
 * or a mixed transaction whose pools disagree — a migration, where naming one direction would
 * mean apportioning value between pools.
 */
export type TxDirection = "shielding" | "unshielding" | "shielded" | null;

/**
 * Whether the transaction touches any shielded pool at all.
 *
 * The single place this question is answered; labelling a private transaction as public is
 * the worst error this site can make, so callers import this rather than reimplementing it.
 * It derives from `POOL_BUNDLE`, so adding a pool there is the only edit needed.
 */
export function hasShielded(tx: Transaction): boolean {
  return POOL_NAMES.some((pool) => POOL_BUNDLE[pool](tx) !== null);
}

/**
 * Net public flow across every shielded pool, in domain sign (positive = into the pools).
 *
 * Summing all pools keeps a migration meaningful: an Orchard→Ironwood move of 5 ZEC nets to
 * minus the fee, not −5 ZEC.
 *
 * Sprout is absent because `SproutBundle` carries a JoinSplit count and no value balance. Its
 * public values do exist on-chain (`vpub_old`/`vpub_new` per JoinSplit) but are not carried
 * on this type, so a null here is our gap, not encryption. Gate on {@link reportsValueBalance},
 * not {@link hasShielded}, or a Sprout-only transaction shows a fabricated net of 0.
 */
export function netShieldedZat(tx: Transaction): number {
  return poolBalances(tx).reduce((sum, b) => sum + b.zat, 0);
}

/**
 * Whether any pool on this transaction publishes a value balance, so a net figure is a real
 * measurement rather than an assumed zero.
 *
 * Separate from `hasShielded`: Sprout is shielded but publishes no per-bundle balance.
 */
export function reportsValueBalance(tx: Transaction): boolean {
  return poolBalances(tx).length > 0;
}

export function txKind(tx: Transaction): TxKind {
  if (tx.isCoinbase) return "coinbase";
  const hasT = tx.transparentInputs.length > 0 || tx.transparentOutputs.length > 0;
  if (hasT && hasShielded(tx)) return "mixed";
  return hasShielded(tx) ? "shielded" : "transparent";
}

/**
 * Which way a set of pool value balances crossed the boundary, from the signs alone.
 *
 * Plain signed zatoshi in RPC sign (positive = into the pool), so every caller shares one
 * rule. Zero balances are dropped first: a bundle that moved nothing took no direction.
 *
 * `null` both when the non-zero balances disagree and when there are none; a caller that must
 * tell the two apart checks the input itself, as `boundaryCrossing` does for Sprout.
 */
export function crossingFromBalances(balances: readonly number[]): "in" | "out" | null {
  const moved = balances.filter((v) => v !== 0);
  if (moved.length === 0) return null;
  if (moved.every((v) => v > 0)) return "in";
  if (moved.every((v) => v < 0)) return "out";
  return null;
}

/** Every pool balance a transaction publishes. Sprout is absent: it publishes none. */
function publishedBalances(tx: Transaction): number[] {
  return poolBalances(tx).map((b) => b.zat);
}

function shieldedCrossing(tx: Transaction): "in" | "out" | null {
  return crossingFromBalances(publishedBalances(tx));
}

/**
 * Which way value crossed the boundary.
 *
 * One-sided transparent activity settles it directly. With transparent on both sides, the
 * pools' own published balances decide: all gained is shielding, all lost is unshielding, and
 * disagreement is a migration with no single direction (null). A Sprout-only mixed
 * transaction publishes no balance and also yields null.
 */
export function txDirection(tx: Transaction): TxDirection {
  const kind = txKind(tx);
  if (kind === "shielded") return "shielded";
  if (kind !== "mixed") return null;
  if (tx.transparentInputs.length > 0 && tx.transparentOutputs.length === 0) return "shielding";
  if (tx.transparentOutputs.length > 0 && tx.transparentInputs.length === 0) return "unshielding";
  /*
   * Transparent on both sides. A transparent spend that shields part of its value usually pays
   * the remainder back to a transparent address, so the pools' published balances settle the
   * direction. That is a fact, unlike deciding which transparent output was payment and which
   * was change — an inference this code must never make.
   */
  const crossing = shieldedCrossing(tx);
  if (crossing === "in") return "shielding";
  if (crossing === "out") return "unshielding";
  return null;
}

/**
 * The boundary crossing a badge may draw, as opposed to the one a word may name.
 *
 * `txDirection` names the net crossing, which is right for a word. An arrow between chips
 * (`TRANSPARENT → ORCHARD SAPLING`) claims each named pool received, which is false when, say,
 * transparent and Sapling are spent into Orchard. So this keeps `txDirection`'s answer and
 * withdraws it when any pool contradicts it.
 *
 * Contradiction, not agreement, is the test because of Sprout: it publishes no per-bundle
 * balance, so it can never contradict anything, and a Sprout-only crossing stays drawable.
 *
 * Returns null for every non-mixed kind.
 */
export function boundaryCrossing(tx: Transaction): "in" | "out" | null {
  const direction = txDirection(tx);
  if (direction !== "shielding" && direction !== "unshielding") return null;
  const want = direction === "shielding" ? "in" : "out";
  // `crossingFromBalances` returns null both for "no balances" and "balances disagree".
  // Separate them: no balances (Sprout) cannot contradict and stays drawable; disagreement
  // must refuse.
  const moved = publishedBalances(tx).filter((v) => v !== 0);
  if (moved.length === 0) return want;
  return crossingFromBalances(moved) === want ? want : null;
}

/**
 * What this transaction did to the shielded boundary, or `null` when the question does not
 * apply (transparent, coinbase).
 *
 * Complements the pool badges: a badge says which pool, this says what the value did. Words,
 * not arrow notation, because shielding/unshielding are the protocol's own verbs.
 *
 * The switch is exhaustive over {@link TxDirection} rather than `.toUpperCase()`, so adding a
 * direction makes the compiler ask for its on-screen label.
 */
export function txDirectionLabel(tx: Transaction): string | null {
  switch (txDirection(tx)) {
    case "shielding":
      return "SHIELDING";
    case "unshielding":
      return "UNSHIELDING";
    case "shielded":
      return "SHIELDED";
    default:
      return null;
  }
}

/**
 * The always-present chip form: the same label, plus a word for the rows `txDirectionLabel`
 * leaves null. Used where a cell must never be blank (`KindPill` on /tx, /block, /mempool).
 *
 * Derived from `txDirectionLabel`, never a second switch, so the two cannot drift.
 */
export function txKindLabel(tx: Transaction): string {
  const kind = txKind(tx);
  if (kind === "coinbase") return "COINBASE";
  if (kind === "transparent") return "TRANSPARENT";
  // Both remaining kinds name themselves by what they did to the boundary. "MIXED" covers the
  // one case with no single answer: a transaction whose pools moved in opposite directions.
  return txDirectionLabel(tx) ?? "MIXED";
}

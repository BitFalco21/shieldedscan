import { txDirection, txKind } from "./classify";
import { poolBalances, txPools } from "./pool";
import type { PoolName } from "./pool";
import type { Transaction } from "./transaction";

/**
 * What the learning page (`/learn`) shows about one transaction a reader pasted: its shape in
 * the protocol's own words and its public facts, nothing more. The shape comes from the same
 * classifiers every other page uses (`txKind`, `txDirection`), so `/learn` and `/tx` agree.
 */
export type LearnShape =
  | "transparent"
  | "shielding"
  | "shielded"
  | "unshielding"
  | "coinbase"
  /** Value moved into one pool and out of another: there is no single direction to name. */
  | "mixed";

/**
 * Transparent entries carried per side. The counts and totals beside them cover every entry,
 * so a capped list never passes for a whole one. The cap only bites on exchange batches.
 */
export const LEARN_SIDE_CAP = 8;

export interface LearnEntry {
  readonly address: string;
  readonly valueZat: number;
}

/** One pool's own published balance, in RPC sign: positive means value went INTO the pool. */
export interface LearnPoolMove {
  readonly pool: PoolName;
  readonly valueBalanceZat: number;
}

export interface LearnTx {
  readonly txid: string;
  readonly shape: LearnShape;
  /** Null while the transaction is in the mempool, waiting for a block. */
  readonly blockHeight: number | null;
  readonly timestamp: number;
  readonly feeZat: number | null;
  readonly inputs: readonly LearnEntry[];
  readonly outputs: readonly LearnEntry[];
  readonly inputCount: number;
  readonly outputCount: number;
  readonly inputTotalZat: number;
  readonly outputTotalZat: number;
  /** Every shielded pool the transaction touched. */
  readonly pools: readonly PoolName[];
  /** Pools whose published balance moved. Sprout publishes none, so it never appears here. */
  readonly poolMoves: readonly LearnPoolMove[];
}

export function learnShape(tx: Transaction): LearnShape {
  const kind = txKind(tx);
  if (kind !== "mixed") return kind;
  const direction = txDirection(tx);
  return direction === "shielding" || direction === "unshielding" ? direction : "mixed";
}

const sum = (entries: readonly LearnEntry[]): number =>
  entries.reduce((total, e) => total + e.valueZat, 0);

export function learnTx(tx: Transaction): LearnTx {
  return {
    txid: tx.txid,
    shape: learnShape(tx),
    blockHeight: tx.blockHeight,
    timestamp: tx.timestamp,
    feeZat: tx.feeZat,
    inputs: tx.transparentInputs.slice(0, LEARN_SIDE_CAP),
    outputs: tx.transparentOutputs.slice(0, LEARN_SIDE_CAP),
    inputCount: tx.transparentInputs.length,
    outputCount: tx.transparentOutputs.length,
    inputTotalZat: sum(tx.transparentInputs),
    outputTotalZat: sum(tx.transparentOutputs),
    pools: txPools(tx),
    poolMoves: poolBalances(tx)
      .filter((b) => b.zat !== 0)
      .map((b) => ({ pool: b.pool, valueBalanceZat: b.zat })),
  };
}

/**
 * Value that entered shielded pools, from the pools' own published balances — or null when no
 * pool published a balance that rose (Sprout publishes none, and a fully shielded transfer
 * enters nothing). Never a difference of transparent totals: that would fold the fee in.
 */
export function learnIntoPoolsZat(tx: LearnTx): number | null {
  const into = tx.poolMoves.filter((m) => m.valueBalanceZat > 0);
  return into.length ? into.reduce((total, m) => total + m.valueBalanceZat, 0) : null;
}

/** Value that left shielded pools, as a positive amount, or null when none published one. */
export function learnOutOfPoolsZat(tx: LearnTx): number | null {
  const out = tx.poolMoves.filter((m) => m.valueBalanceZat < 0);
  return out.length ? out.reduce((total, m) => total - m.valueBalanceZat, 0) : null;
}

import type { Transaction } from "./transaction";
import { boundaryCrossing } from "./classify";
import type { PoolName } from "./pool";
import { poolMigration, txPools } from "./pool";

/**
 * One end of a value path.
 *
 * `"mined"` is not a pool: it names value that was issued rather than moved, the one source
 * with no origin to point at. It is distinct from `"coinbase"`, which names the transaction's
 * kind and is already shown in the TYPE column.
 */
export type FlowEnd = PoolName | "transparent" | "mined";

/**
 * What a type badge may name: one of the shielded pools a transaction touches, or the
 * non-pool answers — purely transparent, a coinbase, or `mined`, the issued value a
 * coinbase pays out.
 */
export type TxTypeName = FlowEnd | "coinbase";

/** Where a transaction's value came from and where it went, in the order it moved. */
export interface TxFlowPath {
  /** Ends value left, in `PoolName` order. */
  from: FlowEnd[];
  /** Ends value entered, in `PoolName` order. */
  to: FlowEnd[];
}

/**
 * The path the DIRECTION column draws, or `null` when the chain does not settle one.
 *
 * The complement of {@link txKindLabel}, which names what happened; this names where
 * (`SHIELDING` beside `TRANSPARENT → ORCHARD`).
 *
 * Every case is a published balance or a refusal. An arrow claims each named end moved that
 * way, which is stronger than the net crossing the word states, so the authorities are the
 * strict ones: {@link poolMigration} (exactly one pool gaining) and {@link boundaryCrossing}
 * (no pool contradicting the net direction). Anything they decline returns null; the column
 * then shows a flat chip list and `MIXED` in TYPE explains it. Never guess a direction.
 *
 * Equal ends are a real answer: value that stayed inside Ironwood reads `IRONWOOD → IRONWOOD`
 * and a transparent transfer `TRANSPARENT → TRANSPARENT`, so "nothing crossed" is stated
 * rather than inferred from a missing mark.
 */
export function txFlowPath(tx: Transaction): TxFlowPath | null {
  const pools = txPools(tx);

  /*
   * Coinbase first, unconditionally: a ZIP-213 coinbase paying into a pool would otherwise read
   * as shielding, when the value was issued on the shielded side rather than crossing into it.
   */
  if (tx.isCoinbase) {
    const to: FlowEnd[] = [
      ...(tx.transparentOutputs.length > 0 ? (["transparent"] as const) : []),
      ...pools,
    ];
    return to.length > 0 ? { from: ["mined"], to } : null;
  }

  const migration = poolMigration(tx);
  if (migration) return { from: migration.fromPools, to: [migration.toPool] };

  const crossing = boundaryCrossing(tx);
  if (crossing !== null && pools.length > 0) {
    return crossing === "in"
      ? { from: ["transparent"], to: pools }
      : { from: pools, to: ["transparent"] };
  }

  // No transparent side and exactly one pool: the value had nowhere else to go, so it moved
  // within that pool. This holds for Sprout too, although it publishes no balance to check.
  const isolated = tx.transparentInputs.length === 0 && tx.transparentOutputs.length === 0;
  if (isolated && pools.length === 1) {
    const pool = pools[0]!;
    return { from: [pool], to: [pool] };
  }

  if (pools.length === 0) return { from: ["transparent"], to: ["transparent"] };

  return null;
}

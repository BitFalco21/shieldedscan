import { addressDeltaZat } from "./address";
import { poolBalances, txPools, type PoolName } from "./pool";
import type { Transaction } from "./transaction";
import { txFlowPath } from "./tx-flow-path";

/**
 * Who a transaction was with, read from one transparent address: the other side of the
 * transaction, never a recipient.
 *
 * A transparent transaction spends inputs and creates outputs; it is not "A pays B". An output
 * may be the payment or the sender's own change, and the chain does not say which: telling them
 * apart is the heuristic chain analysis uses, which this explorer does not apply (see
 * `tx-action.ts`). So the other side is listed whole, in the transaction's own order, each entry
 * with its public amount, and a page names one only when it is the only one.
 *
 * Inputs on the address history are always resolved (the chain index stores every input's
 * address and value, and refuses a row it could not resolve), so an empty address means a script
 * that names none (OP_RETURN, multisig, a bare key), never an unknown.
 */

/** One entry on the other side. */
export type Counterparty =
  /** A transparent address, every input or output it holds on that side summed. */
  | { kind: "address"; address: string; zat: number }
  /** Scripts naming no address, summed; `count` of them. */
  | { kind: "nonStandard"; zat: number; count: number }
  /**
   * A shielded pool. `zat` is its published value balance, null for Sprout, which publishes none
   * (a gap in what we can show, not encryption). `settled` is false where the pools moved opposite
   * ways and no direction can be claimed (`txFlowPath` returns null): then there is no amount
   * either.
   */
  | { kind: "pool"; pool: PoolName; zat: number | null; settled: boolean }
  /** New coins: a coinbase's input side. */
  | { kind: "mined" };

/**
 * `from`: the address gained, so its other side is the inputs. `to`: it lost, so the other side is
 * the outputs. `both`: it netted to zero while others took part, so both sides are shown. `self`:
 * nobody else took part on the side that matters (a consolidation, a fee-only send to itself).
 */
export type CounterpartyDirection = "from" | "to" | "both" | "self";

export interface AddressCounterparties {
  direction: CounterpartyDirection;
  /** The other side as a page shows it: inputs for `from`, outputs for `to`, empty otherwise. */
  shown: Counterparty[];
  /** Every other input-side entry (pools first, then transparent entries in on-chain order). */
  inputs: Counterparty[];
  /** Every other output-side entry, ordered the same way. */
  outputs: Counterparty[];
}

/** Groups one transparent side by address in first-appearance order, without `self`. */
function transparentSide(
  entries: readonly { address: string; valueZat: number }[],
  self: string,
): Counterparty[] {
  const byAddress = new Map<string, number>();
  let nonStandard = 0;
  let nonStandardCount = 0;
  for (const e of entries) {
    if (e.address === self) continue;
    if (e.address === "") {
      nonStandard += e.valueZat;
      nonStandardCount++;
      continue;
    }
    byAddress.set(e.address, (byAddress.get(e.address) ?? 0) + e.valueZat);
  }
  const out: Counterparty[] = [...byAddress].map(([address, zat]) => ({
    kind: "address" as const,
    address,
    zat,
  }));
  if (nonStandardCount > 0)
    out.push({ kind: "nonStandard", zat: nonStandard, count: nonStandardCount });
  return out;
}

export function addressCounterparties(tx: Transaction, address: string): AddressCounterparties {
  const balances = new Map(poolBalances(tx).map((b) => [b.pool, b.zat]));
  const pool = (p: PoolName, settled: boolean): Counterparty => ({
    kind: "pool",
    pool: p,
    zat: settled && balances.has(p) ? Math.abs(balances.get(p)!) : null,
    settled,
  });
  const isPool = (end: string): end is PoolName => end !== "transparent" && end !== "mined";

  const path = txFlowPath(tx);
  let inputPools: Counterparty[];
  let outputPools: Counterparty[];
  if (path !== null) {
    inputPools = path.from.filter(isPool).map((p) => pool(p, true));
    outputPools = path.to.filter(isPool).map((p) => pool(p, true));
  } else {
    // Pools moved opposite ways: they are part of the other side, but in no direction.
    inputPools = [];
    outputPools = [];
  }
  const unsettled = path === null ? txPools(tx).map((p) => pool(p, false)) : [];

  const inputs: Counterparty[] = tx.isCoinbase
    ? [{ kind: "mined" }]
    : [...inputPools, ...transparentSide(tx.transparentInputs, address)];
  const outputs: Counterparty[] = [
    ...outputPools,
    ...transparentSide(tx.transparentOutputs, address),
  ];

  const delta = addressDeltaZat(tx, address);
  if (delta > 0) {
    const shown = [...unsettled, ...inputs];
    return { direction: shown.length > 0 ? "from" : "self", shown, inputs, outputs };
  }
  if (delta < 0) {
    const shown = [...unsettled, ...outputs];
    return { direction: shown.length > 0 ? "to" : "self", shown, inputs, outputs };
  }
  const anyone = inputs.length + outputs.length + unsettled.length > 0;
  return {
    direction: anyone ? "both" : "self",
    shown: [],
    inputs: [...unsettled, ...inputs],
    outputs,
  };
}

/**
 * The words for a side with more than one entry, naming nobody: the pools by name (a pool is not
 * a person), then a count of everything else ("ironwood + 1 output", "4 inputs"). A page shows
 * this instead of one address, so no output is singled out as the payment.
 */
export function counterpartySummary(
  parties: readonly Counterparty[],
  noun: "input" | "output",
): string {
  const pools = parties.flatMap((p) => (p.kind === "pool" ? [p.pool] : []));
  const rest = parties.reduce(
    (n, p) => n + (p.kind === "pool" ? 0 : p.kind === "nonStandard" ? p.count : 1),
    0,
  );
  const counted = rest === 0 ? [] : [`${rest} ${noun}${rest === 1 ? "" : "s"}`];
  return [...pools, ...counted].join(" + ");
}

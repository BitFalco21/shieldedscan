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

/** Why a pool the transaction touched is put on neither side. */
export type UndirectedReason =
  /** Its published balance points one way and another pool's the other (`txFlowPath` refuses). */
  | "opposite"
  /** Sprout publishes no balance, so which way its value went is not on chain. */
  | "unpublished";

/** One entry on the other side. */
export type OtherParty =
  /** A transparent address, every input or output it holds on that side summed. */
  | { kind: "address"; address: string; zat: number }
  /** Scripts naming no address, summed; `count` of them. */
  | { kind: "nonStandard"; zat: number; count: number }
  /**
   * A shielded pool. `zat` is its published value balance (absolute), null where none is
   * published (Sprout) or none can be claimed. `undirected` is set only on the pools listed apart,
   * on neither side.
   */
  | { kind: "pool"; pool: PoolName; zat: number | null; undirected?: UndirectedReason }
  /** New coins: a coinbase's input side. */
  | { kind: "mined" };

/**
 * `from`: the address gained, so its other side is the inputs. `to`: it lost, so the other side is
 * the outputs. `both`: it netted to zero while others took part, so both sides are shown. `self`:
 * nobody else took part (a consolidation, a fee-only send to itself). The direction rests on this
 * address's transparent arithmetic alone, the one thing here that is a fact.
 */
export type CounterpartyDirection = "from" | "to" | "both" | "self";

export interface AddressCounterparties {
  direction: CounterpartyDirection;
  /** The other side as a page shows it: inputs for `from`, outputs for `to`, empty otherwise. */
  shown: OtherParty[];
  /** Every other input-side entry (pools first, then transparent entries in on-chain order). */
  inputs: OtherParty[];
  /** Every other output-side entry, ordered the same way. */
  outputs: OtherParty[];
  /** Pools touched in no statable direction: listed apart, never under a side. */
  undirected: OtherParty[];
}

/** Groups one transparent side by address in first-appearance order, without `self`. */
function transparentSide(
  entries: readonly { address: string; valueZat: number }[],
  self: string,
): OtherParty[] {
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
  const out: OtherParty[] = [...byAddress].map(([address, zat]) => ({
    kind: "address" as const,
    address,
    zat,
  }));
  if (nonStandardCount > 0) {
    out.push({ kind: "nonStandard", zat: nonStandard, count: nonStandardCount });
  }
  return out;
}

export function addressCounterparties(tx: Transaction, address: string): AddressCounterparties {
  const balances = new Map(poolBalances(tx).map((b) => [b.pool, b.zat]));
  const isPool = (end: string): end is PoolName => end !== "transparent" && end !== "mined";
  // A pool whose published balance is exactly zero moved nothing across: it is no counterparty.
  const directed = (ends: readonly string[]): OtherParty[] =>
    ends
      .filter(isPool)
      .filter((p) => balances.get(p) !== 0)
      .map((p) => {
        const zat = balances.get(p);
        return { kind: "pool" as const, pool: p, zat: zat === undefined ? null : Math.abs(zat) };
      });

  const path = txFlowPath(tx);
  const undirected: OtherParty[] =
    path === null
      ? txPools(tx).map((p) => ({
          kind: "pool" as const,
          pool: p,
          zat: null,
          undirected: p === "sprout" ? ("unpublished" as const) : ("opposite" as const),
        }))
      : [];

  const inputs: OtherParty[] = tx.isCoinbase
    ? [{ kind: "mined" }]
    : [...(path ? directed(path.from) : []), ...transparentSide(tx.transparentInputs, address)];
  const outputs: OtherParty[] = [
    ...(path ? directed(path.to) : []),
    ...transparentSide(tx.transparentOutputs, address),
  ];

  const delta = addressDeltaZat(tx, address);
  const shown = delta > 0 ? inputs : delta < 0 ? outputs : [];
  const anyone = shown.length + undirected.length > 0;
  if (delta !== 0) {
    return {
      direction: anyone ? (delta > 0 ? "from" : "to") : "self",
      shown,
      inputs,
      outputs,
      undirected,
    };
  }
  const both = inputs.length + outputs.length + undirected.length > 0;
  return { direction: both ? "both" : "self", shown: [], inputs, outputs, undirected };
}

/**
 * The words for a side with more than one entry, naming nobody: the pools by name (a pool is not
 * a person), then a count of everything else ("ironwood + 1 output", "4 inputs"). A page shows
 * this instead of one address, so no output is singled out as the payment.
 */
export function counterpartySummary(
  parties: readonly OtherParty[],
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

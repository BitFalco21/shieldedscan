/**
 * ZEC moving into and out of the exchanges' labelled addresses, one transaction at a time.
 *
 * A transaction's flow for an exchange is what it paid that exchange's addresses minus what it
 * spent from them, so change returned to the exchange cancels out, and a move between one
 * exchange's own wallets nets to the fee alone. Where the exchange is the only party on its own
 * side, the other side's amounts are exact and the flow is split by them; with parties on both
 * sides it is `mixed`, never apportioned, because which input paid which output is not on the chain.
 */

import { ADDRESS_LABELS } from "./address-label";
import { EXCHANGES, LABEL_EXCHANGE, type ExchangeId } from "./exchange-reserves";

/** What sits on the other side of an exchange's flow. */
export type FlowKind =
  | "transparent"
  | "shielded"
  | "mined"
  | "exchange"
  | "bridge"
  | "other-labelled"
  /** The transaction fee, on an outflow the exchange alone paid. */
  | "fee"
  /** Several kinds on both sides: which input paid which output is not on the chain. */
  | "mixed";

/**
 * Every label name that is not an exchange's, decided as a bridge or as another labelled party.
 * A test holds this against `LABEL_EXCHANGE`, so a new label is never grouped without a decision.
 */
export const OTHER_LABELS: ReadonlySet<string> = new Set([
  "Grayscale Zcash Trust",
  "ZIP-271 Disbursement Multisig",
  "BitGet Exploit Sept 2026",
  "DPRK attackers",
]);

/** Labels that are bridges: their value is a crossing to or from another chain. */
export const BRIDGE_LABELS: ReadonlySet<string> = new Set([
  "NEAR Intents Bridge Hot Wallet",
  "Hyperunit Hot Wallet",
  "Hyperunit Deposit",
]);

export type LabelGroup =
  { kind: "exchange"; exchange: ExchangeId } | { kind: "bridge" } | { kind: "other" };

/**
 * The version of the classification below. Stored flows were made by one version, and a build with
 * another reclassifies them all before answering, so this changes with ANY change to how a
 * transaction's flows come out; a test pins the outputs to it.
 */
export const LABEL_FLOW_CLASSIFIER = "1";

/** A group as stored beside each address: its exchange id, `bridge` or `other`. */
export function labelGroupKey(group: LabelGroup | null): string {
  if (group === null) return "other";
  return group.kind === "exchange" ? group.exchange : group.kind;
}

/** The group a labelled address belongs to, or null for an address with no label. */
export function labelGroupOf(address: string): LabelGroup | null {
  const label = ADDRESS_LABELS[address];
  if (label === undefined) return null;
  const mapped = LABEL_EXCHANGE[label.name];
  // A theft-flagged address counts under no exchange, whatever its name (as in the reserves).
  if (label.flag === undefined && typeof mapped === "string") {
    return { kind: "exchange", exchange: mapped };
  }
  return BRIDGE_LABELS.has(label.name) ? { kind: "bridge" } : { kind: "other" };
}

/** One stored transaction: the gain or loss of each labelled address in it, and its other side. */
export interface LabelFlowTx {
  txid: string;
  height: number;
  timestamp: number;
  isCoinbase: boolean;
  /** Value the shielded pools gave to the transparent side, and took from it. */
  poolsGaveZat: number;
  poolsTookZat: number;
  /** Transparent value on inputs and outputs that name no labelled address. */
  unlabelledInZat: number;
  unlabelledOutZat: number;
  deltas: ReadonlyArray<{ address: string; deltaZat: number }>;
}

export interface FlowPart {
  kind: FlowKind;
  /** The other exchange, on an `exchange` part. */
  exchange?: ExchangeId;
  zat: number;
}

export interface ExchangeFlow {
  txid: string;
  height: number;
  timestamp: number;
  exchange: ExchangeId;
  direction: "in" | "out";
  /** Always positive: the value that arrived or left. The parts add up to it. */
  zat: number;
  /**
   * Where it came from or went. Exact when the exchange is the only party on its own side of the
   * transaction; one `mixed` part when parties on both sides make the split unknowable.
   */
  parts: FlowPart[];
}

/** Each group's net in `tx`. Bridges and other labels net as one group each. */
function groupNets(tx: LabelFlowTx, groupOf: (address: string) => LabelGroup | null) {
  const exchanges = new Map<ExchangeId, number>();
  let bridge = 0;
  let other = 0;
  for (const d of tx.deltas) {
    // A stored address this build has no label for was labelled by another build: it is still
    // a labelled party, never value dropped from the transaction.
    const g = groupOf(d.address) ?? { kind: "other" };
    if (g.kind === "exchange") {
      exchanges.set(g.exchange, (exchanges.get(g.exchange) ?? 0) + d.deltaZat);
    } else if (g.kind === "bridge") bridge += d.deltaZat;
    else other += d.deltaZat;
  }
  return { exchanges, bridge, other };
}

/**
 * The parties giving value (`sign` −1) or taking it (+1) in `tx`, other than `self`, with their
 * amounts. An entity counts by the sign of its net, never by being present.
 */
function parties(
  tx: LabelFlowTx,
  nets: ReturnType<typeof groupNets>,
  self: ExchangeId,
  sign: 1 | -1,
): FlowPart[] {
  const out: FlowPart[] = [];
  const unlabelled = sign > 0 ? tx.unlabelledOutZat : tx.unlabelledInZat;
  if (unlabelled > 0) out.push({ kind: "transparent", zat: unlabelled });
  const pools = sign > 0 ? tx.poolsTookZat : tx.poolsGaveZat;
  if (pools > 0) out.push({ kind: "shielded", zat: pools });
  for (const [exchange, net] of nets.exchanges) {
    if (exchange !== self && Math.sign(net) === sign) {
      out.push({ kind: "exchange", exchange, zat: Math.abs(net) });
    }
  }
  if (Math.sign(nets.bridge) === sign) out.push({ kind: "bridge", zat: Math.abs(nets.bridge) });
  if (Math.sign(nets.other) === sign)
    out.push({ kind: "other-labelled", zat: Math.abs(nets.other) });
  return out;
}

/**
 * The exchange flows in one transaction: one per exchange whose addresses gained or lost in it.
 * An outflow nobody but the exchange took (its own wallets paying each other, leaving only the
 * fee) is `internal` and returned apart, never as a flow.
 */
export function exchangeFlowsOf(
  tx: LabelFlowTx,
  groupOf: (address: string) => LabelGroup | null = labelGroupOf,
): { flows: ExchangeFlow[]; internal: Array<{ exchange: ExchangeId; feeZat: number }> } {
  const nets = groupNets(tx, groupOf);
  const flows: ExchangeFlow[] = [];
  const internal: Array<{ exchange: ExchangeId; feeZat: number }> = [];
  for (const exchange of EXCHANGES) {
    const net = nets.exchanges.get(exchange);
    if (net === undefined || net === 0) continue;
    const inbound = net > 0;
    const zat = Math.abs(net);
    // The other side of this exchange's flow, and the rest of its own side.
    const other = parties(tx, nets, exchange, inbound ? -1 : 1);
    const ownSide = parties(tx, nets, exchange, inbound ? 1 : -1);
    if (inbound && tx.isCoinbase) other.push({ kind: "mined", zat: Math.max(0, zat - sum(other)) });
    if (other.length === 0) {
      if (!inbound) internal.push({ exchange, feeZat: zat });
      continue;
    }
    let parts: FlowPart[];
    if (ownSide.length === 0) {
      // This exchange alone on its side: every amount opposite is exact. The difference from the
      // net is the fee: paid out of an outflow (its own part), paid by the senders of an inflow
      // (taken from the largest part).
      parts = other.map((p) => ({ ...p }));
      const gap = zat - sum(parts);
      if (gap > 0) parts.push({ kind: "fee", zat: gap });
      else if (gap < 0) parts = withoutFee(parts, -gap);
    } else if (other.length === 1) {
      // Others on its side too, but one party opposite: all of the net came from or went to it.
      parts = [{ ...other[0]!, zat }];
    } else {
      parts = [{ kind: "mixed", zat }];
    }
    flows.push({
      txid: tx.txid,
      height: tx.height,
      timestamp: tx.timestamp,
      exchange,
      direction: inbound ? "in" : "out",
      zat,
      parts,
    });
  }
  return { flows, internal };
}

const sum = (parts: readonly FlowPart[]) => parts.reduce((s, p) => s + p.zat, 0);

/** The parts less a fee the senders paid, taken from the largest first; none left negative. */
function withoutFee(parts: FlowPart[], fee: number): FlowPart[] {
  let left = fee;
  for (const p of [...parts].sort((a, b) => b.zat - a.zat)) {
    const take = Math.min(p.zat, left);
    p.zat -= take;
    left -= take;
    if (left === 0) break;
  }
  return parts.filter((p) => p.zat > 0);
}

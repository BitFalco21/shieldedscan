import { isOneOf } from "./closed-set";
import { classifyZcashAddress, type ZcashAddressKind } from "./address";
import type { CrossChainProtocol, CrossChainTransfer } from "./crosschain";
import type { PoolName } from "./pool";
import { POOL_NAMES, poolBalances, txPools, VALUE_POOL_NAMES } from "./pool";
import type { PulseBlockPools } from "./pulse-wire";
import { ZATS_PER_ZEC, type Transaction } from "./transaction";
import { txFlowPath } from "./tx-flow-path";
import { publicValueZat } from "./value";

export * from "./pulse-wire";

/**
 * The movement model behind `/pulse`: one event per thing that happened, with the amounts the
 * chain published and a refusal wherever it published none.
 *
 * This module adds amounts to directions it does not decide. Every direction comes from
 * {@link txFlowPath}, which is built on `poolMigration` and `boundaryCrossing` and returns null
 * wherever the published balances do not settle one. Do not re-derive a direction here.
 */

/** One end of a movement. `mined` is issuance, which has no origin to point at. */
export type PulseNode = PoolName | "transparent" | "lockbox" | "mined" | `chain:${string}`;

/**
 * A movement's end, including the boundary hub.
 *
 * The hub is not a place value sits: it is where a movement is drawn when the chain does not
 * settle where it went. Nothing accumulates there.
 */
export type PulseEnd = PulseNode | "hub";

/**
 * One drawn segment of a movement.
 *
 * What `amountZat` means depends on the event's shape. On a `path` or `ledger` event it is a
 * magnitude and `from`/`to` carry the direction. On a `hub` event `from` is always `"hub"`, so
 * the sign is the whole of the direction: positive means value entered that node, as with
 * `valueBalanceZat`. On a `veil` event it is always null.
 *
 * `null` is never zero: the amount is either encrypted by design (`veil`) or not carried in this
 * view (a Sprout leg whose net was not supplied). The shape tells a renderer which.
 */
export interface PulseLeg {
  from: PulseEnd;
  to: PulseEnd;
  amountZat: number | null;
}

/**
 * How a movement is drawn, and therefore what it claims.
 *
 * - `path` — the chain settled where the value went; the legs are directed and sized.
 * - `veil` — value that stayed inside one pool. How much moved is encrypted on-chain, so the
 *   amount is null and redaction bars are correct here and only here.
 * - `hub` — the chain did not settle a direction. Signed legs, no pairing between them.
 * - `ledger` — value that moved inside the transparent box, which crosses nothing.
 *
 * The type is derived from the array because the wire guard checks it at runtime: a shape
 * added only to a hand-typed union would compile and then be silently dropped by the client
 * parser's `.filter(isPulseEvent)`.
 */
export const PULSE_SHAPES = ["path", "veil", "hub", "ledger"] as const;

export type PulseShape = (typeof PULSE_SHAPES)[number];

/** What produced a movement. Derived from the array for the reason {@link PULSE_SHAPES} is. */
export const PULSE_EVENT_KINDS = ["tx", "coinbase", "swap", "lockbox"] as const;

export type PulseEventKind = (typeof PULSE_EVENT_KINDS)[number];

export interface PulseEvent {
  id: string;
  kind: PulseEventKind;
  shape: PulseShape;
  /** Unix seconds. A confirmed movement takes its block's header time; a swap, venue time. */
  at: number;
  /** Null for a movement no Zcash block has recorded yet — a mempool tx or an unpaired swap. */
  height: number | null;
  /** Null with `height`. Carried so a reorg can discard exactly the rows it invalidated. */
  blockHash: string | null;
  /**
   * The segments to draw, in the order value moved.
   *
   * They are not guaranteed to join up. A crossing folded into its Zcash-leg transaction
   * contributes `chain:X → hub` or `hub → chain:X` beside the transaction's own legs; neither
   * source settles what happened between them, so a renderer must not draw a continuous line.
   */
  legs: PulseLeg[];
  /**
   * The block subsidy a coinbase issued: its outputs less the fee total it collected. Null on
   * every other kind, and on a coinbase whose block fee total was not derivable (flagged by
   * {@link PulseEvent.subsidyIncludesFees}). Never a hard-coded split.
   */
  subsidyZat: number | null;
  /**
   * Coinbase only: the block's fee total was not derivable, so the leg amounts carry the
   * subsidy AND the fees together and the two cannot be separated.
   */
  subsidyIncludesFees?: true;
  /**
   * The fee the transaction paid, in zatoshi. Null when it could not be derived, and on a
   * coinbase, which pays none. Always emitted by this module: an absent key and an explicit
   * null behave differently under a spread.
   */
  feeZat?: number | null;
  /** The swap venue, on a swap event or a transaction one has been folded into. */
  venue?: CrossChainProtocol;
  /** The Zcash-leg txid a swap names, which is the only thing pairing may key on. */
  zcashTxid?: string | null;
  /**
   * The counterpart chain's ticker, on a swap. Uppercased, matching its `chain:` node. Carried
   * so a title derives from the event alone; after pairing, the chain leg is one of several.
   */
  counterpartChain?: string;
  /**
   * The counterpart asset as the venue published it, on a swap. Kept verbatim, including NEAR
   * Intents' `"<CHAIN> asset"` placeholder; `assetTickerIsKnown` tells the two apart.
   */
  counterpartAsset?: string;
  /**
   * The counterpart is a wrapped claim rather than the asset itself (Maya's `ZEC/ZEC`). Still a
   * crossing, so it is labelled rather than dropped.
   */
  counterpartIsSynthetic?: boolean;
  /** Present only while the movement is unconfirmed. Absent means confirmed, never `false`. */
  pending?: true;
}

const CHAIN_PREFIX = "chain:";

/** The node a chain ticker names. Uppercased, so one chain is one node across a frame. */
export function pulseChainNode(ticker: string): PulseNode {
  return `${CHAIN_PREFIX}${ticker.trim().toUpperCase()}`;
}

/** The ticker inside a chain node, or null when the node is not one. */
export function pulseChainTicker(node: PulseEnd): string | null {
  return node.startsWith(CHAIN_PREFIX) ? node.slice(CHAIN_PREFIX.length) : null;
}

const sum = (values: readonly { valueZat: number }[]): number =>
  values.reduce((total, v) => total + v.valueZat, 0);

/**
 * A pool's own published net for this transaction, in domain sign (positive = entering), or
 * null when this view does not carry one.
 *
 * Sprout publishes no per-bundle balance; its public values are `vpub_old`/`vpub_new` per
 * JoinSplit, stored in RPC sign. The caller negates once at the store boundary and passes the
 * net in already in domain sign.
 */
function poolNetZat(tx: Transaction, pool: PoolName, sproutNetZat: number | null): number | null {
  // Sprout publishes no per-bundle balance; the store derives its net from the JoinSplits.
  if (pool === "sprout") return sproutNetZat;
  return poolBalances(tx).find((b) => b.pool === pool)?.zat ?? null;
}

const magnitude = (zat: number | null): number | null => (zat === null ? null : Math.abs(zat));

/**
 * True when a movement's end is one of the shielded pools. Exported so the page's sentences
 * share one definition of "which ends are pools" and a new pool cannot be missed in one place.
 */
export const isPulsePool = (end: PulseEnd): end is PoolName => isOneOf(POOL_NAMES, end);

const isPool = isPulsePool;

/**
 * Everything a coinbase issued: its public payouts plus what it put into a pool, or null when a
 * pool it touched published no net for this view. Reading that null as zero would understate
 * issuance. (Only Sprout can be null and ZIP 213 postdates it, but the term is not assumed away.)
 */
function coinbaseIssuedZat(tx: Transaction, sproutNetZat: number | null): number | null {
  let issued = sum(tx.transparentOutputs);
  for (const pool of txPools(tx)) {
    const net = poolNetZat(tx, pool, sproutNetZat);
    if (net === null) return null;
    issued += Math.max(0, net);
  }
  return issued;
}

/**
 * How a path is drawn. When both ends are the same single node the value stayed where it was:
 * encrypted inside a pool, public inside the transparent box. Decided once and passed to
 * {@link pathLegs} so shape and amount come from the same reading.
 */
function pathShape(path: { from: PulseNode[]; to: PulseNode[] }): PulseShape {
  if (path.from.length === 1 && path.to.length === 1 && path.from[0] === path.to[0]) {
    return path.from[0] === "transparent" ? "ledger" : "veil";
  }
  return "path";
}

/**
 * Legs for a transaction whose direction the chain settled.
 *
 * Each leg is sized on the pool that published a balance for it: the pool end of a crossing,
 * and the source end of a migration. Sizing a migration on its destination would split one
 * figure across several legs, which `poolMigration` refuses to do.
 *
 * One side of every such path is a single end shared by all legs; the other fans out from it.
 */
function pathLegs(
  tx: Transaction,
  path: { from: PulseNode[]; to: PulseNode[] },
  shape: PulseShape,
  sproutNetZat: number | null,
): PulseLeg[] {
  const poolAmount = (end: PulseNode): number | null =>
    isPool(end) ? magnitude(poolNetZat(tx, end, sproutNetZat)) : null;

  if (path.from.length === 1 && path.from[0] === "mined") {
    return path.to.map((end) => ({
      from: "mined" as const,
      to: end,
      // What the coinbase issued into each place. Neither is the subsidy, which the event carries.
      amountZat: end === "transparent" ? sum(tx.transparentOutputs) : poolAmount(end),
    }));
  }

  // The value stayed where it was. A pool's balance here is roughly minus the fee, so using it
  // would claim the fee is what moved; the amount is null instead.
  if (shape === "veil" || shape === "ledger") {
    const end = path.from[0]!;
    return [{ from: end, to: end, amountZat: shape === "ledger" ? publicValueZat(tx) : null }];
  }

  const fromFans = path.from.length >= path.to.length;
  const fanned = fromFans ? path.from : path.to;
  return fanned.map((end) => {
    const from = fromFans ? end : path.from[0]!;
    const to = fromFans ? path.to[0]! : end;
    // The source pool when there is one, otherwise the destination (a crossing's only published
    // figure). Not a `??` chain: a null source amount must not fall through to another pool's.
    const poolEnd = isPool(from) ? from : isPool(to) ? to : null;
    return {
      from,
      to,
      amountZat:
        poolEnd === null ? publicValueZat(tx) : magnitude(poolNetZat(tx, poolEnd, sproutNetZat)),
    };
  });
}

/**
 * Legs for a transaction the chain did not settle a direction for. Each leg attaches one node
 * to the hub with its own signed net; nothing pairs them, since pairing would apportion value.
 */
function hubLegs(tx: Transaction, sproutNetZat: number | null): PulseLeg[] {
  const legs: PulseLeg[] = [];

  if (tx.transparentInputs.length > 0 || tx.transparentOutputs.length > 0) {
    // Outputs less inputs; never a guess about which output was payment and which was change.
    const net = sum(tx.transparentOutputs) - sum(tx.transparentInputs);
    if (net !== 0) legs.push({ from: "hub", to: "transparent", amountZat: net });
  }

  for (const pool of txPools(tx)) {
    const net = poolNetZat(tx, pool, sproutNetZat);
    if (net === 0) continue;
    legs.push({ from: "hub", to: pool, amountZat: net });
  }

  return legs;
}

/** The subsidy a coinbase issued, or null when what it issued could not be totalled. */
function subsidyZat(
  tx: Transaction,
  sproutNetZat: number | null,
  blockFeeZat: number,
): number | null {
  const issued = coinbaseIssuedZat(tx, sproutNetZat);
  return issued === null ? null : issued - blockFeeZat;
}

/**
 * The movement one transaction drew.
 *
 * `sproutNetZat` is already in domain sign (positive = value entered Sprout); the index stores
 * `tx.sprout_vpub_net_zat` in RPC sign and the store negates it once. Null means the view did
 * not carry it, which renders as a dashed floor-sized leg, never a redaction bar.
 *
 * `blockFeeZat` is the containing block's fee total, needed only for a coinbase, whose subsidy
 * is its outputs less the fees it collected.
 */
export function pulseEventForTx(
  tx: Transaction,
  sproutNetZat: number | null,
  blockFeeZat?: number | null,
): PulseEvent {
  const path = txFlowPath(tx);
  const shape: PulseShape = path === null ? "hub" : pathShape(path);
  const legs = (path === null ? hubLegs(tx, sproutNetZat) : pathLegs(tx, path, shape, sproutNetZat))
    // A pool present with a zero balance moved nothing and is not part of this movement
    // (`txFlowPath` names pools that are present). A null amount is not a zero and stays.
    .filter((leg) => leg.amountZat !== 0);

  const feeUnknown = blockFeeZat === null || blockFeeZat === undefined;
  return {
    id: tx.txid,
    kind: tx.isCoinbase ? "coinbase" : "tx",
    shape,
    at: tx.timestamp,
    height: tx.blockHeight,
    blockHash: tx.blockHash,
    legs,
    subsidyZat: tx.isCoinbase && !feeUnknown ? subsidyZat(tx, sproutNetZat, blockFeeZat) : null,
    ...(tx.isCoinbase && feeUnknown ? { subsidyIncludesFees: true as const } : {}),
    feeZat: tx.feeZat,
    ...(tx.blockHeight === null ? { pending: true as const } : {}),
  };
}

/**
 * Which end of the Zcash side a crossing attaches to, from the address family alone. Only a
 * transparent delivery demonstrably landed in the transparent box; a shielded or unpublished
 * address attaches to the hub.
 *
 * Shared by per-transfer pulses and per-ribbon aggregates so the two cannot disagree.
 */
export function pulseZcashEnd(addressKind: ZcashAddressKind | null): PulseEnd {
  return addressKind === "transparent" ? "transparent" : "hub";
}

/**
 * The movement one cross-chain crossing drew, or null when there is none to draw.
 *
 * Completed crossings only: a `pending` one has not happened and a `refunded` one was undone.
 * The Zcash end comes from {@link pulseZcashEnd}.
 */
export function pulseEventForTransfer(t: CrossChainTransfer): PulseEvent | null {
  if (t.status !== "completed") return null;

  const chain = pulseChainNode(t.counterpartChain);
  const zcashEnd = pulseZcashEnd(classifyZcashAddress(t.zcashAddress));
  const leg: PulseLeg =
    t.direction === "in"
      ? { from: chain, to: zcashEnd, amountZat: t.zecAmountZat }
      : { from: zcashEnd, to: chain, amountZat: t.zecAmountZat };

  return {
    id: `swap:${t.id}`,
    kind: "swap",
    shape: "path",
    // Venue time: until a Zcash leg is paired, no block has recorded this crossing.
    at: t.timestamp,
    height: null,
    blockHash: null,
    legs: [leg],
    subsidyZat: null,
    feeZat: null,
    venue: t.protocol,
    zcashTxid: t.zcashTxid,
    counterpartChain: pulseChainTicker(chain) ?? t.counterpartChain,
    counterpartAsset: t.counterpartAsset,
    counterpartIsSynthetic: t.counterpartIsSynthetic,
  };
}

/**
 * The lockbox movement between two blocks, or null when there is none to state.
 *
 * The NU6 deferred subsidy accrues per block and no transaction spends into it, so it is
 * measured as the difference between two closes. Every guard below rejects a difference that
 * might not be one block's accrual. Never returns a zero movement.
 */
export function lockboxLegForBlocks(
  prev: PulseBlockPools | null,
  cur: PulseBlockPools,
): PulseEvent | null {
  if (prev === null) return null;
  // Otherwise the delta could span a gap or a reorged sibling.
  if (cur.prevHash !== prev.hash) return null;

  const before = prev.pools.lockbox;
  const after = cur.pools.lockbox;
  if (before === null || after === null) return null;

  const delta = after - before;
  if (delta <= 0) return null;

  return {
    id: `lockbox:${cur.hash}`,
    kind: "lockbox",
    shape: "path",
    at: cur.timestamp,
    height: cur.height,
    blockHash: cur.hash,
    legs: [{ from: "mined", to: "lockbox", amountZat: delta }],
    subsidyZat: null,
    feeZat: null,
  };
}

/**
 * What the chain issued between two block rows, in zatoshi, or null when it cannot be said.
 *
 * The six value pools partition every ZEC in existence, so movements between them cancel and
 * what survives is issuance. Coinbase outputs would overstate it by the collected fees.
 *
 * All or nothing: any null close refuses the answer. A negative difference also returns null,
 * since issuance cannot be negative (a reorged sibling or rows out of order). Zero is returned.
 *
 * Unlike {@link lockboxLegForBlocks} this does not check that the rows chain: it is meant for
 * window endpoints thousands of blocks apart. A gap in the index therefore reads as issuance.
 */
export function issuanceZatBetween(
  prev: PulseBlockPools | null,
  cur: PulseBlockPools,
): number | null {
  if (prev === null) return null;
  let issued = 0;
  for (const pool of VALUE_POOL_NAMES) {
    const before = prev.pools[pool];
    const after = cur.pools[pool];
    if (before === null || after === null) return null;
    issued += after - before;
  }
  return issued < 0 ? null : issued;
}

/**
 * Folds each swap into its Zcash-leg transaction, so one movement draws as one pulse.
 *
 * Keyed on `zcashTxid` alone; matching on amount or time could pair unrelated movements. A swap
 * whose transaction is not in this frame stays its own event. Input order is preserved.
 */
export function pairSwapsWithTxs(events: PulseEvent[]): PulseEvent[] {
  const byTxid = new Map<string, PulseEvent>();
  for (const event of events) {
    if (event.kind === "tx" || event.kind === "coinbase") byTxid.set(event.id, event);
  }

  const merged = new Map<string, PulseEvent>();
  const paired = new Set<PulseEvent>();

  for (const event of events) {
    if (event.kind !== "swap" || !event.zcashTxid) continue;
    const target = merged.get(event.zcashTxid) ?? byTxid.get(event.zcashTxid);
    if (target === undefined) continue;

    const chainLeg = event.legs[0];
    if (chainLeg === undefined) continue;
    // Read the direction off the leg the swap already built rather than re-deriving it.
    const inbound = pulseChainTicker(chainLeg.from) !== null;

    merged.set(event.zcashTxid, {
      ...target,
      legs: inbound ? [chainLeg, ...target.legs] : [...target.legs, chainLeg],
      venue: event.venue,
      zcashTxid: event.zcashTxid,
      counterpartChain: event.counterpartChain,
      counterpartAsset: event.counterpartAsset,
      counterpartIsSynthetic: event.counterpartIsSynthetic,
    });
    paired.add(event);
  }

  return events.filter((event) => !paired.has(event)).map((event) => merged.get(event.id) ?? event);
}

/** The amount at which a pulse reaches its full size: 1,000 ZEC. Stated as the pulse ruler. */
export const PULSE_FULL_SIZE_ZAT = 1_000 * ZATS_PER_ZEC;

/**
 * How large a pulse carrying this amount is drawn, in pixels.
 *
 * The distance up the size range scales with the square root of the amount, since an eye reads
 * a disc's area. A null amount takes the floor rather than vanishing: an unknown amount is not
 * nothing. Sized on the magnitude, because a hub leg's sign is a direction.
 */
export function pulseRadius(amountZat: number | null, floor = 6, max = 16): number {
  if (amountZat === null || !Number.isFinite(amountZat)) return floor;
  const size = Math.abs(amountZat);
  if (size <= 0) return floor;
  return floor + (max - floor) * Math.min(1, Math.sqrt(size / PULSE_FULL_SIZE_ZAT));
}

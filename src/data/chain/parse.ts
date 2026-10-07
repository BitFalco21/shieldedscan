import type {
  Block,
  BlockMiner,
  IronwoodBundle,
  OrchardBundle,
  SaplingBundle,
  SproutBundle,
  Transaction,
  TransparentOutput,
  TxDirection,
  TxKind,
  TxKindFilter,
} from "@/domain";
import { blockComposition, blockMiner, matchesTxKindFilter, txDirection, txKind } from "@/domain";
import type { PoolId, RpcBlock, RpcTransaction, RpcValuePool } from "./rpc-types";
import { decodeCoinbaseTag } from "./coinbase-tag";

/**
 * Pure `getblock` → domain translation. No I/O, no storage, no RPC.
 *
 * Three things here are load-bearing; losing any of them produces plausible, silently wrong
 * output:
 *
 *  1. Value balances are negated. The RPC's `valueBalanceZat` is net value flowing out of a
 *     shielded pool; the domain uses `> 0` for value entering it. A pure shielding tx
 *     reports a negative RPC balance, a pure unshielding tx a positive one.
 *  2. Sapling and Orchard are read from different places — top-level vs nested. See
 *     `rpc-types.ts`.
 *  3. Fees are derived, not reported: `getblock` carries no `fee` field.
 *
 * Transparent inputs cannot be completed here: the RPC gives only a reference to the output
 * being spent, with no address or value. This module emits `TransparentInputRef`s and leaves
 * resolution to the ingest layer, which is also why `feeZat` is not set here.
 */

/** A transparent input awaiting resolution against a previously-ingested output. */
export interface TransparentInputRef {
  ordinal: number;
  prevTxid: string;
  prevVout: number;
}

/** A transparent output, with `address` absent when the script names none or several. */
export interface ParsedOutput {
  ordinal: number;
  address: string | null;
  valueZat: number;
  scriptType: string;
}

/**
 * A transaction parsed as far as a single block allows: everything except
 * `transparentInputs` and `feeZat`, both of which need cross-transaction lookups.
 *
 * `rpcSaplingVB`/`rpcOrchardVB`/`rpcIronwoodVB` stay in RPC sign: the fee equation is
 * defined in those terms, and negating first would invert it.
 */
export interface ParsedTransaction {
  txid: string;
  blockHeight: number;
  timestamp: number;
  isCoinbase: boolean;
  version: number;
  sizeBytes: number;
  lockTime: number;
  /** The containing block's hash; null only on the standalone path for a mempool tx. */
  blockHash: string | null;
  expiryHeight: number | null;
  sprout: SproutBundle | null;
  sapling: SaplingBundle | null;
  orchard: OrchardBundle | null;
  ironwood: IronwoodBundle | null;
  inputRefs: TransparentInputRef[];
  outputs: ParsedOutput[];
  rpcSaplingVB: number;
  rpcOrchardVB: number;
  /** RPC sign, like its siblings. 0 on any pre-NU6.3 transaction. */
  rpcIronwoodVB: number;
  /**
   * Sprout's value balance, in RPC sign like its siblings: `vpub_new − vpub_old` summed over
   * the JoinSplits, so positive = value leaving the pool. 0 on every post-2017 transaction.
   *
   * Sprout publishes no `valueBalanceZat` field (hence `reportsValueBalance` excludes it), so
   * this is assembled from the JoinSplits. It is still a fee term, and the amount is public.
   */
  rpcSproutVB: number;
}

/** Per-block aggregate, cheap to compute at ingest and expensive to recompute later. */
export interface BlockRollup {
  height: number;
  /** Coinbase is deliberately excluded from these three — see `classifyForRollup`. */
  transparentTxCount: number;
  mixedTxCount: number;
  shieldedTxCount: number;
  /** Domain sign (positive = into the pool), taken from the node's own pool deltas. */
  saplingFlowZat: number;
  orchardFlowZat: number;
  poolTotals: Partial<Record<PoolId, number>>;
}

export interface ParsedBlock {
  block: Block;
  transactions: ParsedTransaction[];
  rollup: BlockRollup;
}

/**
 * RPC value balance → domain sign.
 *
 * Negating 0 yields `-0`, which is not `Object.is`-equal to 0 and can survive a JSON round
 * trip. "Negative nothing" is meaningless for a pool flow, so it is normalised away.
 */
export function poolFlowZat(rpcValueBalanceZat: number): number {
  const flow = -rpcValueBalanceZat;
  return flow === 0 ? 0 : flow;
}

/** Bundles are `null` when the pool is untouched — never a zero-filled object. */
function parseSprout(tx: RpcTransaction): SproutBundle | null {
  return tx.vjoinsplit.length > 0 ? { joinSplits: tx.vjoinsplit.length } : null;
}

/**
 * Sprout's value balance in RPC sign, summed over the JoinSplits.
 *
 * `vpub_new` leaves the pool and `vpub_old` enters it, which is the same orientation the
 * other three pools' `valueBalanceZat` uses — so this term slots into the fee equation
 * beside them with no special case.
 */
function rpcSproutValueBalance(tx: RpcTransaction): number {
  let balance = 0;
  for (const js of tx.vjoinsplit) balance += js.vpub_newZat - js.vpub_oldZat;
  return balance;
}

function parseSapling(tx: RpcTransaction): SaplingBundle | null {
  const spends = tx.vShieldedSpend.length;
  const outputs = tx.vShieldedOutput.length;
  if (spends === 0 && outputs === 0 && tx.valueBalanceZat === 0) return null;
  return { spends, outputs, valueBalanceZat: poolFlowZat(tx.valueBalanceZat) };
}

function parseOrchard(tx: RpcTransaction): OrchardBundle | null {
  const actions = tx.orchard.actions.length;
  if (actions === 0 && tx.orchard.valueBalanceZat === 0) return null;
  return { actions, valueBalanceZat: poolFlowZat(tx.orchard.valueBalanceZat) };
}

/**
 * Ironwood (NU6.3). Absent entirely on pre-activation transactions, hence the guard —
 * `tx.ironwood` is `undefined` there, not a zero-filled bundle like `orchard`.
 */
function parseIronwood(tx: RpcTransaction): IronwoodBundle | null {
  const bundle = tx.ironwood;
  if (bundle === undefined) return null;
  const actions = bundle.actions.length;
  if (actions === 0 && bundle.valueBalanceZat === 0) return null;
  return { actions, valueBalanceZat: poolFlowZat(bundle.valueBalanceZat) };
}

/**
 * Coinbase transactions are identified structurally: their sole input carries a `coinbase`
 * field in place of `txid`/`vout`. Height- or index-based guesses are not equivalent.
 * Coinbase inputs are skipped during resolution, and coinbase is excluded from the rollup.
 */
function isCoinbase(tx: RpcTransaction): boolean {
  return tx.vin.length > 0 && tx.vin[0]?.coinbase !== undefined;
}

export function parseTransaction(
  tx: RpcTransaction,
  blockHeight: number,
  blockTime: number,
  blockHash: string | null = null,
): ParsedTransaction {
  const coinbase = isCoinbase(tx);

  const inputRefs: TransparentInputRef[] = coinbase
    ? []
    : tx.vin.flatMap((vin, ordinal) =>
        vin.txid === undefined || vin.vout === undefined
          ? []
          : [{ ordinal, prevTxid: vin.txid, prevVout: vin.vout }],
      );

  const outputs: ParsedOutput[] = tx.vout.map((out) => {
    const addresses = out.scriptPubKey.addresses ?? [];
    return {
      ordinal: out.n,
      // Exactly one address or none: multisig and OP_RETURN outputs are stored without an
      // address rather than attributing value to the first of several parties. Both response
      // forms are read — the historical array and the modern scalar.
      address: addresses.length === 1 ? (addresses[0] ?? null) : (out.scriptPubKey.address ?? null),
      valueZat: out.valueZat,
      scriptType: out.scriptPubKey.type,
    };
  });

  return {
    txid: tx.txid,
    blockHeight,
    // Use the block's time (equal to the transaction's) so every transaction in a block agrees.
    timestamp: blockTime,
    isCoinbase: coinbase,
    version: tx.version,
    sizeBytes: tx.size,
    // Unlike expiry, locktime 0 is kept as 0: "no lock" is its defined meaning.
    lockTime: tx.locktime,
    blockHash,
    // 0 means "no expiry" in the protocol, and the domain types that as null.
    expiryHeight: tx.expiryheight === 0 ? null : tx.expiryheight,
    sprout: parseSprout(tx),
    sapling: parseSapling(tx),
    orchard: parseOrchard(tx),
    ironwood: parseIronwood(tx),
    inputRefs,
    outputs,
    rpcSaplingVB: tx.valueBalanceZat,
    rpcOrchardVB: tx.orchard.valueBalanceZat,
    rpcIronwoodVB: tx.ironwood?.valueBalanceZat ?? 0,
    rpcSproutVB: rpcSproutValueBalance(tx),
  };
}

function poolDelta(pools: RpcValuePool[], id: PoolId): number {
  return pools.find((p) => p.id === id)?.valueDeltaZat ?? 0;
}

/**
 * Chain-wide pool totals, keyed by pool id.
 *
 * `monitored: false` means the node is not tracking that pool's value (e.g. `ironwood`
 * before NU6.3). Such a pool is omitted, so it stores as NULL rather than 0: zero would be
 * a claim the node declined to make, and would plot as a real point on a chart.
 */
function poolTotals(pools: RpcValuePool[]): Partial<Record<PoolId, number>> {
  const totals: Partial<Record<PoolId, number>> = {};
  for (const pool of pools) {
    if (pool.monitored === false) continue;
    if (pool.chainValueZat !== null) totals[pool.id as PoolId] = pool.chainValueZat;
  }
  return totals;
}

/**
 * Which of `ActivityPoint`'s three buckets a transaction belongs to, or `null` for coinbase.
 *
 * Coinbase is excluded because folding it into "transparent" would add +1 per block and
 * quietly deflate the shielded share `shieldedSharePct()` reports.
 */
function classifyForRollup(parsed: ParsedTransaction): "transparent" | "mixed" | "shielded" | null {
  if (parsed.isCoinbase) return null;
  // Reuse the domain classifier so the stored `kind` cannot diverge from the UI's label.
  const kind = txKind(toDomainShape(parsed));
  return kind === "coinbase" ? null : kind;
}

/**
 * A `Transaction` good enough for `txKind` and `txDirection`, which read only bundle presence,
 * the pools' published value balances, and transparent input/output COUNTS. Input *values* are
 * unknown at this stage and neither classifier consults them.
 */
function toDomainShape(parsed: ParsedTransaction): Transaction {
  return {
    txid: parsed.txid,
    blockHeight: parsed.blockHeight,
    blockHash: parsed.blockHash,
    timestamp: parsed.timestamp,
    isCoinbase: parsed.isCoinbase,
    version: parsed.version,
    sizeBytes: parsed.sizeBytes,
    lockTime: parsed.lockTime,
    expiryHeight: parsed.expiryHeight,
    rawHex: null,
    feeZat: null,
    bindingSigValid: null,
    transparentInputs: parsed.inputRefs.map(() => ({ address: "", valueZat: 0 })),
    transparentOutputs: parsed.outputs.map((o) => ({
      address: o.address ?? "",
      valueZat: o.valueZat,
    })),
    sprout: parsed.sprout,
    sapling: parsed.sapling,
    orchard: parsed.orchard,
    ironwood: parsed.ironwood,
  };
}

/**
 * The parts of a coinbase the reward and the funding streams are read from. A parsed
 * transaction is one; so is a coinbase rebuilt from the chain index, so a block list
 * served from Postgres reaches the same answer through the same two functions.
 */
export interface CoinbaseTerms {
  outputs: readonly { address: string | null; valueZat: number }[];
  sapling?: { valueBalanceZat: number } | null;
  orchard?: { valueBalanceZat: number } | null;
  ironwood?: { valueBalanceZat: number } | null;
}

/**
 * Coinbase outputs that did not go to the miner: the era's funding streams.
 *
 * Defined by exclusion rather than an address list, because stream addresses rotate by era
 * and period (ZIP 214). Every output sharing the miner's address is excluded: a miner
 * splitting its reward across two outputs still has one payee.
 *
 * A shielded coinbase leaves the miner unidentified, so every transparent output is then a
 * stream — which is why `blockMiner` reports `shielded` rather than guessing.
 */
export function fundingStreamsOf(coinbase: CoinbaseTerms, miner: BlockMiner): TransparentOutput[] {
  const minerAddress = miner.kind === "transparent" ? miner.address : null;
  return coinbase.outputs.flatMap((output) =>
    output.address === null || output.address === minerAddress
      ? []
      : [{ address: output.address, valueZat: output.valueZat }],
  );
}

/**
 * Everything the coinbase paid out — the subsidy plus the fees it swept up.
 *
 * Shielded balances are added because a ZIP-213 coinbase pays into a pool instead of to an
 * address, and those amounts are public even though the recipient is not. They are in
 * domain sign here (positive = into the pool), and a coinbase cannot spend, so they only
 * ever add.
 */
export function blockRewardZatOf(coinbase: CoinbaseTerms): number {
  const transparent = coinbase.outputs.reduce((sum, output) => sum + output.valueZat, 0);
  // Every shielded pool is a term. These are already in domain sign (`poolFlowZat` negated
  // the RPC value at the parse boundary, so `> 0` means value entering the pool), which is
  // why a ZIP-213 coinbase minting into a pool adds a positive term. Do not reason from the
  // raw RPC balance here: its sign is the opposite, and subtracting would yield a negative
  // reward. Example: mainnet block 3,437,300 pays 12,500,000 zat transparently and
  // 125,513,060 zat into Ironwood, for a reward of 138,013,060 zat.
  const sapling = coinbase.sapling?.valueBalanceZat ?? 0;
  const orchard = coinbase.orchard?.valueBalanceZat ?? 0;
  const ironwood = coinbase.ironwood?.valueBalanceZat ?? 0;
  return transparent + sapling + orchard + ironwood;
}

export function parseBlock(raw: RpcBlock): ParsedBlock {
  const transactions = raw.tx.map((tx) => parseTransaction(tx, raw.height, raw.time, raw.hash));

  let transparentTxCount = 0;
  let mixedTxCount = 0;
  let shieldedTxCount = 0;
  for (const parsed of transactions) {
    const bucket = classifyForRollup(parsed);
    if (bucket === "transparent") transparentTxCount += 1;
    else if (bucket === "mixed") mixedTxCount += 1;
    else if (bucket === "shielded") shieldedTxCount += 1;
  }

  // The coinbase answers who mined the block, what they wrote, what the streams took and
  // what the block paid out — all from the block response in hand, with no input resolution,
  // which keeps these fields affordable on the list path.
  const coinbase = transactions.find((tx) => tx.isCoinbase);
  const miner = blockMiner(coinbase ? [toDomainShape(coinbase)] : []);
  const rawCoinbase = raw.tx.find((tx) => isCoinbase(tx));

  return {
    block: {
      height: raw.height,
      hash: raw.hash,
      prevHash: raw.previousblockhash,
      timestamp: raw.time,
      sizeBytes: raw.size,
      txids: transactions.map((t) => t.txid),
      composition: blockComposition(transactions.map(toDomainShape)),

      version: raw.version,
      difficulty: raw.difficulty,
      bits: raw.bits,
      nonce: raw.nonce,
      merkleRoot: raw.merkleroot,
      finalSaplingRoot: raw.finalsaplingroot ?? null,
      finalOrchardRoot: raw.finalorchardroot ?? null,

      miner,
      coinbaseTag: decodeCoinbaseTag(rawCoinbase?.vin[0]?.coinbase),
      fundingStreams: coinbase ? fundingStreamsOf(coinbase, miner) : [],
      blockRewardZat: coinbase ? blockRewardZatOf(coinbase) : null,
      // Fees need every transaction's inputs resolved, which a single block response cannot
      // provide. The detail path fills this in.
      totalFeeZat: null,
    },
    transactions,
    rollup: {
      height: raw.height,
      transparentTxCount,
      mixedTxCount,
      shieldedTxCount,
      // From the node's own pool deltas rather than summed from transactions: these are already
      // in domain sign, and using the authoritative figure makes reconciliation a real check.
      saplingFlowZat: poolDelta(raw.valuePools, "sapling"),
      orchardFlowZat: poolDelta(raw.valuePools, "orchard"),
      poolTotals: poolTotals(raw.valuePools),
    },
  };
}

export interface ReconciliationResult {
  ok: boolean;
  saplingFromTxs: number;
  saplingFromPool: number;
  orchardFromTxs: number;
  orchardFromPool: number;
  ironwoodFromTxs: number;
  ironwoodFromPool: number;
}

/**
 * Asserts that the transactions in a block account for exactly the pool movement the node
 * reports: `−sum(tx valueBalanceZat) === pool valueDeltaZat`.
 *
 * This catches failure modes that would otherwise be invisible: an inverted sign (which
 * would flip every shielding chart while looking plausible), a missed bundle field (reading
 * only the top-level `valueBalanceZat` makes the Orchard side mismatch), and regressions in
 * bundle parsing.
 *
 * Every shielded pool is checked separately: a pool's own transactions account for its own
 * delta, so an Orchard→Ironwood migration reconciles on both sides rather than netting out.
 * It does not check fees — a term missing from `computeFeeZat` leaves the flows matching.
 *
 * Example: block 3,428,150 has orchard −302,530,000 and ironwood +302,400,000, both matching
 * the node. The follower runs this per block and refuses to advance on mismatch.
 */
export function reconcilePoolFlows(raw: RpcBlock, parsed: ParsedBlock): ReconciliationResult {
  const saplingFromTxs = -parsed.transactions.reduce((sum, t) => sum + t.rpcSaplingVB, 0);
  const orchardFromTxs = -parsed.transactions.reduce((sum, t) => sum + t.rpcOrchardVB, 0);
  const ironwoodFromTxs = -parsed.transactions.reduce((sum, t) => sum + t.rpcIronwoodVB, 0);
  const saplingFromPool = poolDelta(raw.valuePools, "sapling");
  const orchardFromPool = poolDelta(raw.valuePools, "orchard");
  const ironwoodFromPool = poolDelta(raw.valuePools, "ironwood");
  return {
    ok:
      saplingFromTxs === saplingFromPool &&
      orchardFromTxs === orchardFromPool &&
      ironwoodFromTxs === ironwoodFromPool,
    saplingFromTxs,
    saplingFromPool,
    orchardFromTxs,
    orchardFromPool,
    ironwoodFromTxs,
    ironwoodFromPool,
  };
}

/**
 * The fee, from Zcash's balance equation, in RPC value-balance signs:
 *
 *   fee = transparent_in + vbSprout + vbSapling + vbOrchard + vbIronwood − transparent_out
 *
 * Every shielded pool must appear in this sum, or value moving between two pools reads as a
 * payment to the miner. For example, transaction `25d87ba6…` in block 3,428,150 migrates
 * 3 ZEC from Orchard to Ironwood: `vbOrchard` is +300,030,000 and `vbIronwood` −300,000,000,
 * for a true fee of 30,000 zat. Sprout has no `valueBalanceZat`; its term is assembled from
 * each JoinSplit's `vpub_old`/`vpub_new` (see `rpcSproutVB`), and omitting it yields
 * negative fees on historical transactions.
 *
 * `transparentInZat` is null when any input could not be resolved, and the fee is then
 * unknown — never a partial sum. Coinbase transactions have no fee and return null.
 *
 * Do not special-case "no transparent side ⇒ unknown": for a fully shielded transaction the
 * entire value balance is the fee, since the fee has to leave the pool to reach the miner.
 */
export function computeFeeZat(
  parsed: ParsedTransaction,
  transparentInZat: number | null,
): number | null {
  if (parsed.isCoinbase) return null;
  if (transparentInZat === null) return null;
  return feeFromTermsZat({
    transparentInZat,
    transparentOutZat: parsed.outputs.reduce((sum, o) => sum + o.valueZat, 0),
    rpcSproutVB: parsed.rpcSproutVB,
    rpcSaplingVB: parsed.rpcSaplingVB,
    rpcOrchardVB: parsed.rpcOrchardVB,
    rpcIronwoodVB: parsed.rpcIronwoodVB,
  });
}

/**
 * Every term of the fee equation, as plain zatoshi scalars in RPC sign (positive = value
 * leaving that pool). Lets a caller that has the terms but not a `ParsedTransaction` (the
 * fee repair, reading them from Postgres) use the same arithmetic instead of a second copy
 * of the equation.
 */
export interface FeeTermsZat {
  transparentInZat: number;
  transparentOutZat: number;
  rpcSproutVB: number;
  rpcSaplingVB: number;
  rpcOrchardVB: number;
  rpcIronwoodVB: number;
}

/**
 * The fee equation itself, and the only place it is written. Adding a pool means adding a
 * field here and to `FeeTermsZat`; the compiler then points at every caller.
 */
export function feeFromTermsZat(terms: FeeTermsZat): number {
  return (
    terms.transparentInZat +
    terms.rpcSproutVB +
    terms.rpcSaplingVB +
    terms.rpcOrchardVB +
    terms.rpcIronwoodVB -
    terms.transparentOutZat
  );
}

/**
 * A block's total fee: the sum of its non-coinbase fees, or null if any one is unknown —
 * never a partial sum, which would render as a confident figure that is quietly short.
 * Pass only non-coinbase fees. An empty list totals 0: a block with only its coinbase
 * collected no fees. Shared by the ingest path and the fee repair.
 */
export function blockTotalFeeZat(nonCoinbaseFeesZat: readonly (number | null)[]): number | null {
  let total = 0;
  for (const fee of nonCoinbaseFeesZat) {
    if (fee === null) return null;
    total += fee;
  }
  return total;
}

/**
 * The domain `kind` for a parsed transaction, for storage alongside it. Direction is
 * classified separately by {@link classifyTxDirection}.
 */
export function classifyTxKind(parsed: ParsedTransaction): TxKind {
  return txKind(toDomainShape(parsed));
}

/**
 * The domain `direction` for a parsed transaction, for storage alongside `kind`. The
 * reduced parse shape is enough: `txDirection` reads the transparent sides' lengths and the
 * pools' published balances, not resolved input values, so ingest can classify before
 * resolution.
 */
export function classifyTxDirection(parsed: ParsedTransaction): TxDirection {
  return txDirection(toDomainShape(parsed));
}

/** Does a parsed transaction belong in a list filtered to `filter`? See `matchesTxKindFilter`. */
export function parsedMatchesTxKindFilter(
  parsed: ParsedTransaction,
  filter: TxKindFilter,
): boolean {
  return matchesTxKindFilter(toDomainShape(parsed), filter);
}

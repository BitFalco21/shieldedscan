/**
 * The shapes Zakura/Zebra return from `getblock` at verbosity 2.
 *
 * These are observed field names from real captures, not names recalled from
 * documentation. The fixtures in `__fixtures__/` are those captures with `hex` and
 * `scriptSig` stripped, the only fields nothing here reads.
 *
 * Two traps are encoded in these types:
 *
 *  - Sapling's value balance is top-level; Orchard's is nested. `RpcTransaction` carries
 *    `valueBalanceZat` for Sapling and `orchard.valueBalanceZat` for Orchard. Assuming the
 *    top-level field covers both pools silently drops every Orchard flow.
 *  - Money is read from the `…Zat` integer fields, never the decimal twins. Every amount
 *    appears twice (`value`/`valueZat`, `valueBalance`/`valueBalanceZat`); the decimal forms
 *    are floats and must not touch a ledger.
 */

/**
 * A transparent input. Carries no address and no value — only a reference to the
 * output it spends, which is why inputs must be resolved against previously-ingested
 * rows rather than from the RPC response (see `parse.ts`).
 *
 * Coinbase inputs are structurally different: they have `coinbase` and no `txid`/`vout`.
 * That presence test is how `isCoinbase` is determined.
 */
export interface RpcVin {
  txid?: string;
  vout?: number;
  coinbase?: string;
  sequence: number;
}

export interface RpcScriptPubKey {
  /** e.g. `pubkeyhash` (t1…), `scripthash` (t3…). */
  type: string;
  /**
   * Absent or empty for non-standard scripts (`OP_RETURN`), and multi-entry for multisig.
   * `TransparentOutput.address` is a single string, so anything other than exactly one
   * address is recorded without an address rather than guessing one.
   */
  addresses?: string[];
  /**
   * The modern scalar form. Which form a node returns varies by script type and node
   * version, so both are read; reading only `addresses` would drop every output's
   * attribution if a node switched.
   */
  address?: string;
}

export interface RpcVout {
  n: number;
  valueZat: number;
  scriptPubKey: RpcScriptPubKey;
}

/**
 * An Orchard-shaped shielded bundle: `actions` plus a signed value balance.
 *
 * Shared by Orchard and Ironwood because the response shape is identical (`actions`,
 * `anchor`, `bindingSig`, `flags`, `proof`, `valueBalance`, `valueBalanceZat`).
 */
export interface RpcOrchardBundle {
  actions: unknown[];
  /** RPC sign: positive = value leaving the pool. Negated at parse time. */
  valueBalanceZat: number;
}

/**
 * One Sprout JoinSplit, carrying the pool's public values — Sprout's equivalent of the
 * other pools' `valueBalanceZat`. Empty on modern transactions, but omitting these terms
 * from the fee equation yields negative fees on historical ones.
 *
 * Read the `…Zat` variants, never the float ZEC ones: amounts like 41827.18136286 lose
 * exactness as doubles once summed, and ledger amounts are never rounded.
 */
export interface RpcJoinSplit {
  /** RPC sign: value moving *into* the Sprout pool from the transparent value pool. */
  vpub_oldZat: number;
  /** RPC sign: value moving *out of* the Sprout pool into the transparent value pool. */
  vpub_newZat: number;
}

export interface RpcTransaction {
  txid: string;
  size: number;
  version: number;
  locktime: number;
  expiryheight: number;
  vin: RpcVin[];
  vout: RpcVout[];
  /**
   * Sprout joinsplits. Empty on every modern transaction, but not ignorable: their public
   * values are a term in the fee equation (see `RpcJoinSplit`).
   */
  vjoinsplit: RpcJoinSplit[];
  vShieldedSpend: unknown[];
  vShieldedOutput: unknown[];
  /** **Sapling** value balance. RPC sign: positive = value leaving the pool. */
  valueBalanceZat: number;
  orchard: RpcOrchardBundle;
  /**
   * Ironwood (NU6.3), the fourth shielded pool. Optional because the field does not exist on
   * transactions mined before activation at height 3,428,143 — unlike `orchard`, which the
   * node emits as a zero-filled bundle even on pre-NU5 blocks.
   *
   * Reading it is not optional: an Orchard → Ironwood migration shows a positive
   * `orchard.valueBalanceZat` with a matching negative `ironwood.valueBalanceZat`, and
   * ignoring the second term makes the fee equation treat the migrated value as a fee.
   */
  ironwood?: RpcOrchardBundle;
}

/**
 * One entry of `getblock().valuePools`. Six pools exist: transparent, sprout, sapling,
 * orchard, lockbox, ironwood.
 *
 * `valueDeltaZat` is the node's own per-block change for the pool, and it is already in
 * the domain sign convention (positive = value entering the pool) — the inverse of the
 * per-transaction `valueBalanceZat`. That relationship is the reconciliation invariant
 * asserted in `parse.ts`.
 */
export interface RpcValuePool {
  id: string;
  chainValueZat: number | null;
  valueDeltaZat: number | null;
  monitored: boolean;
}

export interface RpcBlock {
  hash: string;
  height: number;
  previousblockhash: string;
  /** Unix seconds. */
  time: number;
  size: number;
  nTx: number;
  tx: RpcTransaction[];
  valuePools: RpcValuePool[];

  /**
   * Header fields. Two are not what a Bitcoin-shaped guess would produce:
   *
   *  - `nonce` is a 32-byte hex string, not a number. Zcash's nonce is a 256-bit header
   *    field; typing it as `number` would truncate it through JSON.
   *  - `bits` is a hex string (`"1c00e9e0"`), while `difficulty` is the float the node
   *    derives from it. Two views of one value; the node sends both.
   */
  version: number;
  merkleroot: string;
  nonce: string;
  bits: string;
  difficulty: number;
  /**
   * Commitment tree roots. Optional because a block mined before a pool existed has none;
   * absence maps to `null`, never `""`.
   */
  finalsaplingroot?: string;
  finalorchardroot?: string;
}

/**
 * `getblockheader`'s response — the header alone, with no transaction list.
 *
 * The cheap way to read one header field: `getblock` at verbosity 2 inlines every
 * transaction. Do not assume the full zcashd RPC surface on a Zebra-family node (Zakura
 * lacks `getchaintips`, for instance); this method is implemented.
 *
 * Only the fields the difficulty repair reads are typed. `difficulty` is identical to the
 * `getblock` field of the same name — a second route to one value, not a second derivation.
 * The node accepts a hash or a height, and an unknown hash is an error rather than a
 * plausible answer, which is what lets the repair key on hash.
 */
export interface RpcBlockHeader {
  hash: string;
  height: number;
  difficulty: number;
}

/**
 * `getblock` at verbosity 1: every field `RpcBlock` carries, with `tx` holding txids instead
 * of transactions — a few KB per block instead of a few hundred.
 */
export type RpcBlockSummary = Omit<RpcBlock, "tx"> & { tx: string[] };

export type PoolId = "transparent" | "sprout" | "sapling" | "orchard" | "lockbox" | "ironwood";

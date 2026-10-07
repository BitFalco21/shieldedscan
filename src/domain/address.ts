import type { Transaction } from "./transaction";

export interface TransparentAddress {
  kind: "transparent";
  address: string;
  balanceZat: number;
  totalReceivedZat: number;
  totalSentZat: number;
  txids: string[];
}

/** Shielded addresses have no public history, by design. */
export interface ShieldedAddress {
  kind: "sapling" | "unified";
  address: string;
}

export type AddressInfo = TransparentAddress | ShieldedAddress;

/** The address families this chain has, independent of whether we hold any info about one. */
export type ZcashAddressKind = TransparentAddress["kind"] | ShieldedAddress["kind"];

/**
 * Both networks' prefixes, unconditionally: `t1`/`t3` mainnet and `tm`/`t2` testnet
 * transparent, `zs1`/`ztestsapling1` Sapling, `u1`/`utest1` unified. The domain cannot ask
 * which deployment it runs on, and accepting both is harmless: an other-network address
 * simply 404s at the API.
 */
const TRANSPARENT = /^t(?:[13]|m|2)[a-zA-Z0-9]{20,40}$/;
const SAPLING = /^(?:zs1|ztestsapling1)[a-z0-9]{20,300}$/;
const UNIFIED = /^(?:u1|utest1)[a-z0-9]{20,300}$/;

/**
 * The single source of truth for what a Zcash address string looks like.
 *
 * Returns `null` for anything unrecognised, including addresses from other chains (common
 * for a cross-chain transfer's boundary address). Never guesses a family.
 */
export function classifyZcashAddress(address: string | null | undefined): ZcashAddressKind | null {
  if (typeof address !== "string") return null;
  const a = address.trim();
  if (TRANSPARENT.test(a)) return "transparent";
  if (SAPLING.test(a)) return "sapling";
  if (UNIFIED.test(a)) return "unified";
  return null;
}

/** The short form, for chrome: panel titles, badges, table cells. */
export function zcashAddressKindLabel(kind: ZcashAddressKind | null): string {
  switch (kind) {
    case "transparent":
      return "TRANSPARENT";
    case "sapling":
      return "SAPLING";
    case "unified":
      return "UNIFIED";
    case null:
      return "UNKNOWN";
  }
}

/**
 * What a transaction did to one transparent address's balance, in zatoshis.
 *
 * Outputs paying the address, minus inputs spending from it. Positive means the address
 * received on net, negative means it sent.
 *
 * This is arithmetic, not inference: it never decides which output was the payment and which
 * was change (a guess about intent this explorer refuses to make). Every input and output
 * naming this address is public, and their signed sum is a fact.
 *
 * Shielded components are not folded in: adding a shielded value balance would attribute an
 * encrypted amount to a transparent address.
 *
 * `TransparentOutput.address` is `""` for scripts naming no address (OP_RETURN, multisig);
 * those never match, so they contribute nothing.
 */
export function addressDeltaZat(tx: Transaction, address: string): number {
  const received = tx.transparentOutputs
    .filter((o) => o.address === address)
    .reduce((sum, o) => sum + o.valueZat, 0);
  const spent = tx.transparentInputs
    .filter((i) => i.address === address)
    .reduce((sum, i) => sum + i.valueZat, 0);
  return received - spent;
}

/**
 * The caveat that belongs next to the address itself.
 *
 * A unified address can carry a transparent receiver, so a destination may be called
 * shielded-capable but never shielded. Returns null where there is nothing to qualify.
 */
export function zcashAddressKindNote(kind: ZcashAddressKind | null): string | null {
  switch (kind) {
    case "unified":
      return "shielded-capable — the receiver used is not public";
    case "sapling":
      return "shielded";
    case "transparent":
    case null:
      return null;
  }
}

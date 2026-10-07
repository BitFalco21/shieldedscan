/**
 * A canonical Zcash transaction id: exactly 64 lowercase hex characters.
 *
 * Stricter than `classifySearchQuery`, which accepts uppercase from a visitor and lowercases
 * it. This answers "is this a txid as the project stores and publishes it"; anything else
 * should never reach a ledger key or a public post.
 */
const CANONICAL_TXID = /^[0-9a-f]{64}$/;

export function isCanonicalTxid(value: string): boolean {
  return CANONICAL_TXID.test(value);
}

import { siteUrl } from "@/lib/site";
import type { TxCardFacts } from "./tx-card-facts";

/**
 * The card for a transaction id that names nothing on this chain.
 *
 * A well-formed id that is simply absent — a stale link, a typo, a transaction from the
 * other network — must still preview as something, and the honest something is the site
 * rather than a broken image or a guess. So this states the site's own line and asserts
 * NOTHING about a transaction: no verdict about value, no fee, no block, no id. The Veil is
 * deliberately not borrowed for the value cell either; a redaction bar means "encrypted
 * on-chain, hidden by design", and spending it on "we have no such transaction" would teach
 * a reader that our absences are Zcash's privacy.
 */
export function siteCardFacts(): TxCardFacts {
  return {
    verdict: "PRIVACY IS NORMAL",
    path: null,
    // No figure row at all. A dash under VALUE would read as a figure we could not fetch,
    // and "unknown" under FEE would claim we looked for one.
    value: null,
    fee: null,
    stamp: "NO SUCH TRANSACTION ON THIS CHAIN",
    confirmed: false,
    txidShort: "",
    shape: "SHIELDED POOLS · CROSS-CHAIN FLOWS · NETWORK ANALYTICS",
    host: siteUrl.replace(/^https?:\/\//, ""),
    // No shield: this card reports on no transaction, and an outline shield would state
    // "transparent" about something that does not exist.
    shield: null,
  };
}

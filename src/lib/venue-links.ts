import type { CrossChainTransfer } from "@/domain";

/**
 * Where a transfer can be checked against the venue that recorded it. The far leg of a swap is
 * the one figure that cannot be checked against the Zcash chain, so we link the venue's record.
 *
 * Hosts are configuration, not constants: a third-party host baked into code is an outage
 * waiting to happen.
 */
const INTENTS_EXPLORER =
  process.env.NEAR_INTENTS_EXPLORER_URL ?? "https://explorer.near-intents.org";

/** Maya's block explorer; configurable for the same reason. */
const MAYA_EXPLORER = process.env.MAYA_EXPLORER_URL ?? "https://www.mayascan.org";

/**
 * THORChain's explorer, keyed like Maya's on the inbound deposit's txID. It returns HTTP 200 for
 * a fabricated id too (a soft 404), so link checks must read rendered text.
 */
const THORCHAIN_EXPLORER = process.env.THORCHAIN_EXPLORER_URL ?? "https://thorchain.net";

/**
 * The venue's own page for this transfer, or `null` when there is nothing honest to link.
 *
 * NEAR Intents links are keyed on the venue's deposit address: EVM `0x…` (42 chars), NEAR
 * implicit (64 hex, no `0x` prefix), XRP `r…`. The intent hash and the deposit transaction hash
 * do not resolve on the venue's explorer; the resolved page states "Tokens were deposited to
 * <key>".
 *
 * The explorer is client-rendered, so `/transactions/<anything>` answers HTTP 200 and renders
 * "404 Transaction not found" in the browser; the `@external` e2e spec therefore asserts on
 * rendered text, never on status.
 *
 * Returns null when the venue published no deposit address (older rows lack it). A dead external
 * link is worse than no link on a page whose claim is checkability.
 */
export function venueTransferUrl(transfer: CrossChainTransfer): string | null {
  if (transfer.protocol === "maya") return midgardTransferUrl(transfer, "maya-", MAYA_EXPLORER);
  if (transfer.protocol === "thorchain") {
    return midgardTransferUrl(transfer, "thorchain-", THORCHAIN_EXPLORER);
  }
  if (transfer.protocol !== "near-intents") return null;
  const depositAddress = transfer.venueDepositAddress;
  // Truthiness rather than `=== null`: null, empty string and `undefined` (an API that has not
  // shipped the field yet) all mean "no address". Unlike a number, an empty address carries no
  // meaning, so a falsiness check is correct here.
  if (!depositAddress) return null;
  return `${INTENTS_EXPLORER}/transactions/${encodeURIComponent(depositAddress)}`;
}

/**
 * A Midgard venue's (Maya, THORChain) record of a swap, keyed on the transfer id.
 *
 * Midgard venues deposit into a shared vault, so there is no per-transfer address, but their
 * explorers index by the swap's inbound txID, which `midgard.ts` stores as the id
 * (`${protocol}-${identity}`, `identity` = `action.in[0].txID`). If the id's fallback chain
 * (`action.in[0].txID ?? zcashTxid ?? counterpartTxHash`) ever yields something else, this link
 * would be dead; the `@external` spec guards it. These explorers also answer HTTP 200 for a
 * fabricated hash, so only rendered text distinguishes a real record.
 */
function midgardTransferUrl(
  transfer: CrossChainTransfer,
  prefix: string,
  explorer: string,
): string | null {
  const hash = transfer.id.startsWith(prefix) ? transfer.id.slice(prefix.length) : "";
  // An id not in the venue-prefixed form cannot be keyed on; no link beats a dead one.
  if (!hash) return null;
  return `${explorer}/tx/${encodeURIComponent(hash)}`;
}

/** The venue's display name, for the link's own label. */
export function venueName(transfer: CrossChainTransfer): string | null {
  if (transfer.protocol === "near-intents") return "NEAR Intents explorer";
  if (transfer.protocol === "maya") return "MayaScan";
  if (transfer.protocol === "thorchain") return "THORChain Explorer";
  return null;
}

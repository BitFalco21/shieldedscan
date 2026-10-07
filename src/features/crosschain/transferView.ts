import type { CrossChainTransfer } from "@/domain";
import { ZCASH_CHAIN, minUsdFilterLabel } from "@/domain";
import { formatAssetAmount, formatZecAmount } from "@/lib/format";
import type { CrossChainFilterState } from "./crossChainHref";

/**
 * Pure helpers about a transfer and about what the filter state is showing.
 *
 * They live here rather than in `CrossChainListPage` because that file is a Client Component,
 * and `"use client"` turns every function a file exports into a client-only one;
 * `CrossChainDetailPage`, a Server Component, calls `legsOf`. A page module that exports shared
 * helpers cannot become a client component until they are moved out.
 */

/**
 * Splits a transfer into its two ends. Direction is relative to Zcash, so which side ZEC sits on
 * flips with it; deriving that once lets both ends render through the same component.
 */
export function legsOf(t: CrossChainTransfer) {
  const zcash = {
    // The same constant `transferChainSide` answers with, so the SOURCE column and the
    // SOURCE filter above it cannot disagree about what this end is called.
    chain: ZCASH_CHAIN,
    amount: formatZecAmount(t.zecAmountZat),
    asset: "ZEC",
    usdAtSwap: t.usdValueAtSwap,
    address: t.zcashAddress,
    href: t.zcashAddress === null ? null : `/address/${t.zcashAddress}`,
    synthetic: false,
  };
  const counterpart = {
    chain: t.counterpartChain,
    // Null means the far leg has not settled, so there is no amount — and no dash either:
    // `TransferLeg` says so in words.
    amount: t.counterpartAmount === null ? null : formatAssetAmount(t.counterpartAmount),
    asset: t.counterpartAsset,
    usdAtSwap: t.counterpartUsdAtSwap,
    address: t.counterpartAddress,
    // Foreign addresses have no page in this explorer, so they are never links.
    href: null,
    synthetic: t.counterpartIsSynthetic,
  };
  return t.direction === "in"
    ? { source: counterpart, destination: zcash }
    : { source: zcash, destination: counterpart };
}

/**
 * A both-ends selection that no row can satisfy, whatever the chains.
 *
 * Every transfer has Zcash at exactly one end, so the only shapes are `foreign → ZEC` and `ZEC →
 * foreign`; a selection matches only if one survives it. When neither does, the zero is
 * structural and the page says so. Written from those two shapes, so it also catches ZEC named
 * at both ends — a transfer both inbound and outbound. Reachable only via a hand-edited or
 * shared URL, since the menus pin the direction.
 */
export function isUnsatisfiable(state: CrossChainFilterState): boolean {
  const { sourceChains: s, destinationChains: d } = state;
  if (s.length === 0 || d.length === 0) return false;
  const hasForeign = (chains: string[]) => chains.some((c) => c !== ZCASH_CHAIN);
  const inboundPossible = hasForeign(s) && d.includes(ZCASH_CHAIN);
  const outboundPossible = s.includes(ZCASH_CHAIN) && hasForeign(d);
  return !inboundPossible && !outboundPossible;
}

/** "BTC", "BTC or ETH", "BTC, ETH or SOL", "BTC, ETH, SOL or 3 more". */
function chainPhrase(chains: string[]): string {
  const NAMED = 3;
  const named = chains.slice(0, NAMED);
  const rest = chains.length - named.length;
  const tail = rest > 0 ? `${rest} more` : named.pop();
  return named.length === 0 ? (tail ?? "") : `${named.join(", ")} or ${tail}`;
}

/**
 * What the totals line counts, in words. Every clause is optional and they compose — "1,234
 * inbound cross-chain transactions on maya from BTC or ETH to ZEC". The count comes from
 * `countCrossChainTransfers` with the same filters as the list, so the sentence cannot describe
 * a different set from the table.
 */
export function filterSentence(state: CrossChainFilterState): string {
  const side =
    state.direction === "all" ? "" : `${state.direction === "in" ? "inbound" : "outbound"} `;
  const venue = state.protocol === "all" ? "" : ` on ${state.protocol}`;
  const from = state.sourceChains.length > 0 ? ` from ${chainPhrase(state.sourceChains)}` : "";
  const to =
    state.destinationChains.length > 0 ? ` to ${chainPhrase(state.destinationChains)}` : "";
  // "at swap" is carried in the sentence as well as the chip label: this line is the one a
  // reader quotes, and a bare "worth $100K or more" would read as today's money.
  const worth =
    state.minUsd === null
      ? ""
      : ` worth ${minUsdFilterLabel(state.minUsd).replace("≥ ", "")} or more at swap`;
  return `${side}cross-chain transactions${venue}${from}${to}${worth}`;
}

import type { CrossChainTransfer } from "@/domain";
import { ZCASH_CHAIN } from "@/domain";
import type { ActionPart } from "@/domain";
import { chainName } from "@/lib/chains";
import { formatCount } from "@/lib/format";

/**
 * What a cross-chain transfer did, as one sentence of parts — the same grammar as a
 * transaction's (`txAction`), so a crossing reads like every other action on the site.
 *
 * Both amounts are the venue's published figures, and only the Zcash leg is checked against
 * the chain here; `farSideNote` says so. A counterpart amount the venue has not published yet
 * is left out rather than rendered as a placeholder figure.
 */
export interface TransferAction {
  parts: ActionPart[];
  /**
   * What this explorer cannot vouch for about the foreign leg — shown as a tip beside that leg's
   * label (SOURCE on an inbound crossing, DESTINATION on an outbound one), not in the action
   * sentence.
   */
  farSideNote: string;
}

const text = (t: string): ActionPart => ({ kind: "text", text: t });

const VERB: Record<CrossChainTransfer["status"], string> = {
  completed: "Swapped",
  pending: "Swapping",
  refunded: "Refunded a swap of",
};

export function transferAction(t: CrossChainTransfer): TransferAction {
  const zcash: ActionPart[] = [
    { kind: "zec", zat: t.zecAmountZat },
    text(" on "),
    { kind: "chain", chain: ZCASH_CHAIN, label: chainName(ZCASH_CHAIN) },
  ];
  const counterpartChain: ActionPart = {
    kind: "chain",
    chain: t.counterpartChain,
    label: chainName(t.counterpartChain),
  };
  // Wrapped ZEC held on another chain (Maya's `ZEC/ZEC`) is still a crossing — and saying
  // what it is keeps "1,000 ZEC for 1,000 ZEC/ZEC" from reading as a swap with itself.
  const wrapped = t.counterpartIsSynthetic ? [text(" (wrapped ZEC)")] : [];
  const counterpart: ActionPart[] =
    t.counterpartAmount === null
      ? [counterpartChain, ...wrapped]
      : [
          {
            kind: "asset",
            amount: formatCount(t.counterpartAmount),
            ticker: t.counterpartAsset,
            chain: t.counterpartChain,
          },
          ...wrapped,
          text(" on "),
          counterpartChain,
        ];
  const joiner =
    t.counterpartAmount === null ? (t.direction === "in" ? " from " : " to ") : " for ";

  const route =
    t.direction === "in"
      ? t.counterpartAmount === null
        ? [...zcash, text(joiner), ...counterpart]
        : [...counterpart, text(joiner), ...zcash]
      : [...zcash, text(joiner), ...counterpart];

  const far = chainName(t.counterpartChain);
  return {
    parts: [
      { kind: "verb", text: VERB[t.status], tone: "plain" },
      text(" "),
      ...route,
      text(" "),
      { kind: "venue", protocol: t.protocol, before: "via " },
    ],
    // About the far leg only: what the Zcash recipient does next is the inbound page's own veil
    // strip, so the tip beside the foreign label does not repeat it.
    farSideNote:
      t.direction === "in"
        ? `The ${far} side is the venue’s report; only the Zcash leg is checked here.`
        : `The ${far} side is the venue’s report; what happens there after arrival is outside this explorer.`,
  };
}

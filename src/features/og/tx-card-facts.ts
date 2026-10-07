import {
  txFlowPath,
  txKindLabel,
  publicValueZat,
  utcDayFromSeconds,
  type Transaction,
} from "@/domain";
import { privacyVariantFor, type PrivacyVariant } from "@/components/PrivacyShield";
import { feeUsdAtDay, formatCount, formatZec, shortHash } from "@/lib/format";
import { siteUrl } from "@/lib/site";

/** What a card may say about a transaction's value. */
export type TxCardValue =
  | {
      kind: "public";
      /** The amount, with its ticker — TAZ on testnet, per `formatZec`. */
      zec: string;
      /** The dollar figure at the transaction's OWN day's close, or null. */
      usd: string | null;
      /** The day that dollar figure came from — it travels with the figure or not at all. */
      usdBasis: string | null;
    }
  /**
   * No figure of any kind, deliberately: the card draws the site's redaction bars here.
   * A `0` on this branch would be the fabrication the Veil exists to prevent, and a `—`
   * would read as a value we failed to fetch.
   */
  | { kind: "shielded" };

/** What a card may say about a fee. */
export type TxCardFee =
  | { kind: "amount"; zec: string }
  /** A coinbase COLLECTS the block's fees rather than paying one. */
  | { kind: "none" }
  /** An input we could not resolve. Fees are repaired, not guaranteed. */
  | { kind: "unknown" };

export interface TxCardFacts {
  /** The hero: what the transaction did, in the words the pages already use. */
  verdict: string;
  /** `ORCHARD → IRONWOOD`, or null where the chain settles no single path. */
  path: string | null;
  /**
   * Null means the card prints NO figure row at all — the state the fallback card uses.
   * It is deliberately not a value with a dash in it: a dash beside a label reads as a
   * figure we failed to fetch, and the fallback is not reporting on a transaction.
   */
  value: TxCardValue | null;
  fee: TxCardFee | null;
  /** `BLOCK 3,428,150 · 30 AUG 2026`, or the mempool sentence. */
  stamp: string;
  /** False while the transaction is still in the mempool — the card is cached differently. */
  confirmed: boolean;
  txidShort: string;
  /** How many logical parts the transaction has, stated as counts and never as amounts. */
  shape: string;
  /** The host this card belongs to, so a testnet card can never read as a mainnet one. */
  host: string;
  /**
   * Which shield the card draws — the site's own privacy grammar, at 300px instead of 14.
   *
   * Null where no mark can be stood behind: the fallback card reports on no transaction, and a
   * coinbase is ambiguous here. `privacyVariantFor` maps every coinbase to `transparent` (right
   * on a list row beside a COINBASE pill), so a ZIP-213 coinbase shielding the miner's share
   * would draw an outline shield beside `MINED → TRANSPARENT ORCHARD`. Rather than derive a
   * second answer, the card draws nothing and lets the verdict and the path carry it.
   */
  shield: PrivacyVariant | null;
}

export interface TxCardPrices {
  /** Daily closes keyed `YYYY-MM-DD`, as `getDailyPriceMap` returns them. */
  dailyUsd: Record<string, number>;
  /** The live price, which is the day's close only for today. */
  currentUsd: number | null;
  nowSeconds: number;
}

/** "30 AUG 2026" — the UTC day, matching the alert cards' stamp. */
function cardDay(timestamp: number): string {
  return new Date(timestamp * 1000)
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
    .toUpperCase();
}

/**
 * Every string the share card prints, derived and never invented.
 *
 * Pure, and separate from the renderer for the reason `DailyCard`'s figures are: a card is
 * a permanent, screenshot-able claim, so what it asserts has to be testable without
 * rendering a pixel. Each field below either comes from a domain function that already
 * answers that question for the pages (`txKindLabel`, `txFlowPath`, `publicValueZat`) or is
 * an explicit refusal. Nothing here decides anything about a transaction on its own.
 *
 * What it deliberately does not carry:
 *
 *  - No confirmation count. A scraper caches the image and a screenshot outlives the cache;
 *    the block height and the day are immutable, so those are what it states.
 *  - No address, no name, no payment narration. Deciding which output was the payment is an
 *    inference this site refuses, and a label would travel without the basis that qualifies it.
 *  - No dollar figure without its date. The transaction's own day's close, through
 *    `feeUsdAtDay`, with the day printed beside the figure.
 */
export function txCardFacts(tx: Transaction, prices: TxCardPrices): TxCardFacts {
  const path = txFlowPath(tx);
  const publicZat = publicValueZat(tx);

  const usd =
    publicZat === null
      ? null
      : feeUsdAtDay(publicZat, tx.timestamp, prices.dailyUsd, prices.currentUsd, prices.nowSeconds);

  const shieldedActions =
    (tx.orchard?.actions ?? 0) +
    (tx.ironwood?.actions ?? 0) +
    (tx.sapling ? tx.sapling.spends + tx.sapling.outputs : 0) +
    (tx.sprout?.joinSplits ?? 0);

  return {
    verdict: txKindLabel(tx),
    path: path ? `${path.from.join(" ").toUpperCase()} → ${path.to.join(" ").toUpperCase()}` : null,
    value:
      publicZat === null
        ? { kind: "shielded" }
        : {
            kind: "public",
            zec: formatZec(publicZat),
            usd,
            /*
             * The basis travels with the figure or neither appears: an undated dollar amount on a
             * permanent card is a claim about "now" that decays. Today's close does not exist
             * yet, so `feeUsdAtDay` falls back to the live price for a transaction mined today,
             * and the label must not call that a close.
             */
            usdBasis:
              usd === null
                ? null
                : utcDayFromSeconds(tx.timestamp) === utcDayFromSeconds(prices.nowSeconds)
                  ? `AT THE PRICE ON ${cardDay(tx.timestamp)}`
                  : `AT THE ${cardDay(tx.timestamp)} CLOSE`,
          },
    fee: tx.isCoinbase
      ? { kind: "none" }
      : tx.feeZat === null
        ? { kind: "unknown" }
        : { kind: "amount", zec: formatZec(tx.feeZat) },
    stamp:
      tx.blockHeight === null
        ? "IN THE MEMPOOL — NOT YET IN A BLOCK"
        : `BLOCK ${formatCount(tx.blockHeight)} · ${cardDay(tx.timestamp)}`,
    confirmed: tx.blockHeight !== null,
    // Eight leading characters and six trailing: enough to recognise the transaction the
    // link points at, and the URL beside the card carries all 64.
    txidShort: `${tx.txid.slice(0, 8)}…${tx.txid.slice(-6)}`,
    // Counts, never amounts: a shielded action's value is not ours to state, and its count is
    // public by construction.
    shape: [
      `${tx.transparentInputs.length} TRANSPARENT IN`,
      `${tx.transparentOutputs.length} OUT`,
      ...(shieldedActions > 0
        ? [`${shieldedActions} SHIELDED ACTION${shieldedActions === 1 ? "" : "S"}`]
        : []),
    ].join(" · "),
    host: siteUrl.replace(/^https?:\/\//, ""),
    shield: tx.isCoinbase ? null : privacyVariantFor(tx),
  };
}

export { shortHash };

import { assetTickerIsKnown } from "./crosschain";
import { formatUsdExact } from "@/lib/format";
import { isCanonicalTxid } from "./txid";
import { encodeEventWatermark, parseEventWatermark } from "./watermark";

/**
 * One cross-chain crossing, as published on X. Terms only: the labels the card and the text
 * both need are functions below, so the image and the words cannot disagree.
 */
export interface SwapFigures {
  /** The venue's own transfer id; the ledger's primary key, which makes posting exactly-once. */
  transferId: string;
  timestamp: number;
  zecAmountZat: number;
  /** The venue's published value for the ZEC leg. Never averaged with the other leg. */
  usdAtSwap: number | null;
  counterpartAsset: string;
  counterpartChain: string;
  counterpartChainName: string;
  counterpartAmount: number;
  /** True when the asset IS the chain's own coin, so the chain need not be named twice. */
  counterpartIsNative: boolean;
  venue: string;
  /** The Zcash side's txid, so the post is checkable. */
  zcashTxid: string;
  /**
   * `"in"` is into Zcash, `"out"` is out of it. Optional because ledger rows written before
   * outbound crossings were posted omit it, and all of those are inbound. Read it through
   * `swapDirection`.
   */
  direction?: "in" | "out";
}

/** The crossing's direction; an absent field means inbound. */
export function swapDirection(s: SwapFigures): "in" | "out" {
  return s.direction ?? "in";
}

export const SWAP_KIND = "swap";
export const SWAP_DRYRUN_KIND = "swap-dryrun";

/** Upper bound on decimals so a near-zero input cannot loop forever. */
const MAX_COUNTERPART_DECIMALS = 12;

/**
 * An amount with significant precision, never a fixed two decimals.
 *
 * An integer keeps no decimals ("507,500"). Anything else keeps at least two ("2.50"), and
 * more only while two would round a non-zero amount to "0.00": a 0.004 BTC crossing must
 * never render as nothing.
 *
 * Shared by `SwapCard` and `swapCounterpartLabel` so the image and the text state the same
 * amount.
 */

export function formatCounterpartAmount(amount: number): string {
  if (Number.isInteger(amount)) {
    return amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  let decimals = 2;
  while (decimals < MAX_COUNTERPART_DECIMALS && Number(amount.toFixed(decimals)) === 0) {
    decimals++;
  }
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * "507,500 USDC on Ethereum", or "2.50 BTC" when the asset is the chain's own coin.
 * Null when the venue published no real ticker (see `assetTickerIsKnown`) or a blank one,
 * which `assetTickerIsKnown("")` would otherwise accept.
 */
export function swapCounterpartLabel(s: SwapFigures): string | null {
  if (s.counterpartAsset.trim() === "") return null;
  if (!assetTickerIsKnown(s.counterpartAsset)) return null;
  const amount = formatCounterpartAmount(s.counterpartAmount);
  const asset = `${amount} ${s.counterpartAsset}`;
  return s.counterpartIsNative ? asset : `${asset} on ${s.counterpartChainName}`;
}

/**
 * The USD value at swap, always to the whole dollar.
 *
 * The one formatter for this figure, shared by `SwapCard` and the post text, so the image
 * and its caption cannot state different amounts.
 *
 * Rounding to the dollar first makes `formatUsdExact`'s two decimals always ".00", so
 * stripping them is lossless.
 *
 * Also imported by the social-post service, which is maintained outside this repository.
 */
export function formatSwapUsdAtSwap(value: number): string {
  const exact = formatUsdExact(Math.round(value));
  return exact.slice(0, -3);
}

/** Does this crossing carry every figure the card prints? A missing one means no post. */
export function swapIsComplete(s: SwapFigures): boolean {
  if (s.usdAtSwap === null || !Number.isFinite(s.usdAtSwap) || s.usdAtSwap <= 0) return false;
  // `NaN <= 0` and `Infinity <= 0` are both false, so finiteness is checked explicitly.
  if (!Number.isFinite(s.zecAmountZat) || s.zecAmountZat <= 0) return false;
  if (!Number.isFinite(s.counterpartAmount) || s.counterpartAmount <= 0) return false;
  if (s.venue.trim() === "") return false;
  if (!isCanonicalTxid(s.zcashTxid)) return false;
  return swapCounterpartLabel(s) !== null;
}

/**
 * How long a crossing must sit before it is eligible to post: venues can restate recent
 * values, and a post cannot be corrected.
 *
 * Lives in the domain layer so the X poster can use it without importing `server/`.
 */
export const SWAP_SETTLE_SECONDS = 15 * 60;

/**
 * The swap poller's watermark, keyed on `(timestamp, id)`. Thin aliases over
 * `@/domain/watermark`, which the boundary poller shares; `timestamp` keeps its name because
 * a swap is keyed on a venue timestamp.
 */
export interface SwapWatermark {
  timestamp: number;
  id: string;
}

/** Also imported by the social-post service, which is maintained outside this repository. */
export function encodeSwapWatermark(timestamp: number, id: string): string {
  return encodeEventWatermark(timestamp, id);
}

/** Also imported by the social-post service, which is maintained outside this repository. */
export function parseSwapWatermark(raw: string): SwapWatermark {
  const { position, id } = parseEventWatermark(raw);
  return { timestamp: position, id };
}

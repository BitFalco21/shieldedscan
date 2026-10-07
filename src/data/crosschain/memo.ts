/**
 * Midgard swap-memo parsing.
 *
 * A memo looks like `=:ARB.USDT:0xRecipient/…:limit/interval/qty:affiliate:fee`, where
 * field [1] is the *target asset*. It is only consulted as a fallback: a failed or
 * partially-settled swap can have no counter leg at all, and without this the row is
 * silently dropped.
 *
 * Two traps:
 *
 * 1. Assets are often abbreviated to a single letter — `=:e:0x…`, `=:b:bc1…`, `=:z:t1…`.
 *    Taking the raw field would yield "E"/"B"/"Z" as chain tickers.
 * 2. The shorthand is venue-specific. On Maya `c` is CACAO (the matching out leg pays
 *    `MAYA.CACAO`); on THORChain `c` is BCH. Resolving one table against the other
 *    silently mislabels chains.
 *
 * The tables are conservative: only entries backed by an observed leg or the venue's own
 * source appear. An unrecognised shorthand resolves to null, so the caller says UNKNOWN
 * rather than inventing a chain.
 */

import type { MidgardProtocol } from "./venues";

/** Maya's shorthand codes, each confirmed against a live leg. */
const MAYA_SHORTHAND: Record<string, string> = {
  b: "BTC.BTC",
  e: "ETH.ETH",
  c: "MAYA.CACAO",
  d: "DASH.DASH",
  k: "KUJI.KUJI",
  r: "THOR.RUNE",
  z: "ZEC.ZEC",
};

/**
 * THORChain's own table: `Asset.ShortCode()` in thornode `common/asset.go`. Some codes are
 * two letters — `tr`, `ta`, `do`, `ad`. Retired chains are omitted.
 */
const THORCHAIN_SHORTHAND: Record<string, string> = {
  r: "THOR.RUNE",
  b: "BTC.BTC",
  e: "ETH.ETH",
  g: "GAIA.ATOM",
  d: "DOGE.DOGE",
  l: "LTC.LTC",
  c: "BCH.BCH",
  a: "AVAX.AVAX",
  s: "BSC.BNB",
  f: "BASE.ETH",
  tr: "TRON.TRX",
  x: "XRP.XRP",
  o: "SOL.SOL",
  ta: "TAO.TAO",
  z: "ZEC.ZEC",
  m: "XMR.XMR",
  p: "POL.POL",
  u: "SUI.SUI",
  do: "DOT.DOT",
  ad: "ADA.ADA",
};

const SHORTHAND: Record<MidgardProtocol, Record<string, string>> = {
  maya: MAYA_SHORTHAND,
  thorchain: THORCHAIN_SHORTHAND,
};

/**
 * Resolves a memo's target asset to a full `CHAIN.SYMBOL` string.
 *
 * Returns null when the memo is absent, malformed, unrecognised, or targets ZEC itself
 * — a `=:z:…` memo describes the *Zcash* leg, so treating it as the counterparty would
 * label an inbound swap as arriving from Zcash.
 */
export function memoTargetAsset(
  memo: string | undefined,
  protocol: MidgardProtocol,
): string | null {
  if (typeof memo !== "string") return null;
  const field = memo.split(":")[1]?.trim();
  if (!field) return null;

  // Full form already: "ARB.USDT-0X…", "BTC.BTC", or a wrapped "BTC~BTC" / "BTC-BTC".
  // Any of the venue's separators marks a full asset id; a bare word is a shorthand.
  const resolved = /[~./-]/.test(field) ? field : SHORTHAND[protocol][field.toLowerCase()];

  if (!resolved) return null;
  // The chain before ANY separator: `ZEC~ZEC` is ZEC as much as `ZEC.ZEC` is.
  if (resolved.split(/[~./-]/)[0]?.toUpperCase() === "ZEC") return null;
  return resolved;
}

/**
 * The destination address a swap memo names — field [2],
 * `=:ASSET:DEST:limit:affiliates:fees`.
 *
 * Used to tell the user's own payout from the venue's fee legs, because Midgard flags only
 * some affiliate legs: with two affiliates, an unflagged fee leg could otherwise be taken as
 * the counterparty. A refund address may follow the destination after a `/`; it is dropped.
 * Null when the memo has no such field.
 */
export function memoDestination(memo: string | undefined): string | null {
  if (typeof memo !== "string") return null;
  const field = memo.split(":")[2]?.split("/")[0]?.trim();
  return field ? field : null;
}

import type { ExchangeId, FlowKind } from "@/domain";

/** What each kind of counterparty is called on the page, in the order the breakdowns list them. */
export const FLOW_KIND_LABELS: Readonly<Record<FlowKind, string>> = {
  transparent: "Transparent addresses",
  shielded: "Shielded pools",
  mined: "Mining",
  exchange: "Other exchanges",
  bridge: "Bridges",
  "other-labelled": "Other labelled",
  fee: "Fees",
  mixed: "Mixed",
};

/** The same, where a phone row has no room for the long form. */
export const FLOW_KIND_SHORT: Readonly<Record<FlowKind, string>> = {
  ...FLOW_KIND_LABELS,
  transparent: "Transparent",
  "other-labelled": "Other labels",
};

export const FLOW_KIND_ORDER: readonly FlowKind[] = [
  "transparent",
  "shielded",
  "mined",
  "exchange",
  "bridge",
  "other-labelled",
  "fee",
  "mixed",
];

/**
 * Why an exchange's figures leave something out. Gemini takes shielded deposits (its own
 * announcement, 2026-11-24) and has paid shielded withdrawals since 2020, and on chain nothing
 * leaves its labelled wallets into a pool: both go through a shielded wallet no one can see.
 */
export const EXCHANGE_FLOW_TIPS: Partial<Readonly<Record<ExchangeId, string>>> = {
  gemini:
    "Gemini also takes shielded deposits and pays shielded withdrawals through a wallet no one can see, so these figures cover only its transparent wallets.",
};

/**
 * A figure for a phone column: K from 1,000 ZEC (not 10,000, as `formatZecVolumeCompact` does),
 * since four-digit sums with two decimals pushed the tables past a 360 px screen. No ticker: the
 * column says the unit. Callers put the exact amount in a `title`.
 */
export function phoneZec(zat: number): string {
  const zec = Math.abs(zat) / 100_000_000;
  if (zec >= 1_000_000) return `${(zec / 1_000_000).toFixed(2)}M`;
  if (zec >= 1_000) return `${(zec / 1_000).toFixed(1)}K`;
  if (zec >= 1 || zec === 0) {
    return zec.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // Below a coin, three significant digits: a real fee never reads as 0.00.
  return zec.toLocaleString("en-US", { maximumSignificantDigits: 3 });
}

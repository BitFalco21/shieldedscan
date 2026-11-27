import type { ExchangeId } from "@/domain";

/**
 * Each exchange's line on the exchange reserves chart, fixed by exchange so it keeps its colour
 * between ranges and pages. Flow hues, near each exchange's own brand colour where one is free: gold,
 * azure, cyan, violet, then lime, emerald, sky and coral.
 */
export const EXCHANGE_CLASSES: Readonly<Record<ExchangeId, string>> = {
  binance: "flow-1",
  coinbase: "flow-2",
  gemini: "flow-6",
  kraken: "flow-5",
  okx: "flow-7",
  kucoin: "flow-4",
  bitget: "flow-9",
  gate: "flow-8",
};

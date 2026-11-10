import type { ExchangeId } from "@/domain";

/**
 * Each exchange's line on the exchange reserves chart, fixed by exchange so it keeps its colour
 * between ranges and pages. Flow hues, chosen near each exchange's own brand colour: gold, azure,
 * cyan, violet.
 */
export const EXCHANGE_CLASSES: Readonly<Record<ExchangeId, string>> = {
  binance: "flow-1",
  coinbase: "flow-2",
  gemini: "flow-6",
  kraken: "flow-5",
};

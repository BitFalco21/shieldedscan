/**
 * Display names for chain tickers.
 *
 * Purely presentational: the domain carries the ticker, which is what the venues
 * publish and what stays stable. "Arbitrum" reads better than "ARB" in a route, but a
 * ticker is never wrong, so an unlisted chain simply shows its ticker — venues list new
 * chains without warning and the page must not need a code change to render one.
 */
const CHAIN_NAMES: Record<string, string> = {
  ZEC: "Zcash",
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  ARB: "Arbitrum",
  BASE: "Base",
  TRON: "Tron",
  NEAR: "NEAR",
  XRP: "XRP Ledger",
  LTC: "Litecoin",
  DOGE: "Dogecoin",
  DASH: "Dash",
  BCH: "Bitcoin Cash",
  AVAX: "Avalanche",
  BSC: "BNB Chain",
  POL: "Polygon",
  SUI: "Sui",
  TON: "TON",
  APTOS: "Aptos",
  CARDANO: "Cardano",
  STELLAR: "Stellar",
  MAYA: "Maya Protocol",
  THOR: "THORChain",
  UNKNOWN: "Unknown chain",
};

export function chainName(ticker: string): string {
  return CHAIN_NAMES[ticker.toUpperCase()] ?? ticker.toUpperCase();
}

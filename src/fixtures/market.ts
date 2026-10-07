import type { MarketAsset, MarketSnapshot } from "@/domain";

/**
 * Market capitalisations, for the fixture build.
 *
 * Real upstream figures, kept exact rather than rounded:
 *
 *  - The page's subject is a ratio between two of these, so invented figures would give
 *    invented multiples.
 *  - `marketCapUsd` is not `priceUsd * circulatingSupply` in this data, because it is not in
 *    the real data either; the domain's arithmetic is written around that discrepancy.
 *
 * The set exercises every branch of `eligibleAssets`: assets well above Zcash, two just
 * above it, a stablecoin, a tokenised fund, and one asset below.
 */
const asset = (
  id: string,
  symbol: string,
  name: string,
  marketCapUsd: number,
  priceUsd: number,
  circulatingSupply: number,
  rank: number,
  isStablecoin = false,
): MarketAsset => ({
  id,
  symbol,
  name,
  marketCapUsd,
  priceUsd,
  circulatingSupply,
  rank,
  isStablecoin,
});

const zec = asset("zcash", "ZEC", "Zcash", 8_249_897_604, 489.43, 16_871_956.4155448, 15);

const assets: MarketAsset[] = [
  asset("bitcoin", "BTC", "Bitcoin", 1_287_601_924_219, 64_539, 19_951_712, 1),
  asset("ethereum", "ETH", "Ethereum", 230_794_179_539, 1_911.72, 120_707_849, 2),
  asset("tether", "USDT", "Tether", 183_019_246_679, 0.999_74, 183_066_857_281, 3, true),
  asset("binancecoin", "BNB", "BNB", 81_714_339_912, 588.4, 138_874_390, 4),
  asset("ripple", "XRP", "XRP", 63_923_365_463, 1.06, 60_305_062_760, 6),
  asset("solana", "SOL", "Solana", 44_676_207_281, 78.71, 567_555_618, 7),
  asset("tron", "TRX", "TRON", 31_981_106_744, 0.337_6, 94_729_286_324, 8),
  // A tokenised portfolio of home-equity lines of credit: a fund's book, not a valuation.
  // Excluded by name in `domain/market.ts`, and here so the exclusion is exercised.
  asset("figure-heloc", "FIGR_HELOC", "Figure Heloc", 21_983_454_157, 1.038, 21_175_594_037, 9),
  // Present so the HYPE mark is exercised locally and by the e2e sweep.
  asset("hyperliquid", "HYPE", "Hyperliquid", 12_384_806_917, 55.68, 222_445_714.07, 10),
  asset("dogecoin", "DOGE", "Dogecoin", 11_177_356_889, 0.074_3, 150_435_487_288, 11),
  // Just above Zcash, and both deliberately kept: freely traded at a market-set price.
  asset("rain", "RAIN", "Rain", 9_239_573_905, 0.012_895_2, 716_577_603_732, 13),
  asset("leo-token", "LEO", "LEO Token", 8_380_845_094, 9.11, 919_993_733.9, 14),
  // Below Zcash — the case a stale `?vs=monero` link lands on.
  asset("monero", "XMR", "Monero", 7_494_212_005, 399.06, 18_479_461, 16),
];

/** A snapshot dated at import time, so the page's "as of" is never rendered as stale. */
export function getMarketSnapshot(): MarketSnapshot {
  return { asOf: Math.floor(Date.now() / 1000), zec, assets };
}

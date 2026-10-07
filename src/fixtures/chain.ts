import type { ChainInfo } from "@/domain";
import { TIP_HEIGHT, TIP_TIME, hex64 } from "./ids";

export const chainInfo: ChainInfo = {
  height: TIP_HEIGHT,
  bestBlockHash: hex64(`b${TIP_HEIGHT}`),
  lastBlockTimestamp: TIP_TIME,
  circulatingSupplyZat: 1_680_000_000_000_000, // ~16.8M ZEC
  txCount24h: 8241,
  fullyShieldedPct24h: 61,
  priceUsd: 38.42,
  priceChange24hPct: 4.7,
};

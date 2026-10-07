import type { MarketAsset } from "@/domain";
import { ChainLogo } from "@/components/ChainLogo";

export interface AssetLabelProps {
  asset: MarketAsset;
  emphasis?: "normal" | "strong";
}

/**
 * An asset's mark and its ticker — the one way an asset is named on this page.
 *
 * The ticker, not the name: CoinGecko's `name` is the project ("Hyperliquid") while the thing
 * valued is the token (HYPE). The full name travels in `title`, and the page's prose still
 * uses it. Shared by the picker and the headline so the control and the figure it drives
 * cannot name an asset differently.
 */
export function AssetLabel({ asset, emphasis }: AssetLabelProps) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={asset.name}>
      {/*
       * The upstream's ID is the fallback, and it earns its place: several assets are filed
       * in `brand-marks.ts` under a chain name rather than a ticker, so TRX misses while
       * "tron" hits. A lettermark where a real mark exists is how a present logo looks absent.
       */}
      <ChainLogo
        chain={asset.symbol}
        fallbackChain={asset.id}
        {...(emphasis ? { emphasis } : {})}
      />
      {asset.symbol}
    </span>
  );
}

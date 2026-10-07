import type { CrossChainVolumeSide } from "@/domain";
import { formatUsdCompact } from "@/lib/format";

/**
 * Swap-time dollars, compact, with `≥` whenever some swap carried no venue price: the figure is
 * then a floor within the public-venue floor, and the sign is part of the number.
 */
export function formatUsdAtSwap(side: CrossChainVolumeSide): string {
  const floor = side.usdCoveredTransfers < side.transfers;
  return `${floor ? "≥ " : ""}${formatUsdCompact(side.usdAtSwap)}`;
}

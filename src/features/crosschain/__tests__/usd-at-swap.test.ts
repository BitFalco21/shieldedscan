import { describe, expect, it } from "vitest";
import { formatUsdCompact } from "@/lib/format";
import { formatUsdAtSwap } from "../usd-at-swap";

const side = { transfers: 4, zecAmountZat: 1, usdAtSwap: 12_345_678, usdCoveredTransfers: 4 };

describe("formatUsdAtSwap", () => {
  it("prints the dollars alone when every swap was priced", () => {
    expect(formatUsdAtSwap(side)).toBe(formatUsdCompact(12_345_678));
  });

  it("marks the figure a floor when some swap carried no price", () => {
    expect(formatUsdAtSwap({ ...side, usdCoveredTransfers: 3 })).toBe(
      `≥ ${formatUsdCompact(12_345_678)}`,
    );
  });
});

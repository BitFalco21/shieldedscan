import { describe, expect, it } from "vitest";
import type { CrossChainDirection, CrossChainFlow, CrossChainTransfer } from "../crosschain";
import {
  ZCASH_CHAIN,
  chainFilterOptions,
  matchesCrossChainFilters,
  transferChainSide,
} from "../crosschain";
import {
  CROSSCHAIN_MIN_USD_FILTERS,
  minUsdFilterLabel,
  parseChainFilter,
  parseMinUsdFilter,
  serializeChainFilter,
} from "../list";

function transfer(over: Partial<CrossChainTransfer> = {}): CrossChainTransfer {
  return {
    id: "maya-1",
    direction: "in",
    protocol: "maya",
    counterpartChain: "BTC",
    counterpartAsset: "BTC",
    counterpartAmount: 1,
    counterpartIsSynthetic: false,
    counterpartTxHash: null,
    counterpartAddress: null,
    zcashTxid: null,
    zcashAddress: null,
    zecAmountZat: 100,
    usdValueAtSwap: null,
    counterpartUsdAtSwap: null,
    venueDepositAddress: null,
    status: "completed",
    timestamp: 1_700_000_000,
    ...over,
  };
}

/**
 * A flow row with the swap-time USD terms defaulted to their unmeasured state (a zero covered
 * count means "no price published", not "$0 crossed").
 */
const flow = (
  chain: string,
  direction: CrossChainDirection,
  transfers: number,
  zecAmountZat: number,
): CrossChainFlow => ({
  chain,
  direction,
  transfers,
  zecAmountZat,
  usdAtSwap: 0,
  usdCoveredTransfers: 0,
});

const flows: CrossChainFlow[] = [
  flow("BTC", "in", 10, 900),
  flow("ETH", "in", 20, 400),
  flow("SOL", "out", 5, 500),
  flow("TRON", "out", 5, 100),
];

describe("parseChainFilter", () => {
  it("empty and absent both mean every chain", () => {
    expect(parseChainFilter(undefined)).toEqual([]);
    expect(parseChainFilter("")).toEqual([]);
  });

  it("uppercases, trims, dedupes and sorts, so one selection has one URL", () => {
    expect(parseChainFilter("eth, btc ,ETH")).toEqual(["BTC", "ETH"]);
    // …and therefore one CDN cache key per selection.
    expect(parseChainFilter("btc,eth")).toEqual(parseChainFilter("ETH,BTC"));
  });

  it("drops malformed tokens without discarding the well-formed ones beside them", () => {
    expect(parseChainFilter("BTC, ,ET H,'; DROP TABLE,ETH")).toEqual(["BTC", "ETH"]);
  });

  it("keeps a well-formed chain we hold no rows for", () => {
    // The chain set is open (venues add chains), so a well-formed unknown ticker is kept and
    // yields an empty page; coercing it to "all" would show the rows the reader excluded.
    expect(parseChainFilter("NOTACHAIN")).toEqual(["NOTACHAIN"]);
  });

  it("accepts the shapes venue parsers actually emit", () => {
    expect(parseChainFilter("cardano,starknet,near,unknown")).toEqual([
      "CARDANO",
      "NEAR",
      "STARKNET",
      "UNKNOWN",
    ]);
  });

  it("caps how many chains one side may name", () => {
    const many = Array.from({ length: 40 }, (_, i) => `C${i}`).join(",");
    expect(parseChainFilter(many).length).toBeLessThanOrEqual(16);
  });

  it("round-trips through serializeChainFilter", () => {
    expect(parseChainFilter(serializeChainFilter(["ETH", "BTC"]))).toEqual(["BTC", "ETH"]);
    expect(serializeChainFilter([])).toBe("");
  });
});

describe("transferChainSide", () => {
  it("puts the counterpart at the source of an inbound transfer", () => {
    const t = transfer({ direction: "in", counterpartChain: "BTC" });
    expect(transferChainSide(t, "source")).toBe("BTC");
    expect(transferChainSide(t, "destination")).toBe(ZCASH_CHAIN);
  });

  it("and at the destination of an outbound one", () => {
    const t = transfer({ direction: "out", counterpartChain: "SOL" });
    expect(transferChainSide(t, "source")).toBe(ZCASH_CHAIN);
    expect(transferChainSide(t, "destination")).toBe("SOL");
  });
});

describe("matchesCrossChainFilters", () => {
  const inbound = transfer({ direction: "in", counterpartChain: "BTC", protocol: "maya" });
  const outbound = transfer({
    id: "ni-1",
    direction: "out",
    counterpartChain: "SOL",
    protocol: "near-intents",
  });

  it("an empty narrowing matches everything", () => {
    expect(matchesCrossChainFilters(inbound, {})).toBe(true);
    expect(matchesCrossChainFilters(outbound, {})).toBe(true);
  });

  it("a source set matches the chain at the source end", () => {
    expect(matchesCrossChainFilters(inbound, { sourceChains: ["BTC"] })).toBe(true);
    expect(matchesCrossChainFilters(outbound, { sourceChains: ["BTC"] })).toBe(false);
    // ZEC as a source is every outbound transfer.
    expect(matchesCrossChainFilters(outbound, { sourceChains: [ZCASH_CHAIN] })).toBe(true);
    expect(matchesCrossChainFilters(inbound, { sourceChains: [ZCASH_CHAIN] })).toBe(false);
  });

  it("several chains on one side are an OR", () => {
    expect(matchesCrossChainFilters(inbound, { sourceChains: ["ETH", "BTC"] })).toBe(true);
  });

  it("the two sides AND together", () => {
    expect(
      matchesCrossChainFilters(inbound, {
        sourceChains: ["BTC"],
        destinationChains: [ZCASH_CHAIN],
      }),
    ).toBe(true);
    // Every transfer has Zcash at one end, so a foreign chain on both sides matches nothing.
    expect(
      matchesCrossChainFilters(inbound, { sourceChains: ["BTC"], destinationChains: ["ETH"] }),
    ).toBe(false);
  });

  it("and AND with venue and direction", () => {
    expect(matchesCrossChainFilters(inbound, { protocol: "maya", sourceChains: ["BTC"] })).toBe(
      true,
    );
    expect(
      matchesCrossChainFilters(inbound, { protocol: "near-intents", sourceChains: ["BTC"] }),
    ).toBe(false);
    expect(matchesCrossChainFilters(inbound, { direction: "out", sourceChains: ["BTC"] })).toBe(
      false,
    );
  });
});

describe("chainFilterOptions", () => {
  it("NEVER offers ZEC — the direction chips say which side Zcash is on", () => {
    // A transfer is (direction, counterpart chain); listing ZEC would duplicate a direction
    // and allow selections no row can satisfy.
    for (const direction of ["all", "in", "out"] as const) {
      const { source, destination } = chainFilterOptions(flows, direction);
      expect(source, `source under ${direction}`).not.toContain(ZCASH_CHAIN);
      expect(destination, `destination under ${direction}`).not.toContain(ZCASH_CHAIN);
    }
  });

  it("offers NOTHING until a direction is chosen", () => {
    // A chain filter needs a direction to say which end it filters, so ALL has no menu.
    expect(chainFilterOptions(flows, "all")).toEqual({ source: [], destination: [] });
  });

  it("offers each end's own counterpart chains, largest first", () => {
    expect(chainFilterOptions(flows, "in").source).toEqual(["BTC", "ETH"]);
    expect(chainFilterOptions(flows, "out").destination).toEqual(["SOL", "TRON"]);
  });

  it("offers nothing on a side the direction pins to Zcash", () => {
    // No destination to choose on an inbound transfer, so no control at all.
    expect(chainFilterOptions(flows, "in").destination).toEqual([]);
    expect(chainFilterOptions(flows, "out").source).toEqual([]);
  });

  it("still offers the counterpart side once a direction is chosen", () => {
    expect(chainFilterOptions(flows, "in").source).toEqual(["BTC", "ETH"]);
    expect(chainFilterOptions(flows, "out").destination).toEqual(["SOL", "TRON"]);
  });

  it("offers nothing when the chain list could not be read", () => {
    // An unreadable list costs the menus and nothing else; the page still lists transfers.
    expect(chainFilterOptions([], "all")).toEqual({ source: [], destination: [] });
    expect(chainFilterOptions([], "in").source).toEqual([]);
  });
});

describe("parseMinUsdFilter", () => {
  it("keeps a usable threshold, preset or not", () => {
    // The UI offers presets; the URL accepts any amount.
    expect(parseMinUsdFilter("100000")).toBe(100_000);
    expect(parseMinUsdFilter("250000")).toBe(250_000);
    expect(parseMinUsdFilter("12.5")).toBe(12.5);
  });

  it("treats anything that is not a usable threshold as no filter at all", () => {
    // Unlike a chain ticker, a malformed number has no honest interpretation, so it means "all".
    for (const bad of [undefined, "", "abc", "-5", "0", "NaN", "Infinity", "1e400"]) {
      expect(parseMinUsdFilter(bad), `${String(bad)} should mean "all"`).toBeNull();
    }
  });

  it("refuses an absurd ceiling rather than passing it to Postgres", () => {
    expect(parseMinUsdFilter("1e13")).toBeNull();
    // ...but the largest crossing ever observed, $13.2M, is comfortably inside it.
    expect(parseMinUsdFilter("13174399")).toBe(13_174_399);
  });
});

describe("minUsdFilterLabel", () => {
  it("is short enough for a chip at every preset", () => {
    expect(CROSSCHAIN_MIN_USD_FILTERS.map(minUsdFilterLabel)).toEqual([
      "ALL",
      "\u2265 $10K",
      "\u2265 $100K",
      "\u2265 $1M",
    ]);
    for (const label of CROSSCHAIN_MIN_USD_FILTERS.map(minUsdFilterLabel)) {
      expect(label.length).toBeLessThanOrEqual(8);
    }
  });
});

describe("the minimum-value filter, in matchesCrossChainFilters", () => {
  const worth = (usd: number | null) => transfer({ usdValueAtSwap: usd });

  it("keeps a transfer at or above the threshold", () => {
    expect(matchesCrossChainFilters(worth(100_000), { minUsdAtSwap: 100_000 })).toBe(true);
    expect(matchesCrossChainFilters(worth(100_001), { minUsdAtSwap: 100_000 })).toBe(true);
    expect(matchesCrossChainFilters(worth(99_999), { minUsdAtSwap: 100_000 })).toBe(false);
  });

  it("EXCLUDES a transfer whose value was never published", () => {
    // A row of unknown value never clears a threshold.
    expect(matchesCrossChainFilters(worth(null), { minUsdAtSwap: 100_000 })).toBe(false);
    // ...and is untouched when no threshold is asked for.
    expect(matchesCrossChainFilters(worth(null), {})).toBe(true);
  });

  it("a ZEC floor compares the chain's own amount, and excludes nothing for want of a price", () => {
    // A floor in ZEC, independent of price data.
    const t = transfer({ zecAmountZat: 5_000_00000000, usdValueAtSwap: null });
    expect(matchesCrossChainFilters(t, { minZecZat: 5_000_00000000 })).toBe(true);
    expect(matchesCrossChainFilters(t, { minZecZat: 5_000_00000001 })).toBe(false);
    // Unpriced rows survive a ZEC floor — the amount is exact on every row.
    expect(matchesCrossChainFilters(t, { minZecZat: 1 })).toBe(true);
    // ...and the two floors AND together rather than either standing in for the other.
    expect(matchesCrossChainFilters(t, { minZecZat: 1, minUsdAtSwap: 1 })).toBe(false);
  });

  it("ANDs with every other filter", () => {
    const t = transfer({ direction: "in", counterpartChain: "BTC", usdValueAtSwap: 500_000 });
    expect(matchesCrossChainFilters(t, { sourceChains: ["BTC"], minUsdAtSwap: 100_000 })).toBe(
      true,
    );
    expect(matchesCrossChainFilters(t, { sourceChains: ["ETH"], minUsdAtSwap: 100_000 })).toBe(
      false,
    );
    expect(matchesCrossChainFilters(t, { direction: "out", minUsdAtSwap: 100_000 })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { MarketAsset } from "@/domain";
import { compareToZec, eligibleAssets } from "@/domain";
import { getMarketSnapshot } from "@/fixtures/market";
import { compareCardFacts, compareCardMark } from "../compare-card-facts";

/**
 * What the compare share card prints, and which mark each side draws.
 *
 * The mark rule is the one worth a test: a real silhouette is drawn ONLY where both its path
 * and its colour are known, because a path in a guessed colour is an inaccurate logo, and the
 * site's own rule is that an honest initial beats one of those.
 */
const snapshot = getMarketSnapshot();
const byId = (id: string): MarketAsset => snapshot.assets.find((a) => a.id === id)!;

describe("compareCardFacts", () => {
  it("prints the same figures the page does, and the read time", () => {
    const facts = compareCardFacts(snapshot, compareToZec(snapshot.zec, byId("bitcoin"))!);

    expect(facts.impliedPrice).toBe("$76,387.74");
    expect(facts.multiple).toBe("156.07x");
    expect(facts.zec.marketCap).toBe("$8.25B");
    expect(facts.other.marketCap).toBe("$1.29T");
    expect(facts.other.ticker).toBe("BTC · RANK 1");
    expect(facts.source).toMatch(/^CoinGecko · \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    // The subset font has no "#" and no apostrophe; neither may appear on the card.
    for (const s of [facts.zec.ticker, facts.other.ticker, facts.source, facts.url]) {
      expect(s).not.toMatch(/[#']/);
    }
  });

  it("draws every fixture asset as a real mark — none falls back to a letter", () => {
    // The fixture set mirrors what production offers, so a lettermark here means an asset
    // whose card ships with an initial; add its colour to OG_BRAND_COLORS.
    for (const asset of [snapshot.zec, ...eligibleAssets(snapshot)]) {
      expect(compareCardMark(asset).kind, `${asset.symbol} has no card mark`).toBe("mark");
    }
  });

  it("resolves an aliased ticker to the colour its silhouette is filed under", () => {
    // BNB's mark is filed as BSC, and so is its colour class.
    const mark = compareCardMark(byId("binancecoin"));
    expect(mark).toMatchObject({ kind: "mark", color: "#f0b90b" });
  });

  it("draws a lettermark for an asset with no known mark or colour, never a guessed colour", () => {
    const unknown: MarketAsset = { ...byId("bitcoin"), id: "nothing-here", symbol: "NOPE" };
    expect(compareCardMark(unknown)).toEqual({ kind: "letter", letter: "N" });
  });
});

import { describe, expect, it } from "vitest";

import { WRAPPED_ZEC, countsTowardTotals, wrappedToken } from "../wrapped-zec";

describe("the list of ZEC on other chains", () => {
  it("has unique ids and unique contracts per chain", () => {
    const ids = WRAPPED_ZEC.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = WRAPPED_ZEC.map((t) => `${t.chain}:${t.contract.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("points every locked backing at a listed, counted token", () => {
    for (const t of WRAPPED_ZEC) {
      if (t.backing.kind !== "locked") continue;
      const below = wrappedToken(t.backing.tokenId);
      expect(below, t.id).toBeDefined();
      expect(countsTowardTotals(below!), t.id).toBe(true);
      expect(below!.id).not.toBe(t.id);
    }
  });

  it("never counts a token that only carries the name", () => {
    // A token calling itself ZEC on Base with a supply of 1,000,000,000.
    const impostor = WRAPPED_ZEC.find(
      (t) => t.contract === "0xC844f1ED61ff576cccb344F2197bdfE9b8431D2C",
    );
    expect(impostor?.status).toBe("excluded");
    expect(countsTowardTotals(impostor!)).toBe(false);
    // The Robinhood-chain "Zcash" token is a fund holding stablecoins, not ZEC.
    expect(wrappedToken("robinhood-zcash-fund")?.status).toBe("excluded");
  });

  it("keeps Binance's own BSC token apart from the Omni token on BSC", () => {
    expect(wrappedToken("bsc-binance-peg")?.contract).not.toBe(wrappedToken("bsc-omni")?.contract);
    expect(wrappedToken("bsc-binance-peg")?.status).toBe("custodial");
    expect(wrappedToken("bsc-omni")?.backing).toEqual({
      kind: "locked",
      tokenId: "near-omni",
      account: "omni.bridge.near",
    });
  });

  it("dates every entry and names its evidence", () => {
    for (const t of WRAPPED_ZEC) {
      expect(t.verifiedOn, t.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.evidence.length, t.id).toBeGreaterThan(5);
      expect(t.decimals, t.id).toBeGreaterThanOrEqual(0);
      expect(t.decimals, t.id).toBeLessThanOrEqual(18);
    }
  });
});

import { describe, expect, it } from "vitest";
import { memoDestination, memoTargetAsset } from "../memo";
import { parseMidgardActions } from "../midgard";
import { describeMidgardAsset } from "../venues";
import fixture from "../__fixtures__/thorchain-actions.json";

/**
 * A real THORChain Midgard response: two `addLiquidity` actions, the pool's first swap
 * (0.01 ZEC → ETH), two ZEC → RUNE swaps carrying two affiliate fees, and a BTC → ZEC swap
 * still pending. The ETH swap's Zcash leg is block 3,503,592, paying THORChain's vault with
 * an OP_RETURN memo.
 */
describe("THORChain's first ZEC swaps", () => {
  const transfers = parseMidgardActions(fixture, "thorchain");
  const byId = (id: string) => {
    const t = transfers.find((x) => x.id === `thorchain-${id}`);
    if (!t) throw new Error(`${id} did not parse`);
    return t;
  };

  it("keeps the three settled swaps, skips the pending inbound and both liquidity actions", () => {
    // The pending BTC → ZEC swap has no ZEC leg yet; it parses once it settles, under the
    // same id (its BTC deposit txid), so it lands as one row rather than two.
    expect(transfers).toHaveLength(3);
  });

  it("names the user's payout, not an affiliate leg Midgard left unflagged", () => {
    // Memo `=:r:thor1xp3q…:…:ns/ej:20/1` — two affiliates. Midgard flags the `ns` leg only, so
    // the `ej` leg (0.00017284 RUNE) must not be taken as the counterparty.
    const rune = byId("e03db858c6f07a9fb758b58e6bd9105286710c14c3eb74e12dda13872e5668c9");
    expect(rune.counterpartAsset).toBe("RUNE");
    expect(rune.counterpartAmount).toBe(1.72472281);
    expect(rune.counterpartAddress).toBe("thor1xp3q07akccpd7dukns8l9wy6e4ty47az7cseg6");
  });

  it("parses the ETH swap through the shared Midgard parser exactly", () => {
    expect(byId("d35549ca7cb5fa7974bb1c07ba4206c9f808ec43b9aad6db896b6d3bcb168a7c")).toEqual({
      id: "thorchain-d35549ca7cb5fa7974bb1c07ba4206c9f808ec43b9aad6db896b6d3bcb168a7c",
      direction: "out",
      protocol: "thorchain",
      counterpartChain: "ETH",
      counterpartAsset: "ETH",
      counterpartIsSynthetic: false,
      counterpartAmount: 0.00380983,
      counterpartTxHash: "6a8abe8bb3b5fb0d5e66a674cad6b0a2382ca58273ffe879de08a244072d4ffb",
      counterpartAddress: "0x5f9ee08962c216941b2aa25d7295d5eb0089abc5",
      venueDepositAddress: null,
      zcashTxid: "d35549ca7cb5fa7974bb1c07ba4206c9f808ec43b9aad6db896b6d3bcb168a7c",
      zcashAddress: "t1TcUwWriUbS4ddDXruXd7ma9yvqTqj3qNt",
      zecAmountZat: 1_000_000,
      usdValueAtSwap: 0.01 * 1078.4684262475346,
      counterpartUsdAtSwap: 0.00380983 * 2754.545574460293,
      status: "completed",
      timestamp: 1790933358,
    });
  });
});

describe("THORChain's wrapped asset kinds", () => {
  // thornode `NewAsset` decides the kind by the FIRST of `~ . / -`.
  it("reads a trade-account asset as a claim held on THOR", () => {
    expect(describeMidgardAsset("BTC~BTC", "thorchain")).toEqual({
      chain: "THOR",
      symbol: "BTC",
      synthetic: true,
    });
  });

  it("reads a secured asset as a claim held on THOR", () => {
    expect(describeMidgardAsset("ETH-ETH", "thorchain")).toEqual({
      chain: "THOR",
      symbol: "ETH",
      synthetic: true,
    });
  });

  it("still reads a layer-1 token whose symbol carries a dash as layer-1", () => {
    // The `.` comes first, so the dash belongs to the contract suffix.
    expect(
      describeMidgardAsset("ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48", "thorchain"),
    ).toEqual({ chain: "ETH", symbol: "USDC", synthetic: false });
  });

  it("strips the contract suffix from a wrapped token too", () => {
    expect(describeMidgardAsset("ETH~USDC-0XA0B8", "thorchain").symbol).toBe("USDC");
  });

  it("leaves Maya's synth spelling unchanged", () => {
    expect(describeMidgardAsset("ZEC/ZEC", "maya")).toEqual({
      chain: "MAYA",
      symbol: "ZEC",
      synthetic: true,
    });
  });
});

describe("THORChain memo shorthand, from thornode `Asset.ShortCode()`", () => {
  it.each([
    ["o", "SOL.SOL"],
    ["x", "XRP.XRP"],
    ["f", "BASE.ETH"],
    ["tr", "TRON.TRX"],
    ["ta", "TAO.TAO"],
    ["do", "DOT.DOT"],
    ["ad", "ADA.ADA"],
    ["m", "XMR.XMR"],
  ])("resolves %s to %s", (code, asset) => {
    expect(memoTargetAsset(`=:${code}:addr:0/1/0`, "thorchain")).toBe(asset);
  });

  it("no longer resolves `n` — the BNB Beacon Chain was retired", () => {
    expect(memoTargetAsset("=:n:bnb1x:0/1/0", "thorchain")).toBeNull();
  });

  it("accepts a wrapped full-form target", () => {
    expect(memoTargetAsset("=:BTC~BTC:thor1x", "thorchain")).toBe("BTC~BTC");
  });

  it("refuses a wrapped ZEC target — it names the Zcash side, not a counterparty", () => {
    expect(memoTargetAsset("=:ZEC~ZEC:thor1x", "thorchain")).toBeNull();
  });
});

describe("memoDestination", () => {
  it("reads field [2] and drops a trailing refund address", () => {
    expect(memoDestination("=:e:0x5f9Ee08962C216941B2aa25d7295D5EB0089aBc5:377179/1/1")).toBe(
      "0x5f9Ee08962C216941B2aa25d7295D5EB0089aBc5",
    );
    expect(memoDestination("=:b:bc1qdest/bc1qrefund:0")).toBe("bc1qdest");
  });

  it("is null when the memo carries no destination", () => {
    expect(memoDestination(undefined)).toBeNull();
    expect(memoDestination("=:b")).toBeNull();
  });
});

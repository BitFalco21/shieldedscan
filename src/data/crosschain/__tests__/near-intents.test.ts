import { describe, expect, it } from "vitest";
import { classifyZcashAddress } from "@/domain";
import {
  chainFromIntentsAsset,
  parseIntentsTransactions,
  symbolFromIntentsAsset,
} from "../near-intents";
import fixture from "../__fixtures__/near-intents.json";

/**
 * A real capture from the NEAR Intents explorer API — three transfers per direction.
 *
 * out[0] ZEC→TRON, `senders` empty (only the deposit address is known)
 * out[1] ZEC→ETH,  `senders` carries the user's real t1
 * out[2] ZEC→ETH,  same sender, larger amount
 * in[0]  ZEC→ZEC internal (origin `1cs_v1:near:nep141:zec.omft.near`) — must be rejected
 * in[1]  ARB(USDC)→ZEC, delivered to a UNIFIED address
 * in[2]  TRON(USDT)→ZEC, delivered to a t1
 */
const outbound = parseIntentsTransactions(fixture.out);
const inbound = parseIntentsTransactions(fixture.in);

describe("asset id parsing", () => {
  it("reads the chain out of the asset id", () => {
    expect(chainFromIntentsAsset("nep141:zec.omft.near")).toBe("ZEC");
    expect(chainFromIntentsAsset("nep141:eth-0xa0b8.omft.near")).toBe("ETH");
    expect(chainFromIntentsAsset("nep141:wrap.near")).toBe("NEAR");
  });

  describe("REGRESSION: multi-prefix asset ids", () => {
    it("strips every namespace, not just the first", () => {
      // Taking segment [1] would yield "near" here, turning a ZEC→ZEC internal transfer into an
      // invented inbound transfer from NEAR.
      expect(chainFromIntentsAsset("1cs_v1:near:nep141:zec.omft.near")).toBe("ZEC");
      expect(symbolFromIntentsAsset("1cs_v1:near:nep141:zec.omft.near")).toBe("ZEC");
    });
  });

  it("recovers a symbol only for native assets, never guessing from a contract", () => {
    expect(symbolFromIntentsAsset("nep141:btc.omft.near")).toBe("BTC");
    expect(symbolFromIntentsAsset("nep141:wrap.near")).toBe("NEAR");
    expect(symbolFromIntentsAsset("nep141:eth-0xa0b8.omft.near")).toBeNull();
  });
});

describe("parseIntentsTransactions, against the live capture", () => {
  it("direction is relative to Zcash", () => {
    expect(outbound.map((t) => t.direction)).toEqual(["out", "out", "out"]);
    expect(inbound.map((t) => t.direction)).toEqual(["in", "in"]);
  });

  describe("REGRESSION: swaps that never touch the Zcash chain", () => {
    // Intents settles some swaps entirely in its own ledger — the user already holds
    // nep141:zec.omft.near. Those rows differ from real transfers only in
    // depositType/recipientType.
    const [outRow] = fixture.out;

    it("drops an outbound swap whose deposit never came from Zcash", () => {
      const internal = {
        ...outRow,
        depositType: "INTENTS",
        recipientType: "INTENTS",
        depositAddress: "d1ec8b8118a8bce9649c5734eef1935b1e5bcc2ff7b54b764ea6ce0a58f7e827",
        senders: ["d1ec8b8118a8bce9649c5734eef1935b1e5bcc2ff7b54b764ea6ce0a58f7e827"],
        originChainTxHashes: [],
      };
      expect(parseIntentsTransactions([internal])).toEqual([]);
    });

    it("drops an inbound swap whose ZEC was never delivered on-chain", () => {
      const [inRow] = fixture.in.slice(1);
      const internal = { ...inRow, recipientType: "INTENTS", destinationChainTxHashes: [] };
      expect(parseIntentsTransactions([internal])).toEqual([]);
    });

    it("falls back to the tx hash if the venue renames the field", () => {
      // A schema change should degrade to the older heuristic, not silently drop
      // every row — a real on-chain leg always publishes a hash.
      const renamed = { ...outRow, depositType: undefined, recipientType: undefined };
      expect(parseIntentsTransactions([renamed])).toHaveLength(1);

      const renamedInternal = { ...renamed, originChainTxHashes: [] };
      expect(parseIntentsTransactions([renamedInternal])).toEqual([]);
    });

    it("never puts a foreign chain's account id in zcashAddress", () => {
      const foreignSender = {
        ...outRow,
        senders: ["d1ec8b8118a8bce9649c5734eef1935b1e5bcc2ff7b54b764ea6ce0a58f7e827"],
      };
      // Falls through to the deposit address, which is a real t1.
      expect(parseIntentsTransactions([foreignSender])[0]?.zcashAddress).toBe(
        "t1UVgiau7pks5hLESobUP2a5DE1Fhba4NVc",
      );

      const bothForeign = { ...foreignSender, depositAddress: "somebody.near" };
      expect(parseIntentsTransactions([bothForeign])[0]?.zcashAddress).toBeNull();
    });
  });

  it("rejects the ZEC→ZEC internal transfer — it crosses no boundary", () => {
    expect(fixture.in).toHaveLength(3);
    expect(inbound).toHaveLength(2);
    expect(inbound.map((t) => t.counterpartChain)).toEqual(["ARB", "TRON"]);
  });

  describe("amounts", () => {
    it("takes the ZEC leg from the raw integer, which is already zatoshis", () => {
      expect(outbound[0]?.zecAmountZat).toBe(2_000_000); // "0.02"
      expect(outbound[2]?.zecAmountZat).toBe(33_425_827);
      for (const t of [...outbound, ...inbound]) {
        expect(Number.isInteger(t.zecAmountZat)).toBe(true);
      }
    });

    it("prefers the settled raw amount over the quoted *Formatted string", () => {
      // in[1]: amountOut 38189102 vs amountOutFormatted "0.38205714" — they disagree by
      // 16,612 zat. amountOutUsd divides out to $497.26 against the raw figure and
      // $497.04 against the formatted one; the raw value matches the price implied by
      // the outbound rows, so it is the one that settled.
      expect(inbound[0]?.zecAmountZat).toBe(38_189_102);
      expect(inbound[1]?.zecAmountZat).toBe(29_929_045);
    });

    it("takes the counter leg from *Formatted — its raw value is native decimals", () => {
      // ETH's raw amountOut is 1e18-scaled, unlike Midgard's universal 1e8. Dividing it
      // by 1e8 would overstate the counter amount by ten orders of magnitude.
      expect(outbound[1]?.counterpartAmount).toBeCloseTo(0.004095079965594884, 12);
      expect(inbound[1]?.counterpartAmount).toBe(150);
    });

    it("keeps createdAtTimestamp as unix seconds", () => {
      expect(outbound[0]?.timestamp).toBe(1785144012);
    });
  });

  it("takes the USD value from the ZEC leg", () => {
    expect(outbound[0]?.usdValueAtSwap).toBeCloseTo(9.9654, 4);
    expect(inbound[0]?.usdValueAtSwap).toBeCloseTo(189.899, 3);
  });

  describe("asset symbols", () => {
    it("names native assets from the id", () => {
      expect(outbound[0]?.counterpartAsset).toBe("TRON"); // native tron.omft.near
    });

    it("resolves known contracts, so stablecoins are not hidden as '<CHAIN> asset'", () => {
      // arb-0xaf88… is canonical USDC, corroborated by the venue's own $1.00 valuation.
      expect(inbound[0]?.counterpartAsset).toBe("USDC");
      expect(
        symbolFromIntentsAsset("nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near"),
      ).toBe("USDT");
      expect(
        symbolFromIntentsAsset("nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"),
      ).toBe("USDC");
    });

    it("keeps the honest fallback for an unlisted contract", () => {
      expect(symbolFromIntentsAsset("nep141:eth-0xdeadbeef.omft.near")).toBeNull();
    });
  });

  describe("REGRESSION: the 1cs_v1 native asset shape", () => {
    it("reads 1cs_v1:btc:native:coin as native BTC, not NEAR", () => {
      // Taking the last colon segment would yield "coin" and mislabel native BTC as a NEAR asset.
      expect(chainFromIntentsAsset("1cs_v1:btc:native:coin")).toBe("BTC");
      expect(symbolFromIntentsAsset("1cs_v1:btc:native:coin")).toBe("BTC");
    });

    it("still unwraps the nested nep141 form", () => {
      expect(chainFromIntentsAsset("1cs_v1:near:nep141:zec.omft.near")).toBe("ZEC");
    });
  });

  describe("the Zcash boundary address", () => {
    it("prefers the real sender over the protocol's ephemeral deposit address", () => {
      expect(outbound[1]?.zcashAddress).toBe("t1Td5YSm644g7Y64wtdaQgF3SASeX8EvmSE");
    });

    it("falls back to the deposit address when the venue publishes no sender", () => {
      // out[0] has `senders: []`. Still a real Zcash address, just not the user's wallet.
      expect(outbound[0]?.zcashAddress).toBe("t1UVgiau7pks5hLESobUP2a5DE1Fhba4NVc");
    });

    it("is the recipient for inbound — and can be unified, on this venue too", () => {
      expect(classifyZcashAddress(inbound[0]?.zcashAddress)).toBe("unified");
      expect(classifyZcashAddress(inbound[1]?.zcashAddress)).toBe("transparent");
    });
  });

  it("maps each chain's txid to the correct side", () => {
    expect(outbound[0]?.zcashTxid).toBe(
      "6d893a4d8808eb56c1851dd5eafd88ada6334b8c20817b92c914b52c1d6a5787",
    );
    expect(outbound[0]?.counterpartTxHash).toBe(
      "349f73edd3584003bccf8060624909dbcf94dbb675d416ec349c59742768f82d",
    );
    expect(inbound[0]?.zcashTxid).toBe(
      "cf352a2244495b81a6800b7602186811c0dbde018349f2b50f137429549abfde",
    );
  });

  describe("identity", () => {
    it("uses the venue's own intent hash, which is base58 and url-safe", () => {
      expect(outbound[0]?.id).toBe("near-intents-7PchQufSJnyoMLSWXFo1DWM6tLZy42KEo3ip3ihzkHWQ");
      for (const t of [...outbound, ...inbound]) expect(t.id).toBe(encodeURIComponent(t.id));
    });

    it("is stable across polls", () => {
      expect(parseIntentsTransactions(fixture.out).map((t) => t.id)).toEqual(
        outbound.map((t) => t.id),
      );
    });

    it("falls back to a hashed triple when no intent hash is published", () => {
      const [row] = fixture.out;
      const withoutHash = { ...row, intentHashes: undefined };
      const [parsed] = parseIntentsTransactions([withoutHash]);
      expect(parsed?.id).toMatch(/^near-intents-[0-9a-f]{16}$/);
    });

    it("distinguishes deposits reusing one address, which the address alone would not", () => {
      const [row] = fixture.out;
      const a = { ...row, intentHashes: undefined };
      const b = { ...row, intentHashes: undefined, createdAtTimestamp: 1785144013 };
      expect(parseIntentsTransactions([a])[0]?.id).not.toBe(parseIntentsTransactions([b])[0]?.id);
    });
  });

  describe("rejection", () => {
    it("drops non-SUCCESS rows and zero amounts", () => {
      const [row] = fixture.out;
      expect(parseIntentsTransactions([{ ...row, status: "PENDING" }])).toEqual([]);
      expect(parseIntentsTransactions([{ ...row, amountIn: "0", amountInFormatted: "0" }])).toEqual(
        [],
      );
    });

    it("returns [] for junk rather than throwing", () => {
      expect(parseIntentsTransactions(null)).toEqual([]);
      expect(parseIntentsTransactions({})).toEqual([]);
      expect(parseIntentsTransactions([null, undefined, 42])).toEqual([]);
    });
  });
});

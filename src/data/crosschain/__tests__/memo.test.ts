import { describe, expect, it } from "vitest";
import { parseMidgardActions } from "../midgard";
import { memoTargetAsset } from "../memo";

/** Asserts a parse produced exactly one row and returns it, so tests index safely. */
function only<T>(rows: T[]): T {
  expect(rows).toHaveLength(1);
  return rows[0] as T;
}

describe("memoTargetAsset", () => {
  it("reads the full-form target asset", () => {
    expect(memoTargetAsset("=:ARB.USDT:0x9Bfc0F4a/u1l5n:1943064799/1/0:hrz_ios:100", "maya")).toBe(
      "ARB.USDT",
    );
    expect(memoTargetAsset("=:BTC.BTC:bc1qr5z:92007/3/0", "maya")).toBe("BTC.BTC");
  });

  describe("REGRESSION: shorthand must not become a chain ticker", () => {
    // Taking memo.split(':')[1] raw would yield "E"/"B"/"C" as fake tickers.
    it("expands single-letter assets", () => {
      expect(memoTargetAsset("=:e:0x09D36eed1DbD/u1kp6c:0/1/0", "maya")).toBe("ETH.ETH");
      expect(memoTargetAsset("=:b:bc1qr5z3xdsvkrvt9ka3:92007/3/0:_/ts:0/0", "maya")).toBe(
        "BTC.BTC",
      );
    });

    it("resolves shorthand per venue — `c` is CACAO on Maya but BCH on THORChain", () => {
      // The Maya action carrying `=:c:maya1kkp8…` pays out MAYA.CACAO.
      expect(memoTargetAsset("=:c:maya1kkp8c0zca889hpe:71943722194049/1/0:dx:0", "maya")).toBe(
        "MAYA.CACAO",
      );
      expect(memoTargetAsset("=:c:qq3k8k9j:0/1/0", "thorchain")).toBe("BCH.BCH");
    });

    it("rejects a ZEC target — that memo describes the Zcash leg, not a counterparty", () => {
      expect(memoTargetAsset("=:z:t1fwZ9Md8brP9zmYD9jY:19925985/1/0:sto:0", "maya")).toBeNull();
      expect(memoTargetAsset("=:ZEC.ZEC:t1fwZ9Md8brP9zmYD9jY", "maya")).toBeNull();
    });

    it("returns null for unrecognised shorthand instead of inventing a chain", () => {
      expect(memoTargetAsset("=:qq:addr:0", "maya")).toBeNull();
      expect(memoTargetAsset("", "maya")).toBeNull();
      expect(memoTargetAsset(undefined, "maya")).toBeNull();
      expect(memoTargetAsset("nocolons", "maya")).toBeNull();
    });
  });
});

describe("the memo fallback inside the parser", () => {
  /** A failed swap: ZEC went in, nothing came back out. Only the memo names the target. */
  function strandedAction(memo: string) {
    return {
      actions: [
        {
          date: "1785084660535005244",
          status: "success",
          type: "swap",
          in: [
            {
              address: "t1RDCnMNpvVMfngtFkEYq38LxD9c7cQHGch",
              coins: [{ amount: "4015371", asset: "ZEC.ZEC" }],
              txID: "AABBCC",
            },
          ],
          out: [],
          metadata: { swap: { inPriceUSD: "497.74", memo } },
        },
      ],
    };
  }

  it("recovers the counter chain from shorthand rather than dropping the row", () => {
    const swap = only(parseMidgardActions(strandedAction("=:e:0xrecipient:0/1/0"), "maya"));
    expect(swap.counterpartChain).toBe("ETH");
    expect(swap.counterpartAsset).toBe("ETH");
    expect(swap.counterpartAmount).toBeNull();
    expect(swap.counterpartTxHash).toBeNull();
  });

  it("keeps the row as UNKNOWN when the memo cannot be resolved", () => {
    const swap = only(parseMidgardActions(strandedAction("=:zz:addr:0"), "maya"));
    expect(swap.counterpartChain).toBe("UNKNOWN");
    expect(swap.zecAmountZat).toBe(4015371);
  });
});

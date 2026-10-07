import { describe, expect, it } from "vitest";
import { classifyZcashAddress } from "@/domain";
import { parseMidgardActions } from "../midgard";
import fixture from "../__fixtures__/maya-actions.json";

/**
 * Every action in the fixture is a real Maya response, curated to cover one case each.
 * Index order is fixed by the fixture file:
 *
 *   0  out → ARB.USDT, affiliate CACAO leg listed FIRST, full-form memo
 *   1  out → ETH.ETH,  affiliate CACAO leg listed FIRST, shorthand memo "e"
 *   2  in  ← THOR.RUNE (protocol settlement leg), t1 destination
 *   3  in  ← BTC.BTC,  t1 destination
 *   4  in  ← ETH.ETH,  UNIFIED (u1) destination
 *   5  out → MAYA.CACAO only (a genuine ZEC↔CACAO swap)
 *   6  out → BTC.BTC,  no affiliate leg
 *   7  out → BTC.BTC,  STREAMING swap that returned part of the deposit as ZEC
 *   8  out → BTC.BTC,  STREAMING swap whose out[] carries MORE ZEC than was deposited
 */
const swaps = parseMidgardActions(fixture, "maya");

/**
 * Each action's in-side txID — the user's originating deposit, which is the row's
 * identity. For outbound swaps that is also the Zcash txid; for inbound it is the
 * counterparty chain's, and deliberately so (see the identity comment in midgard.ts).
 */
const byIndexTxid = [
  "8be1d08c645dd0260b5a7210e58c037ad5cf5f8492e6cf30b647b3adfbec7e3a",
  "86545589dbff9030ad8e237311bbf61f234029961a599e53598bf6cb2db8184a",
  "12aaf0e8e42d81d6bc95150bbb2b390e2cd8b1d3d84817e32e2789fbb4e986b8",
  "b5af684b95490ffdfbe2cf05fe75b4910089f1b0636b434a7c10d4540be4fcb4",
  "f1b8384577b8f3bac79659bfc7b1dd0e44f33bd69264008d102a264ae592d28c",
  "6a72daaae15e0f02d89afba6e701c97a1f2c4ad948ee6b0cc4b689099d0d9b12",
  "1f3fc06452f82d499ddee6b524e15582030794dd180ae05e7d04ffc1549d0b80",
  "4f76208f7e3b40292fdba8d77093f097042f4f152bb9dc51dbeacd9eebe694da",
  "1e6a97d7e7fc817eaf5e3d5799da0df1fda9ae6a9ca2e9505e2d81cb9b96c980",
];

function nth(i: number) {
  const s = swaps.find((x) => x.id === `maya-${byIndexTxid[i]}`);
  if (!s) throw new Error(`fixture action ${i} did not parse`);
  return s;
}

describe("parseMidgardActions", () => {
  it("parses every action in the fixture", () => {
    expect(swaps).toHaveLength(9);
  });

  /**
   * A ZEC leg in `out[]` is only a refund when it is smaller than the deposit.
   *
   * Midgard merges the out legs of related actions sharing a txid, so a streaming swap can
   * report more ZEC out than went in — here 109.24 against a 74.75 deposit. Subtracting
   * unconditionally makes the amount negative and drops the row as "nothing crossed".
   *
   * More out than in cannot be a refund of this deposit, so the leg is ignored and the deposit
   * stands — the conservative reading, never a crossing larger than what was sent.
   */
  describe("REGRESSION: an out-leg larger than the deposit is not a refund", () => {
    const merged = nth(8);

    it("keeps the deposit rather than going negative and vanishing", () => {
      expect(merged.direction).toBe("out");
      expect(merged.zecAmountZat).toBe(7_474_593_750);
    });

    it("prices it at ZEC's price, not Bitcoin's", () => {
      // inPriceUSD 233.68919065321492.
      expect(merged.usdValueAtSwap).toBeCloseTo(74.7459375 * 233.68919065321492, 2);
    });
  });

  /**
   * A streaming swap returns the part of the deposit it could not fill, in the deposited
   * asset — so a ZEC→BTC swap legitimately has ZEC in `in[]` and in `out[]`.
   *
   * Treating that as inbound would store BTC "arriving on Zcash", carrying the refund as the
   * amount and `outPriceUSD` (Bitcoin's unit price) as the price — a few such rows can
   * dominate a venue's USD volume while each looks plausible alone.
   */
  describe("REGRESSION: a streaming swap's partial refund is not an inbound transfer", () => {
    const streamed = nth(7);

    it("keeps the direction of the swap, not of the refund leg", () => {
      expect(streamed.direction).toBe("out");
      expect(streamed.counterpartChain).toBe("BTC");
    });

    it("counts the ZEC that actually crossed — deposit minus what came back", () => {
      // 529.488 deposited, 205.91102054 returned unswapped to the sender's own u1 address.
      expect(streamed.zecAmountZat).toBe(52_948_800_000 - 20_591_102_054);
    });

    it("prices the ZEC leg at ZEC's price, never the counterparty's", () => {
      // inPriceUSD 523.3523236395265 — ZEC. The bug used outPriceUSD, which is BTC's.
      expect(streamed.usdValueAtSwap).toBeCloseTo(323.57697946 * 523.3523236395265, 2);
      // The shape of the failure, stated as a bound: no row may imply a per-ZEC price
      // anywhere near a Bitcoin one.
      const impliedZecUsd = streamed.usdValueAtSwap! / (streamed.zecAmountZat / 1e8);
      expect(impliedZecUsd).toBeLessThan(10_000);
    });

    it("holds for every row in the fixture, not just this one", () => {
      for (const s of swaps) {
        if (s.usdValueAtSwap === null || s.zecAmountZat === 0) continue;
        expect(s.usdValueAtSwap / (s.zecAmountZat / 1e8), s.id).toBeLessThan(10_000);
      }
    });
  });

  describe("REGRESSION: affiliate legs must not become the counterparty", () => {
    // Maya lists an affiliate MAYA.CACAO payout in out[], often before the real leg. Taking
    // the first non-ZEC leg would yield counterChain "MAYA", which the protocol filter drops.
    it("action 0 resolves to ARB, not MAYA", () => {
      expect(nth(0).counterpartChain).toBe("ARB");
      expect(nth(0).counterpartAsset).toBe("USDT");
    });
    it("action 1 resolves to ETH, not MAYA", () => {
      expect(nth(1).counterpartChain).toBe("ETH");
    });
    it("no outbound swap with a real counter leg is attributed to the protocol", () => {
      const outbound = swaps.filter((s) => s.direction === "out");
      expect(outbound.map((s) => s.counterpartChain)).toEqual(
        expect.arrayContaining(["ARB", "ETH", "BTC"]),
      );
    });
  });

  describe("a genuine swap against the protocol's own asset is still attributed to it", () => {
    it("ZEC→CACAO keeps MAYA rather than falling through to UNKNOWN", () => {
      // Filtering protocol legs is a serve-layer decision, not a parse-layer one:
      // the row is stored faithfully so the choice stays revisitable.
      expect(nth(5).counterpartChain).toBe("MAYA");
      expect(nth(5).direction).toBe("out");
    });
    it("RUNE→ZEC keeps THOR", () => {
      expect(nth(2).counterpartChain).toBe("THOR");
      expect(nth(2).direction).toBe("in");
    });
  });

  describe("direction is relative to Zcash, inverted from Midgard's field names", () => {
    it("ZEC in in[] means ZEC LEFT Zcash", () => {
      expect(nth(0).direction).toBe("out");
      expect(nth(6).direction).toBe("out");
    });
    it("ZEC in out[] means ZEC ARRIVED on Zcash", () => {
      expect(nth(3).direction).toBe("in");
      expect(nth(4).direction).toBe("in");
    });
  });

  describe("units follow the domain, not the source guide", () => {
    it("timestamp is unix SECONDS, from a nanosecond source", () => {
      // date "1785084660535005244" ns -> 1785084660 s. A /1e6 would land in the year 58,000.
      expect(nth(0).timestamp).toBe(1785084660);
      for (const s of swaps) {
        expect(s.timestamp).toBeGreaterThan(1_600_000_000);
        expect(s.timestamp).toBeLessThan(2_000_000_000);
      }
    });
    it("zecAmountZat is zatoshis — Midgard's 1e8 scaling already IS zatoshis", () => {
      expect(nth(0).zecAmountZat).toBe(4015371);
      expect(nth(4).zecAmountZat).toBe(3193282);
      for (const s of swaps) expect(Number.isInteger(s.zecAmountZat)).toBe(true);
    });
    it("counterpartAmount is decimal units of the counter asset", () => {
      expect(nth(0).counterpartAmount).toBeCloseTo(19.587439, 6);
      expect(nth(6).counterpartAmount).toBeCloseTo(0.00094658, 8);
    });
  });

  describe("usdValueAtSwap prices the ZEC leg from the correct side", () => {
    it("outbound uses inPriceUSD (ZEC is the in asset)", () => {
      expect(nth(0).usdValueAtSwap).toBeCloseTo(19.99, 1);
    });
    it("inbound uses outPriceUSD (ZEC is the out asset)", () => {
      // 0.19985947 ZEC x $488.556 = $97.64, corroborated by the RUNE side of the same
      // action (230 RUNE x $0.4268 = $98.2). Using inPriceUSD would report $98 as $0.09.
      expect(nth(2).usdValueAtSwap).toBeCloseTo(97.64, 1);
    });
  });

  describe("the Zcash boundary address", () => {
    it("is the sender for outbound and the recipient for inbound", () => {
      expect(nth(0).zcashAddress).toBe("t1RDCnMNpvVMfngtFkEYq38LxD9c7cQHGch");
      expect(nth(3).zcashAddress).toBe("t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf");
    });
    it("can be a unified address — the shielded-capable case", () => {
      const s = nth(4);
      expect(s.zcashAddress?.startsWith("u1")).toBe(true);
      expect(classifyZcashAddress(s.zcashAddress)).toBe("unified");
    });
  });

  describe("identity and links", () => {
    it("id is url-safe and lowercased", () => {
      expect(nth(0).id).toBe(`maya-${byIndexTxid[0]}`);
      for (const s of swaps) expect(s.id).toBe(encodeURIComponent(s.id));
    });
    it("the Zcash txid is the Zcash-side leg's txID, lowercased", () => {
      expect(nth(0).zcashTxid).toBe(byIndexTxid[0]); // outbound: in-side IS the Zcash leg
      expect(nth(4).zcashTxid).toBe(
        "470c5c79c4cf738d194b3311da8981e3145399df806f7abd754994a244537367",
      );
    });

    it("keeps identity stable while an inbound Zcash payout is still unsettled", () => {
      // The failure this guards: keying on the Zcash leg means an inbound swap is first
      // seen under one hash and later under another, so the upsert stores it twice.
      const settled = fixture.actions[4] as (typeof fixture.actions)[number];
      const unsettled = {
        ...settled,
        out: (settled.out ?? []).map((leg) =>
          (leg.coins ?? []).some((c) => c.asset === "ZEC.ZEC") ? { ...leg, txID: "" } : leg,
        ),
      };
      const [before] = parseMidgardActions({ actions: [unsettled] }, "maya");
      expect(before?.id).toBe(nth(4).id);
      expect(before?.zcashTxid).toBeNull();
    });
    it("counterpartTxHash is the counter leg's txID, null when the venue left it empty", () => {
      expect(nth(0).counterpartTxHash).toMatch(/^881bca58c7fb/);
      expect(nth(5).counterpartTxHash).toBeNull(); // CACAO payout carries no txID
    });
  });

  describe("filtering", () => {
    it("keeps only successful swaps", () => {
      expect(swaps.every((s) => s.status === "completed")).toBe(true);
    });
    it("ignores non-swap action types", () => {
      const root = {
        actions: [{ type: "addLiquidity", status: "success", date: "1785084660000000000" }],
      };
      expect(parseMidgardActions(root, "maya")).toEqual([]);
    });
    it("returns [] for junk rather than throwing", () => {
      expect(parseMidgardActions(null, "maya")).toEqual([]);
      expect(parseMidgardActions({}, "maya")).toEqual([]);
      expect(parseMidgardActions({ actions: "nope" }, "maya")).toEqual([]);
    });
  });

  describe("protocol identity", () => {
    it("tags rows with the venue they came from", () => {
      expect(swaps.every((s) => s.protocol === "maya")).toBe(true);
      expect(parseMidgardActions(fixture, "thorchain").map((s) => s.protocol)).toContain(
        "thorchain",
      );
    });
  });
});

describe("synthetic assets — wrapped ZEC", () => {
  /** A real Maya shape: native ZEC in, synthetic ZEC out to a maya1 address. */
  const wrapAction = {
    actions: [
      {
        date: "1785084660535005244",
        status: "success",
        type: "swap",
        in: [
          {
            address: "t1ggQ7ZgHRoR34Z2xCcF155VcDe5zDZpZF1",
            coins: [{ amount: "500000000", asset: "ZEC.ZEC" }],
            txID: "AA11",
          },
        ],
        out: [
          {
            address: "maya1qvlul0ujfrq27ja7uxrp8r7my9juegz0ul0lxc",
            coins: [{ amount: "499000000", asset: "ZEC/ZEC" }],
            txID: "",
          },
        ],
        metadata: { swap: { inPriceUSD: "497.74" } },
      },
    ],
  };

  it("reads ZEC/ZEC as wrapped ZEC on the venue, not a chain called 'ZEC/ZEC'", () => {
    const [swap] = parseMidgardActions(wrapAction, "maya");
    expect(swap?.counterpartChain).toBe("MAYA");
    expect(swap?.counterpartAsset).toBe("ZEC");
    expect(swap?.counterpartIsSynthetic).toBe(true);
    expect(swap?.direction).toBe("out");
  });

  it("marks a synthetic non-ZEC asset too", () => {
    const btcSynth = JSON.parse(JSON.stringify(wrapAction));
    btcSynth.actions[0].out[0].coins[0].asset = "BTC/BTC";
    const [swap] = parseMidgardActions(btcSynth, "maya");
    expect(swap?.counterpartAsset).toBe("BTC");
    expect(swap?.counterpartIsSynthetic).toBe(true);
  });

  it("leaves layer-1 assets unmarked", () => {
    expect(nth(6).counterpartIsSynthetic).toBe(false);
    expect(nth(6).counterpartChain).toBe("BTC");
  });
});

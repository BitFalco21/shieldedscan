import { describe, expect, it } from "vitest";
import {
  boundaryAmountZat,
  boundaryDirection,
  boundaryIsComplete,
  boundaryKind,
  boundaryPoolLabel,
  boundaryPoolPhrase,
  boundaryPoolsRanked,
  boundaryUsdValue,
  formatBoundaryUsd,
  formatBoundaryZec,
  missingBoundaryFigure,
  SHIELDING_DRYRUN_KIND,
  SHIELDING_KIND,
  UNSHIELDING_DRYRUN_KIND,
  UNSHIELDING_KIND,
  type BoundaryFigures,
} from "../boundary";

/** Real mainnet crossings, not invented figures. */

/** Block 3,456,631 — the largest shielding of its fortnight, Ironwood only. */
const SHIELD: BoundaryFigures = {
  txid: "97d9e97db08967319516f224ef66c5618bab465d13d3327f5a942154b6b89338",
  blockHeight: 3_456_631,
  timestamp: 1_787_393_919,
  pools: [{ pool: "ironwood", valueBalanceZat: 6_938_583_540_000 }],
  priceUsd: 804.5431518554688,
};

/** Block 3,427,165 — the largest unshielding of its quarter, and it left ORCHARD. */
const UNSHIELD: BoundaryFigures = {
  txid: "9d4e72e5000d2dd4d9039b8f525c28a84eb04c84734ae610d23cf8b4e168a1aa",
  blockHeight: 3_427_165,
  timestamp: 1_785_173_010,
  pools: [{ pool: "orchard", valueBalanceZat: -6_942_069_475_000 }],
  priceUsd: 476.6684875488281,
};

/** Block 3,367,633 — two pools at once, ~1.8% of postable events. */
const TWO_POOL: BoundaryFigures = {
  txid: "d860bc0f19e7d14cac8f038b5fcab374253ba028de5aa97df14a15f8830d661f",
  blockHeight: 3_367_633,
  timestamp: 1_780_000_000,
  pools: [
    // Deliberately smallest-first, so anything asserting an order has to sort rather
    // than echo the input.
    { pool: "sapling", valueBalanceZat: -135_801_146_190 },
    { pool: "orchard", valueBalanceZat: -5_891_668_958_810 },
  ],
  priceUsd: 389.2999267578125,
};

describe("boundaryDirection", () => {
  it("reads the direction from the pools' own signs", () => {
    expect(boundaryDirection(SHIELD)).toBe("shielding");
    expect(boundaryDirection(UNSHIELD)).toBe("unshielding");
    expect(boundaryDirection(TWO_POOL)).toBe("unshielding");
  });

  /**
   * A real crossing: a net unshielding from Sapling with Orchard moving the other way by
   * 0.00975 ZEC. There is no single direction, and therefore no post.
   */
  it("refuses a direction when one pool moved against the others", () => {
    const contradictory: BoundaryFigures = {
      ...UNSHIELD,
      pools: [
        { pool: "sapling", valueBalanceZat: -181_179_000_000 },
        { pool: "orchard", valueBalanceZat: 975_000 },
      ],
    };
    expect(boundaryDirection(contradictory)).toBeNull();
    expect(boundaryIsComplete(contradictory)).toBe(false);
    expect(missingBoundaryFigure(contradictory)).toBe("contradictoryPools");
  });

  it("has no direction with no pools at all", () => {
    expect(boundaryDirection({ ...SHIELD, pools: [] })).toBeNull();
  });
});

describe("boundaryAmountZat", () => {
  it("is unsigned, whichever way the value went", () => {
    expect(boundaryAmountZat(SHIELD)).toBe(6_938_583_540_000);
    expect(boundaryAmountZat(UNSHIELD)).toBe(6_942_069_475_000);
  });

  // Derived from the legs, so a multi-pool card's legs always add up to its total.
  it("is exactly the sum of the legs on a multi-pool crossing", () => {
    expect(boundaryAmountZat(TWO_POOL)).toBe(135_801_146_190 + 5_891_668_958_810);
    expect(boundaryAmountZat(TWO_POOL)).toBe(6_027_470_105_000);
  });
});

describe("the pools", () => {
  it("ranks by movement, largest first, whatever order they arrive in", () => {
    expect(boundaryPoolsRanked(TWO_POOL).map((p) => p.pool)).toEqual(["orchard", "sapling"]);
  });

  it("names one pool as a pool and several joined", () => {
    expect(boundaryPoolLabel(SHIELD)).toBe("Ironwood pool");
    expect(boundaryPoolLabel(UNSHIELD)).toBe("Orchard pool");
    expect(boundaryPoolLabel(TWO_POOL)).toBe("Orchard + Sapling");
  });

  // The post lists each pool with its own amount on its own line, so the phrase must not
  // name them a second time.
  it("gives the post a phrase that counts rather than repeating the names", () => {
    expect(boundaryPoolPhrase(SHIELD)).toBe("the Ironwood pool");
    expect(boundaryPoolPhrase(TWO_POOL)).toBe("two pools");
  });
});

describe("formatting", () => {
  // One formatter for the card and the post, so they cannot round differently.
  it("prints ZEC at two decimals, unsigned", () => {
    expect(formatBoundaryZec(6_938_583_540_000)).toBe("69,385.84");
    expect(formatBoundaryZec(-6_942_069_475_000)).toBe("69,420.69");
  });

  it("prints USD at a whole dollar", () => {
    expect(formatBoundaryUsd(55_823_899.4)).toBe("$55,823,899");
    expect(formatBoundaryUsd(23_464_936.7)).toBe("$23,464,937");
  });

  it("values the crossing at the stored price", () => {
    expect(boundaryUsdValue(SHIELD)).toBeCloseTo(55_823_899, 0);
    expect(boundaryUsdValue(UNSHIELD)).toBeCloseTo(33_090_658, 0);
    expect(boundaryUsdValue(TWO_POOL)).toBeCloseTo(23_464_937, 0);
  });

  it("has no USD value with no price, rather than a fabricated zero", () => {
    expect(boundaryUsdValue({ ...SHIELD, priceUsd: null })).toBeNull();
    expect(boundaryUsdValue({ ...SHIELD, priceUsd: 0 })).toBeNull();
  });
});

describe("boundaryKind", () => {
  it("maps a direction to its ledger kind, real and dry-run", () => {
    expect(boundaryKind("shielding", false)).toBe(SHIELDING_KIND);
    expect(boundaryKind("shielding", true)).toBe(SHIELDING_DRYRUN_KIND);
    expect(boundaryKind("unshielding", false)).toBe(UNSHIELDING_KIND);
    expect(boundaryKind("unshielding", true)).toBe(UNSHIELDING_DRYRUN_KIND);
  });
});

describe("boundaryIsComplete", () => {
  it("accepts every real crossing", () => {
    expect(boundaryIsComplete(SHIELD)).toBe(true);
    expect(boundaryIsComplete(UNSHIELD)).toBe(true);
    expect(boundaryIsComplete(TWO_POOL)).toBe(true);
  });

  it("refuses a crossing with no price rather than posting a card with a blank", () => {
    expect(boundaryIsComplete({ ...SHIELD, priceUsd: null })).toBe(false);
    expect(missingBoundaryFigure({ ...SHIELD, priceUsd: null })).toBe("priceUsd");
  });

  /**
   * A pool whose bundle appears with a balance of exactly zero moved nothing and must not be
   * named (seen on mainnet: a zero-balance Orchard bundle beside a 27,189 ZEC Sapling
   * unshielding).
   */
  it("refuses a zero-balance leg, which is a pool that did not move", () => {
    const withZeroLeg: BoundaryFigures = {
      ...UNSHIELD,
      pools: [
        { pool: "sapling", valueBalanceZat: -2_718_984_420_554 },
        { pool: "orchard", valueBalanceZat: 0 },
      ],
    };
    expect(boundaryIsComplete(withZeroLeg)).toBe(false);
    expect(missingBoundaryFigure(withZeroLeg)).toBe("poolValueBalance");
  });

  it("refuses anything that is not a canonical txid", () => {
    expect(boundaryIsComplete({ ...SHIELD, txid: "" })).toBe(false);
    expect(boundaryIsComplete({ ...SHIELD, txid: SHIELD.txid.toUpperCase() })).toBe(false);
    expect(boundaryIsComplete({ ...SHIELD, txid: SHIELD.txid.slice(0, 63) })).toBe(false);
  });

  // NaN <= 0 and Infinity <= 0 are both false, so a bound check alone lets either through.
  it("refuses a non-finite amount, which a bound check alone would admit", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        boundaryIsComplete({ ...SHIELD, pools: [{ pool: "ironwood", valueBalanceZat: bad }] }),
      ).toBe(false);
    }
    expect(boundaryIsComplete({ ...SHIELD, priceUsd: Number.NaN })).toBe(false);
  });

  it("names nothing missing on a complete crossing", () => {
    expect(missingBoundaryFigure(SHIELD)).toBe("none");
  });
});

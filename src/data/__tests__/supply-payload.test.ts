import { describe, expect, it } from "vitest";
import { parseSupplyLive, SUPPLY_LIVE_KIND } from "../supply-payload";

const supply = {
  height: 3_543_500,
  nsmZat: 12_345,
  pools: [
    { pool: "transparent", balanceZat: 1_000 },
    { pool: "ironwood", balanceZat: 2_000 },
  ],
};

describe("parseSupplyLive", () => {
  it("accepts its own endpoint's payload", () => {
    expect(parseSupplyLive({ kind: SUPPLY_LIVE_KIND, supply })).toEqual(supply);
  });

  it("keeps an explicit null NSM, which is not zero", () => {
    expect(
      parseSupplyLive({ kind: SUPPLY_LIVE_KIND, supply: { ...supply, nsmZat: null } }),
    ).toEqual({ ...supply, nsmZat: null });
  });

  it("refuses another endpoint's body", () => {
    expect(parseSupplyLive({ kind: "pulse-live", supply })).toBeNull();
    expect(parseSupplyLive(supply)).toBeNull();
    expect(parseSupplyLive(null)).toBeNull();
  });

  it("refuses an absent NSM key: a shape this build does not know", () => {
    const { nsmZat: _omitted, ...rest } = supply;
    expect(parseSupplyLive({ kind: SUPPLY_LIVE_KIND, supply: rest })).toBeNull();
  });

  it("refuses the whole payload over one malformed balance, rather than sum around it", () => {
    const pools = [...supply.pools, { pool: "sapling", balanceZat: Number.NaN }];
    expect(parseSupplyLive({ kind: SUPPLY_LIVE_KIND, supply: { ...supply, pools } })).toBeNull();
    const nameless = [...supply.pools, { balanceZat: 1 }];
    expect(
      parseSupplyLive({ kind: SUPPLY_LIVE_KIND, supply: { ...supply, pools: nameless } }),
    ).toBeNull();
  });

  it("refuses a payload without a height", () => {
    const { height: _omitted, ...rest } = supply;
    expect(parseSupplyLive({ kind: SUPPLY_LIVE_KIND, supply: rest })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { allPoolsSupply, scheduledIssuanceThroughZat } from "@/domain";
import { getHalvingSchedule, getSupplyBreakdown, getSupplySeries } from "@/fixtures";

/**
 * The supply fixtures obey the chain's identity: the pools plus the NSM equal what the schedule
 * has issued, read at one tip that the halving schedule and the daily closes share. Otherwise the
 * issuance headline and its curve disagree on every preview.
 */
describe("the supply fixtures", () => {
  const supply = getSupplyBreakdown();

  it("add up to the schedule's issuance at their height, to the zatoshi", () => {
    expect(allPoolsSupply(supply, "mainnet").issuedZat).toBe(
      scheduledIssuanceThroughZat(supply.height),
    );
  });

  it("are read at the tip the halving schedule and the daily closes end on", () => {
    expect(supply.height).toBe(getHalvingSchedule().height);
    expect(getSupplySeries().at(-1)!.height).toBe(supply.height);
  });
});

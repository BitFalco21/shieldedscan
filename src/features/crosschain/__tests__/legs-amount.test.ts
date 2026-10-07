import { describe, expect, it } from "vitest";
import { crossChainTransfers as transfers } from "@/fixtures/crosschain";
import { formatAssetAmount } from "@/lib/format";
import { legsOf } from "../transferView";

/**
 * A counterpart amount is formatted one way everywhere — 0.00042 BTC never reads `0` — and an
 * unsettled leg is stated in words, never a bare em dash.
 */
describe("legsOf counterpart amount", () => {
  it("formats through the same function the homepage panel uses", () => {
    const t = { ...transfers[0]!, direction: "in" as const, counterpartAmount: 0.00042 };
    expect(legsOf(t).source.amount).toBe(formatAssetAmount(0.00042));
    expect(legsOf(t).source.amount).toBe("0.00042");
  });

  it("carries an unsettled leg as null, never as a dash", () => {
    const t = { ...transfers[0]!, direction: "in" as const, counterpartAmount: null };
    expect(legsOf(t).source.amount).toBeNull();
  });
});

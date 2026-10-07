import { describe, expect, it } from "vitest";
import { flowPaletteClass } from "../flow-palette";

/**
 * A Sankey has two halves and a reader crosses between them, so a chain's colour has to be
 * the same on both — and the same on the next page load. These pin that, plus the graceful
 * handling of a chain nobody has listed yet, which is a routine event: venues add them
 * without warning.
 */
describe("flowPaletteClass", () => {
  it("gives a chain the same colour every time", () => {
    expect(flowPaletteClass("ETH")).toBe(flowPaletteClass("ETH"));
    expect(flowPaletteClass("eth")).toBe(flowPaletteClass("ETH"));
  });

  it("keeps the largest flows on distinct colours", () => {
    // The top eight are what the eye actually compares; a collision there is the one that
    // matters. Below that, repeats are unavoidable with a fixed palette and harmless.
    const top = ["ETH", "SOL", "BTC", "TRON", "NEAR", "ARB", "MAYA", "BASE"];
    expect(new Set(top.map(flowPaletteClass)).size).toBe(top.length);
  });

  it("gives an unlisted chain a stable colour rather than none", () => {
    const first = flowPaletteClass("SOMENEWCHAIN");
    expect(first).toMatch(/^flow-[1-8]$/);
    expect(flowPaletteClass("SOMENEWCHAIN")).toBe(first);
  });

  it("marks the folded tail as not-a-chain", () => {
    // It aggregates many chains, so dressing it in one chain's colour would misread.
    expect(flowPaletteClass("UNKNOWN")).toBe("flow-rest");
  });
});

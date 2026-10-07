import { describe, expect, it } from "vitest";
import { wheelFactor } from "../use-wheel-zoom";

describe("wheelFactor", () => {
  it("one ~100 px mouse notch zooms ×1.15, in either direction", () => {
    expect(wheelFactor(-100, 0, false)).toBeCloseTo(1.15, 6);
    expect(wheelFactor(100, 0, false)).toBeCloseTo(1 / 1.15, 6);
  });

  it("a small pinch event zooms a little — not a whole notch", () => {
    const f = wheelFactor(-4, 0, true);
    expect(f).toBeGreaterThan(1);
    expect(f).toBeLessThan(1.05);
  });

  it("converts line and page deltas to pixels, and caps any single event", () => {
    expect(wheelFactor(-3, 1, false)).toBeCloseTo(wheelFactor(-48, 0, false), 9);
    expect(wheelFactor(-100, 2, false)).toBe(1.5);
    expect(wheelFactor(100_000, 0, true)).toBeCloseTo(1 / 1.5, 9);
  });
});

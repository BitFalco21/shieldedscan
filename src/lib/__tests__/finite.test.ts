import { describe, expect, it } from "vitest";
import { finiteOrNull, isFiniteNumber, isFiniteOrNull, parseFiniteOrNull } from "../finite";

describe("finite number checks", () => {
  it("accepts finite numbers only", () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1.5)).toBe(true);
    for (const bad of [Number.NaN, Infinity, "1", null, undefined]) {
      expect(isFiniteNumber(bad)).toBe(false);
    }
  });

  it("accepts an explicit null but never undefined", () => {
    expect(isFiniteOrNull(null)).toBe(true);
    expect(isFiniteOrNull(3)).toBe(true);
    expect(isFiniteOrNull(undefined)).toBe(false);
    expect(isFiniteOrNull(Number.NaN)).toBe(false);
  });

  it("normalises anything unmeasured to null, keeping a real zero", () => {
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull(Number.NaN)).toBeNull();
    expect(finiteOrNull("5")).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
  });

  it("parses decimal strings, and reads a blank string as missing rather than zero", () => {
    expect(parseFiniteOrNull("12.5")).toBe(12.5);
    expect(parseFiniteOrNull("0")).toBe(0);
    expect(parseFiniteOrNull("")).toBeNull();
    expect(parseFiniteOrNull("  ")).toBeNull();
    expect(parseFiniteOrNull("abc")).toBeNull();
    expect(parseFiniteOrNull(undefined)).toBeNull();
  });
});

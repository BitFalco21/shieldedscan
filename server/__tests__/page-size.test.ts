import { describe, expect, it } from "vitest";
import { MAX_PAGE_SIZE, clampPageSize } from "../page-size";

describe("clampPageSize", () => {
  it("passes an in-range integer through", () => {
    expect(clampPageSize(25)).toBe(25);
  });
  it("floors fractions and clamps to [1, MAX_PAGE_SIZE]", () => {
    expect(clampPageSize(7.9)).toBe(7);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-4)).toBe(1);
    expect(clampPageSize(1_000_000)).toBe(MAX_PAGE_SIZE);
  });
  it("takes the fallback for a missing or non-finite request", () => {
    expect(clampPageSize(undefined, 25)).toBe(25);
    expect(clampPageSize(Number.NaN, 25)).toBe(25);
    expect(clampPageSize(Number.POSITIVE_INFINITY, 25)).toBe(25);
  });
  it("bounds the fallback too, so a default cannot exceed the cap", () => {
    expect(clampPageSize(undefined, 500)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(undefined)).toBe(MAX_PAGE_SIZE);
  });
});

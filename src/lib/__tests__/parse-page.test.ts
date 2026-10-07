import { describe, expect, it } from "vitest";
import { parsePage } from "../parse-page";

describe("parsePage", () => {
  it("defaults to 1 when undefined", () => {
    expect(parsePage(undefined)).toBe(1);
  });

  it("parses a whole number string", () => {
    expect(parsePage("3")).toBe(3);
  });

  it("floors a fractional string", () => {
    expect(parsePage("2.5")).toBe(2);
  });

  it("falls back to 1 for garbage input", () => {
    expect(parsePage("garbage")).toBe(1);
  });

  it("clamps negative numbers to 1", () => {
    expect(parsePage("-4")).toBe(1);
  });
});

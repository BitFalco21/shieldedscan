import { types } from "pg";
import { describe, expect, it } from "vitest";
import "../pg-types";

describe("pg-types", () => {
  it("parses BIGINT as a number, so zatoshi sums add rather than concatenate", () => {
    expect(types.getTypeParser(20)("2100000000000000")).toBe(2_100_000_000_000_000);
  });

  it("parses NUMERIC as a number", () => {
    expect(types.getTypeParser(1700)("12.5")).toBe(12.5);
  });
});

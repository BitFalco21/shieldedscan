import { describe, expect, it } from "vitest";
import { amount, zec } from "../v1/format";

describe("v1 wire formatting", () => {
  it("states zatoshi as an exact ZEC decimal with all eight places", () => {
    expect(zec(0)).toBe("0.00000000");
    expect(zec(1)).toBe("0.00000001");
    expect(zec(2_100_000_000_000_000)).toBe("21000000.00000000");
    expect(zec(-250_000_000)).toBe("-2.50000000");
    expect(zec(2_099_516_000_00)).toBe("2099.51600000");
  });

  it("pairs the integer with its decimal", () => {
    expect(amount(123_456_789)).toEqual({ zat: 123_456_789, zec: "1.23456789" });
  });
});

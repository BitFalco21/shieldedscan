import { describe, expect, it } from "vitest";
import { isOneOf } from "../closed-set";

describe("isOneOf", () => {
  const COLOURS = ["red", "green"] as const;

  it("accepts members and rejects everything else, including absence", () => {
    expect(isOneOf(COLOURS, "red")).toBe(true);
    expect(isOneOf(COLOURS, "RED")).toBe(false);
    expect(isOneOf(COLOURS, "")).toBe(false);
    expect(isOneOf(COLOURS, undefined)).toBe(false);
    expect(isOneOf(COLOURS, null)).toBe(false);
  });

  it("narrows the value to the list's union", () => {
    const raw: string = "green";
    if (isOneOf(COLOURS, raw)) {
      const narrowed: "red" | "green" = raw;
      expect(narrowed).toBe("green");
    }
  });
});

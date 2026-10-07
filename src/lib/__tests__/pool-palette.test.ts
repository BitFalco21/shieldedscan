import { describe, expect, it } from "vitest";
import { POOL_NAMES } from "@/domain";
import { POOL_CLASSES } from "../pool-palette";

describe("POOL_CLASSES", () => {
  it("gives every pool its own colour", () => {
    const classes = POOL_NAMES.map((pool) => POOL_CLASSES[pool]);
    expect(classes.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
    expect(new Set(classes).size).toBe(POOL_NAMES.length);
  });
});

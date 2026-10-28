import { describe, expect, it } from "vitest";
import { blocksTargetForDay } from "../chart-series";
import { BLOSSOM_HEIGHT, NU7_HEIGHT } from "../halving";

/** A day of `blocks` blocks ending at `topHeight`. */
const day = (topHeight: number, blocks: number) => ({ timestamp: 0, blocks, topHeight });

describe("blocksTargetForDay", () => {
  it("names each era's target: 576, 1,152, then 3,456 from NU7", () => {
    expect(blocksTargetForDay(day(BLOSSOM_HEIGHT - 1, 576))).toBe(576);
    expect(blocksTargetForDay(day(3_000_000, 1_152))).toBe(1_152);
    expect(blocksTargetForDay(day(NU7_HEIGHT + 3_456, 3_456))).toBe(3_456);
  });

  it("draws no target on an activation day, whose blocks fall under two", () => {
    expect(blocksTargetForDay(day(BLOSSOM_HEIGHT + 100, 1_000))).toBeNull();
    expect(blocksTargetForDay(day(NU7_HEIGHT + 100, 1_000))).toBeNull();
  });

  it("counts a day that starts exactly at NU7 as NU7's", () => {
    expect(blocksTargetForDay(day(NU7_HEIGHT + 3_455, 3_456))).toBe(3_456);
  });
});

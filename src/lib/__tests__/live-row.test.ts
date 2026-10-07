import { describe, expect, it } from "vitest";
import { liveRowClass } from "@/lib/live-row";

describe("liveRowClass", () => {
  it("adds the arrival transition only to a row that just arrived", () => {
    expect(liveRowClass("hairline-b", true)).toBe("hairline-b live-new");
    expect(liveRowClass("hairline-b", false)).toBe("hairline-b");
  });
});

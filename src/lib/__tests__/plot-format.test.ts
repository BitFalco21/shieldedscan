import { describe, expect, it } from "vitest";
import { niceAxis } from "../nice-ticks";
import { formatPlotTick } from "../plot-format";

/** A Zeno chart's y labels for data running 0..max in a unit, as the axis draws them. */
const labels = (unit: Parameters<typeof formatPlotTick>[0], max: number) => {
  const format = (v: number) => formatPlotTick(unit, v);
  return niceAxis(0, max, { label: format }).ticks.map(format);
};

describe("formatPlotTick on round axis steps", () => {
  it("prints counts exactly, where the compact readout form would round 2,500 to 3K", () => {
    expect(labels("count", 11_200)).toEqual(["0", "2.5K", "5K", "7.5K", "10K", "12.5K"]);
  });

  it("never labels a fraction of a count", () => {
    expect(labels("count", 3)).toEqual(["0", "1", "2", "3"]);
  });

  it("prints bytes as bytes, so a decimal step is not misread in 1,024-byte kB", () => {
    expect(labels("bytes", 4_800)).toEqual([
      "0 B",
      "1,000 B",
      "2,000 B",
      "3,000 B",
      "4,000 B",
      "5,000 B",
    ]);
  });

  it("prints ZEC without trailing zeros", () => {
    expect(labels("zat", 3_469_000 * 100_000_000)).toEqual([
      "0 ZEC",
      "1M ZEC",
      "2M ZEC",
      "3M ZEC",
      "4M ZEC",
    ]);
  });

  it("prints prices without cents a whole step does not have", () => {
    expect(labels("usd", 46)).toEqual(["$0", "$10", "$20", "$30", "$40", "$50"]);
  });
});

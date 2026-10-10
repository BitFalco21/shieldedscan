import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StackedBarChart, type StackedBarChartProps } from "../StackedBarChart";

const SERIES = [
  { key: "ETH", label: "Ethereum", colorClass: "flow-1", values: [30, 10, 5] },
  { key: "BTC", label: "Bitcoin", colorClass: "flow-3", values: [10, 30, 1] },
];

const draw = (props: Partial<StackedBarChartProps> = {}) =>
  render(
    <StackedBarChart
      series={SERIES}
      labels={["Aug 26", "Sep 26", "Oct 26"]}
      ariaLabel="Inflow"
      formatValue={(v) => `${v} ZEC`}
      {...props}
    />,
  ).container;

const segments = (svg: HTMLElement, colorClass: string) =>
  [...svg.querySelectorAll(`rect.${colorClass}`)] as SVGRectElement[];

describe("StackedBarChart", () => {
  it("stacks each period in series order, first at the bottom", () => {
    const svg = draw();
    const [eth] = segments(svg, "flow-1");
    const [btc] = segments(svg, "flow-3");
    // Bitcoin sits on Ethereum: its bottom edge is Ethereum's top.
    const bottom = Number(btc!.getAttribute("y")) + Number(btc!.getAttribute("height"));
    expect(bottom).toBeCloseTo(Number(eth!.getAttribute("y")));
  });

  it("scales every bar to the tallest period's total", () => {
    const svg = draw();
    const heights = [0, 1, 2].map(
      (i) =>
        Number(segments(svg, "flow-1")[i]!.getAttribute("height")) +
        Number(segments(svg, "flow-3")[i]!.getAttribute("height")),
    );
    // Totals 40, 40, 6.
    expect(heights[0]).toBeCloseTo(heights[1]!);
    expect(heights[2]! / heights[0]!).toBeCloseTo(6 / 40);
  });

  it("fades and hatches a running period, and says how far it reaches", () => {
    const svg = draw({ partial: { index: 2, note: "to 9 Oct" } });
    expect(segments(svg, "flow-1")[2]!.getAttribute("class")).toContain("opacity-45");
    expect(segments(svg, "flow-1")[0]!.getAttribute("class")).not.toContain("opacity-45");
    expect(svg.querySelector("rect[fill^='url(#']")).not.toBeNull();
    expect(svg.textContent).toContain("to 9 Oct");
  });

  it("brings a highlighted series forward by fading every other one", () => {
    const svg = draw({ highlightKey: "BTC" });
    for (const r of segments(svg, "flow-1"))
      expect(r.getAttribute("class")).toContain("opacity-15");
    for (const r of segments(svg, "flow-3"))
      expect(r.getAttribute("class")).not.toContain("opacity-15");
  });
});

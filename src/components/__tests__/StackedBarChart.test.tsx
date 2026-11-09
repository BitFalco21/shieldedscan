import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("draws no hatch for a running period that has nothing yet, never a negative height", () => {
    const svg = draw({
      series: [{ key: "x", label: "x", colorClass: "flow-1", values: [3, 2, -1] }],
      partial: { index: 2, note: "so far" },
    });
    for (const r of svg.querySelectorAll("rect")) {
      expect(Number(r.getAttribute("height") ?? 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it("brings a highlighted series forward by fading every other one", () => {
    const svg = draw({ highlightKey: "BTC" });
    for (const r of segments(svg, "flow-1"))
      expect(r.getAttribute("class")).toContain("opacity-15");
    for (const r of segments(svg, "flow-3"))
      expect(r.getAttribute("class")).not.toContain("opacity-15");
  });

  describe("on a narrow screen", () => {
    /** jsdom lays nothing out, so the viewport and the measured width are stubbed. */
    const atWidth = (px: number, viewport: number) => {
      vi.stubGlobal(
        "matchMedia",
        (query: string) =>
          ({
            matches: query === "(max-width: 639px)" && viewport < 640,
            addEventListener() {},
            removeEventListener() {},
          }) as unknown as MediaQueryList,
      );
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          disconnect() {}
        },
      );
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        width: px,
      } as DOMRect);
    };
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });
    const tickSizes = (svg: HTMLElement) =>
      [...svg.querySelectorAll("text.chart-tick")].map((t) => Number(t.getAttribute("font-size")));

    it("sizes the ticks to render at ~11px and grows the frame with them", () => {
      atWidth(330, 375);
      const svg = draw({ marker: { index: 1, label: "NU7" } });
      // 11 units per 1000 rendered at 330px would be ~3.6px; scaled up they render at 11px.
      for (const size of tickSizes(svg)) expect((size * 330) / 1000).toBeCloseTo(11, 0);
      const height = Number(svg.querySelector("svg")!.getAttribute("viewBox")!.split(" ")[3]);
      expect(height).toBeGreaterThan(320);
      const label = svg.querySelector(".chart-marker-label")!;
      expect(Number(label.getAttribute("font-size"))).toBeGreaterThan(10);
    });

    it("keeps the fixed frame above a phone's viewport, however narrow the panel", () => {
      // A half-width panel on a desktop page: drawn as it always was.
      atWidth(530, 1440);
      const svg = draw();
      expect(svg.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 1000 320");
      for (const size of tickSizes(svg)) expect(size).toBe(11);
    });
  });
});

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ChartThumbnail, type ChartThumb } from "../ChartThumbnail";

const draw = (thumb: ChartThumb) => render(<ChartThumbnail thumb={thumb} />).container;

/** The y coordinates of a path's points, in drawing order. */
const ys = (d: string) => [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));

describe("ChartThumbnail", () => {
  it("stacks bands, so the top band's upper edge is the total", () => {
    const svg = draw({
      kind: "stack",
      series: [
        { values: [1, 1], className: "band-transparent" },
        { values: [3, 1], className: "band-shielded" },
      ],
    });
    const paths = svg.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    // Totals are 4 and 2: the first point of the top band sits at the plot's top (y = 1),
    // the second halfway down.
    const top = ys(paths[1]!.getAttribute("d")!);
    expect(top[0]).toBeCloseTo(1);
    expect(top[1]).toBeCloseTo(20);
    expect(paths[1]!.getAttribute("class")).toContain("band-shielded");
  });

  it("keeps a gap in a line a gap, and draws each line in its own class", () => {
    const svg = draw({
      kind: "lines",
      series: [
        { values: [1, 2, null, 3, 4], className: "flow-2" },
        { values: [2, 2, 2, 2, 2], className: "flow-4", opacity: 0.5 },
      ],
    });
    const [gapped, flat] = [...svg.querySelectorAll("path")];
    expect(gapped!.getAttribute("d")!.match(/M/g)).toHaveLength(2);
    expect(flat!.getAttribute("class")).toBe("flow-4");
    expect(flat!.getAttribute("opacity")).toBe("0.5");
  });

  it("starts every scale at zero, so a small wobble never reads as a cliff", () => {
    const svg = draw({ kind: "lines", series: [{ values: [100, 101], className: "text-green" }] });
    const [a, b] = ys(svg.querySelector("path")!.getAttribute("d")!);
    // 100 and 101 on a zero-based axis are nearly the same height.
    expect(Math.abs(a! - b!)).toBeLessThan(1);
  });

  it("draws a flow as bars either side of one midline, on one shared scale", () => {
    const svg = draw({ kind: "flow", inValues: [4, 2], outValues: [2, 4] });
    const rects = [...svg.querySelectorAll("rect")];
    expect(rects).toHaveLength(4);
    const heights = rects.map((r) => Number(r.getAttribute("height")));
    // The tallest inbound and outbound bars are the same height: one scale.
    expect(heights[0]).toBeCloseTo(heights[3]!);
    expect(rects[2]!.getAttribute("opacity")).toBe("0.35");
  });

  it("draws nothing it cannot draw honestly, and is decorative to a screen reader", () => {
    expect(
      draw({ kind: "lines", series: [{ values: [1], className: "text-green" }] }).innerHTML,
    ).toBe("");
    const svg = draw({ kind: "area", series: { values: [1, 2], className: "text-series" } });
    expect(svg.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});

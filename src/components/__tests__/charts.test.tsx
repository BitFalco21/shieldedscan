import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CHART_PAD_R, CHART_W, PHONE_TICK_FONT, TICK_FONT, tickCharW } from "../chart-axes";
import { MultiLineChart } from "../MultiLineChart";
import { StackedAreaChart } from "../StackedAreaChart";

/**
 * The y-axis ticks only. `XAxis` shares the `chart-tick` class, so the two are told apart by
 * structure rather than by coordinates: `YAxis` pairs each label with its gridline inside a
 * `<g>`, and `XAxis` emits bare text.
 */
function yAxisTicks(container: HTMLElement): number[] {
  return [...container.querySelectorAll("g > text.chart-tick")].map((t) => Number(t.textContent));
}

describe("phone axes", () => {
  /*
   * Every chart draws in a 1000-unit viewBox that scales to its container, so across a phone an
   * 11-unit tick would render at ~3px. Phone mode draws the ticks larger in SVG units so they
   * land back at a readable size, and the gutter and label density derive from the same font so
   * nothing clips or collides.
   */
  const lineChart = (phone: boolean) => (
    <MultiLineChart
      labels={Array.from(
        { length: 40 },
        (_, i) => `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
      )}
      series={[
        {
          name: "count",
          values: Array.from({ length: 40 }, (_, i) => i + 1),
          className: "text-green",
        },
      ]}
      ariaLabel="counts"
      phone={phone}
    />
  );
  const tickFonts = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("text.chart-tick")].map(
      (t) => t.getAttribute("font-size") ?? "",
    );
  /** XAxis labels only — YAxis pairs each tick with its gridline inside a `<g>`. */
  const xLabels = (container: HTMLElement) =>
    [...container.querySelectorAll("text.chart-tick")].filter(
      (t) => t.parentElement?.tagName !== "g",
    );

  it("draws every tick at the phone size, as an attribute the gutter arithmetic can agree with", () => {
    const { container } = render(lineChart(true));
    const fonts = new Set(tickFonts(container));
    expect(fonts).toEqual(new Set([String(PHONE_TICK_FONT)]));
    expect(PHONE_TICK_FONT).toBeGreaterThan(TICK_FONT);
  });

  it("keeps the base size everywhere else", () => {
    const { container } = render(lineChart(false));
    expect(new Set(tickFonts(container))).toEqual(new Set([String(TICK_FONT)]));
  });

  it("widens the gutter with the font, so a large tick is not clipped at the left edge", () => {
    const normal = render(lineChart(false)).container;
    const phone = render(lineChart(true)).container;
    const gutter = (c: HTMLElement) =>
      Number(c.querySelector("line.chart-grid")?.getAttribute("x1"));
    expect(gutter(phone)).toBeGreaterThan(gutter(normal));
  });

  it("draws fewer x labels, because each one is wider", () => {
    const normal = render(lineChart(false)).container;
    const phone = render(lineChart(true)).container;
    expect(xLabels(phone).length).toBeLessThan(xLabels(normal).length);
    // First and last stay — an axis whose ends are unlabelled states no range at all.
    expect(xLabels(phone).length).toBeGreaterThanOrEqual(2);
  });

  /** Horizontal extent of an x label from its anchor and measured character width. */
  const extentsOf = (container: HTMLElement) =>
    xLabels(container)
      .map((t) => {
        const x = Number(t.getAttribute("x"));
        const w = (t.textContent?.length ?? 0) * tickCharW(Number(t.getAttribute("font-size")));
        const anchor = t.getAttribute("text-anchor");
        const start = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
        return { start, end: start + w };
      })
      .sort((a, b) => a.start - b.start);

  it("keeps large labels apart, where a fixed label count would fuse them", () => {
    // 10-character dates at the phone font are the widest labels any chart draws; a fixed
    // label count would fuse two of them into one run.
    const extents = extentsOf(render(lineChart(true)).container);
    expect(extents.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < extents.length; i += 1) {
      expect(extents[i]!.start).toBeGreaterThanOrEqual(extents[i - 1]!.end);
    }
  });

  it("keeps every label inside the viewBox — the stacked chart clipped its last month", () => {
    const { container } = render(
      <StackedAreaChart
        ariaLabel="stacked"
        series={[{ key: "a", label: "A", colorClass: "band-shielded", values: [1, 2] }]}
        labels={["Jun 26", "Jul 26"]}
        formatValue={String}
      />,
    );
    for (const { start, end } of extentsOf(container)) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(CHART_W);
    }
  });
});

describe("MultiLineChart's y-axis floor", () => {
  const priceLike = (values: number[]) => (
    <MultiLineChart
      labels={values.map((_, i) => `p${i}`)}
      series={[{ name: "price", values, className: "text-green" }]}
      ariaLabel="price"
      baseline="data"
    />
  );

  /**
   * The margin below the lowest point must be clamped at zero. A tenth of the whole data span
   * can exceed the low itself — over a series from $18.29 to $2,239.29 it would floor the axis
   * at -$203.81, a gridline at a negative price. The `low > 0` guard checks the input, never
   * the output.
   */
  it("never floors below zero for a series whose low is a fraction of its high", () => {
    const { container } = render(priceLike([18.29, 2239.29]));
    expect(Math.min(...yAxisTicks(container))).toBeGreaterThanOrEqual(0);
  });

  it("floors at zero rather than merely clipping the negative label", () => {
    // The lowest tick IS the floor, so a chart that clamped only the rendered text would
    // still plot its line against a negative baseline and misstate every height.
    const { container } = render(priceLike([18.29, 2239.29]));
    expect(Math.min(...yAxisTicks(container))).toBe(0);
  });

  /**
   * The other half, and the reason `baseline="data"` exists: a week of ZEC moving $759.91 to
   * $887.76 must not become a flat line pinned to the top of a zero-based frame.
   */
  it("still clips a narrow window, so a real move keeps its shape", () => {
    const { container } = render(priceLike([759.91, 887.76]));
    expect(Math.min(...yAxisTicks(container))).toBeGreaterThan(700);
  });

  it("leaves the default zero-based axis alone", () => {
    const { container } = render(
      <MultiLineChart
        labels={["a", "b"]}
        series={[{ name: "count", values: [40, 100], className: "text-green" }]}
        ariaLabel="counts"
      />,
    );
    expect(Math.min(...yAxisTicks(container))).toBe(0);
  });
});

describe("MultiLineChart's hover sits on the points it drew", () => {
  // The crosshair is the only inline-styled element in a chart; its `left` is a percentage.
  const crosshairLeft = (container: HTMLElement): number =>
    parseFloat((container.querySelector("div.w-px[aria-hidden]") as HTMLElement).style.left);

  it("puts the first and last index on the plot's edges, not half a slice in", () => {
    const { container, getByRole } = render(
      <MultiLineChart
        labels={["Oct 3", "Oct 4"]}
        series={[{ name: "share", values: [41.6, 40.3], className: "text-green" }]}
        formatValue={(v) => `${v.toFixed(1)}%`}
        ariaLabel="two days"
      />,
    );
    const group = getByRole("group");
    fireEvent.keyDown(group, { key: "End" });
    // The last point is drawn at the plot's right edge, so the crosshair must sit there.
    expect(crosshairLeft(container)).toBeCloseTo(((CHART_W - CHART_PAD_R) / CHART_W) * 100, 5);
  });

  it("a fixed yMax holds the axis ceiling, and markers draw one dot per measured point", () => {
    const { container } = render(
      <MultiLineChart
        labels={["a", "b", "c"]}
        series={[{ name: "share", values: [10, null, 30], className: "text-green" }]}
        ariaLabel="share"
        yMax={100}
        markers
      />,
    );
    expect(Math.max(...yAxisTicks(container))).toBe(100);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });
});

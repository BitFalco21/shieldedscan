import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlowBalanceChart } from "../FlowBalanceChart";

/**
 * The one thing that can make this chart lie is a per-side scale.
 *
 * If each direction were scaled to its own maximum, every month would render as roughly
 * balanced and the picture would be confidently wrong rather than merely uninformative. The
 * geometry tests below assert the shared ruler directly, because it is not visible in any
 * snapshot and would survive review unnoticed.
 */

const rects = (): SVGRectElement[] => Array.from(screen.getByRole("img").querySelectorAll("rect"));

describe("FlowBalanceChart", () => {
  /*
   * The labels are props because this component draws two different quantities: shielding
   * flows and cross-chain volume. A shared flow component with a default vocabulary would
   * describe one caller's data in another caller's words.
   */
  it("names its directions from the caller, so a shared chart cannot mislabel its data", () => {
    render(
      <FlowBalanceChart
        inLabel="Inbound"
        outLabel="Outbound"
        points={[{ label: "Jan 26", inValue: 100, outValue: 50 }]}
        ariaLabel="ZEC arriving on and leaving Zcash per month, on one scale"
      />,
    );
    const titles = Array.from(screen.getByRole("img").querySelectorAll("title")).map(
      (t) => t.textContent ?? "",
    );
    expect(titles.some((t) => t.includes("inbound"))).toBe(true);
    expect(titles.some((t) => t.includes("outbound"))).toBe(true);
    // The specific failure: a cross-chain chart must never call a crossing a shielding.
    expect(titles.join(" ")).not.toMatch(/shield/i);
  });

  it("draws both directions on ONE scale", () => {
    // 100 in, 50 out. The out bar must be exactly half the height of the in bar — under a
    // per-side scale both would be full height and the month would read as balanced.
    render(
      <FlowBalanceChart
        inLabel="Shielded"
        outLabel="Unshielded"
        points={[{ label: "Jan 26", inValue: 100, outValue: 50 }]}
        ariaLabel="test"
      />,
    );
    const [inBar, outBar] = rects();
    const inH = Number(inBar?.getAttribute("height"));
    const outH = Number(outBar?.getAttribute("height"));
    expect(inH).toBeGreaterThan(0);
    expect(outH / inH).toBeCloseTo(0.5, 2);
  });

  it("keeps the scale shared ACROSS points, not just within one", () => {
    // A quiet month beside a busy one must render visibly smaller. Scaling per point would
    // make every month look identical, which is the same lie in a different place.
    render(
      <FlowBalanceChart
        inLabel="Shielded"
        outLabel="Unshielded"
        points={[
          { label: "Jan 26", inValue: 1000, outValue: 1000 },
          { label: "Feb 26", inValue: 100, outValue: 100 },
        ]}
        ariaLabel="test"
      />,
    );
    const heights = rects().map((r) => Number(r.getAttribute("height")));
    // Two bars per point, in document order: [jan-in, jan-out, feb-in, feb-out].
    expect(heights[2]! / heights[0]!).toBeCloseTo(0.1, 2);
  });

  it("puts what entered above the line and what left below it", () => {
    render(
      <FlowBalanceChart
        inLabel="Shielded"
        outLabel="Unshielded"
        points={[{ label: "Jan 26", inValue: 100, outValue: 100 }]}
        ariaLabel="test"
      />,
    );
    const bars = rects().filter((r) => !r.classList.contains("chart-grid"));
    const [inBar, outBar] = bars;
    // Assert the relationship the chart exists to draw: equal magnitudes meet at one line —
    // the in bar ends exactly where the out bar begins — with in above, out below.
    const inY = Number(inBar?.getAttribute("y"));
    const inH = Number(inBar?.getAttribute("height"));
    const outY = Number(outBar?.getAttribute("y"));
    expect(inY + inH).toBeCloseTo(outY, 1);
    expect(inY).toBeLessThan(outY);
  });

  it("renders nothing rather than an empty frame when there is no data", () => {
    const { container } = render(
      <FlowBalanceChart points={[]} ariaLabel="test" inLabel="Shielded" outLabel="Unshielded" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("does not colour direction as good or bad", () => {
    // ZEC leaving the shielded pools is not a loss, and red/green here would be an editorial
    // claim. Direction is carried by position and opacity, one hue.
    render(
      <FlowBalanceChart
        inLabel="Shielded"
        outLabel="Unshielded"
        points={[{ label: "Jan 26", inValue: 100, outValue: 50 }]}
        ariaLabel="test"
      />,
    );
    const fills = new Set(rects().map((r) => r.getAttribute("fill")));
    expect(fills.size).toBe(1);
  });
});

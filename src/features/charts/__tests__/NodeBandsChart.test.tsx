import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { nodeBandClass } from "@/lib/node-band-palette";
import { NodeBandsChart } from "../NodeBandsChart";

const BANDS = {
  keys: ["zebra-2", "zakura-1"],
  labels: ["Zebra 2.x", "Zakura 1.x"],
  days: ["2026-11-01", "2026-11-02"],
  answering: [10, 12],
  nodes: [
    [6, 7],
    [4, 5],
  ],
};

const draw = () =>
  render(<NodeBandsChart bands={BANDS} what="software release line" recordingSince={null} />)
    .container;

/** The bar segments of one band, by the class that colours it. */
const segmentsOf = (container: HTMLElement, index: number) => {
  const colour = nodeBandClass(BANDS.keys[index]!, index);
  const segments = [...container.querySelectorAll("rect.chart-band")].filter((r) =>
    r.classList.contains(colour),
  );
  expect(segments.length).toBeGreaterThan(0);
  return segments;
};

describe("NodeBandsChart legend highlight", () => {
  it("brings a band forward while its legend item is pointed at, and restores on leaving", () => {
    const container = draw();
    const zakura = screen.getByRole("button", { name: "Zakura 1.x" });
    fireEvent.pointerEnter(zakura);
    for (const r of segmentsOf(container, 0))
      expect(r.getAttribute("class")).toContain("opacity-15");
    for (const r of segmentsOf(container, 1)) {
      expect(r.getAttribute("class")).not.toContain("opacity-15");
    }
    fireEvent.pointerLeave(zakura);
    for (const r of container.querySelectorAll("rect.chart-band")) {
      expect(r.getAttribute("class")).not.toContain("opacity-15");
    }
  });

  it("previews on focus, and pins on a click that leaving does not undo", () => {
    const container = draw();
    const zebra = screen.getByRole("button", { name: "Zebra 2.x" });
    fireEvent.focus(zebra);
    for (const r of segmentsOf(container, 1))
      expect(r.getAttribute("class")).toContain("opacity-15");
    expect(zebra.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(zebra);
    fireEvent.blur(zebra);
    fireEvent.pointerLeave(zebra);
    expect(zebra.getAttribute("aria-pressed")).toBe("true");
    for (const r of segmentsOf(container, 1))
      expect(r.getAttribute("class")).toContain("opacity-15");
    fireEvent.click(zebra);
    expect(container.querySelectorAll("rect.opacity-15")).toHaveLength(0);
  });
});

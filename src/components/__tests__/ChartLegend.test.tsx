import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChartLegend, type LegendItem } from "../ChartLegend";

const ITEMS: LegendItem[] = [
  { label: "Old", className: "age-band-9", mark: "area", key: "old" },
  { label: "New", className: "age-band-1", mark: "area", key: "new" },
];

describe("ChartLegend highlight", () => {
  it("stays a plain list when nothing listens", () => {
    render(<ChartLegend items={ITEMS} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Old")).toBeTruthy();
  });

  it("reports the item pointed at, and clears it on leaving", () => {
    const onHighlight = vi.fn();
    render(<ChartLegend items={ITEMS} highlighted={null} onHighlight={onHighlight} />);
    const item = screen.getByRole("button", { name: "New" });
    fireEvent.pointerEnter(item);
    expect(onHighlight).toHaveBeenLastCalledWith("new");
    fireEvent.pointerLeave(item);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  it("reports the item focused from the keyboard, and clears it on blur", () => {
    const onHighlight = vi.fn();
    render(<ChartLegend items={ITEMS} highlighted={null} onHighlight={onHighlight} />);
    const item = screen.getByRole("button", { name: "Old" });
    fireEvent.focus(item);
    expect(onHighlight).toHaveBeenLastCalledWith("old");
    fireEvent.blur(item);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  it("marks the highlighted item pressed and fades the others", () => {
    render(<ChartLegend items={ITEMS} highlighted="old" onHighlight={() => {}} />);
    const old = screen.getByRole("button", { name: "Old" });
    const young = screen.getByRole("button", { name: "New" });
    expect(old.getAttribute("aria-pressed")).toBe("true");
    expect(young.getAttribute("aria-pressed")).toBe("false");
    expect(young.className).toContain("opacity-35");
    expect(old.className).not.toContain("opacity-35");
  });
});

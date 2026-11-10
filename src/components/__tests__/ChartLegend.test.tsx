import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useLegendHighlight } from "@/lib/use-legend-highlight";
import { ChartLegend, type LegendItem } from "../ChartLegend";

const ITEMS: LegendItem[] = [
  { label: "Old", className: "age-band-9", mark: "area", key: "old" },
  { label: "New", className: "age-band-1", mark: "area", key: "new" },
];

/** The legend with the hook a chart would hold, and the key the chart would bring forward. */
function Harness() {
  const highlight = useLegendHighlight();
  return (
    <>
      <output data-testid="highlighted">{highlight.highlighted ?? "none"}</output>
      <ChartLegend items={ITEMS} highlight={highlight} />
    </>
  );
}

const highlighted = () => screen.getByTestId("highlighted").textContent;
const button = (name: string) => screen.getByRole("button", { name });

describe("ChartLegend", () => {
  it("stays a plain list when no chart listens", () => {
    render(<ChartLegend items={ITEMS} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Old")).toBeTruthy();
  });

  it("previews the item pointed at, fades the others, and clears on leaving", () => {
    render(<Harness />);
    fireEvent.pointerEnter(button("New"));
    expect(highlighted()).toBe("new");
    expect(button("Old").className).toContain("opacity-35");
    expect(button("New").className).not.toContain("opacity-35");
    // A preview is not a state a screen reader is told about.
    expect(button("New").getAttribute("aria-pressed")).toBe("false");
    fireEvent.pointerLeave(button("New"));
    expect(highlighted()).toBe("none");
    expect(button("Old").className).not.toContain("opacity-35");
  });

  it("previews on focus and clears on blur", () => {
    render(<Harness />);
    fireEvent.focus(button("Old"));
    expect(highlighted()).toBe("old");
    fireEvent.blur(button("Old"));
    expect(highlighted()).toBe("none");
  });

  it("pins on click, holds through leave and blur, and unpins on a second click", () => {
    render(<Harness />);
    fireEvent.click(button("Old"));
    expect(button("Old").getAttribute("aria-pressed")).toBe("true");
    fireEvent.pointerLeave(button("Old"));
    fireEvent.blur(button("Old"));
    expect(highlighted()).toBe("old");
    // A pin outranks a preview of another item.
    fireEvent.pointerEnter(button("New"));
    expect(highlighted()).toBe("old");
    fireEvent.pointerLeave(button("New"));
    fireEvent.click(button("Old"));
    expect(button("Old").getAttribute("aria-pressed")).toBe("false");
    expect(highlighted()).toBe("none");
  });

  it("pins from the keyboard: focus, then Enter or Space, which a button turns into a click", () => {
    render(<Harness />);
    fireEvent.focus(button("New"));
    fireEvent.click(button("New"));
    fireEvent.blur(button("New"));
    expect(button("New").getAttribute("aria-pressed")).toBe("true");
    expect(highlighted()).toBe("new");
  });

  it("keeps a tap's pin when the finger lifts: pointerenter, pointerleave, click", () => {
    render(<Harness />);
    const item = button("New");
    fireEvent.pointerEnter(item, { pointerType: "touch" });
    fireEvent.pointerLeave(item, { pointerType: "touch" });
    fireEvent.click(item);
    expect(item.getAttribute("aria-pressed")).toBe("true");
    expect(highlighted()).toBe("new");
    // A second tap unpins.
    fireEvent.pointerEnter(item, { pointerType: "touch" });
    fireEvent.pointerLeave(item, { pointerType: "touch" });
    fireEvent.click(item);
    expect(highlighted()).toBe("none");
  });

  it("can be clicked: it says so with the cursor", () => {
    render(<Harness />);
    expect(button("Old").className).toContain("cursor-pointer");
  });
});

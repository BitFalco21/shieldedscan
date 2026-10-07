import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatCard } from "../StatCard";
import { StatGrid } from "../StatGrid";

/**
 * The phone form is CSS (`.stat-grid > .stat-card` below `sm`), so what can be pinned here is the
 * contract that CSS relies on: the grid's class, the cards as DIRECT children, and the class
 * hooks on each part. A card restyled with utilities instead would silently escape the phone
 * form — a utility beats the components layer.
 */
describe("StatGrid", () => {
  it("holds its cards as direct children, which the phone form's selectors require", () => {
    const { container } = render(
      <StatGrid>
        <StatCard label="TOTAL" value="18,418" sub="all-time" />
        <StatCard label="TPS" value="0.041" />
      </StatGrid>,
    );
    const grid = container.firstElementChild!;
    expect(grid.classList.contains("stat-grid")).toBe(true);
    expect(Array.from(grid.children).every((c) => c.classList.contains("stat-card"))).toBe(true);
  });

  it("takes its gap from the stat-grid class, never a gap utility the phone form cannot undo", () => {
    const { container } = render(
      <StatGrid columns={4} className="mb-3">
        <StatCard label="A" value="1" />
      </StatGrid>,
    );
    const cls = container.firstElementChild!.className;
    expect(cls).not.toMatch(/\bgap-/);
    expect(cls).toContain("sm:grid-cols-2");
    expect(cls).toContain("lg:grid-cols-4");
    expect(cls).toContain("mb-3");
  });

  it.each([
    [2, "sm:grid-cols-2"],
    [3, "sm:grid-cols-3"],
    [5, "lg:grid-cols-5"],
  ] as const)("lays out %i columns", (columns, expected) => {
    const { container } = render(
      <StatGrid columns={columns}>
        <StatCard label="A" value="1" />
      </StatGrid>,
    );
    expect(container.firstElementChild!.className).toContain(expected);
  });
});

describe("StatCard", () => {
  it("is a panel with label, value and sub on the class hooks the phone form styles", () => {
    render(<StatCard label="TOTAL" value="18,418" sub="all-time" />);
    const label = screen.getByText("TOTAL");
    const card = label.parentElement!;
    expect(card.className).toBe("stat-card panel");
    expect(label.className).toBe("stat-card-label microlabel");
    expect(screen.getByText("18,418").className).toBe("stat-card-value");
    expect(screen.getByText("all-time").className).toBe("stat-card-sub");
  });

  it("renders no sub-line element when none is given", () => {
    render(<StatCard label="TPS" value="0.041" />);
    expect(screen.getByText("TPS").parentElement!.children).toHaveLength(2);
  });
});

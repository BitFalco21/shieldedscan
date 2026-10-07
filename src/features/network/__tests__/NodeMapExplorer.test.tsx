import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureDataSource } from "@/data/fixture-source";
import { NodeMapExplorer } from "../map/NodeMapExplorer";
import { asnRanking, cellClasses } from "../map/lenses";

/**
 * The map tab, rendered from the fixtures. Pinned: one lit rect per cell and one hollow rect
 * per ghost cell; the ghost toggle removes exactly those; a lens is an attribute on the svg and
 * every cell already carries a class from all four families; hovering a cell fills the readout
 * with its place and counts; a click pins it; no inline style and no address anywhere.
 */

const map = await fixtureDataSource.getNetworkMap();
const summary = await fixtureDataSource.getNetworkSummary();

describe("NodeMapExplorer", () => {
  it("draws one cell per map cell and one hollow square per ghost cell", () => {
    const { container } = render(<NodeMapExplorer map={map} summary={summary} />);
    expect(container.querySelectorAll(".net-cell")).toHaveLength(map.cells.length);
    expect(container.querySelectorAll(".net-ghost")).toHaveLength(map.ghostCells.length);
    expect(container.querySelector(".net-land")?.getAttribute("d")?.startsWith("M")).toBe(true);
  });

  it("the ghost toggle removes the never-answered squares and nothing else", () => {
    const { container } = render(<NodeMapExplorer map={map} summary={summary} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(container.querySelectorAll(".net-ghost")).toHaveLength(0);
    expect(container.querySelectorAll(".net-cell")).toHaveLength(map.cells.length);
  });

  it("switches lens by an attribute on the svg; every cell carries all three families", () => {
    const { container } = render(<NodeMapExplorer map={map} summary={summary} />);
    const mapEl = container.querySelector(".net-map")!;
    expect(mapEl.getAttribute("data-lens")).toBe("client");
    const chip = screen.getByRole("button", { name: "crawls answered" });
    fireEvent.click(chip);
    expect(mapEl.getAttribute("data-lens")).toBe("uptime");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "software" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    const ranking = asnRanking(map);
    for (const cell of map.cells) {
      const classes = cellClasses(cell, ranking).split(" ");
      expect(classes[0]).toMatch(/^net-client-/);
      expect(classes[1]).toMatch(/^net-asn-/);
      expect(classes[2]).toMatch(/^net-up-/);
      expect(classes).toHaveLength(3);
    }
  });

  it("fills the readout with a hovered cell's place and counts, and pins on click", () => {
    const { container } = render(<NodeMapExplorer map={map} summary={summary} />);
    const readout = screen.getByRole("status");
    expect(readout.textContent).toContain("advertised to us, not answering");
    const biggest = [...map.cells].sort((a, b) => b.nodes - a.nodes)[0]!;
    const rect = container.querySelector(
      `.net-cell[aria-label^="${biggest.city}, ${biggest.country}"]`,
    )!;
    expect(rect).not.toBeNull();
    // Keyboard focus reaches a cell directly; the pointer path is nearest-cell picking, which
    // needs a laid-out svg and is exercised by e2e/network.spec.ts.
    fireEvent.focus(rect);
    expect(readout.textContent).toContain(`${biggest.city}, ${biggest.country}`);
    expect(readout.textContent).toContain("nodes here");
    expect(readout.textContent).toContain("A 1° cell, not an address");
    fireEvent.keyDown(rect, { key: "Enter" });
    fireEvent.blur(rect);
    expect(readout.textContent).toContain(`${biggest.city}, ${biggest.country}`);
    expect(readout.textContent).toContain("Esc");
    fireEvent.keyDown(container.firstElementChild!, { key: "Escape" });
    expect(readout.textContent).not.toContain("nodes here");
  });

  it("the country list folds the tail rather than dropping it", () => {
    const { container } = render(<NodeMapExplorer map={map} summary={summary} />);
    const list = container.querySelector("ol")!;
    const total = map.countries.reduce((s, c) => s + c.count, 0);
    expect(total).toBe(summary.reachable);
    expect(list.querySelectorAll("li")).toHaveLength(13);
    expect(list.textContent).toContain("more countries");
  });

  it("carries no inline style and no address-shaped string", () => {
    const { container } = render(<NodeMapExplorer map={map} summary={summary} />);
    expect(container.innerHTML).not.toMatch(/\sstyle=/);
    expect(container.innerHTML).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });
});

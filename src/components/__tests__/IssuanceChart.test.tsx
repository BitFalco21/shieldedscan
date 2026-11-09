import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { issuanceOutlook } from "@/domain";
import { IssuanceChart } from "../IssuanceChart";

const NOW = 1_793_000_000;
const DAY = 86_400;
const tip = { height: 3_600_000, observedIntervalSeconds: 25 };
const closes = Array.from({ length: 400 }, (_, i) => ({
  timestamp: NOW - (400 - i) * DAY,
  height: tip.height - (399 - i) * 3_000,
}));
const outlook = issuanceOutlook(closes, tip, NOW);

const draw = () =>
  render(<IssuanceChart outlook={outlook} now={NOW} ariaLabel="issuance" renderedWidth={1000} />);

describe("IssuanceChart", () => {
  it("draws observed history solid and filled, and the projection dashed from the newest close", () => {
    const { container } = draw();
    const lines = [...container.querySelectorAll("path[fill='none']")];
    const solid = lines.filter((p) => !p.hasAttribute("stroke-dasharray"));
    const dashed = lines.filter((p) => p.hasAttribute("stroke-dasharray"));
    expect(solid).toHaveLength(1);
    expect(dashed).toHaveLength(1);
    // The dashed line starts where the solid one ends: no gap, no overlap.
    const solidEnd = solid[0]!.getAttribute("d")!.split(" L").at(-1)!;
    const dashedStart = dashed[0]!.getAttribute("d")!.slice(1).split(" L")[0]!;
    expect(dashedStart).toBe(solidEnd);
    // The fill closes the observed curve only.
    const fills = container.querySelectorAll("path[stroke='none']");
    expect(fills).toHaveLength(1);
    // Solid points left of dashed ones on the time axis.
    const xs = (d: string) => [...d.matchAll(/[ML]([\d.]+) /g)].map((m) => Number(m[1]));
    expect(Math.max(...xs(solid[0]!.getAttribute("d")!))).toBeLessThanOrEqual(
      Math.min(...xs(dashed[0]!.getAttribute("d")!)),
    );
  });

  it("marks now and every event ahead with a rule and a label, left to right", () => {
    const { container } = draw();
    const labels = [...container.querySelectorAll("text.chart-marker-label")].map(
      (t) => t.textContent,
    );
    expect(labels).toEqual([
      "now",
      "halving 3",
      "reissuance",
      "halving 4",
      "halving 5",
      "halving 6",
    ]);
    // A rule per marker, plus the cap.
    expect(container.querySelectorAll(".chart-marker line")).toHaveLength(labels.length + 1);
    const ruleX = [...container.querySelectorAll(".chart-marker line")]
      .slice(1)
      .map((l) => Number(l.getAttribute("x1")));
    expect(ruleX).toEqual([...ruleX].sort((a, b) => a - b));
  });

  it("tops the axis at the 21M cap, in thirds", () => {
    const { container } = draw();
    const ticks = [...container.querySelectorAll("g > text.chart-tick")].map((t) => t.textContent);
    expect(ticks).toEqual(["0 ZEC", "7M ZEC", "14M ZEC", "21M ZEC"]);
  });

  it("drops a label that has no room rather than overlap it, keeping the rule", () => {
    const { container } = render(
      <IssuanceChart outlook={outlook} now={NOW} ariaLabel="issuance" renderedWidth={320} />,
    );
    const labels = container.querySelectorAll("text.chart-marker-label");
    const rules = container.querySelectorAll(".chart-marker line");
    expect(rules).toHaveLength(7);
    expect(labels.length).toBeLessThan(6);
    expect(labels.length).toBeGreaterThan(0);
  });

  it("reads an observed close with its block, and a projected month as an estimate", () => {
    const { container, getByRole } = draw();
    const group = container.querySelector("[role='group']")!;
    fireEvent.focus(group);
    expect(getByRole("status").textContent).toMatch(/\d{4}-\d{2}-\d{2} · block [\d,]+/);
    expect(getByRole("status").textContent).toContain("Issued");
    fireEvent.keyDown(group, { key: "End" });
    expect(getByRole("status").textContent).toMatch(/· estimate/);
    expect(getByRole("status").textContent).toContain("Projected");
    expect(getByRole("status").textContent).toMatch(/Block≈ [\d,]+/);
  });

  it("carries no id, so two on a page cannot collide", () => {
    const { container } = draw();
    expect(container.querySelectorAll("svg [id]")).toHaveLength(0);
  });
});

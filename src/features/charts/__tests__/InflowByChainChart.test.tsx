import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InflowByChainChart } from "../InflowByChainChart";

const draw = (running: { index: number; throughDay: number } | null = null) =>
  render(
    <InflowByChainChart
      series={[
        { key: "ETH", label: "Ethereum", colorClass: "flow-1", values: [10, 300] },
        { key: "BTC", label: "Bitcoin", colorClass: "flow-3", values: [90, 100] },
        { key: "OTHER", label: "Other chains", colorClass: "flow-rest", values: [900, 0] },
      ]}
      labels={["Sep 26", "Oct 26"]}
      readoutLabels={["September 2026", "October 2026"]}
      running={running}
      foldKey="OTHER"
      formatValue={(v) => `${v}.00000000 ZEC`}
      formatSum={(v) => `${v} ZEC`}
      formatTick={(v) => `${v} ZEC`}
    />,
  );

const firstRow = () => screen.getAllByRole("row")[0]!.textContent ?? "";

describe("InflowByChainChart", () => {
  it("ranks the chains over every month shown until a month is read", () => {
    draw();
    expect(screen.getByText("September 2026 – October 2026 · 1400 ZEC")).toBeTruthy();
    expect(firstRow()).toContain("Ethereum");
  });

  it("rounds the key's amounts and keeps the exact one on hover", () => {
    draw();
    const cell = screen.getByText("310 ZEC");
    expect(cell.getAttribute("title")).toBe("310.00000000 ZEC");
  });

  it("re-ranks the key for the month the readout is on", () => {
    draw();
    const chart = screen.getByRole("group");
    fireEvent.focus(chart);
    // The first month: Bitcoin outranks Ethereum there, and the fold stays last.
    expect(screen.getByText("September 2026 · 1000 ZEC")).toBeTruthy();
    expect(firstRow()).toContain("Bitcoin");
    expect(screen.getAllByRole("row").at(-1)!.textContent).toContain("Other chains");
    fireEvent.blur(chart);
    expect(firstRow()).toContain("Ethereum");
  });

  it("names how far a running month reaches, on the bar and in the key", () => {
    draw({ index: 1, throughDay: 9 });
    expect(screen.getByRole("img").textContent).toContain("to 9 Oct");
    expect(screen.getByText("September 2026 – 9 Oct 2026 · 1400 ZEC")).toBeTruthy();
    // The month itself, read on its own, says how far it reaches.
    fireEvent.keyDown(screen.getByRole("group"), { key: "End" });
    fireEvent.focus(screen.getByRole("group"));
    expect(screen.getByText("October 2026, to 9 Oct · 400 ZEC")).toBeTruthy();
  });
});

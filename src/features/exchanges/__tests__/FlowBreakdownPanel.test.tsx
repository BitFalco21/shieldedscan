import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlowBreakdownPanel } from "../FlowBreakdownPanel";

describe("FlowBreakdownPanel", () => {
  it("explains the rows whose name does not, and only those", () => {
    render(
      <FlowBreakdownPanel
        title="WHERE IT WENT"
        showTxs={false}
        side={{
          zat: 1_000,
          txs: 3,
          parts: [
            { kind: "transparent", exchange: null, zat: 700 },
            { kind: "bridge", exchange: null, zat: 290 },
            { kind: "fee", exchange: null, zat: 10 },
          ],
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "What is bridges, where it went?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "What is fees, where it went?" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /transparent/i })).toBeNull();
  });
});

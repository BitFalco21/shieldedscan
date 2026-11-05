import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Nu7Clock } from "../Nu7Clock";

describe("Nu7Clock", () => {
  it("shows the estimate as hours, minutes and seconds, marked as an estimate", () => {
    render(<Nu7Clock seconds={7 * 3_600 + 5 * 60 + 42} spacingSeconds={75} blocksToGo={341} />);
    expect(screen.getByRole("timer").textContent).toContain("07hrs:05min:42sec");
    expect(screen.getByText("estimate · 75 s per block")).toBeTruthy();
  });

  it("says past the estimate while several blocks remain, and any moment for the last one", () => {
    const { rerender } = render(<Nu7Clock seconds={-40} spacingSeconds={75} blocksToGo={5} />);
    expect(screen.getByText("past the estimate")).toBeTruthy();
    rerender(<Nu7Clock seconds={-40} spacingSeconds={75} blocksToGo={1} />);
    expect(screen.getByText("any moment")).toBeTruthy();
  });
});

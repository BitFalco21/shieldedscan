import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActionPanel } from "../ActionPanel";

describe("ActionPanel", () => {
  it("copies as a sentence — real spaces between figure, ticker, chips and the label", () => {
    const { container } = render(
      <ActionPanel
        icon="transparent"
        parts={[
          { kind: "verb", text: "Moved", tone: "plain" },
          { kind: "text", text: " " },
          { kind: "zec", zat: 71_212_516 },
          { kind: "text", text: " from " },
          { kind: "end", end: "transparent", before: "3 ", after: " inputs" },
        ]}
        details={["≈ $932.98", "fee 0.00015 ZEC"]}
        limit="Which output is the payment and which is change."
      />,
    );
    // A gap that exists only in CSS is not a gap the text contains.
    expect(container.textContent).toContain("Moved 0.71212516 ZEC from 3 transparent inputs");
    expect(container.textContent).toContain("NOT ON CHAIN Which output is the payment");
    expect(container.textContent).toContain("≈ $932.98 · fee 0.00015 ZEC");
  });

  it("draws an encrypted amount as the Veil and never prices it", () => {
    render(
      <ActionPanel
        icon="shielded"
        parts={[
          { kind: "verb", text: "Moved", tone: "shielded" },
          { kind: "text", text: " " },
          { kind: "zec", zat: null },
          { kind: "text", text: " privately inside " },
          { kind: "end", end: "orchard" },
        ]}
        details={[]}
        limit="The amount, the parties and the memo."
      />,
    );
    expect(screen.getByRole("img", { name: /value shielded/ })).toBeDefined();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("draws no closing line when it is given no limit", () => {
    // A cross-chain transfer's far-side note lives in a tip beside the foreign leg instead.
    const { container } = render(
      <ActionPanel
        icon="swap"
        parts={[{ kind: "verb", text: "Swapped", tone: "plain" }]}
        details={[]}
      />,
    );
    expect(container.textContent).not.toContain("NOT ON CHAIN");
    expect(container.querySelector(".border-dashed")).toBeNull();
  });
});

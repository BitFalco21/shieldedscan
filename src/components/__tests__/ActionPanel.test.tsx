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
        zecUsd={100}
        limit="Which output is the payment and which is change."
      />,
    );
    // A gap that exists only in CSS is not a gap the text contains.
    expect(container.textContent).toContain("from 3 transparent inputs");
    expect(container.textContent).toContain("NOT ON CHAIN Which output is the payment");
    // The dollar figure beside the amount it prices, not under the whole sentence.
    expect(container.textContent).toContain("Moved 0.71212516 ZEC (≈ $71.21) from 3");
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
        limit="The amount, the parties and the memo."
      />,
    );
    expect(screen.getByRole("img", { name: /value shielded/ })).toBeDefined();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("draws no closing line when it is given no limit", () => {
    // A cross-chain transfer's far-side note lives in a tip beside the foreign leg instead.
    const { container } = render(
      <ActionPanel icon="swap" parts={[{ kind: "verb", text: "Swapped", tone: "plain" }]} />,
    );
    expect(container.textContent).not.toContain("NOT ON CHAIN");
    expect(container.querySelector(".border-dashed")).toBeNull();
  });

  it("draws what came before above the sentence, and what came after below its closing line", () => {
    const { container } = render(
      <ActionPanel
        icon="transparent"
        parts={[{ kind: "verb", text: "Moved", tone: "plain" }]}
        limit="Which output is the payment and which is change."
        lead={<p>earlier</p>}
      >
        <p>later</p>
      </ActionPanel>,
    );
    const text = container.textContent ?? "";
    expect(container.querySelectorAll("section")).toHaveLength(1);
    // The closing line stays with the sentence it qualifies, never under someone else's report.
    const order = ["earlier", "Moved", "NOT ON CHAIN", "later"].map((t) => text.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

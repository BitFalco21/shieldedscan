import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { crossChainTransfers } from "@/fixtures/crosschain";
import { CrossChainDetailPage } from "../CrossChainDetailPage";

/**
 * The action box states what happened and nothing else; what this explorer cannot vouch for
 * about the foreign leg is a tip beside that leg's label. The tip must land on the non-Zcash
 * side in both directions — SOURCE inbound, DESTINATION outbound.
 */
const inbound = crossChainTransfers.find((t) => t.direction === "in")!;
const outbound = crossChainTransfers.find((t) => t.direction === "out")!;

describe("the transfer page's far-side note", () => {
  it("is not in the action box", () => {
    const { container } = render(<CrossChainDetailPage transfer={outbound} zcashTxHref={null} />);
    const box = container.querySelector('section[aria-label="What happened"]')!;
    expect(box.textContent).not.toContain("NOT ON CHAIN");
    expect(box.textContent).not.toContain("venue’s report");
  });

  it("sits beside DESTINATION on an outbound crossing, and nowhere else", () => {
    render(<CrossChainDetailPage transfer={outbound} zcashTxHref={null} />);
    const tip = screen.getByRole("button", { name: "What is destination chain?" });
    expect(screen.getByRole("tooltip").textContent).toMatch(/side is the venue’s report/);
    expect(tip.closest(".relative")!.textContent).toContain("DESTINATION");
    expect(screen.queryByRole("button", { name: "What is source chain?" })).toBeNull();
  });

  it("sits beside SOURCE on an inbound crossing, and nowhere else", () => {
    render(<CrossChainDetailPage transfer={inbound} zcashTxHref={null} />);
    const tip = screen.getByRole("button", { name: "What is source chain?" });
    expect(screen.getByRole("tooltip").textContent).toMatch(/only the Zcash leg is checked here/);
    expect(tip.closest(".relative")!.textContent).toContain("SOURCE");
    expect(screen.queryByRole("button", { name: "What is destination chain?" })).toBeNull();
  });
});

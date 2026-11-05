import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NU7_HEIGHT, blockSummaryOf, type BlockSummary } from "@/domain";
import { blocks as fixtureBlocks } from "@/fixtures/blocks";
import { Nu7FirstBlocks } from "../Nu7FirstBlocks";

const T = 1_799_000_000;

function block(height: number, timestamp: number): BlockSummary {
  return { ...blockSummaryOf(fixtureBlocks[0]!), height, hash: `h${height}`, timestamp };
}

describe("Nu7FirstBlocks", () => {
  it("renders nothing until a block after the activation exists", () => {
    const { container } = render(<Nu7FirstBlocks blocks={[block(NU7_HEIGHT, T)]} />);
    expect(container.innerHTML).toBe("");
  });

  it("prints each real interval, and draws no bar for a backwards timestamp", () => {
    const { container } = render(
      <Nu7FirstBlocks
        blocks={[
          block(NU7_HEIGHT, T),
          block(NU7_HEIGHT + 1, T + 31),
          block(NU7_HEIGHT + 2, T + 26),
        ]}
      />,
    );
    expect(screen.getByText("31 s")).toBeTruthy();
    expect(screen.getByText("-5 s")).toBeTruthy();
    const bars = [...container.querySelectorAll("rect.fill-green-dim")].map((r) =>
      r.getAttribute("width"),
    );
    expect(bars).toEqual(["31", "0"]);
  });
});

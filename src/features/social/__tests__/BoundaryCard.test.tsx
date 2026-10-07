import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BoundaryFigures } from "@/domain/boundary";
import { BoundaryCard } from "../BoundaryCard";

const SHIELD: BoundaryFigures = {
  txid: "97d9e97db08967319516f224ef66c5618bab465d13d3327f5a942154b6b89338",
  blockHeight: 3_456_631,
  timestamp: 1_787_393_919,
  pools: [{ pool: "ironwood", valueBalanceZat: 6_938_583_540_000 }],
  priceUsd: 804.5431518554688,
};

const UNSHIELD: BoundaryFigures = {
  txid: "9d4e72e5000d2dd4d9039b8f525c28a84eb04c84734ae610d23cf8b4e168a1aa",
  blockHeight: 3_427_165,
  timestamp: 1_785_173_010,
  pools: [{ pool: "orchard", valueBalanceZat: -6_942_069_475_000 }],
  priceUsd: 476.6684875488281,
};

const TWO_POOL: BoundaryFigures = {
  txid: "d860bc0f19e7d14cac8f038b5fcab374253ba028de5aa97df14a15f8830d661f",
  blockHeight: 3_367_633,
  timestamp: 1_780_669_931,
  pools: [
    { pool: "sapling", valueBalanceZat: -135_801_146_190 },
    { pool: "orchard", valueBalanceZat: -5_891_668_958_810 },
  ],
  priceUsd: 389.2999267578125,
};

describe("BoundaryCard", () => {
  // Movement and amount are the card; the pool is stated once.
  it("leads with the movement and the amount", () => {
    render(<BoundaryCard figures={SHIELD} />);
    expect(screen.getByText("SHIELDING")).toBeTruthy();
    expect(screen.getByText("69,385.84")).toBeTruthy();
    expect(screen.getByText("$55,823,899")).toBeTruthy();
  });

  it("names the pool", () => {
    render(<BoundaryCard figures={SHIELD} />);
    expect(screen.getByText("Ironwood pool")).toBeTruthy();
  });

  it("reads the direction from the pools, not from a passed-in kind", () => {
    render(<BoundaryCard figures={UNSHIELD} />);
    expect(screen.getByText("UNSHIELDING")).toBeTruthy();
    expect(screen.getByText("Orchard pool")).toBeTruthy();
  });

  // Green is this site's privacy signal, so it lights up only when value becomes private.
  it("lights up for a shielding and stays neutral for an unshielding", () => {
    const { container, unmount } = render(<BoundaryCard figures={SHIELD} />);
    expect(container.querySelector('[data-dir="shielding"]')).toBeTruthy();
    unmount();
    const out = render(<BoundaryCard figures={UNSHIELD} />);
    expect(out.container.querySelector('[data-dir="unshielding"]')).toBeTruthy();
    expect(out.container.querySelector('[data-dir="shielding"]')).toBeNull();
  });

  it("gives each pool its own amount when more than one moved", () => {
    render(<BoundaryCard figures={TWO_POOL} />);
    expect(screen.getByText("Orchard + Sapling")).toBeTruthy();
    expect(screen.getByText(/58,916\.69 ZEC/)).toBeTruthy();
    expect(screen.getByText(/1,358\.01 ZEC/)).toBeTruthy();
  });

  // The pool label takes the LARGEST mover's tone, matching PoolBadge's table: strength of
  // the cryptography, not decoration.
  it("tones the pool name by which pool moved most", () => {
    const { container, unmount } = render(<BoundaryCard figures={TWO_POOL} />);
    expect(container.querySelector('.card-boundary-pool[data-tone="full"]')).toBeTruthy();
    unmount();
    const sapling = render(
      <BoundaryCard
        figures={{ ...TWO_POOL, pools: [{ pool: "sapling", valueBalanceZat: -500_000_000_000 }] }}
      />,
    );
    expect(sapling.container.querySelector('.card-boundary-pool[data-tone="dim"]')).toBeTruthy();
  });

  /**
   * The strip carries no scale and no figures: a plausible-looking chart nobody can check
   * would be a fabricated figure. It ramps the opposite way for the two directions, so left
   * to right always reads as the direction the value travelled.
   */
  it("ramps the strip the other way for the other direction", () => {
    const first = (c: Element) =>
      Number(c.querySelector(".card-boundary-lit rect")!.getAttribute("fill-opacity"));
    const shield = render(<BoundaryCard figures={SHIELD} />);
    const shieldFirst = first(shield.container);
    shield.unmount();
    const unshield = render(<BoundaryCard figures={UNSHIELD} />);
    expect(first(unshield.container)).toBeGreaterThan(shieldFirst);
  });

  it("draws no text, axis or figure inside the strip", () => {
    const { container } = render(<BoundaryCard figures={SHIELD} />);
    const svg = container.querySelector(".card-boundary-lit")!.closest("svg")!;
    expect(svg.querySelectorAll("text")).toHaveLength(0);
  });

  // The site's no-SVG-id rule holds here too: nothing in this SVG needs an identity.
  it("emits no SVG id anywhere", () => {
    const { container } = render(<BoundaryCard figures={SHIELD} />);
    expect(container.querySelectorAll("svg [id]")).toHaveLength(0);
  });

  it("carries the render step's screenshot hook", () => {
    const { container } = render(<BoundaryCard figures={SHIELD} />);
    expect(container.querySelector("[data-social-card]")).toBeTruthy();
  });

  // The rate travels with the dollar figure, so a screenshot years later still states what
  // the crossing was worth THEN rather than implying what it is worth now.
  it("prints the rate beside the dollar figure", () => {
    render(<BoundaryCard figures={SHIELD} />);
    expect(screen.getByText(/at \$804\.54 \/ ZEC/)).toBeTruthy();
  });

  it("refuses to render an incomplete crossing rather than drawing a blank", () => {
    expect(() => render(<BoundaryCard figures={{ ...SHIELD, priceUsd: null }} />)).toThrow();
    expect(() =>
      render(
        <BoundaryCard
          figures={{
            ...SHIELD,
            pools: [
              { pool: "sapling", valueBalanceZat: -100 },
              { pool: "orchard", valueBalanceZat: 5 },
            ],
          }}
        />,
      ),
    ).toThrow();
  });

  // What crossed the boundary is public; who moved it is not.
  it("shows no address, label or attribution", () => {
    const { container } = render(<BoundaryCard figures={SHIELD} />);
    expect(container.textContent).not.toMatch(/\bt1[a-zA-Z0-9]{20,}/);
    expect(container.textContent).not.toMatch(/wallet|exchange|owner/i);
  });
});

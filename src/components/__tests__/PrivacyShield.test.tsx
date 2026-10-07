import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain";
import { PrivacyShield, privacyCountLabel, privacyVariantFor } from "../PrivacyShield";

describe("PrivacyShield", () => {
  it.each([
    ["shielded", "shield-shielded", "fully shielded"],
    ["transparent", "shield-transparent", "transparent"],
    ["mixed", "shield-mixed", "mixed — partly shielded"],
  ] as const)("labels and styles the %s variant", (variant, className, label) => {
    render(<PrivacyShield variant={variant} />);
    const shield = screen.getByRole("img", { name: label });
    // getAttribute, not `.className`: on an SVG element that property is an
    // SVGAnimatedString object rather than a string, so `toContain` sees no characters.
    expect(shield.getAttribute("class")).toContain(className);
  });

  it("distinguishes the three states by shape, not only by colour", () => {
    // The whole point of the shield over the dot: fill level is the primary channel, so the
    // mark still carries its meaning for a reader who cannot see the green. Colour is
    // redundant reinforcement and must never be the sole difference.
    const fillOf = (variant: "shielded" | "transparent" | "mixed") => {
      const { container } = render(<PrivacyShield variant={variant} />);
      const paths = [...container.querySelectorAll("path")];
      return {
        pathCount: paths.length,
        outlineFill: paths[paths.length - 1]?.getAttribute("fill"),
      };
    };

    // Full silhouette filled.
    expect(fillOf("shielded")).toEqual({ pathCount: 1, outlineFill: "currentColor" });
    // Outline only.
    expect(fillOf("transparent")).toEqual({ pathCount: 1, outlineFill: "none" });
    // A second, half-silhouette path under an unfilled outline.
    expect(fillOf("mixed")).toEqual({ pathCount: 2, outlineFill: "none" });
  });

  it.each([
    ["shielded", "fully shielded"],
    ["transparent", "transparent"],
    ["mixed", "mixed — partly shielded"],
  ] as const)("hovers the %s variant with its own name", (variant, label) => {
    // Without this the shield is a mark you have to have learned: the blocks list stands
    // three of them alone in a column with no text beside them.
    const { container } = render(<PrivacyShield variant={variant} />);
    expect(container.querySelector("title")?.textContent).toBe(label);
  });

  it("says the same thing to a pointer and to a screen reader", () => {
    // One prop drives both channels. A hover richer than the accessible name would hand a
    // screen-reader user the poorer of the two facts.
    const { container } = render(
      <PrivacyShield variant="shielded" label="3 fully shielded transactions" />,
    );
    expect(container.querySelector("title")?.textContent).toBe("3 fully shielded transactions");
    expect(screen.getByRole("img", { name: "3 fully shielded transactions" })).toBeDefined();
  });

  it("emits no SVG ids, so a table of rows cannot collide on one", () => {
    // A clipPath or gradient would need an id; 25 rows sharing it is invalid markup whose
    // rendering depends on document order. Two plain paths have no identity to collide.
    const { container } = render(<PrivacyShield variant="mixed" />);
    expect(container.querySelectorAll("[id]")).toHaveLength(0);
    expect(container.querySelectorAll("clipPath, linearGradient, mask")).toHaveLength(0);
  });
});

describe("privacyCountLabel", () => {
  it("agrees in number with the count it carries", () => {
    expect(privacyCountLabel("shielded", 1)).toBe("1 fully shielded transaction");
    expect(privacyCountLabel("shielded", 3)).toBe("3 fully shielded transactions");
    expect(privacyCountLabel("transparent", 1_204)).toBe("1,204 transparent transactions");
  });

  it("keeps the gloss that makes 'mixed' mean something", () => {
    // "2 mixed transactions" is the one form that tells a newcomer nothing on its own.
    expect(privacyCountLabel("mixed", 2)).toBe("2 mixed transactions — partly shielded");
  });
});

describe("privacyVariantFor", () => {
  const base: Transaction = {
    txid: "ab".repeat(32),
    blockHeight: 100,
    blockHash: "0b".repeat(32),
    timestamp: 1_783_875_480,
    isCoinbase: false,
    version: 5,
    sizeBytes: 1000,
    lockTime: 0,
    expiryHeight: 140,
    rawHex: null,
    feeZat: 1000,
    bindingSigValid: true,
    transparentInputs: [],
    transparentOutputs: [],
    sprout: null,
    sapling: null,
    orchard: null,
    ironwood: null,
  };
  const tIn = { address: "t1ExampleInputAddress0000000001", valueZat: 100_000_000 };
  const tOut = { address: "t1ExampleOutputAddress000000001", valueZat: 99_990_000 };
  const orchard = { actions: 2, valueBalanceZat: -100_000_000 };

  it("maps a fully shielded transaction to the shielded variant", () => {
    expect(privacyVariantFor({ ...base, orchard })).toBe("shielded");
  });

  it("maps a transparent-only transaction to the transparent variant", () => {
    expect(
      privacyVariantFor({ ...base, transparentInputs: [tIn], transparentOutputs: [tOut] }),
    ).toBe("transparent");
  });

  it("maps a mixed t->z transaction to the mixed variant", () => {
    expect(privacyVariantFor({ ...base, transparentInputs: [tIn], orchard })).toBe("mixed");
  });
});

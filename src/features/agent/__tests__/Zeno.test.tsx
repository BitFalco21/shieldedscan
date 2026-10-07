import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SHIELD } from "@/components/PrivacyShield";
import { Zeno } from "../Zeno";
import type { ZenoExpression } from "../zeno-mood";

const EXPRESSIONS: readonly ZenoExpression[] = [
  "ready",
  "thinking",
  "reading",
  "writing",
  "answered",
  "stuck",
];

const svgOf = (ui: React.ReactElement) => render(ui).container.querySelector("svg")!;

describe("Zeno", () => {
  it("is decorative: hidden from assistive technology", () => {
    for (const expression of EXPRESSIONS) {
      expect(svgOf(<Zeno expression={expression} stage />).getAttribute("aria-hidden")).toBe(
        "true",
      );
    }
  });

  it("carries no SVG id in any state, so a second instance can never collide with the first", () => {
    // The page renders up to three at once (the rail, the phone bar, a phone turn's stage).
    for (const expression of EXPRESSIONS) {
      const { container } = render(<Zeno expression={expression} stage blocks={4} slow={2} />);
      expect(container.querySelectorAll("[id]")).toHaveLength(0);
    }
  });

  it("wears the site's own shield path, not a redrawn one", () => {
    const paths = Array.from(svgOf(<Zeno />).querySelectorAll("path")).map((p) =>
      p.getAttribute("d"),
    );
    expect(paths).toContain(SHIELD);
  });

  it("draws colour only through token classes, never a literal", () => {
    for (const expression of EXPRESSIONS) {
      const { container } = render(<Zeno expression={expression} stage blocks={3} slow={2} />);
      expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(|style=/i);
    }
  });

  it("names its state on the element, for anything that needs to read it", () => {
    const svg = svgOf(<Zeno expression="reading" stage blocks={2} />);
    expect(svg.getAttribute("data-zeno-expression")).toBe("reading");
    expect(svg.getAttribute("data-zeno-blocks")).toBe("2");
  });

  it("stacks exactly the blocks it is given, at most four, and only on a stage", () => {
    const blocks = (ui: React.ReactElement) => svgOf(ui).querySelectorAll(".zeno-block").length;
    expect(blocks(<Zeno expression="reading" stage blocks={0} />)).toBe(0);
    expect(blocks(<Zeno expression="reading" stage blocks={3} />)).toBe(3);
    expect(blocks(<Zeno expression="reading" stage blocks={9} />)).toBe(4);
    // Off the stage there is nowhere to put them.
    expect(blocks(<Zeno expression="reading" blocks={3} />)).toBe(0);
  });

  it("celebrates only an answer, and fizzles only a non-answer", () => {
    const confetti = (e: ZenoExpression) =>
      svgOf(<Zeno expression={e} stage />).querySelectorAll(".zeno-confetti rect").length;
    const smoke = (e: ZenoExpression) =>
      svgOf(<Zeno expression={e} stage />).querySelectorAll(".zeno-puff").length;
    for (const e of EXPRESSIONS) {
      expect(confetti(e), e).toBe(e === "answered" ? 12 : 0);
      expect(smoke(e), e).toBe(e === "stuck" ? 3 : 0);
    }
  });

  it("works the bubble while a turn runs, and blinks its cursor otherwise", () => {
    for (const e of EXPRESSIONS) {
      const svg = svgOf(<Zeno expression={e} />);
      const live = e === "thinking" || e === "reading" || e === "writing";
      expect(svg.querySelectorAll(".zeno-dot"), e).toHaveLength(live ? 3 : 0);
      expect(svg.querySelectorAll(".zeno-cursor"), e).toHaveLength(live ? 0 : 1);
    }
  });

  it("sweats on a slow turn: one drop, then two and a hand to the face", () => {
    const at = (slow: 0 | 1 | 2) => svgOf(<Zeno expression="thinking" slow={slow} />);
    expect(at(0).querySelectorAll(".zeno-sweat")).toHaveLength(0);
    expect(at(1).querySelectorAll(".zeno-sweat")).toHaveLength(1);
    expect(at(2).querySelectorAll(".zeno-sweat")).toHaveLength(2);
    expect(at(2).querySelectorAll(".zeno-scratch")).toHaveLength(1);
  });

  it("is the face alone in the head variant: no body, no bubble, no stage", () => {
    const svg = svgOf(<Zeno variant="head" expression="answered" stage blocks={3} />);
    expect(svg.querySelector('path[d="' + SHIELD + '"]')).toBeNull();
    expect(svg.querySelector("text")).toBeNull();
    expect(svg.querySelectorAll(".zeno-block")).toHaveLength(0);
    expect(svg.querySelectorAll(".zeno-confetti rect")).toHaveLength(0);
  });
});

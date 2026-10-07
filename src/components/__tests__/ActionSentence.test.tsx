import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActionPart } from "@/domain";
import { ActionSentence } from "../ActionSentence";
import { ProtocolLogo } from "../ProtocolLogo";

/**
 * Every mark in an action sentence sits on the text line by one rule (`align-middle`), and every
 * mark is the same 14px size, so chip labels line up with the words around them.
 */

const PARTS: ActionPart[] = [
  { kind: "verb", text: "Swapped", tone: "plain" },
  { kind: "text", text: " " },
  { kind: "zec", zat: 150_000_000 },
  { kind: "text", text: " from " },
  { kind: "end", end: "transparent", before: "2 ", after: " outputs" },
  { kind: "text", text: " to " },
  { kind: "asset", amount: "0.004", ticker: "BTC", chain: "BTC" },
  { kind: "text", text: " on " },
  { kind: "chain", chain: "BTC", label: "Bitcoin" },
  { kind: "text", text: " " },
  { kind: "venue", protocol: "thorchain", before: "via " },
];

describe("ActionSentence", () => {
  it("aligns no mark by a hand-tuned pixel offset", () => {
    const { container } = render(<ActionSentence parts={PARTS} />);
    const offsets = Array.from(container.querySelectorAll("[class]")).filter((el) =>
      /\balign-\[/.test(el.getAttribute("class") ?? ""),
    );
    expect(offsets.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });

  it("centres every mark — coin, pool chip, chain chip, venue — by the one middle rule", () => {
    const { container } = render(<ActionSentence parts={PARTS} />);
    // Each SVG mark and each chip is inside (or is) an `align-middle` box.
    const marks = Array.from(container.querySelectorAll("svg"));
    expect(marks.length).toBeGreaterThanOrEqual(4);
    for (const svg of marks) {
      expect(svg.closest(".align-middle"), svg.outerHTML.slice(0, 80)).not.toBeNull();
    }
  });

  it("keeps the venue's NAME a word in the sentence, not inside the centred box", () => {
    const { container } = render(<ActionSentence parts={PARTS} />);
    expect(container.textContent).toContain("via THORChain");
    const name = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "THORChain",
    );
    expect(name?.closest(".align-middle")).toBeNull();
  });

  it("draws every logo in the sentence at 14px, the venue's included", () => {
    const { container } = render(<ActionSentence parts={PARTS} />);
    for (const svg of Array.from(container.querySelectorAll("svg[viewBox]"))) {
      const cls = svg.getAttribute("class") ?? "";
      if (cls.includes("h-2.5")) continue; // the pool chip's 10px shield
      expect(cls, svg.outerHTML.slice(0, 80)).toMatch(/\bh-3(\.5)?\b/);
      expect(cls).not.toContain("18px");
    }
  });
});

describe("ProtocolLogo", () => {
  it("honours its size — the row mark by default, 14px in prose", () => {
    const row = render(<ProtocolLogo protocol="thorchain" />).container.querySelector("svg");
    expect(row?.getAttribute("class")).toContain("h-[18px]");
    const sm = render(<ProtocolLogo protocol="thorchain" size="sm" />).container.querySelector(
      "svg",
    );
    expect(sm?.getAttribute("class")).toContain("h-3.5");
  });
});

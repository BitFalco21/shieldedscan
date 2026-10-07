import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShareBar, shareBarWidth } from "@/components/ShareBar";

describe("shareBarWidth", () => {
  it("draws a share at its own width", () => {
    expect(shareBarWidth(42.5)).toBe(42.5);
  });

  it("lifts a tiny but real share to the floor, and leaves zero and unknown empty", () => {
    expect(shareBarWidth(0.01)).toBe(0.6);
    expect(shareBarWidth(0.01, 1)).toBe(1);
    expect(shareBarWidth(0)).toBe(0);
    expect(shareBarWidth(null)).toBe(0);
  });

  it("draws a negative share by its magnitude and never past the track", () => {
    expect(shareBarWidth(-12)).toBe(12);
    expect(shareBarWidth(140)).toBe(100);
  });
});

describe("ShareBar", () => {
  it("renders a decorative track and fill sized by SVG attributes", () => {
    const { container } = render(
      <ShareBar pct={25} height={6} rx={2} className="h-1.5" fillClassName="text-green" />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 100 6");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("class")).toBe("h-1.5");
    const [track, fill] = Array.from(container.querySelectorAll("rect"));
    expect(track?.getAttribute("width")).toBe("100");
    expect(track?.getAttribute("class")).toBe("text-edge-faint");
    expect(fill?.getAttribute("width")).toBe("25");
    expect(fill?.getAttribute("height")).toBe("6");
    expect(fill?.getAttribute("rx")).toBe("2");
    expect(fill?.getAttribute("class")).toBe("text-green");
  });
});

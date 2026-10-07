import { describe, expect, it } from "vitest";
import { BRAND_MARKS, brandMark, canonicalMarkTicker, markSizeClass } from "../brand-marks";

/**
 * Guards against a mark whose data is absent or malformed: it still renders an `<svg>`, so
 * nothing looks broken.
 *
 * These run without a browser, so they check what can be checked from the data alone —
 * presence, parseability, and that the lookup refuses anything unusable. The geometric half
 * (centred inside its viewBox, actually paints ink) needs `getBBox` and lives in
 * `e2e/charts.spec.ts`.
 */
describe("BRAND_MARKS", () => {
  const entries = Object.entries(BRAND_MARKS);

  it("has entries", () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it("every mark carries path data", () => {
    // An empty path draws nothing, which reads as whitespace.
    const empty = entries.filter(([, mark]) => mark.d.trim() === "").map(([ticker]) => ticker);
    expect(empty, `marks with no path data: ${empty.join(", ")}`).toEqual([]);
  });

  it("every path starts with a move command", () => {
    // A `d` that does not begin with M/m is invalid and the browser discards the whole path.
    const malformed = entries
      .filter(([, mark]) => !/^\s*[Mm]/.test(mark.d))
      .map(([ticker]) => ticker);
    expect(malformed, `paths not starting with a move: ${malformed.join(", ")}`).toEqual([]);
  });

  it("no path contains a non-finite coordinate", () => {
    const bad = entries
      .filter(([, mark]) => /NaN|Infinity|undefined|null/.test(mark.d))
      .map(([ticker]) => ticker);
    expect(bad, `paths with non-numeric coordinates: ${bad.join(", ")}`).toEqual([]);
  });

  it("every viewBox is four finite numbers with positive extent", () => {
    const bad: string[] = [];
    for (const [ticker, mark] of entries) {
      const parts = mark.viewBox
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        bad.push(`${ticker}: viewBox "${mark.viewBox}"`);
        continue;
      }
      const [, , w, h] = parts as [number, number, number, number];
      if (w <= 0 || h <= 0) bad.push(`${ticker}: viewBox has no extent`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("markSizeClass never returns an empty class", () => {
    for (const [ticker, mark] of entries) {
      expect(markSizeClass(mark).trim(), `${ticker} got no size class`).not.toBe("");
    }
  });
});

describe("brandMark", () => {
  it("finds a mark case-insensitively", () => {
    expect(brandMark("btc")).not.toBeNull();
    expect(brandMark("BTC")).not.toBeNull();
  });

  it("returns null for an unknown ticker, so the lettermark takes over", () => {
    // Venues list new chains without warning; an unknown one must still render.
    expect(brandMark("NOTACHAIN")).toBeNull();
    expect(brandMark("")).toBeNull();
    expect(brandMark(null)).toBeNull();
    expect(brandMark(undefined)).toBeNull();
  });

  it("treats a blank path as no mark at all", () => {
    // Without the guard, an entry with empty data renders an invisible SVG instead of falling
    // back to the lettermark.
    const ticker = "BLANKTESTONLY";
    (BRAND_MARKS as Record<string, { viewBox: string; d: string }>)[ticker] = {
      viewBox: "0 0 24 24",
      d: "   ",
    };
    try {
      expect(brandMark(ticker)).toBeNull();
    } finally {
      delete (BRAND_MARKS as Record<string, unknown>)[ticker];
    }
  });

  it("resolves the venue's chain slug as well as the ticker", () => {
    // The key is whatever the venue calls the chain, and it sends either form. A mark filed
    // under one spelling and requested by the other is a silent miss that looks like a
    // missing logo — the failure this alias table exists to prevent.
    expect(brandMark("GNOSIS")).toBe(brandMark("GNO"));
    expect(brandMark("gnosis")).not.toBeNull();
    expect(brandMark("COSMOS")).toBe(brandMark("ATOM"));
  });

  it("reports the canonical key, so the colour class follows the silhouette", () => {
    expect(canonicalMarkTicker("GNOSIS")).toBe("GNO");
    expect(canonicalMarkTicker("cosmos")).toBe("ATOM");
    expect(canonicalMarkTicker("BTC")).toBe("BTC");
    expect(canonicalMarkTicker("NOTACHAIN")).toBeNull();
  });

  it("has a mark for every chain that was reported showing a lettermark", () => {
    // Marks sourced from CC0/MIT sets or constructed from an official reference. If any
    // regresses to absent, this names it rather than leaving a blank on a table row.
    for (const ticker of [
      "ATOM",
      "GNO",
      "APTOS",
      "STARKNET",
      "KUJIRA",
      "BERACHAIN",
      "PLASMA",
      "XRD",
      "ALEO",
      "BASE",
    ]) {
      const mark = brandMark(ticker);
      expect(mark, `${ticker} has no mark`).not.toBeNull();
      expect(mark!.d.length, `${ticker} has suspiciously short path data`).toBeGreaterThan(100);
    }
  });
});

/**
 * Base's mark is pinned because a featureless square is easy to mistake for a broken logo.
 *
 * A plain blue rounded square is Base's logo — "The Square", their foundational icon since the
 * 2025 rebrand, which their own guidance reserves for favicons and app icons.
 *
 * The path below is a scaled copy of `logo/TheSquare/Digital/Base_square_blue.svg` in
 * `github.com/base/brand-kit`. Do not replace it with the superseded circle-with-a-chord.
 */
describe("BASE stays Base's official Square", () => {
  const square = BRAND_MARKS.BASE;

  it("is the exact path from Base's own brand kit", () => {
    expect(square?.d).toBe(
      "M3 4.706c0-.585 0-.877.11-1.101.106-.215.28-.39.496-.495C3.83 3 4.122 3 4.706 3h14.588c.585 0 .876 0 1.101.11.215.105.389.28.494.495.111.225.111.517.111 1.101v14.588c0 .585 0 .876-.11 1.101-.106.215-.28.389-.495.494-.225.111-.517.111-1.101.111H4.706c-.585 0-.876 0-1.101-.11a1.08 1.08 0 0 1-.494-.495C3 20.17 3 19.878 3 19.294z",
    );
  });

  it("is one closed subpath — a square, with no glyph cut into it", () => {
    // The failure this guards: someone adds an inner shape to make it "look like a logo".
    expect((square?.d.match(/M/g) ?? []).length).toBe(1);
    expect(square?.d.endsWith("z")).toBe(true);
  });

  it("is symmetric inside its viewBox, which the first attempt was not", () => {
    // The mark insets equally on all four sides of its 24-wide box.
    expect(square?.viewBox).toBe("0 0 24 24");
    expect(square?.d.startsWith("M3 4.706")).toBe(true);
    expect(square?.d).toContain("h14.588");
  });
});

describe("THORChain's bolt", () => {
  it("is filed under THOR, and RUNE carries the same mark", () => {
    expect(brandMark("THOR")).not.toBeNull();
    expect(canonicalMarkTicker("RUNE")).toBe("THOR");
  });

  it("is two closed triangles that meet at one point", () => {
    const d = BRAND_MARKS.THOR!.d;
    const triangles = d.split("M").filter((s) => s.trim() !== "");
    expect(triangles).toHaveLength(2);
    for (const t of triangles) expect(t.trim().endsWith("Z")).toBe(true);
    // The waist: the shared vertex is what makes it one bolt rather than two shards.
    expect(triangles.every((t) => t.includes("213 194"))).toBe(true);
  });

  it("sits in a square viewBox, so it takes the 18px square box", () => {
    expect(markSizeClass(BRAND_MARKS.THOR!)).toBe("h-[18px] w-[18px] shrink-0");
  });
});

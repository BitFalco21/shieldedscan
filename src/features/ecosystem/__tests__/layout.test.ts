import { describe, expect, it } from "vitest";
import { ECOSYSTEM_CATEGORIES, ECOSYSTEM_ENTRIES } from "@/domain/ecosystem";
import {
  LABEL_CHARS,
  NODE_R,
  RING0_B,
  SPACING,
  arcPoints,
  clockAngle,
  labelLines,
  layoutEcosystem,
  onEllipse,
} from "../layout";

const layout = layoutEcosystem(ECOSYSTEM_CATEGORIES, ECOSYSTEM_ENTRIES);

describe("layoutEcosystem", () => {
  it("places every project exactly once, in the colour slot of its own category", () => {
    const ids = layout.nodes.map((n) => n.entry.id);
    expect(ids).toHaveLength(ECOSYSTEM_ENTRIES.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of layout.nodes) {
      expect(layout.sectors[n.slot - 1]!.meta.id, n.entry.id).toBe(n.entry.category);
    }
  });

  it("never puts two discs closer than a ring step, so no name runs into a neighbour", () => {
    let closest = Infinity;
    for (const a of layout.nodes)
      for (const b of layout.nodes)
        if (a !== b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    expect(closest).toBeGreaterThanOrEqual(SPACING * 0.85);
  });

  it("keeps the centre clear for the Zcash mark", () => {
    for (const n of layout.nodes)
      expect(Math.hypot(n.x, n.y), n.entry.id).toBeGreaterThan(RING0_B - 1);
  });

  it("gives each category one contiguous wedge, clockwise in listed order, never overlapping", () => {
    let last = -Infinity;
    for (const s of layout.sectors) {
      const angles = layout.nodes.filter((n) => n.slot === s.slot).map((n) => clockAngle(n.x, n.y));
      // Node coordinates are rounded to 0.01, so angles are compared to a thousandth.
      expect(Math.min(...angles), s.meta.id).toBeGreaterThan(last);
      last = Math.max(...angles);
      expect(s.start).toBeLessThanOrEqual(Math.min(...angles) + 1e-3);
      expect(s.end).toBeGreaterThanOrEqual(Math.max(...angles) - 1e-3);
    }
    expect(last).toBeLessThan(2 * Math.PI);
  });

  it("counts each category's projects on its label", () => {
    for (const s of layout.sectors) {
      expect(s.count).toBe(ECOSYSTEM_ENTRIES.filter((e) => e.category === s.meta.id).length);
    }
  });

  it("frames every disc, name and category label inside the drawing's own bounds", () => {
    for (const n of layout.nodes) {
      expect(Math.abs(n.x) + NODE_R).toBeLessThan(layout.halfWidth);
      expect(Math.abs(n.y) + NODE_R).toBeLessThan(layout.halfHeight);
    }
    for (const s of layout.sectors) {
      expect(Math.abs(s.labelX)).toBeLessThan(layout.halfWidth);
      expect(Math.abs(s.labelY)).toBeLessThan(layout.halfHeight);
    }
  });

  it("is deterministic, so the server and the client lay out identically", () => {
    expect(layoutEcosystem(ECOSYSTEM_CATEGORIES, ECOSYSTEM_ENTRIES)).toEqual(layout);
  });

  it("gives an empty category no wedge instead of a label over nothing", () => {
    const out = layoutEcosystem(
      ECOSYSTEM_CATEGORIES,
      ECOSYSTEM_ENTRIES.filter((e) => e.category !== "mining"),
    );
    expect(out.sectors.map((s) => s.meta.id)).not.toContain("mining");
    expect(out.nodes).toHaveLength(ECOSYSTEM_ENTRIES.filter((e) => e.category !== "mining").length);
  });

  it("grows rather than overlaps when a category doubles", () => {
    const doubled = [
      ...ECOSYSTEM_ENTRIES,
      ...ECOSYSTEM_ENTRIES.filter((e) => e.category === "wallet").map((e) => ({
        ...e,
        id: `${e.id}-2`,
      })),
    ];
    const bigger = layoutEcosystem(ECOSYSTEM_CATEGORIES, doubled);
    expect(bigger.rings).toBeGreaterThanOrEqual(layout.rings);
    expect(bigger.nodes).toHaveLength(doubled.length);
  });
});

describe("labelLines", () => {
  it("keeps a short name on one line", () => {
    expect(labelLines("Zcash")).toEqual(["Zcash"]);
  });

  it("wraps at spaces, then breaks a long hyphenated word after its hyphen", () => {
    expect(labelLines("Financial Privacy Foundation")).toEqual([
      "Financial",
      "Privacy",
      "Foundation",
    ]);
    expect(labelLines("sapling-crypto")).toEqual(["sapling-", "crypto"]);
  });

  it("never draws a line longer than the limit, and marks a cut name as cut", () => {
    for (const e of ECOSYSTEM_ENTRIES) {
      for (const line of labelLines(e.name))
        expect(line.length, e.name).toBeLessThanOrEqual(LABEL_CHARS);
    }
    const cut = labelLines("aaaa bbbb cccc dddd eeee ffff gggg hhhh");
    expect(cut).toHaveLength(3);
    expect(cut[2]!.endsWith("…")).toBe(true);
  });
});

describe("geometry", () => {
  it("measures angles clockwise from twelve o'clock", () => {
    expect(clockAngle(0, -1)).toBeCloseTo(0);
    expect(clockAngle(1, 0)).toBeCloseTo(Math.PI / 2);
    expect(clockAngle(0, 1)).toBeCloseTo(Math.PI);
  });

  it("finds the point on an ellipse at a clock angle", () => {
    expect(onEllipse(200, 100, 0)).toEqual({ x: 0, y: -100 });
    expect(onEllipse(200, 100, Math.PI / 2)).toEqual({ x: 200, y: 0 });
  });

  it("samples an arc from its start angle to its end angle", () => {
    const pts = arcPoints(200, 100, 0, Math.PI / 2, 4);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual({ x: 0, y: -100 });
    expect(pts[4]).toEqual({ x: 200, y: 0 });
  });
});

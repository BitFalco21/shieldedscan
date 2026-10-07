import { describe, expect, it } from "vitest";
import { ECOSYSTEM_CATEGORIES, ECOSYSTEM_ENTRIES } from "@/domain/ecosystem";
import { HOME_3D } from "../camera";
import { NODE_R, layoutEcosystem } from "../layout";
import { NAME_FONT, buildScene, type SceneNode } from "../scene";

const layout = layoutEcosystem(ECOSYSTEM_CATEGORIES, ECOSYSTEM_ENTRIES);
const nodes = (items: ReturnType<typeof buildScene>["items"]) =>
  items.filter((i): i is SceneNode => i.kind === "node");

/** The box a drawn name occupies, as the scene measures it. */
function nameBox(n: SceneNode) {
  const b = n.labelScale * n.scale;
  const half = (Math.max(...n.node.lines.map((l) => l.length)) * 8.2 * b) / 2;
  const top = n.y + NODE_R * n.scale + 4 * b;
  return { x0: n.x - half, x1: n.x + half, y0: top, y1: top + (4 + n.node.lines.length * 16) * b };
}

describe("buildScene", () => {
  it("draws every name, at its natural size, in the flat view", () => {
    const flat = nodes(buildScene(layout, { yaw: 0, pitch: 0, tx: 0, ty: 0 }).items);
    expect(flat).toHaveLength(ECOSYSTEM_ENTRIES.length);
    expect(flat.every((n) => n.showLabel && n.labelScale === 1)).toBe(true);
  });

  for (const [name, view] of [
    ["resting 3D", { yaw: HOME_3D.yaw, pitch: HOME_3D.pitch, tx: HOME_3D.tx, ty: HOME_3D.ty }],
    ["turned and nearly edge-on", { yaw: 2.2, pitch: 1.35, tx: 300, ty: -100 }],
  ] as const) {
    it(`never lets two drawn names overlap in 3D (${name})`, () => {
      const shown = nodes(buildScene(layout, view, 20).items).filter((n) => n.showLabel);
      expect(shown.length).toBeGreaterThan(0);
      for (const a of shown)
        for (const b of shown) {
          if (a === b) continue;
          const p = nameBox(a);
          const q = nameBox(b);
          const hit = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
          expect(hit, `${a.node.entry.id} over ${b.node.entry.id}`).toBe(false);
        }
    });
  }

  it("keeps a drawn name at the legibility floor, within the boost ceiling", () => {
    const minFont = 20;
    for (const n of nodes(buildScene(layout, { ...HOME_3D }, minFont).items)) {
      const font = NAME_FONT * n.scale * n.labelScale;
      if (n.labelScale < 2.4) expect(font).toBeGreaterThanOrEqual(minFont - 1e-6);
      expect(n.labelScale).toBeGreaterThanOrEqual(1);
    }
  });

  it("shows more names as the reader zooms in, because the floor shrinks in world units", () => {
    const far = nodes(buildScene(layout, { ...HOME_3D }, 24).items).filter((n) => n.showLabel);
    const near = nodes(buildScene(layout, { ...HOME_3D }, 8).items).filter((n) => n.showLabel);
    expect(near.length).toBeGreaterThan(far.length);
  });

  it("draws nothing the camera is too close to, instead of a disc filling the stage", () => {
    const scene = buildScene(layout, { yaw: 0, pitch: 1.45, tx: 0, ty: -1400 });
    for (const n of nodes(scene.items)) expect(n.scale).toBeLessThanOrEqual(2.6);
  });

  it("fades distant projects but never below the floor, and never fades a near one", () => {
    for (const n of nodes(buildScene(layout, { ...HOME_3D }, 0).items)) {
      expect(n.fade).toBeGreaterThanOrEqual(0.42);
      if (n.scale >= 1) expect(n.fade).toBe(1);
    }
  });
});

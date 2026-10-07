import { CORE_SIZE, NODE_R, arcPoints, type EcosystemLayout, type PlacedNode } from "./layout";
import { project, type Orientation, type Projected } from "./projection";

/**
 * One frame of the stage: every mark projected for a camera, sorted far to near so the nearer
 * disc draws over the further one. In 2D both angles are zero and the scene is the layout
 * itself, so it is computed once and only the camera's shift and zoom change per frame.
 *
 * In 3D two things keep it legible, because a tilted plane squeezes its rows together:
 *
 * - Names are placed nearest-first, and a name that would land on a nearer name or disc is
 *   left out, the collision rule every map uses. Turning or tilting brings names back as rows
 *   open up, and the hovered or picked project always keeps its name. Only words are hidden,
 *   never a disc.
 * - Distance fades a project a little, so the eye reads the near rows first. A project the
 *   camera is too close to (or behind) is not drawn at all.
 */

export interface View extends Orientation {
  /** The world point the camera orbits: the centre of the stage. */
  tx: number;
  ty: number;
}

export interface SceneNode extends Projected {
  kind: "node";
  node: PlacedNode;
  /** Whether its name has room to be drawn this frame. */
  showLabel: boolean;
  /** Extra scale on its name, so a name never renders smaller than the legible floor. */
  labelScale: number;
  /** 1 on the picture plane and nearer; less, down to a floor, further away. */
  fade: number;
}

export interface SceneCore extends Projected {
  kind: "core";
}

export interface SceneSector {
  id: string;
  slot: number;
  /** The category's arc as an SVG polyline `points` string. */
  arc: string;
  label: Projected;
  /** Extra scale on the category label, the same legibility floor names get. */
  labelScale: number;
  lines: string[];
  count: number;
  anchor: "start" | "middle" | "end";
}

export interface Scene {
  items: (SceneNode | SceneCore)[];
  sectors: SceneSector[];
}

/** Beyond this perspective scale a mark is too close to the camera to draw. */
const NEAR_LIMIT = 2.6;
/** A name's rendered width per character and line height, in world units (13.5px mono). */
const CHAR_W = 8.2;
const LINE_H = 16;
const FADE_FLOOR = 0.42;

const fixed = (n: number) => Math.round(n * 10) / 10;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A name is never drawn larger than this multiple of its natural size, however far away. */
const LABEL_BOOST_MAX = 2.4;
/** A name's font size in world units, before perspective. */
export const NAME_FONT = 13.5;

/**
 * `minFont` is the smallest a name may render, in world units at the current zoom (the stage
 * converts its 11px floor). Zero keeps every name at its natural size — the flat view, where the
 * layout already spaces names apart and none is hidden.
 */
export function buildScene(layout: EcosystemLayout, v: View, minFont = 0): Scene {
  const upright = (a: number) => Math.abs(Math.sin(a)) < 1e-9 && Math.cos(a) > 0;
  const flat = upright(v.pitch) && upright(v.yaw);
  const items: (SceneNode | SceneCore)[] = [];
  for (const node of layout.nodes) {
    const p = project(node.x, node.y, v, v.tx, v.ty);
    if (p.scale > NEAR_LIMIT || p.scale <= 0) continue;
    const fade = p.scale >= 1 ? 1 : Math.max(FADE_FLOOR, 1 - (1 - p.scale) * 1.6);
    const labelScale =
      minFont > 0 ? Math.min(LABEL_BOOST_MAX, Math.max(1, minFont / (NAME_FONT * p.scale))) : 1;
    items.push({ kind: "node", node, ...p, showLabel: true, labelScale, fade });
  }
  const core = project(0, 0, v, v.tx, v.ty);
  if (core.scale > 0 && core.scale <= NEAR_LIMIT) items.push({ kind: "core", ...core });

  // In 2D the layout guarantees no two names touch, so nothing is hidden there.
  if (!flat) placeLabels(items);
  items.sort((p, q) => q.depth - p.depth);

  const sectors = layout.sectors.map((s) => ({
    id: s.meta.id,
    slot: s.slot,
    arc: arcPoints(s.arcA, s.arcB, s.start, s.end)
      .map((p) => {
        const q = project(p.x, p.y, v, v.tx, v.ty);
        return `${fixed(q.x)},${fixed(q.y)}`;
      })
      .join(" "),
    label: project(s.labelX, s.labelY, v, v.tx, v.ty),
    labelScale: categoryBoost(project(s.labelX, s.labelY, v, v.tx, v.ty).scale, minFont),
    // Upper-cased here rather than by CSS `text-transform`, so the snapshot — which carries
    // computed paint but no stylesheet — prints the same words the page does.
    lines: s.lines.map((l) => l.toUpperCase()),
    count: s.count,
    anchor: s.anchor,
  }));
  return { items, sectors };
}

/** A category label is 15 world units and bolder, so its floor is proportionally larger. */
function categoryBoost(scale: number, minFont: number): number {
  if (minFont <= 0 || scale <= 0) return 1;
  return Math.min(LABEL_BOOST_MAX, Math.max(1, (minFont * (15 / NAME_FONT)) / (15 * scale)));
}

/** Nearest first: keep a name only if it lands on no kept name and no nearer disc. */
function placeLabels(items: (SceneNode | SceneCore)[]): void {
  const taken: Box[] = [];
  const nearFirst = [...items].sort((p, q) => p.depth - q.depth);
  for (const item of nearFirst) {
    const s = item.scale;
    if (item.kind === "core") {
      const r = (CORE_SIZE / 2) * s;
      taken.push({ x0: item.x - r, y0: item.y - r, x1: item.x + r, y1: item.y + r });
      continue;
    }
    const r = NODE_R * s;
    const b = item.labelScale * s;
    const lines = item.node.lines;
    const half = (Math.max(...lines.map((l) => l.length)) * CHAR_W * b) / 2;
    const label: Box = {
      x0: item.x - half,
      y0: item.y + r + 4 * b,
      x1: item.x + half,
      y1: item.y + r + (8 + lines.length * LINE_H) * b,
    };
    item.showLabel = !taken.some((b) => overlaps(b, label));
    // The disc occludes whatever lies behind it, whether or not its own name fits.
    taken.push({ x0: item.x - r, y0: item.y - r, x1: item.x + r, y1: item.y + r });
    if (item.showLabel) taken.push(label);
  }
}

/** A node's projected position in a scene. */
export function findInScene(scene: Scene, id: string): SceneNode | null {
  for (const item of scene.items)
    if (item.kind === "node" && item.node.entry.id === id) return item;
  return null;
}

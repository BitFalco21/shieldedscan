import type { NetTopology } from "@/domain";
import { ZAKURA_TRANSLATE, ZAKURA_VIEWBOX_SIZE } from "@/components/ZakuraMark";
import { DEFAULT_CAMERA, type SkyCamera } from "./sky-camera";
import type { SkyLayout, Vec3 } from "./sky-layout";

/**
 * Drawing the sky onto a 2D canvas context — the codebase's one canvas.
 *
 * Pure functions of their arguments: the layout, the camera, the focus and a palette read
 * from the CSS tokens by the caller. Nothing here touches the DOM, reads a clock or holds
 * state, which is what lets a recording stub stand in for the context under test and what
 * keeps the theme rule honest — a colour reaches this file only as a string the caller took
 * from `getComputedStyle`.
 */

/**
 * How a mark's size follows the zoom: positions scale with `zoom`, marks with `zoom ** 0.4`,
 * anchored so a mark is its default size at the default zoom. Linear sizing would magnify an
 * overlap instead of resolving it.
 */
export const MARK_ZOOM_EXPONENT = 0.4;

/** Every colour the sky uses, as CSS colour strings resolved from the page's tokens. */
export interface SkyPalette {
  panel: string;
  green: string;
  greenDim: string;
  ink: string;
  inkDim: string;
  inkFaint: string;
  inkBright: string;
  /** "advertised by" highlight and the IPv6 / Tor ghost tints: three flow-palette slots. */
  flow1: string;
  flow2: string;
  flow5: string;
  zakura: string;
  zcashd: string;
}

/** The marks, prepared once where `Path2D` and `Image` exist; null falls back to a disc. */
export interface SkyMarks {
  zakuraPetal: Path2D | null;
  zakuraCore: Path2D | null;
  zcashd: CanvasImageSource | null;
  zebra: CanvasImageSource | null;
}

export const NO_MARKS: SkyMarks = {
  zakuraPetal: null,
  zakuraCore: null,
  zcashd: null,
  zebra: null,
};

export type SkyFocus = { kind: "hub"; index: number } | { kind: "ghost"; index: number } | null;

export interface Projected {
  x: number;
  y: number;
  /** Camera-space depth, for painter's order and depth fade. */
  depth: number;
  /** Perspective scale at this depth, times the zoom: what positions and line fades use. */
  f: number;
  /** Perspective scale times the damped zoom: what a mark's size uses (see `MARK_ZOOM_EXPONENT`). */
  s: number;
}

export interface SkyFrame {
  hubs: Projected[];
  ghosts: Projected[];
}

export function projectPoint(p: Vec3, cam: SkyCamera, w: number): Projected {
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const y2 = p.y * cp - z1 * sp;
  const z2 = p.y * sp + z1 * cp;
  const persp = 2.6 / (2.6 + z2);
  const f = persp * cam.zoom;
  const s =
    persp * DEFAULT_CAMERA.zoom ** (1 - MARK_ZOOM_EXPONENT) * cam.zoom ** MARK_ZOOM_EXPONENT;
  return {
    x: w / 2 + cam.panX + x1 * f * w * 0.5,
    y: w / 2 + cam.panY + y2 * f * w * 0.5,
    depth: z2,
    f,
    s,
  };
}

/** A hub's radius in px: grows with the square root of the addresses it advertised. */
export function hubRadius(outDeg: number, f: number): number {
  return (3 + Math.min(6, Math.sqrt(outDeg) * 0.24)) * f;
}

/**
 * Draws one frame and returns where everything landed, so the caller can hit-test the same
 * positions it drew. Painter's order: lines first, then points back to front.
 */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  w: number,
  topology: NetTopology,
  layout: SkyLayout,
  cam: SkyCamera,
  focus: SkyFocus,
  palette: SkyPalette,
  marks: SkyMarks,
): SkyFrame {
  const hubs = layout.hubs.map((p) => projectPoint(p, cam, w));
  const ghosts = layout.ghosts.map((p) => projectPoint(p, cam, w));
  const ghostRows = topology.ghosts ?? [];

  ctx.save();
  ctx.fillStyle = palette.panel;
  ctx.fillRect(0, 0, w, w);

  // Which points light up under the focus: a hub lights its advertisements and its
  // advertisers; a ghost lights the hubs that told us about it.
  const lit = new Set<string>();
  if (focus?.kind === "hub") {
    for (const [a, b] of topology.hubEdges) {
      if (a === focus.index) lit.add(`h${b}`);
      if (b === focus.index) lit.add(`h${a}`);
    }
    ghostRows.forEach((g, gi) => {
      if (g.by.includes(focus.index)) lit.add(`g${gi}`);
    });
  } else if (focus?.kind === "ghost") {
    for (const i of ghostRows[focus.index]?.by ?? []) lit.add(`h${i}`);
  }
  const hasFocus = focus !== null;

  // 1. hub → advertised address, in the hub's colour, faint, depth-faded.
  ctx.lineWidth = 0.55;
  ghostRows.forEach((g, gi) => {
    const gp = ghosts[gi];
    if (!gp) return;
    for (const hi of g.by) {
      const hp = hubs[hi];
      const hub = topology.hubs[hi];
      if (!hp || !hub) continue;
      const on =
        focus?.kind === "hub"
          ? focus.index === hi
          : focus?.kind === "ghost"
            ? focus.index === gi
            : false;
      ctx.strokeStyle = clientColour(hub.client, palette);
      ctx.globalAlpha = on ? 0.5 : hasFocus ? 0.012 : 0.075 * Math.min(1, gp.f);
      ctx.beginPath();
      ctx.moveTo(hp.x, hp.y);
      ctx.lineTo(gp.x, gp.y);
      ctx.stroke();
    }
  });
  // 2. hub → hub: green for "advertised", flow-1 for "was advertised by", when focused.
  for (const [a, b] of topology.hubEdges) {
    const p1 = hubs[a];
    const p2 = hubs[b];
    if (!p1 || !p2) continue;
    const on = focus?.kind === "hub" && (focus.index === a || focus.index === b);
    ctx.strokeStyle = on ? (focus.index === a ? palette.green : palette.flow1) : palette.greenDim;
    ctx.globalAlpha = on ? 0.7 : hasFocus ? 0.02 : 0.12;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 3. points, back to front.
  const order: Array<{ kind: "hub" | "ghost"; i: number; depth: number }> = [
    ...ghosts.map((p, i) => ({ kind: "ghost" as const, i, depth: p.depth })),
    ...hubs.map((p, i) => ({ kind: "hub" as const, i, depth: p.depth })),
  ].sort((a, b) => b.depth - a.depth);
  for (const pt of order) {
    if (pt.kind === "hub") {
      const p = hubs[pt.i]!;
      const hub = topology.hubs[pt.i]!;
      const on = focus?.kind === "hub" && focus.index === pt.i;
      const near = lit.has(`h${pt.i}`);
      const r = hubRadius(hub.outDeg, p.s);
      ctx.globalAlpha = hasFocus && !on && !near ? 0.25 : 1;
      drawHubMark(ctx, hub.client, p.x, p.y, on ? r + 2 : r, palette, marks);
      if (on) {
        ctx.strokeStyle = palette.ink;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      const p = ghosts[pt.i]!;
      const g = ghostRows[pt.i]!;
      const on = focus?.kind === "ghost" && focus.index === pt.i;
      const near = lit.has(`g${pt.i}`);
      ctx.fillStyle = g.torExit
        ? palette.flow5
        : g.network === "ipv6"
          ? palette.flow2
          : palette.inkFaint;
      ctx.globalAlpha = hasFocus ? (on || near ? 1 : 0.15) : 0.55 * Math.min(1, p.f + 0.2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (on ? 3.2 : 0.8 + Math.min(1.6, g.by.length * 0.07)) * p.s, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  return { hubs, ghosts };
}

/** The nearest point within `within` px of (x, y): hubs win over ghosts at equal distance. */
export function pickSky(frame: SkyFrame, x: number, y: number, within = 10): SkyFocus {
  let best: SkyFocus = null;
  let bd = within;
  frame.hubs.forEach((p, i) => {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < bd) {
      bd = d;
      best = { kind: "hub", index: i };
    }
  });
  if (best) return best;
  frame.ghosts.forEach((p, i) => {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < bd) {
      bd = d;
      best = { kind: "ghost", index: i };
    }
  });
  return best;
}

export function clientColour(client: string, palette: SkyPalette): string {
  switch (client) {
    case "Zebra":
      return palette.inkBright;
    case "Zakura":
      return palette.zakura;
    case "zcashd":
      return palette.zcashd;
    default:
      return palette.inkFaint;
  }
}

/**
 * A hub's mark, centred on (x, y) inside radius r: the same three marks the tables show, drawn
 * from the same path data (`ZakuraMark`, `ZcashdMark`) or the same badge (`ZebraMark`), so a
 * hub reads the same way as a row. Too small to resolve, or with no mark prepared, a disc in
 * the client's colour with a highlight.
 */
function drawHubMark(
  ctx: CanvasRenderingContext2D,
  client: string,
  x: number,
  y: number,
  r: number,
  palette: SkyPalette,
  marks: SkyMarks,
): void {
  if (client === "Zakura" && marks.zakuraPetal && marks.zakuraCore && r >= 2.5) {
    const rr = r * 1.1;
    const k = (rr * 2) / ZAKURA_VIEWBOX_SIZE;
    ctx.save();
    ctx.translate(x - rr, y - rr);
    ctx.scale(k, k);
    ctx.translate(ZAKURA_TRANSLATE[0], ZAKURA_TRANSLATE[1]);
    ctx.fillStyle = palette.zakura;
    ctx.fill(marks.zakuraPetal);
    ctx.fillStyle = "#000000";
    ctx.fill(marks.zakuraCore);
    ctx.restore();
    return;
  }
  if (client === "zcashd" && marks.zcashd && r >= 2.5) {
    ctx.drawImage(marks.zcashd, x - r, y - r, r * 2, r * 2);
    return;
  }
  if (client === "Zebra" && marks.zebra && r >= 2.5) {
    ctx.drawImage(marks.zebra, x - r, y - r, r * 2, r * 2);
    return;
  }
  const col = clientColour(client, palette);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.inkBright;
  ctx.globalAlpha *= 0.8;
  ctx.beginPath();
  ctx.arc(x - r * 0.28, y - r * 0.28, Math.max(0.7, r * 0.26), 0, Math.PI * 2);
  ctx.fill();
}

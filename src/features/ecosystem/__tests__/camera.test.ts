import { describe, expect, it } from "vitest";
import {
  HOME_2D,
  HOME_3D,
  ZOOM_MAX,
  ZOOM_MIN,
  clampTarget,
  dragPlane,
  focusOn,
  isFlat,
  lerpCamera,
  orbit,
  pinchCamera,
  zoomAbout,
  type Camera,
} from "../camera";
import { project, unproject } from "../projection";

const W = 1200;
const H = 700;
/** Where a world point lands on the stage for a camera. */
const screen = (cam: Camera, x: number, y: number) => {
  const p = project(x, y, cam, cam.tx, cam.ty);
  return { x: p.x * cam.zoom, y: p.y * cam.zoom };
};
/** The world point under a stage point. */
const under = (cam: Camera, sx: number, sy: number) =>
  unproject(sx / cam.zoom, sy / cam.zoom, cam, cam.tx, cam.ty)!;

const TILTED: Camera = { ...HOME_3D, yaw: 0.7, zoom: 1.4, tx: 120, ty: -40 };

describe("camera", () => {
  for (const [name, cam] of [
    ["flat", { ...HOME_2D, zoom: 1.5, tx: 30, ty: -20 }],
    ["tilted and turned", TILTED],
  ] as const) {
    it(`keeps the map point under the cursor under the cursor through a zoom (${name})`, () => {
      const w = under(cam, 140, -60);
      const after = zoomAbout(cam, cam.zoom * 1.8, 140, -60, W, H);
      const s = screen(after, w.x, w.y);
      expect(s.x).toBeCloseTo(140, 3);
      expect(s.y).toBeCloseTo(-60, 3);
    });

    it(`grabs the plane: the point under the pointer follows the pointer (${name})`, () => {
      const w = under(cam, -80, 50);
      const after = dragPlane(cam, { x: -80, y: 50 }, { x: 40, y: 10 }, W, H);
      const s = screen(after, w.x, w.y);
      expect(s.x).toBeCloseTo(40, 3);
      expect(s.y).toBeCloseTo(10, 3);
    });
  }

  it("clamps the zoom to its range", () => {
    expect(zoomAbout(HOME_2D, 100, 0, 0, W, H).zoom).toBe(ZOOM_MAX);
    expect(zoomAbout(HOME_2D, 0.01, 0, 0, W, H).zoom).toBe(ZOOM_MIN);
  });

  it("keeps the target on the map however far one drags", () => {
    const far = clampTarget({ ...HOME_2D, tx: 1e6, ty: -1e6 }, W, H);
    expect(far.tx).toBe(W);
    expect(far.ty).toBe(-H);
  });

  it("orbits with no stop: the tilt runs past edge-on to the underside and on round", () => {
    expect(orbit(HOME_3D, 100, 0).yaw).toBeGreaterThan(0);
    // A drag past a 1.45 rad tilt keeps going, over the top.
    let c: Camera = HOME_3D;
    for (let i = 0; i < 20; i += 1) c = orbit(c, 0, -50);
    expect(Math.abs(c.pitch)).toBeGreaterThan(Math.PI / 2);
    // Both angles stay folded into (-π, π], however long the drag.
    const spun = orbit(HOME_3D, 1e6, -1e6);
    for (const a of [spun.yaw, spun.pitch]) {
      expect(a).toBeGreaterThan(-Math.PI);
      expect(a).toBeLessThanOrEqual(Math.PI);
    }
  });

  it("glides the short way round the tilt, as it does the turn", () => {
    const a: Camera = { ...HOME_3D, pitch: 3.0 };
    const b: Camera = { ...HOME_3D, pitch: -3.0 };
    // 3.0 → −3.0 is 0.28 rad through ±π, not 6 rad back through the flat view.
    const mid = lerpCamera(a, b, 0.5).pitch;
    expect(Math.abs(Math.cos(mid) - Math.cos(Math.PI))).toBeLessThan(1e-9);
  });

  it("still grabs the plane and zooms toward the cursor with the map seen from below", () => {
    const below: Camera = { ...HOME_3D, pitch: 2.4, yaw: 0.7, tx: 50, ty: -40 };
    const from = { x: 120, y: 80 };
    const to = { x: 60, y: 140 };
    const grabbed = unproject(from.x / below.zoom, from.y / below.zoom, below, below.tx, below.ty)!;
    const moved = dragPlane(below, from, to, W, H);
    const s = screen(moved, grabbed.x, grabbed.y);
    expect(s.x).toBeCloseTo(to.x, 4);
    expect(s.y).toBeCloseTo(to.y, 4);
    const zoomed = zoomAbout(below, 3, from.x, from.y, W, H);
    const z = screen(zoomed, grabbed.x, grabbed.y);
    expect(z.x).toBeCloseTo(from.x, 4);
    expect(z.y).toBeCloseTo(from.y, 4);
  });

  it("is flat only upright, never seen from below", () => {
    expect(isFlat({ yaw: 0, pitch: 0 })).toBe(true);
    expect(isFlat({ yaw: 0, pitch: Math.PI })).toBe(false);
  });

  it("orbits about the middle of the screen, so what is centred stays centred", () => {
    const c = orbit(TILTED, 250, -80);
    const s = screen(c, c.tx, c.ty);
    expect(s.x).toBeCloseTo(0);
    expect(s.y).toBeCloseTo(0);
  });

  it("puts a focused project at the centre of the stage, in 2D and 3D", () => {
    for (const cam of [HOME_2D, TILTED]) {
      const c = focusOn(cam, 300, -120, 2.5);
      const s = screen(c, 300, -120);
      expect(s.x).toBeCloseTo(0);
      expect(s.y).toBeCloseTo(0);
    }
  });

  it("pinches about the fingers' starting midpoint and carries the plane with them", () => {
    const w = under(HOME_2D, 100, 50);
    const c = pinchCamera(HOME_2D, { x: 100, y: 50 }, 100, { x: 110, y: 50 }, 200, W, H);
    expect(c.zoom).toBeCloseTo(2);
    const s = screen(c, w.x, w.y);
    expect(s.x).toBeCloseTo(110);
    expect(s.y).toBeCloseTo(50);
  });

  it("glides from one camera to another and lands exactly, turning the short way", () => {
    const a = { ...HOME_3D, yaw: 0.1 };
    const b = { ...HOME_3D, yaw: 2 * Math.PI - 0.1, zoom: 3, tx: 50 };
    expect(lerpCamera(a, b, 0)).toEqual(a);
    const end = lerpCamera(a, b, 1);
    expect(end.zoom).toBeCloseTo(3);
    expect(end.tx).toBeCloseTo(50);
    expect(Math.cos(end.yaw)).toBeCloseTo(Math.cos(b.yaw));
    expect(lerpCamera(a, b, 0.5).yaw).toBeCloseTo(0);
  });

  it("knows when the view is flat, so the scene can stay fixed", () => {
    expect(isFlat(HOME_2D)).toBe(true);
    expect(isFlat(HOME_3D)).toBe(false);
    expect(isFlat({ ...HOME_2D, yaw: Math.PI })).toBe(false);
  });
});

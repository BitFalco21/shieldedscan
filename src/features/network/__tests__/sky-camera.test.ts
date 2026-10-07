import { describe, expect, it } from "vitest";
import {
  PAN_ZOOM,
  clampPan,
  dragMode,
  panBy,
  pinchCamera,
  turnedFrom,
  zoomAbout,
  DEFAULT_CAMERA,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../topology/sky-camera";
import { hubRadius, projectPoint } from "../topology/sky-draw";

const W = 600;

describe("zoomAbout", () => {
  it("keeps the point under the cursor under the cursor", () => {
    // A point that projects to (450, 220): after zooming about that pixel it must still land there.
    const p = { x: 0.25, y: -0.1, z: 0.05 };
    const before = projectPoint(p, DEFAULT_CAMERA, W);
    const cam = zoomAbout(DEFAULT_CAMERA, DEFAULT_CAMERA.zoom * 1.6, before.x, before.y, W);
    const after = projectPoint(p, cam, W);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(cam.zoom).toBeCloseTo(DEFAULT_CAMERA.zoom * 1.6, 9);
  });

  it("zooming about the centre leaves the pan at zero", () => {
    const cam = zoomAbout(DEFAULT_CAMERA, 2.5, W / 2, W / 2, W);
    expect(cam.panX).toBe(0);
    expect(cam.panY).toBe(0);
  });

  it("clamps the zoom to its range", () => {
    expect(zoomAbout(DEFAULT_CAMERA, 99, 10, 10, W).zoom).toBe(ZOOM_MAX);
    expect(zoomAbout(DEFAULT_CAMERA, 0.01, 10, 10, W).zoom).toBe(ZOOM_MIN);
  });

  it("zooming back out pulls the picture back towards the frame", () => {
    const zoomedIn = zoomAbout(DEFAULT_CAMERA, ZOOM_MAX, 5, 5, W);
    const out = zoomAbout(zoomedIn, ZOOM_MIN, 5, 5, W);
    expect(out.panX).toBeCloseTo(0, 9);
    expect(out.panY).toBeCloseTo(0, 9);
  });
});

describe("clampPan", () => {
  it("never lets the centre leave the frame at the current zoom", () => {
    const cam = clampPan({ ...DEFAULT_CAMERA, zoom: 2, panX: 10_000, panY: -10_000 }, W);
    const limit = (W / 2) * (2 - ZOOM_MIN);
    expect(cam.panX).toBe(limit);
    expect(cam.panY).toBe(-limit);
  });
});

describe("zooming separates marks", () => {
  // Marks must not scale exactly with the zoom, or zooming magnifies an overlap instead of
  // resolving it. The gap between two hubs must grow faster than the hubs themselves, and a mark
  // keeps its size at the default zoom.
  const a = { x: 0.01, y: 0, z: 0 };
  const b = { x: 0.03, y: 0, z: 0 };
  const gapOverRadius = (zoom: number) => {
    const cam = { ...DEFAULT_CAMERA, zoom };
    const pa = projectPoint(a, cam, W);
    const pb = projectPoint(b, cam, W);
    return Math.hypot(pa.x - pb.x, pa.y - pb.y) / hubRadius(400, pa.s);
  };

  it("pulls two overlapping hubs apart as the zoom rises", () => {
    expect(gapOverRadius(DEFAULT_CAMERA.zoom)).toBeLessThan(1);
    expect(gapOverRadius(ZOOM_MAX)).toBeGreaterThan(5 * gapOverRadius(DEFAULT_CAMERA.zoom));
  });

  it("leaves a mark its old size at the default zoom", () => {
    const p = projectPoint(a, DEFAULT_CAMERA, W);
    expect(p.s).toBeCloseTo(p.f, 9);
  });
});

describe("moving the view", () => {
  it("turns when zoomed out and moves when zoomed in; shift swaps them", () => {
    expect(dragMode(DEFAULT_CAMERA.zoom, false)).toBe("turn");
    expect(dragMode(DEFAULT_CAMERA.zoom, true)).toBe("move");
    expect(dragMode(PAN_ZOOM + 1, false)).toBe("move");
    expect(dragMode(PAN_ZOOM + 1, true)).toBe("turn");
  });

  it("pans by the drag, kept inside the frame", () => {
    const cam = { ...DEFAULT_CAMERA, zoom: 8 };
    expect(panBy(cam, 30, -20, W)).toMatchObject({ panX: 30, panY: -20 });
    const far = panBy(cam, 1e6, 1e6, W);
    expect(far.panX).toBe((W / 2) * (8 - ZOOM_MIN));
  });

  it("a pinch zooms about where it started and carries the view with the fingers", () => {
    const p = { x: 0.2, y: -0.1, z: 0 };
    const start = { ...DEFAULT_CAMERA, zoom: 3 };
    const at = projectPoint(p, start, W);
    // Fingers start on the point and spread apart without moving their midpoint.
    const spread = pinchCamera(start, at, 100, at, 200, W);
    expect(spread.zoom).toBeCloseTo(6, 9);
    const still = projectPoint(p, spread, W);
    expect(still.x).toBeCloseTo(at.x, 6);
    // Then the midpoint moves 40 px right: the point follows it.
    const carried = pinchCamera(start, at, 100, { x: at.x + 40, y: at.y }, 100, W);
    expect(projectPoint(p, carried, W).x).toBeCloseTo(at.x + 40, 6);
  });
});

describe("turnedFrom", () => {
  it("turns from the drag's starting camera in proportion to the distance dragged", () => {
    const a = turnedFrom(DEFAULT_CAMERA, 100, 0);
    const b = turnedFrom(DEFAULT_CAMERA, 200, 0);
    expect(a.pitch).toBe(DEFAULT_CAMERA.pitch);
    expect(b.yaw - DEFAULT_CAMERA.yaw).toBeCloseTo(2 * (a.yaw - DEFAULT_CAMERA.yaw), 12);
  });

  it("stops the tilt short of straight down and straight up", () => {
    expect(turnedFrom(DEFAULT_CAMERA, 0, 100_000).pitch).toBe(1.3);
    expect(turnedFrom(DEFAULT_CAMERA, 0, -100_000).pitch).toBe(-1.3);
  });
});

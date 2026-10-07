import { unproject, type Orientation } from "./projection";

/**
 * The ecosystem stage's camera, kept pure so the feel of a gesture is tested rather than
 * eyeballed, as `features/network/topology/sky-camera.ts` is.
 *
 * It is an orbit camera with no stop on either axis (the map can be flipped over and seen from
 * below): it looks at a target point on the map, turns and tilts about it, and zooms toward it.
 * Moving the view moves the target across the plane, so dragging grabs the ground and the point
 * under the pointer stays there, in 3D as in 2D. Orbiting pivots on the middle of the screen,
 * so turning never swings the part being looked at out of view.
 *
 * Screen coordinates are the stage's viewBox units, origin at its centre: a projected point
 * lands at `projected × zoom`.
 */

export interface Camera extends Orientation {
  zoom: number;
  /** The world point the camera looks at: the centre of the stage. */
  tx: number;
  ty: number;
}

export const ZOOM_MIN = 0.55;
export const ZOOM_MAX = 8;
/** The 3D view's resting tilt — enough to read as depth, little enough to keep rows apart. */
const PITCH_3D = 0.9;

export const HOME_2D: Camera = { zoom: 1, tx: 0, ty: 0, yaw: 0, pitch: 0 };
/** Perspective enlarges the near half, so 3D rests looking a little below the centre. */
export const HOME_3D: Camera = { zoom: 1, tx: 0, ty: 90, yaw: 0, pitch: PITCH_3D };

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** The target stays on the map, so some of it is always in view however far one drags. */
export function clampTarget(cam: Camera, halfW: number, halfH: number): Camera {
  return {
    ...cam,
    tx: Math.min(halfW, Math.max(-halfW, cam.tx)),
    ty: Math.min(halfH, Math.max(-halfH, cam.ty)),
  };
}

function under(cam: Camera, sx: number, sy: number) {
  return unproject(sx / cam.zoom, sy / cam.zoom, cam, cam.tx, cam.ty);
}

/**
 * Zoom to `zoom` keeping the map point under the stage point (sx, sy) — usually the cursor —
 * where it is. On a tilted plane that point is found by unprojecting, so the zoom heads for what
 * the reader is pointing at, not for the middle of the screen.
 */
export function zoomAbout(
  cam: Camera,
  zoom: number,
  sx: number,
  sy: number,
  halfW: number,
  halfH: number,
): Camera {
  const next = { ...cam, zoom: clampZoom(zoom) };
  const before = under(cam, sx, sy);
  const after = under(next, sx, sy);
  if (!before || !after) return clampTarget(next, halfW, halfH);
  return clampTarget(
    { ...next, tx: next.tx + before.x - after.x, ty: next.ty + before.y - after.y },
    halfW,
    halfH,
  );
}

/** Move the view so the map point that was under `from` is now under `to`: grabbing the plane. */
export function dragPlane(
  cam: Camera,
  from: { x: number; y: number },
  to: { x: number; y: number },
  halfW: number,
  halfH: number,
): Camera {
  const a = under(cam, from.x, from.y);
  const b = under(cam, to.x, to.y);
  if (!a || !b) return cam;
  return clampTarget({ ...cam, tx: cam.tx + a.x - b.x, ty: cam.ty + a.y - b.y }, halfW, halfH);
}

/** Radians of turn per stage unit dragged: a full-width drag is a bit over one full turn. */
const TURN_RATE = 0.0035;

/** An angle folded into (−π, π], so it never grows without bound over a long session. */
function wrapAngle(a: number): number {
  const w = Math.atan2(Math.sin(a), Math.cos(a));
  return w === -Math.PI ? Math.PI : w;
}

/**
 * Orbit in 3D with no stop in either direction: across turns about the target, up and down
 * tilts through edge-on and over, to the map seen from below. Names stay upright throughout,
 * because every mark is a billboard.
 */
export function orbit(cam: Camera, dx: number, dy: number): Camera {
  return {
    ...cam,
    yaw: wrapAngle(cam.yaw + dx * TURN_RATE),
    pitch: wrapAngle(cam.pitch - dy * TURN_RATE),
  };
}

/**
 * Two fingers: the pinch scales about where the fingers started and the fingers carry the plane
 * with them — both from the camera at the gesture's start, so the result depends on the fingers'
 * positions alone and never accumulates rounding.
 */
export function pinchCamera(
  start: Camera,
  startMid: { x: number; y: number },
  startDist: number,
  mid: { x: number; y: number },
  dist: number,
  halfW: number,
  halfH: number,
): Camera {
  const scale = startDist > 0 ? dist / startDist : 1;
  const zoomed = zoomAbout(start, start.zoom * scale, startMid.x, startMid.y, halfW, halfH);
  return dragPlane(zoomed, startMid, mid, halfW, halfH);
}

/** The camera that looks at world point (x, y) at `zoom`, keeping its orientation. */
export function focusOn(cam: Camera, x: number, y: number, zoom: number): Camera {
  return { ...cam, zoom: clampZoom(zoom), tx: x, ty: y };
}

/** A camera part-way from `a` to `b`; the turn and the tilt each go the short way round. */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  const turn = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
  const tilt = Math.atan2(Math.sin(b.pitch - a.pitch), Math.cos(b.pitch - a.pitch));
  const mix = (p: number, q: number) => p + (q - p) * t;
  return {
    zoom: a.zoom * Math.pow(b.zoom / a.zoom, t),
    tx: mix(a.tx, b.tx),
    ty: mix(a.ty, b.ty),
    yaw: a.yaw + turn * t,
    pitch: a.pitch + tilt * t,
  };
}

/** Whether a camera sees the map flat, so the scene is the layout itself and only shifts. */
export function isFlat(cam: Orientation): boolean {
  const upright = (a: number) => Math.abs(Math.sin(a)) < 1e-4 && Math.cos(a) > 0;
  return upright(cam.pitch) && upright(cam.yaw);
}

/** Fast start, gentle landing: a glide the eye can follow without it dragging on. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * The sky's camera and its arithmetic, kept pure so the feel of a gesture is tested rather than
 * eyeballed. A zoom keeps the point under the cursor under the cursor: the camera carries a
 * screen-space pan for that, clamped so the picture can never be zoomed out of its frame. How
 * much one wheel event zooms is `wheelFactor`'s job, shared with the other zoomable stages.
 */

export interface SkyCamera {
  yaw: number;
  pitch: number;
  zoom: number;
  /** Screen-space offset of the sky's centre, in CSS px. Only an anchored zoom sets it. */
  panX: number;
  panY: number;
}

export const DEFAULT_CAMERA: SkyCamera = { yaw: 0.6, pitch: -0.35, zoom: 1.3, panX: 0, panY: 0 };
export const ZOOM_MIN = 0.6;
/**
 * 20x: marks grow far more slowly than the space between them (`MARK_ZOOM_EXPONENT`), so zooming
 * in pulls a crowded core apart.
 */
export const ZOOM_MAX = 20;

/** Radians the sky turns per pixel dragged. */
const TURN_RATE = 0.006;
/** The tilt stops short of looking straight down or up, where yaw stops meaning anything. */
const PITCH_LIMIT = 1.3;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * The pan may move the centre of the sky no further than the edge of the frame at this zoom,
 * so however the reader zooms and pans, part of the picture is always on screen — and at the
 * default zoom and below the allowance is small, which pulls a zoom-out back to centre.
 */
export function clampPan(cam: SkyCamera, w: number): SkyCamera {
  const limit = (w / 2) * Math.max(0, cam.zoom - ZOOM_MIN);
  return {
    ...cam,
    panX: Math.min(limit, Math.max(-limit, cam.panX)),
    panY: Math.min(limit, Math.max(-limit, cam.panY)),
  };
}

/**
 * Zoom to `zoom` keeping the canvas point (px, py) fixed. A projected point sits at
 * `w/2 + pan + v × zoom`, so holding its screen position through the change means the pan
 * scales about the anchor by the zoom ratio.
 */
export function zoomAbout(
  cam: SkyCamera,
  zoom: number,
  px: number,
  py: number,
  w: number,
): SkyCamera {
  const next = clampZoom(zoom);
  const r = next / cam.zoom;
  const ax = px - w / 2;
  const ay = py - w / 2;
  return clampPan(
    { ...cam, zoom: next, panX: ax - (ax - cam.panX) * r, panY: ay - (ay - cam.panY) * r },
    w,
  );
}

/**
 * Past this zoom a plain drag moves the view instead of turning the sky: turning about the sky's
 * centre while zoomed in swings the zoomed region out of view. Shift or a non-primary button
 * always does the other, so neither is out of reach.
 */
export const PAN_ZOOM = 2;

export type DragMode = "turn" | "move";

export function dragMode(zoom: number, swap: boolean): DragMode {
  const zoomedIn = zoom > PAN_ZOOM;
  return zoomedIn !== swap ? "move" : "turn";
}

/**
 * The angles after dragging (dx, dy) pixels from the camera the drag started at: computed from
 * the start, never accumulated per event, so the turn depends on the pointer's position alone.
 */
export function turnedFrom(
  start: SkyCamera,
  dx: number,
  dy: number,
): Pick<SkyCamera, "yaw" | "pitch"> {
  return {
    yaw: start.yaw + dx * TURN_RATE,
    pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, start.pitch + dy * TURN_RATE)),
  };
}

/** Move the view by a screen-space delta, kept inside the frame by `clampPan`. */
export function panBy(cam: SkyCamera, dx: number, dy: number, w: number): SkyCamera {
  return clampPan({ ...cam, panX: cam.panX + dx, panY: cam.panY + dy }, w);
}

/**
 * Two fingers: the pinch scales the zoom about where the fingers started, and the fingers'
 * midpoint carries the view with it — both from the camera at the gesture's start, so the
 * result depends on the fingers' positions alone and never accumulates rounding.
 */
export function pinchCamera(
  start: SkyCamera,
  startMid: { x: number; y: number },
  startDist: number,
  mid: { x: number; y: number },
  dist: number,
  w: number,
): SkyCamera {
  const scale = startDist > 0 ? dist / startDist : 1;
  const zoomed = zoomAbout(start, start.zoom * scale, startMid.x, startMid.y, w);
  return panBy(zoomed, mid.x - startMid.x, mid.y - startMid.y, w);
}

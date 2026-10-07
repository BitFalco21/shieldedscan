/**
 * The ecosystem map's 3D view: the flat layout seen from a camera that ORBITS a target point on
 * it — tilted away from the reader and turned about that point, with perspective. Pure
 * arithmetic over the layout's world units, so 2D is the same code with both angles at zero,
 * where a projected point is simply the laid-out point relative to the target.
 *
 * Every disc stays a disc — it is scaled by perspective, never squashed into an ellipse —
 * because a logo drawn on a slant is harder to recognise and the depth reads from size and
 * overlap alone. That is also what lets the whole view stay SVG: a hundred-odd billboards
 * re-sorted per frame need no canvas.
 */

/** Distance from the eye to the picture plane, in world units: larger is flatter. */
const PERSPECTIVE = 2800;

export interface Orientation {
  /** Turn about the target, radians. */
  yaw: number;
  /** Tilt about the horizontal axis, radians: 0 is flat 2D, ±π is the map seen from below. */
  pitch: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Perspective scale: 1 on the picture plane, below 1 further away. */
  scale: number;
  /** Depth: larger is further from the reader, so drawing sorts by it descending. */
  depth: number;
}

/** A world point on the map, seen from a camera orbiting (tx, ty). */
export function project(x: number, y: number, o: Orientation, tx = 0, ty = 0): Projected {
  const rx = x - tx;
  const ry = y - ty;
  const cy = Math.cos(o.yaw);
  const sy = Math.sin(o.yaw);
  const xr = rx * cy - ry * sy;
  const yr = rx * sy + ry * cy;
  // Tilting the top edge away: a point above the target (yr < 0) recedes.
  const depth = -yr * Math.sin(o.pitch);
  const flat = yr * Math.cos(o.pitch);
  const scale = PERSPECTIVE / (PERSPECTIVE + depth);
  return { x: xr * scale, y: flat * scale, scale, depth };
}

/**
 * The world point on the map's plane that projects to (X, Y) — what is under the cursor. Null
 * past the plane's horizon, where no point of the map can appear, and when the plane is seen
 * edge-on and every screen point is ambiguous.
 *
 * Valid from either side of the plane: the tilt may run past 90° to look at the map from
 * below. A point is in front of the eye exactly when `cos(pitch)` and the denominator share a
 * sign (its perspective scale is `F² cos(pitch) / denom`), which is the test used here rather
 * than a plain `denom > 0` that would refuse the whole underside.
 */
export function unproject(
  X: number,
  Y: number,
  o: Orientation,
  tx = 0,
  ty = 0,
): { x: number; y: number } | null {
  const sp = Math.sin(o.pitch);
  const cp = Math.cos(o.pitch);
  const denom = PERSPECTIVE * cp + Y * sp;
  if (Math.abs(cp) < 1e-3 || cp * denom <= 1e-9) return null;
  const yr = (Y * PERSPECTIVE) / denom;
  const scale = PERSPECTIVE / (PERSPECTIVE - yr * sp);
  const xr = X / scale;
  const cy = Math.cos(o.yaw);
  const sy = Math.sin(o.yaw);
  return { x: xr * cy + yr * sy + tx, y: -xr * sy + yr * cy + ty };
}

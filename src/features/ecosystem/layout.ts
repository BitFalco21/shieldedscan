import type { EcosystemCategory, EcosystemCategoryMeta, EcosystemEntry } from "@/domain/ecosystem";

/**
 * Where every project sits on the ecosystem map, as plain numbers, so the geometry is tested
 * without rendering anything. World units, origin at the centre, y pointing down.
 *
 * The projects sit on concentric landscape ellipses around the Zcash mark, wider than tall
 * because the stage is. Points on a ring are spaced by arc length, so neighbours are never
 * closer than a label is wide, and the rings step outward by more than a disc and its label
 * are tall. Each category takes one angular wedge of every ring, clockwise from twelve o'clock
 * in listed order, with a gap before the next. The ring count is the smallest that holds every
 * category, and leftover room widens the gaps, so adding a project grows the map instead of
 * overlapping two discs.
 *
 * Deterministic by construction (no randomness, no measurement of text), so the server render
 * and the client render lay out identically and nothing moves on hydration.
 */

/** Minimum distance between neighbours along a ring: a disc plus a label line fits in it. */
export const SPACING = 112;
/** Radius of a project's disc. */
export const NODE_R = 20;
/** Size of the Zcash mark at the centre, alone, in world units. */
export const CORE_SIZE = 150;
/** Semi-axes of the innermost ring, which clears the Zcash mark at the centre. */
export const RING0_A = 240;
export const RING0_B = 150;
/** How much wider and taller each ring is than the one inside it. */
const RING_STEP_X = 172;
const RING_STEP_Y = 98;
/** The least empty angle between two categories' wedges, in radians; spare room widens it. */
const MIN_GAP = 0.06;
/** How far outside a wedge's outermost ring its arc runs, and its label sits. */
const ARC_OUT = 72;
const LABEL_OUT = 118;
/** A name line holds at most this many characters; longer names wrap, up to `LABEL_LINES`.
 *  Narrow lines are what let the type be large: a label must fit between two neighbours. */
export const LABEL_CHARS = 13;
export const LABEL_LINES = 3;
/** A category label line, which is bolder and letter-spaced, holds fewer. */
const CATEGORY_CHARS = 14;

/** Rough rendered widths, only to size the frame: names are 13.5px mono, labels 15px bold. */
const NAME_CHAR_W = 8.2;
const LABEL_CHAR_W = 10.2;

export interface PlacedNode {
  entry: EcosystemEntry;
  /** The palette slot of its category, 1-based: one colour per category. */
  slot: number;
  x: number;
  y: number;
  /** The name as it is drawn, up to three lines; the full name stays on the link itself. */
  lines: string[];
}

export interface PlacedSector {
  meta: EcosystemCategoryMeta;
  slot: number;
  count: number;
  /** Clock angles (radians from twelve o'clock, clockwise) its arc spans — its projects. */
  start: number;
  end: number;
  /** Semi-axes of the ellipse its arc follows, just outside its outermost ring. */
  arcA: number;
  arcB: number;
  /** Its label, wrapped, and where it sits and which way it reads out from the centre. */
  lines: string[];
  labelX: number;
  labelY: number;
  anchor: "start" | "middle" | "end";
}

export interface EcosystemLayout {
  nodes: PlacedNode[];
  sectors: PlacedSector[];
  /** How many rings are in use. */
  rings: number;
  /** Half the drawing's width and height, labels included: the viewBox is centred on 0. */
  halfWidth: number;
  halfHeight: number;
}

/** Clock angle of a point: radians from twelve o'clock, clockwise, in [0, 2π). */
export function clockAngle(x: number, y: number): number {
  const a = Math.atan2(x, -y);
  return a < 0 ? a + 2 * Math.PI : a;
}

/** The point on an ellipse with semi-axes (a, b) at a clock angle. */
export function onEllipse(a: number, b: number, angle: number): { x: number; y: number } {
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const t = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
  return { x: round(dx * t), y: round(dy * t) };
}

function round(n: number): number {
  // `|| 0` folds −0 into 0, so a point on an axis prints and compares as one value.
  return Math.round(n * 100) / 100 || 0;
}

function ringAxes(k: number): { a: number; b: number } {
  return { a: RING0_A + k * RING_STEP_X, b: RING0_B + k * RING_STEP_Y };
}

interface RingPoint {
  x: number;
  y: number;
  angle: number;
  ring: number;
}

/** Points spaced evenly by ARC LENGTH round ring k, alternate rings staggered by half a step. */
function ringPoints(k: number): RingPoint[] {
  const { a, b } = ringAxes(k);
  const samples = 1440;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * 2 * Math.PI;
    pts.push({ x: a * Math.sin(t), y: -b * Math.cos(t) });
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  }
  const perimeter = cum[cum.length - 1]!;
  const count = Math.floor(perimeter / SPACING);
  const step = perimeter / count;
  const out: RingPoint[] = [];
  let j = 0;
  for (let n = 0; n < count; n++) {
    const target = (n + (k % 2 === 1 ? 0.5 : 0)) * step;
    while (j < cum.length - 1 && cum[j + 1]! < target) j++;
    const f = (target - cum[j]!) / Math.max(1e-9, cum[j + 1]! - cum[j]!);
    const x = pts[j]!.x + (pts[j + 1]!.x - pts[j]!.x) * f;
    const y = pts[j]!.y + (pts[j + 1]!.y - pts[j]!.y) * f;
    out.push({ x, y, angle: clockAngle(x, y), ring: k });
  }
  return out;
}

interface Wedge {
  start: number;
  end: number;
  points: RingPoint[];
}

/**
 * Walk the rings' points clockwise, giving each category the next `n` of them — every ring at
 * once, so its wedge runs from the inner ring to the outer — and leaving `gap` radians empty
 * before the next. Null when the points run out inside one turn.
 */
function carve(points: RingPoint[], counts: number[], gap: number): Wedge[] | null {
  const wedges: Wedge[] = [];
  let cursor = gap / 2;
  let i = 0;
  for (const n of counts) {
    while (i < points.length && points[i]!.angle < cursor) i++;
    if (i + n > points.length) return null;
    const taken = points.slice(i, i + n);
    const end = taken[taken.length - 1]!.angle;
    wedges.push({ start: cursor, end, points: taken });
    i += n;
    cursor = end + gap;
  }
  const last = wedges[wedges.length - 1];
  return last && last.end <= 2 * Math.PI - gap / 2 ? wedges : null;
}

/**
 * The fewest rings that hold every category, then the WIDEST gap that still fits: whatever room
 * the last ring leaves over is shared out evenly between the categories instead of piling up
 * as one empty wedge at the end of the turn.
 */
function pack(counts: number[]): Wedge[] {
  for (let rings = 1; rings <= 40; rings++) {
    const points: RingPoint[] = [];
    for (let k = 0; k < rings; k++) points.push(...ringPoints(k));
    points.sort((p, q) => p.angle - q.angle || p.ring - q.ring);
    if (!carve(points, counts, MIN_GAP)) continue;
    let lo = MIN_GAP;
    let hi = (2 * Math.PI) / counts.length;
    for (let step = 0; step < 30; step++) {
      const mid = (lo + hi) / 2;
      if (carve(points, counts, mid)) lo = mid;
      else hi = mid;
    }
    return carve(points, counts, lo)!;
  }
  throw new Error("ecosystem layout: no ring count holds every project");
}

/**
 * Wrap a name greedily onto lines of at most `max` characters, at most `lines` of them. A word
 * longer than a line, or text left over after the last line, is elided rather than overflowing
 * into a neighbour's disc — the hover card, the link's own name and the list carry it in full.
 */
export function labelLines(name: string, max = LABEL_CHARS, lines = LABEL_LINES): string[] {
  const out: string[] = [];
  let line = "";
  // A word too long for a line may still break after a hyphen it carries ("sapling-crypto"),
  // which is where a reader expects a break; anything else too long is elided below.
  const words = name
    .split(" ")
    .flatMap((w) => (w.length > max && w.includes("-") ? w.split(/(?<=-)/) : [w]));
  for (let k = 0; k < words.length; k++) {
    const word = words[k]!;
    const next = line ? (line.endsWith("-") ? line + word : `${line} ${word}`) : word;
    if (next.length <= max) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    if (out.length === lines) return withEllipsis(out, max);
    line = word;
    if (line.length > max) {
      out.push(elide(line, max));
      if (k < words.length - 1) return withEllipsis(out.slice(0, lines), max);
      return out.slice(0, lines);
    }
  }
  if (line) out.push(line);
  return out.length > lines ? withEllipsis(out.slice(0, lines), max) : out;
}

/** Mark the last kept line as cut, so a truncated name reads as elided, never as complete. */
function withEllipsis(kept: string[], max: number): string[] {
  const last = kept[kept.length - 1]!;
  const cut = last.endsWith("…") ? last : `${last.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  return [...kept.slice(0, -1), cut];
}

function elide(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function layoutEcosystem(
  categories: readonly EcosystemCategoryMeta[],
  entries: readonly EcosystemEntry[],
): EcosystemLayout {
  const byCategory = new Map<EcosystemCategory, EcosystemEntry[]>();
  for (const c of categories) byCategory.set(c.id, []);
  for (const e of entries) byCategory.get(e.category)?.push(e);
  // A category with nothing in it takes no wedge: an empty sector would draw a label over
  // no projects, which reads as a category whose members failed to load.
  const shown = categories.filter((c) => (byCategory.get(c.id)?.length ?? 0) > 0);
  const counts = shown.map((c) => byCategory.get(c.id)!.length);

  const wedges = pack(counts);
  const rings = Math.max(...wedges.flatMap((w) => w.points.map((p) => p.ring))) + 1;

  const nodes: PlacedNode[] = [];
  let maxX = 0;
  let maxY = 0;
  const sectors: PlacedSector[] = shown.map((meta, idx) => {
    const wedge = wedges[idx]!;
    const slot = idx + 1;
    // Placement order: inner ring first, then round the ring clockwise, so a category's
    // first-listed projects sit nearest the centre and read in order.
    const points = [...wedge.points].sort((p, q) => p.ring - q.ring || p.angle - q.angle);
    byCategory.get(meta.id)!.forEach((entry, j) => {
      const p = points[j]!;
      const lines = labelLines(entry.name);
      nodes.push({ entry, slot, x: round(p.x), y: round(p.y), lines });
      const nameHalf = (Math.max(...lines.map((l) => l.length)) * NAME_CHAR_W) / 2;
      maxX = Math.max(maxX, Math.abs(p.x) + Math.max(NODE_R, nameHalf));
      maxY = Math.max(maxY, Math.abs(p.y) + NODE_R + 18 + lines.length * 16);
    });
    const outer = ringAxes(Math.max(...wedge.points.map((p) => p.ring)));
    const angles = wedge.points.map((p) => p.angle);
    const start = Math.max(wedge.start, Math.min(...angles) - 0.05);
    const end = Math.min(wedge.end, Math.max(...angles) + 0.05);
    const mid = (start + end) / 2;
    const label = onEllipse(outer.a + LABEL_OUT, outer.b + LABEL_OUT, mid);
    const across = Math.sin(mid);
    const anchor = across > 0.3 ? "start" : across < -0.3 ? "end" : "middle";
    const lines = labelLines(meta.label, CATEGORY_CHARS, 2);
    const width = (Math.max(...lines.map((l) => l.length)) + 3) * LABEL_CHAR_W;
    maxX = Math.max(maxX, Math.abs(label.x) + (anchor === "middle" ? width / 2 : width));
    maxY = Math.max(maxY, Math.abs(label.y) + lines.length * 16 + 10);
    return {
      meta,
      slot,
      count: wedge.points.length,
      // Not rounded: rounding inward would put the arc's end short of its own last project.
      start,
      end,
      arcA: outer.a + ARC_OUT,
      arcB: outer.b + ARC_OUT,
      lines,
      labelX: label.x,
      labelY: label.y,
      anchor,
    };
  });

  const margin = 24;
  return {
    nodes,
    sectors,
    rings,
    halfWidth: Math.ceil(maxX + margin),
    halfHeight: Math.ceil(maxY + margin),
  };
}

/** Points along an ellipse arc between two clock angles, for a polyline in 2D or 3D. */
export function arcPoints(
  a: number,
  b: number,
  start: number,
  end: number,
  steps = 24,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let s = 0; s <= steps; s++) out.push(onEllipse(a, b, start + ((end - start) * s) / steps));
  return out;
}

/** The first letter or digit of a name, for the disc of a project with no committed icon. */
export function initial(name: string): string {
  const m = /[A-Za-z0-9]/.exec(name);
  return m ? m[0].toUpperCase() : "?";
}

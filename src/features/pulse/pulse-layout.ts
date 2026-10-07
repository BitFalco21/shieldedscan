import type {
  PulseBlockPools,
  PulseEdgeTotal,
  PulseEnd,
  PulseEvent,
  PulseRibbonWindow,
  ValuePoolName,
} from "@/domain";
import { POOL_NAMES, pulseChainTicker } from "@/domain";
import { PULSE_FOLDED_CLASS, pulseChainClasses, pulseNodeClass } from "@/lib/pulse-palette";
import { formatCount, formatZecWhole } from "@/lib/format";

/**
 * Where everything on `/pulse` sits, and what each mark is allowed to claim.
 *
 * Pure: numbers in, numbers out, no DOM and no React, so every rule that could put a wrong
 * figure on the page — the two rulers, the two floors, and the ribbon gap — can be checked
 * without a browser.
 *
 * Ribbons never touch a box. A Sankey node reads as conserving what passes through it, and these
 * boxes do not: a pool's balance is a stock at one height and a ribbon is gross flow over a
 * window. Every endpoint is pulled {@link ATTACH_GAP} away from the edge it points at, so the
 * picture states a direction and never a budget.
 */

/** The design canvas, and the only coordinate system anything here speaks. */
export const PULSE_VIEW_W = 1400;
export const PULSE_VIEW_H = 760;

/** The widest a box may be drawn. Area — not side — is proportional to the balance. */
const SIDE_MAX = 340;
/** Below this a box would be invisible, so it is drawn at minimum and says it was. */
const SIDE_MIN = 14;
/** The widest a ribbon may be drawn. */
const STROKE_MAX = 26;
/** Below this a ribbon would vanish, so it is drawn at minimum and says so. */
const STROKE_MIN = 1.25;
/** How far a ribbon stops short of the box it points at. See the header. */
const ATTACH_GAP = 9;
/** How many chains keep their own node before the tail is folded into one. */
const CHAINS_DRAWN = 5;
/**
 * How many ribbons are drawn before the rest are counted instead.
 *
 * Above what a frame can reach: roughly fifty — twelve boundary edges, twelve pool-to-pool
 * migrations, up to twenty-four crossings across the five drawn chains and the folded tail, and
 * the two mined edges. `/pulse` has no evidence table where a dropped ribbon would survive, so
 * dropping one would make the boundary stop summing to what crossed it while still looking like
 * a budget.
 *
 * Still a cap, because the number of counterpart chains is open-ended; when it bites the ruler
 * says `N of M drawn`.
 */
const EDGES_DRAWN = 64;

export interface PulsePoint {
  x: number;
  y: number;
}

/** One cubic Bézier, kept as its control points so a pulse can be placed without a DOM. */
export interface PulseEdgeGeometry {
  d: string;
  p0: PulsePoint;
  c0: PulsePoint;
  c1: PulsePoint;
  p1: PulsePoint;
}

/**
 * A point along an edge, evaluated from the control points rather than `getPointAtLength`: the
 * SVG method needs a laid-out element, which would make the motion engine untestable in jsdom.
 * Travel is not exactly arc-length uniform — invisible at these curvatures.
 */
export function pointOnEdge(g: PulseEdgeGeometry, t: number): PulsePoint {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * g.p0.x + b * g.c0.x + c * g.c1.x + d * g.p1.x,
    y: a * g.p0.y + b * g.c0.y + c * g.c1.y + d * g.p1.y,
  };
}

export type PulseBoxKind = "ledger" | "pool" | "lockbox" | "mined";

export interface PulseBoxLayout {
  key: string;
  node: PulseEnd;
  label: string;
  sub: string;
  x: number;
  y: number;
  w: number;
  h: number;
  balanceZat: number | null;
  /** The true area would have been invisible, so the box is at minimum and says so. */
  floored: boolean;
  /** The node published no balance at this height — outlined and labelled, never floor-sized. */
  absent: boolean;
  kind: PulseBoxKind;
  colorClass: string;
}

export interface PulseChainLayout {
  key: string;
  /** The node a pulse names. Null on the folded tail, which is not a chain. */
  node: PulseEnd | null;
  ticker: string;
  label: string;
  sub: string;
  cx: number;
  cy: number;
  r: number;
  colorClass: string;
  folded: boolean;
  foldedCount: number;
}

export type PulseEdgeKind =
  "subsidy" | "shielding" | "unshielding" | "migration" | "swap-in" | "swap-out" | "hub";

export interface PulseEdgeLayout extends PulseEdgeGeometry {
  key: string;
  from: PulseEnd;
  to: PulseEnd;
  kind: PulseEdgeKind;
  /** Stroke width. `STROKE_MIN` when floored. */
  width: number;
  floored: boolean;
  /** Null when the ribbons could not be read at all — the width is then a placeholder. */
  totalZat: number | null;
  events: number;
  /** Sprout's public JoinSplit values, a different accounting from every other pool's. */
  vpubDerived: boolean;
  /** Public swap venues only, so the total is a lower bound. */
  venueFloor: boolean;
  fromClass: string;
  toClass: string;
}

export interface PulseLayout {
  boxes: PulseBoxLayout[];
  chains: PulseChainLayout[];
  edges: PulseEdgeLayout[];
  hub: PulsePoint;
  /** What one 10 px square of a box is worth, printed beside the boxes. */
  boxRuler: string;
  /** What 3 px of a ribbon is worth, printed beside the ribbons. */
  ribbonRuler: string;
  /** False when the aggregate could not be read: the widths are placeholders, not measurements. */
  ribbonsAvailable: boolean;
  /** The window the ribbons were summed over, in words. A ribbon's title states it. */
  windowLabel: string;
  /** The height every balance and every ruler above was read at — one row, never a tip. */
  atHeight: number;
  /**
   * The slot each chain in this frame takes. Published because the log's dots and the engine's
   * marks colour the same movements; two derivations could let one chain wear two colours in one
   * frame.
   */
  chainClasses: ReadonlyMap<string, string>;
}

const POOL_ORDER: readonly ValuePoolName[] = POOL_NAMES;

const SUBTITLES: Readonly<Record<string, string>> = {
  mined: "issuance · no stock",
  transparent: "t-addresses",
  lockbox: "deferred subsidy",
  ironwood: "NU6.3",
  orchard: "NU5",
  sapling: "2018",
  sprout: "2016 · vpub",
};

/** The key the folded tail of the chain list is drawn under. Not a chain, and never a colour. */
export const PULSE_FOLDED_KEY = "others";

const isChain = (node: PulseEnd): boolean => pulseChainTicker(node) !== null;

function unit(from: PulsePoint, to: PulsePoint): PulsePoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  return len === 0 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
}

/**
 * Push both ends of a curve away from what they point at, along their own handles.
 *
 * One rule for every edge kind, so no case can forget it: the handle already leaves the box in
 * the direction the ribbon travels, so following it is always outward.
 */
function withGap(g: PulseEdgeGeometry): PulseEdgeGeometry {
  const a = unit(g.p0, g.c0);
  const b = unit(g.p1, g.c1);
  const p0 = { x: g.p0.x + a.x * ATTACH_GAP, y: g.p0.y + a.y * ATTACH_GAP };
  const p1 = { x: g.p1.x + b.x * ATTACH_GAP, y: g.p1.y + b.y * ATTACH_GAP };
  return { ...g, p0, p1, d: pathOf(p0, g.c0, g.c1, p1) };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

function pathOf(p0: PulsePoint, c0: PulsePoint, c1: PulsePoint, p1: PulsePoint): string {
  return `M${r2(p0.x)},${r2(p0.y)} C${r2(c0.x)},${r2(c0.y)} ${r2(c1.x)},${r2(c1.y)} ${r2(p1.x)},${r2(p1.y)}`;
}

export function edgeKindOf(from: PulseEnd, to: PulseEnd): PulseEdgeKind {
  if (isChain(from)) return "swap-in";
  if (isChain(to)) return "swap-out";
  if (from === "hub" || to === "hub") return "hub";
  if (from === "mined") return "subsidy";
  const fromPool = (POOL_ORDER as readonly string[]).includes(from);
  const toPool = (POOL_ORDER as readonly string[]).includes(to);
  if (fromPool && toPool) return "migration";
  if (toPool) return "shielding";
  if (fromPool) return "unshielding";
  return "subsidy";
}

/** Every node the picture can place, as a rectangle or a circle. */
interface Placed {
  rect?: { x: number; y: number; w: number; h: number };
  disc?: { cx: number; cy: number; r: number };
}

/**
 * The slot a boundary ribbon leaves the transparent ledger from. Fanned by pool rather than
 * bundled, so four shielding ribbons are four distinguishable departures.
 */
const SHIELD_SLOT: Readonly<Record<string, number>> = {
  sprout: 0.9,
  sapling: 0.72,
  orchard: 0.34,
  ironwood: 0.06,
};
const UNSHIELD_SLOT: Readonly<Record<string, number>> = {
  sprout: 0.97,
  sapling: 0.8,
  orchard: 0.5,
  ironwood: 0.16,
};

function geometryFor(
  from: PulseEnd,
  to: PulseEnd,
  kind: PulseEdgeKind,
  place: (node: PulseEnd) => Placed | null,
  hub: PulsePoint,
  chainIndex: (node: PulseEnd) => number,
): PulseEdgeGeometry | null {
  const a = place(from);
  const b = place(to);
  if (a === null || b === null) return null;

  const asPoint = (p: Placed | null, at: PulsePoint): PulsePoint =>
    p?.disc ? { x: p.disc.cx, y: p.disc.cy } : at;

  let p0: PulsePoint;
  let p1: PulsePoint;
  let c0: PulsePoint;
  let c1: PulsePoint;

  if (kind === "hub") {
    // One end is the boundary itself: a leg the chain did not settle, drawn to the point
    // where the legs meet rather than into a box that never received it.
    const other = from === "hub" ? b : a;
    const box = other.rect;
    const anchor = box
      ? { x: box.x + box.w * 0.5, y: box.y + box.h }
      : asPoint(other, { x: hub.x, y: hub.y });
    p0 = from === "hub" ? hub : anchor;
    p1 = from === "hub" ? anchor : hub;
    c0 = { x: (p0.x + p1.x) / 2, y: p0.y + 40 };
    c1 = { x: (p0.x + p1.x) / 2, y: p1.y - 40 };
  } else if (kind === "swap-in") {
    const disc = a.disc;
    const box = b.rect;
    if (!disc || !box) return null;
    const i = chainIndex(from);
    p0 = { x: disc.cx + disc.r, y: disc.cy - 4 };
    p1 = { x: box.x, y: box.y + box.h * (0.08 + i * 0.075) };
    c0 = { x: p0.x + 120, y: p0.y };
    c1 = { x: p1.x - 120, y: p1.y };
  } else if (kind === "swap-out") {
    const box = a.rect;
    const disc = b.disc;
    if (!disc || !box) return null;
    const i = chainIndex(to);
    p0 = { x: box.x, y: box.y + box.h * (0.56 + i * 0.075) };
    p1 = { x: disc.cx + disc.r, y: disc.cy + 5 };
    c0 = { x: p0.x - 120, y: p0.y };
    c1 = { x: p1.x + 120, y: p1.y };
  } else if (kind === "subsidy") {
    const box = a.rect;
    const target = b.rect;
    if (!box || !target) return null;
    if (to === "transparent") {
      p0 = { x: box.x + box.w * 0.5, y: box.y + box.h };
      p1 = { x: target.x + target.w * 0.5, y: target.y };
      c0 = { x: p0.x, y: p0.y + 40 };
      c1 = { x: p1.x, y: p1.y - 40 };
    } else if (to === "lockbox") {
      p0 = { x: box.x + box.w, y: box.y + box.h / 2 };
      p1 = { x: target.x, y: target.y + target.h / 2 };
      c0 = { x: p0.x + 40, y: p0.y };
      c1 = { x: p1.x - 40, y: p1.y };
    } else {
      // Issuance straight into a shielded pool: a ZIP-213 coinbase. Bowed over the top so it
      // cannot be read as passing through the ledger on its way.
      p0 = { x: box.x + box.w, y: box.y + box.h * 0.2 };
      p1 = { x: target.x + target.w, y: target.y + 6 };
      c0 = { x: p0.x + 260, y: p0.y - 90 };
      c1 = { x: target.x + target.w + 240, y: target.y - 120 };
    }
  } else if (kind === "shielding") {
    const box = a.rect;
    const target = b.rect;
    if (!box || !target) return null;
    const slot = SHIELD_SLOT[to] ?? 0.5;
    p0 = { x: box.x + box.w, y: box.y + box.h * slot };
    p1 = { x: target.x, y: target.y + target.h * 0.3 };
    c0 = { x: p0.x + 130, y: p0.y };
    c1 = { x: p1.x - 130, y: p1.y };
  } else if (kind === "unshielding") {
    const box = a.rect;
    const target = b.rect;
    if (!box || !target) return null;
    const slot = UNSHIELD_SLOT[from] ?? 0.5;
    p0 = { x: box.x, y: box.y + box.h * 0.7 };
    p1 = { x: target.x + target.w, y: target.y + target.h * slot };
    c0 = { x: p0.x - 130, y: p0.y };
    c1 = { x: p1.x + 130, y: p1.y };
  } else {
    const box = a.rect;
    const target = b.rect;
    if (!box || !target) return null;
    p0 = { x: box.x + box.w, y: box.y + box.h * 0.35 };
    p1 = { x: target.x + target.w, y: target.y + target.h * 0.7 };
    const bow = 100 + Math.abs(p1.y - p0.y) * 0.4;
    c0 = { x: p0.x + bow, y: p0.y };
    c1 = { x: p1.x + bow, y: p1.y };
  }

  return withGap({ d: pathOf(p0, c0, c1, p1), p0, c0, c1, p1 });
}

/**
 * The ribbons drawn when the aggregate could not be read: every one floored, and the layout says
 * the totals are unavailable. Drawing nothing would state that no value has ever crossed a
 * boundary.
 */
const SKELETON: readonly (readonly [PulseEnd, PulseEnd])[] = [
  ["mined", "transparent"],
  ["mined", "lockbox"],
  ["transparent", "ironwood"],
  ["transparent", "orchard"],
  ["transparent", "sapling"],
  ["transparent", "sprout"],
  ["ironwood", "transparent"],
  ["orchard", "transparent"],
  ["sapling", "transparent"],
  ["sprout", "transparent"],
  ["orchard", "ironwood"],
  ["sapling", "ironwood"],
  ["sapling", "orchard"],
  ["sprout", "orchard"],
];

export interface PulseLayoutInput {
  stocks: PulseBlockPools;
  /** The window's ribbons, or null when the aggregate could not be read. */
  ribbons: PulseRibbonWindow | null;
  /** Movements the frame carries, so a chain with a pulse is drawn even with no ribbon. */
  events?: readonly PulseEvent[];
  windowLabel: string;
  /**
   * False when no block row covers the instant being drawn — a replay whose hour has not loaded,
   * or one scrubbed before everything we hold. Then `stocks.height` does not describe this
   * instant, so the ruler must not print it.
   */
  measured?: boolean;
}

interface ChainWeight {
  node: PulseEnd;
  ticker: string;
  weight: number;
}

function chainWeights(input: PulseLayoutInput): ChainWeight[] {
  const totals = new Map<string, ChainWeight>();
  const add = (node: PulseEnd, weight: number) => {
    const ticker = pulseChainTicker(node);
    if (ticker === null) return;
    const held = totals.get(node);
    totals.set(node, { node, ticker, weight: (held?.weight ?? 0) + weight });
  };
  for (const edge of input.ribbons?.edges ?? []) {
    add(edge.from, edge.totalZat);
    add(edge.to, edge.totalZat);
  }
  // A crossing on screen with no ribbon behind it still needs somewhere to land, so a chain
  // that only appears in the frame's own movements is drawn at weight zero rather than dropped.
  for (const event of input.events ?? []) {
    for (const leg of event.legs) {
      add(leg.from, 0);
      add(leg.to, 0);
    }
  }
  return [...totals.values()].sort(
    (a, b) => b.weight - a.weight || a.ticker.localeCompare(b.ticker),
  );
}

/**
 * Which chains a frame draws, and the slot each takes — the one derivation.
 *
 * Built from the chains that get their own node, not every ticker in the frame: there are five
 * free slots and five drawn nodes, so allocating to the whole list would spend slots on folded
 * chains and leave drawn ones sharing the tail's ink. Folded chains resolve to that ink through
 * {@link pulseNodeClass}, where their ribbons land anyway. Exported so the log seeded before a
 * layout exists asks the same question of the same input.
 */
export function pulseFrameChainClasses(input: PulseLayoutInput): ReadonlyMap<string, string> {
  return pulseChainClasses(
    chainWeights(input)
      .slice(0, CHAINS_DRAWN)
      .map((c) => c.ticker),
  );
}

export function pulseLayout(input: PulseLayoutInput): PulseLayout {
  const chainClasses = pulseFrameChainClasses(input);
  const balances = input.stocks.pools;
  const known = Object.values(balances).filter((b): b is number => b !== null && b > 0);
  // The scale is the largest balance we can see. With nothing readable every box is floored,
  // which is honest: no box then claims a size it was not measured at.
  const maxBalance = known.length > 0 ? Math.max(...known) : 0;

  const sideOf = (balance: number | null): { side: number; floored: boolean; absent: boolean } => {
    if (balance === null) return { side: SIDE_MIN * 2, floored: false, absent: true };
    if (maxBalance <= 0 || balance <= 0) return { side: SIDE_MIN, floored: true, absent: false };
    const raw = SIDE_MAX * Math.sqrt(balance / maxBalance);
    return { side: Math.max(SIDE_MIN, raw), floored: raw < SIDE_MIN, absent: false };
  };

  const boxes: PulseBoxLayout[] = [];
  const box = (
    key: string,
    kind: PulseBoxKind,
    x: number,
    y: number,
    w: number,
    h: number,
    balanceZat: number | null,
    floored: boolean,
    absent: boolean,
  ): PulseBoxLayout => ({
    key,
    node: key as PulseEnd,
    label: key,
    sub: SUBTITLES[key] ?? "",
    x,
    y,
    w,
    h,
    balanceZat,
    floored,
    absent,
    kind,
    colorClass: pulseNodeClass(key as PulseEnd, chainClasses),
  });

  const t = sideOf(balances.transparent);
  boxes.push(
    box(
      "transparent",
      "ledger",
      470,
      230,
      t.side,
      t.side,
      balances.transparent,
      t.floored,
      t.absent,
    ),
  );
  // Issuance has no stock, so it has no area to be proportional to: a fixed dashed source.
  boxes.push(box("mined", "mined", 470, 96, 176, 44, null, false, false));
  const l = sideOf(balances.lockbox);
  boxes.push(
    box(
      "lockbox",
      "lockbox",
      760,
      96 + (44 - l.side) / 2,
      l.side,
      l.side,
      balances.lockbox,
      l.floored,
      l.absent,
    ),
  );

  const POOL_GAP = 58;
  const sides = POOL_ORDER.map((p) => sideOf(balances[p]));
  const stackHeight = sides.reduce((a, s) => a + s.side, 0) + POOL_GAP * (POOL_ORDER.length - 1);
  // Clamped so a tall stack cannot run off the top of the canvas and take its labels with it.
  let y = Math.max(56, 400 - stackHeight / 2 + 22);
  const poolCx = 1120;
  POOL_ORDER.forEach((pool, i) => {
    const s = sides[i]!;
    boxes.push(
      box(
        pool,
        "pool",
        poolCx - s.side / 2,
        y,
        s.side,
        s.side,
        balances[pool],
        s.floored,
        s.absent,
      ),
    );
    y += s.side + POOL_GAP;
  });

  const weights = chainWeights(input);
  const drawn = weights.slice(0, CHAINS_DRAWN);
  const tail = weights.slice(CHAINS_DRAWN);
  const chains: PulseChainLayout[] = [];
  const CHAIN_TOP = 275;
  const CHAIN_STEP = 62;
  drawn.forEach((c, i) => {
    chains.push({
      key: c.node,
      node: c.node,
      ticker: c.ticker,
      label: c.ticker,
      // No caption: the chain's mark and ticker say what the node is, and the floor caveat lives
      // on the ribbon and pulse titles, where the figure is.
      sub: "",
      cx: 150,
      cy: CHAIN_TOP + i * CHAIN_STEP,
      r: 19,
      colorClass: pulseNodeClass(c.node, chainClasses),
      folded: false,
      foldedCount: 0,
    });
  });
  if (tail.length > 0) {
    chains.push({
      key: PULSE_FOLDED_KEY,
      node: null,
      ticker: `+${tail.length}`,
      label: `+${tail.length}`,
      sub: "other chains",
      cx: 150,
      cy: CHAIN_TOP + drawn.length * CHAIN_STEP,
      r: 19,
      // Never a slot colour: the tail is not a chain, and colouring it would invite the
      // comparison the fold exists to refuse.
      colorClass: PULSE_FOLDED_CLASS,
      folded: true,
      foldedCount: tail.length,
    });
  }

  const transparentBox = boxes.find((b) => b.key === "transparent")!;
  const hub: PulsePoint = { x: 940, y: transparentBox.y + transparentBox.h + 96 };

  const byKey = new Map(boxes.map((b) => [b.key, b]));
  const chainByKey = new Map(chains.map((c) => [c.key, c]));
  const foldedFor = new Set(tail.map((c) => c.node));

  /** Which drawn node a movement's end belongs to — a folded chain lands on the tail. */
  const resolve = (node: PulseEnd): string | null => {
    if (node === "hub") return "hub";
    if (isChain(node)) {
      if (chainByKey.has(node)) return node;
      return foldedFor.has(node) || tail.length > 0 ? PULSE_FOLDED_KEY : null;
    }
    return byKey.has(node) ? node : null;
  };

  const place = (node: PulseEnd): Placed | null => {
    const key = resolve(node);
    if (key === null) return null;
    if (key === "hub") return { disc: { cx: hub.x, cy: hub.y, r: 9 } };
    const b = byKey.get(key);
    if (b) return { rect: { x: b.x, y: b.y, w: b.w, h: b.h } };
    const c = chainByKey.get(key);
    return c ? { disc: { cx: c.cx, cy: c.cy, r: c.r } } : null;
  };

  const chainIndex = (node: PulseEnd): number => {
    const key = resolve(node);
    return Math.max(
      0,
      chains.findIndex((c) => c.key === key),
    );
  };

  const sources: readonly PulseEdgeTotal[] =
    input.ribbons === null
      ? SKELETON.map(([from, to]) => ({ from, to, totalZat: 0, events: 0 }))
      : input.ribbons.edges;

  // Folded chains collapse onto the tail node, so their ribbons sum instead of overlapping.
  const merged = new Map<string, PulseEdgeTotal & { drawnFrom: string; drawnTo: string }>();
  for (const edge of sources) {
    const from = resolve(edge.from);
    const to = resolve(edge.to);
    if (from === null || to === null || from === to) continue;
    const key = `${from}>${to}`;
    const held = merged.get(key);
    merged.set(key, {
      from: (from === PULSE_FOLDED_KEY ? edge.from : (from as PulseEnd)) as PulseEnd,
      to: (to === PULSE_FOLDED_KEY ? edge.to : (to as PulseEnd)) as PulseEnd,
      drawnFrom: from,
      drawnTo: to,
      totalZat: (held?.totalZat ?? 0) + edge.totalZat,
      events: (held?.events ?? 0) + edge.events,
      ...(edge.vpubDerived || held?.vpubDerived ? { vpubDerived: true as const } : {}),
      ...(edge.floor || held?.floor ? { floor: true as const } : {}),
    });
  }

  const ranked = [...merged.values()].sort((a, b) => b.totalZat - a.totalZat).slice(0, EDGES_DRAWN);
  const maxTotal = Math.max(0, ...ranked.map((e) => e.totalZat));

  const edges: PulseEdgeLayout[] = [];
  for (const edge of ranked) {
    const kind = edgeKindOf(edge.from, edge.to);
    const geometry = geometryFor(edge.from, edge.to, kind, place, hub, chainIndex);
    if (geometry === null) continue;
    const raw = maxTotal > 0 ? (STROKE_MAX * edge.totalZat) / maxTotal : 0;
    edges.push({
      ...geometry,
      key: `${edge.drawnFrom}>${edge.drawnTo}`,
      from: edge.from,
      to: edge.to,
      kind,
      width: Math.max(STROKE_MIN, raw),
      floored: raw < STROKE_MIN,
      totalZat: input.ribbons === null ? null : edge.totalZat,
      events: edge.events,
      vpubDerived: edge.vpubDerived === true,
      venueFloor: edge.floor === true,
      fromClass: pulseNodeClass(edge.from, chainClasses),
      toClass: pulseNodeClass(edge.to, chainClasses),
    });
  }

  return {
    boxes,
    chains,
    edges,
    hub,
    boxRuler:
      input.measured === false
        ? "balances at this instant have not been read"
        : `${formatZecWhole(maxBalance * (100 / (SIDE_MAX * SIDE_MAX)))} per 10 px² · at block ${formatCount(input.stocks.height)}`,
    ribbonRuler:
      input.ribbons === null
        ? "unavailable · widths are placeholders"
        : `${formatZecWhole((maxTotal * 3) / STROKE_MAX)} per 3 px · ${input.windowLabel} · completed only` +
          // Both ways a ribbon can fail to be drawn: the cap above, and an endpoint the
          // picture cannot place. Either way the reader is told, because a boundary that
          // silently sums to less than what crossed it looks exactly like a quiet window.
          (edges.length < merged.size ? ` · ${edges.length} of ${merged.size} drawn` : ""),
    ribbonsAvailable: input.ribbons !== null,
    windowLabel: input.windowLabel,
    atHeight: input.stocks.height,
    chainClasses,
  };
}

/**
 * Where a movement's leg travels, whether or not a ribbon was drawn for it.
 *
 * A pulse and a ribbon measure different things — one movement against a window's gross total
 * — so a leg with no ribbon still has to go somewhere. Built from the same placement rules, so
 * a pulse can never travel down a line the picture does not have.
 */
export function legGeometry(
  layout: PulseLayout,
  from: PulseEnd,
  to: PulseEnd,
): PulseEdgeGeometry | null {
  const existing = layout.edges.find((e) => e.from === from && e.to === to);
  if (existing) return existing;
  const byKey = new Map(layout.boxes.map((b) => [b.key, b]));
  const chainByKey = new Map(layout.chains.filter((c) => c.node !== null).map((c) => [c.key, c]));
  const folded = layout.chains.find((c) => c.folded) ?? null;
  const resolveDisc = (node: PulseEnd): PulseChainLayout | null =>
    chainByKey.get(node) ?? (pulseChainTicker(node) !== null ? folded : null);
  const place = (node: PulseEnd): Placed | null => {
    if (node === "hub") return { disc: { cx: layout.hub.x, cy: layout.hub.y, r: 9 } };
    const b = byKey.get(node);
    if (b) return { rect: { x: b.x, y: b.y, w: b.w, h: b.h } };
    const c = resolveDisc(node);
    return c ? { disc: { cx: c.cx, cy: c.cy, r: c.r } } : null;
  };
  const chainIndex = (node: PulseEnd): number => {
    const c = resolveDisc(node);
    return c === null ? 0 : Math.max(0, layout.chains.indexOf(c));
  };
  return geometryFor(from, to, edgeKindOf(from, to), place, layout.hub, chainIndex);
}

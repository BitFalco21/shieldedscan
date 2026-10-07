import type { PulseEnd, PulseEvent, PulseLeg } from "@/domain";
import { pulseRadius } from "@/domain";
import { pulseNodeClass } from "@/lib/pulse-palette";
import { type PulseEdgeGeometry, type PulseLayout, legGeometry, pointOnEdge } from "./pulse-layout";
import type { PulseCollapsedBlock } from "./pulse-scheduler";
import {
  type PulseCoverage,
  collapsedHubTitle,
  collapsedTitle,
  collapsedVeilTitle,
  eventTitle,
  isCrossing,
} from "./pulse-text";

/**
 * Every mark that moves, owned imperatively.
 *
 * React renders the picture; this renders what happens on top of it. Hundreds of marks a minute,
 * each repositioned sixty times a second, must not be React state: reconciling that per frame is
 * work with no benefit.
 *
 * The contract in exchange: attributes and classes only. No inline `style` and no colour
 * literals — a mark takes its palette slot as a class and its ink from `currentColor`. Every
 * mark carries a `<title>` built by `pulse-text.ts`, so a caveat travels with the thing it
 * qualifies.
 */

const NS = "http://www.w3.org/2000/svg";

/**
 * A ceiling on marks in flight. A scrub across an hour at ×600 can ask for thousands at once;
 * past this the oldest are retired early. That is visible as a thinner picture and is the honest
 * failure: the log still carries every movement, and `truncated` still says when a block was a
 * slice.
 */
const MAX_MARKS = 420;

/** How long a pulse takes to cross its edge at ×1, milliseconds. */
const TRAVEL_MS = 3_800;
/** How long an arrival ripple lives. */
const RIPPLE_MS = 900;
/** How long a destination box stays lit. */
const LIT_MS = 900;
/** How long a hub's legs stay on screen. */
const HUB_MS = 4_200;
/** How long a veil orbits its pool. */
const VEIL_MS = 3_200;
/** How long a static mark stays, in still mode. */
const MARK_MS = 6_000;
/**
 * How long a pending mark takes to fade once our node stops offering it. Removing it in the same
 * frame that titles it `left mempool · not confirmed` would mean the title is never seen, and a
 * mark that vanishes between two frames is indistinguishable from one that was confirmed.
 */
const PENDING_FADE_MS = 700;

type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Attrs,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (parent) parent.appendChild(node);
  return node as SVGElementTagNameMap[K];
}

function titled(parent: Element, text: string): void {
  const title = document.createElementNS(NS, "title");
  title.textContent = text;
  parent.insertBefore(title, parent.firstChild);
}

/**
 * Rewrite a mark's `<title>` in place: a merged count mark stands for more blocks than when it
 * was drawn, and its title must not state a smaller claim than the number beside it.
 */
function retitled(parent: Element, text: string): void {
  const existing = parent.querySelector("title");
  if (existing === null) {
    titled(parent, text);
    return;
  }
  existing.textContent = text;
}

/**
 * The lower and upper ends of a merged count mark's block range, either possibly absent. Null is
 * "no height" (an unpaired crossing has none) and must not collapse to zero, which would print
 * `blocks 0–3,459,350`.
 */
function leastHeight(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function greatestHeight(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** Slow in, slow out — a movement that starts and stops rather than one that is switched on. */
const ease = (x: number): number => (x < 0.5 ? 2 * x * x : -1 + (4 - 2 * x) * x);

interface Travelling {
  group: SVGGElement;
  geometry: PulseEdgeGeometry;
  head: SVGCircleElement[];
  tail: SVGCircleElement[];
  startedAt: number;
  duration: number;
  radius: number;
  destination: PulseEnd;
  colorClass: string;
}

interface Expiring {
  node: SVGElement;
  until: number;
}

interface Orbiting {
  node: SVGRectElement;
  box: { x: number; y: number; w: number; h: number };
  startedAt: number;
  until: number;
}

/**
 * A live count-only mark: the running total standing at one node, and what it stands for. One
 * per node at a time, so collapsed blocks at ×600 add to it rather than stacking glowing rects
 * on one spot; the arithmetic moves into the number and the title.
 */
interface CountMark {
  group: SVGGElement;
  label: SVGTextElement;
  count: number;
  fromHeight: number | null;
  toHeight: number | null;
  /** The same object `#expiring` holds, so extending the mark's life is one assignment. */
  entry: Expiring;
  /** Redaction or plain ink. The two say different things and never merge into one another. */
  shielded: boolean;
}

interface Rippling {
  node: SVGCircleElement;
  startedAt: number;
  radius: number;
}

export interface PulseMotionEngineOptions {
  /** The layer every mark is appended to. */
  root: SVGGElement;
  /** The layer pending marks live in, so they can be cleared without touching the rest. */
  pendingRoot: SVGGElement;
  /** The whole stage, for lighting a destination box by its `data-box` attribute. */
  stage: SVGSVGElement;
  layout: PulseLayout;
  still: boolean;
}

export class PulseMotionEngine {
  #root: SVGGElement;
  #pendingRoot: SVGGElement;
  #stage: SVGSVGElement;
  #layout: PulseLayout;
  #still: boolean;
  #speed = 1;
  #travelling: Travelling[] = [];
  #ripples: Rippling[] = [];
  #orbits: Orbiting[] = [];
  #expiring: Expiring[] = [];
  #pending = new Map<string, SVGElement>();
  #counters = new Map<string, { node: SVGTextElement; count: number }>();
  /** One live count-only mark per node, so collapsed blocks add to it instead of stacking. */
  #countMarks = new Map<string, CountMark>();
  #lit = new Map<string, ReturnType<typeof setTimeout>>();
  #disposed = false;

  constructor(options: PulseMotionEngineOptions) {
    this.#root = options.root;
    this.#pendingRoot = options.pendingRoot;
    this.#stage = options.stage;
    this.#layout = options.layout;
    this.#still = options.still;
  }

  setLayout(layout: PulseLayout): void {
    this.#layout = layout;
  }

  /**
   * Switch between motion and still marks.
   *
   * Everything in flight is cleared: a pulse halfway down an edge under reduced motion is a
   * mark claiming a position it was never going to reach.
   */
  setStill(still: boolean): void {
    if (still === this.#still) return;
    this.#still = still;
    this.clearAll();
  }

  /** Replay speed. A pulse gets less time as the clock gets faster, or it would smear. */
  setSpeed(multiplier: number): void {
    this.#speed = Math.max(1, multiplier);
  }

  get still(): boolean {
    return this.#still;
  }

  #geometry(from: PulseEnd, to: PulseEnd): PulseEdgeGeometry | null {
    return legGeometry(this.#layout, from, to);
  }

  #trim(): void {
    while (this.#travelling.length > MAX_MARKS) {
      const oldest = this.#travelling.shift();
      oldest?.group.remove();
    }
  }

  /**
   * One movement, drawn as whatever its shape allows it to claim. `coverage` is the block's own
   * `eventCount` against what it handed over; it rides on every mark the block draws, so a
   * capped block never presents its slice as its total.
   */
  spawnEvent(event: PulseEvent, nowMs: number, coverage?: PulseCoverage): void {
    if (this.#disposed) return;
    if (event.shape === "veil") return this.#spawnVeil(event, nowMs, coverage);
    if (event.shape === "hub") return this.#spawnHub(event, nowMs, coverage);
    for (const leg of event.legs) this.#spawnLeg(event, leg, nowMs, coverage);
  }

  #spawnLeg(event: PulseEvent, leg: PulseLeg, nowMs: number, coverage?: PulseCoverage): void {
    const geometry = this.#geometry(leg.from, leg.to);
    if (geometry === null) return;
    const title = eventTitle(event, leg, coverage);
    // Colour follows the DESTINATION, except for a crossing, which is named by its counterpart
    // chain wherever the value ended up: a swap's identity is the chain it touched.
    const crossing = isCrossing(event);
    const colorNode = crossing ? (leg.from === "transparent" ? leg.to : leg.from) : leg.to;
    const colorClass = pulseNodeClass(colorNode, this.#layout.chainClasses);
    // An unpaired crossing lights nothing: a venue saying a crossing completed is not the chain
    // saying which block carried it, so it is a hollow glyph placed at venue time. Keyed on the
    // counterpart facts, not on `kind`: a paired crossing keeps its transaction's kind.
    const unpaired = crossing && event.height === null;
    const radius = pulseRadius(leg.amountZat) * (unpaired ? 0.9 : 1);

    if (this.#still) {
      this.#placeMark(
        geometry,
        colorClass,
        radius,
        title,
        `${leg.from}>${leg.to}`,
        nowMs,
        unpaired,
      );
      return;
    }

    const group = el("g", { class: `pulse-mark-group ${colorClass}` }, this.#root);
    titled(group, title);
    const tail = [0.85, 0.65, 0.45, 0.25].map((opacity, i) =>
      el(
        "circle",
        { r: radius * (0.8 - i * 0.15), class: "pulse-tail", opacity: opacity * 0.5 },
        group,
      ),
    );
    const halo = el("circle", { r: radius * 1.6, class: "pulse-halo" }, group);
    const core = el(
      "circle",
      unpaired
        ? { r: radius * 0.62, class: "pulse-core is-hollow" }
        : { r: radius * 0.55, class: "pulse-core" },
      group,
    );
    const duration = Math.max(320, TRAVEL_MS / Math.sqrt(this.#speed));
    this.#travelling.push({
      group,
      geometry,
      head: [halo, core],
      tail,
      startedAt: nowMs,
      duration,
      radius,
      // A leg that ends nowhere the chain settled must not light a box.
      destination: unpaired ? ("hub" as PulseEnd) : leg.to,
      colorClass,
    });
    this.#trim();
  }

  /** A static mark at the destination, plus the running count for that edge. */
  #placeMark(
    geometry: PulseEdgeGeometry,
    colorClass: string,
    radius: number,
    title: string,
    edgeKey: string,
    nowMs: number,
    hollow: boolean,
  ): void {
    const at = pointOnEdge(geometry, 1);
    const group = el("g", { class: `pulse-mark-group ${colorClass}` }, this.#root);
    titled(group, title);
    el(
      "circle",
      {
        cx: at.x,
        cy: at.y,
        r: radius,
        class: hollow ? "pulse-still is-hollow" : "pulse-still",
      },
      group,
    );
    this.#expiring.push({ node: group, until: nowMs + MARK_MS });
    const held = this.#counters.get(edgeKey);
    if (held) {
      held.count += 1;
      held.node.textContent = `+${held.count}`;
    } else {
      const text = el(
        "text",
        { x: at.x + 12, y: at.y - 10, class: `pulse-counter ${colorClass}` },
        this.#root,
      );
      text.textContent = "+1";
      this.#counters.set(edgeKey, { node: text, count: 1 });
      this.#expiring.push({ node: text, until: nowMs + MARK_MS });
    }
    this.#trim();
  }

  /**
   * A fully shielded movement: redaction orbiting the pool's own border. The Veil, and the only
   * place on this page it is allowed — it means "encrypted on-chain, hidden by design" and
   * nothing else. It carries no size, because there is no size to carry.
   */
  #spawnVeil(event: PulseEvent, nowMs: number, coverage?: PulseCoverage): void {
    const pool = event.legs[0]?.to ?? event.legs[0]?.from;
    if (pool === undefined) return;
    const box = this.#layout.boxes.find((b) => b.key === pool);
    if (box === undefined) return;
    const width = Math.min(44, Math.max(18, box.w * 0.4));
    const node = el(
      "rect",
      {
        x: box.x + box.w / 2 - width / 2,
        y: box.y - 6,
        width,
        height: 12,
        rx: 2,
        class: "pulse-veil",
        role: "img",
        "aria-label": "value shielded — encrypted on-chain",
      },
      this.#root,
    );
    titled(node, eventTitle(event, undefined, coverage));
    if (this.#still) {
      this.#expiring.push({ node, until: nowMs + MARK_MS });
      return;
    }
    this.#orbits.push({
      node,
      box: { x: box.x, y: box.y, w: box.w, h: box.h },
      startedAt: nowMs,
      until: nowMs + VEIL_MS,
    });
  }

  /**
   * A movement whose direction the chain did not settle: its legs, drawn as legs. Never paired,
   * never joined through the hub — the point on screen is where the legs meet, not a node value
   * passed through. A leg with no published amount is floor-sized, dashed and says so; not
   * redaction, because the amount is missing from this view rather than encrypted.
   */
  #spawnHub(event: PulseEvent, nowMs: number, coverage?: PulseCoverage): void {
    const group = el("g", { class: "pulse-hub-group" }, this.#root);
    titled(group, eventTitle(event, undefined, coverage));
    const { x: hx, y: hy } = this.#layout.hub;
    el("circle", { cx: hx, cy: hy, r: 9, class: "pulse-hub-node" }, group);
    for (const leg of event.legs) {
      const node = leg.from === "hub" ? leg.to : leg.from;
      const box = this.#layout.boxes.find((b) => b.key === node);
      if (box === undefined) continue;
      const px = node === "transparent" ? box.x + box.w - 30 : box.x + box.w * 0.5;
      const py = box.y + box.h;
      const known = leg.amountZat !== null;
      const line = el(
        "path",
        {
          d: `M${px},${py} L${hx},${hy}`,
          class: `pulse-hub-leg ${pulseNodeClass(node, this.#layout.chainClasses)}`,
          "stroke-width": known ? Math.max(1.5, pulseRadius(leg.amountZat) / 2) : 1.5,
          "stroke-dasharray": known ? "none" : "3 3",
        },
        group,
      );
      titled(
        line,
        known
          ? eventTitle(event, leg)
          : `${node} · value not carried in this view · direction not settled by the chain`,
      );
      const mid = { x: (px + hx) / 2, y: (py + hy) / 2 };
      el(
        "circle",
        {
          cx: mid.x,
          cy: mid.y,
          r: known ? pulseRadius(leg.amountZat) : 4,
          class: known
            ? `pulse-still ${pulseNodeClass(node, this.#layout.chainClasses)}`
            : `pulse-still is-hollow ${pulseNodeClass(node, this.#layout.chainClasses)}`,
        },
        group,
      );
    }
    const caption = el(
      "text",
      { x: hx, y: hy + 28, class: "pulse-caption", "text-anchor": "middle" },
      group,
    );
    caption.textContent = `${event.legs.length} legs · drawn as legs, not paired`;
    this.#expiring.push({ node: group, until: nowMs + (this.#still ? MARK_MS : HUB_MS) });
    this.#trim();
  }

  /**
   * A movement our node has seen and no block has confirmed.
   *
   * It hovers at the start of its edge and never travels: travelling would state an arrival
   * that has not happened. Exactly two exits — {@link convertPending} when a block confirms it,
   * {@link expirePending} when it leaves the mempool without one.
   */
  addPending(event: PulseEvent): void {
    if (this.#disposed || this.#pending.has(event.id)) return;
    const leg = event.legs[0];
    if (leg === undefined) return;
    const geometry = this.#geometry(leg.from, leg.to);
    if (geometry === null) return;
    const at = pointOnEdge(geometry, 0.06);
    const group = el(
      "g",
      { class: `pulse-pending-group ${pulseNodeClass(leg.to, this.#layout.chainClasses)}` },
      this.#pendingRoot,
    );
    titled(group, `${eventTitle(event, leg)}`);
    el(
      "circle",
      {
        cx: at.x,
        cy: at.y,
        r: pulseRadius(leg.amountZat) * 0.8,
        class: this.#still ? "pulse-pending is-still-mark" : "pulse-pending",
      },
      group,
    );
    if (this.#still) {
      const word = el("text", { x: at.x + 12, y: at.y + 4, class: "pulse-caption" }, group);
      word.textContent = "pending";
    }
    this.#pending.set(event.id, group);
  }

  /** The first exit: a block confirmed it, so the pending mark becomes the confirmed one. */
  convertPending(id: string): boolean {
    const held = this.#pending.get(id);
    if (held === undefined) return false;
    held.remove();
    this.#pending.delete(id);
    return true;
  }

  /**
   * The second exit: it left the mempool without a block. It fades rather than vanishing, so the
   * retitled `left mempool · not confirmed` is on screen long enough to read and is not mistaken
   * for a confirmation. Under reduced motion there is no fade, so it goes at once.
   */
  expirePending(id: string, nowMs: number): void {
    const held = this.#pending.get(id);
    if (held === undefined) return;
    this.#pending.delete(id);
    titled(held, "left mempool · not confirmed");
    if (this.#still) {
      held.remove();
      return;
    }
    held.classList.add("is-fading");
    this.#expiring.push({ node: held, until: nowMs + PENDING_FADE_MS });
  }

  pendingIds(): string[] {
    return [...this.#pending.keys()];
  }

  clearPending(): void {
    for (const node of this.#pending.values()) node.remove();
    this.#pending.clear();
  }

  /**
   * A block too busy to draw one mark per movement, drawn as one mark per edge plus a count-only
   * mark for each kind of movement no edge can carry. The veils and hubs have no amount to sum;
   * leaving them out would draw a busy block as a small one.
   */
  spawnCollapsed(block: PulseCollapsedBlock, nowMs: number, coverage?: PulseCoverage): void {
    for (const edge of block.edges) {
      const geometry = this.#geometry(edge.from, edge.to);
      if (geometry === null) continue;
      const title = collapsedTitle(
        edge.count,
        edge.totalZat,
        edge.height,
        edge.from,
        edge.to,
        coverage,
      );
      const colorClass = pulseNodeClass(edge.to, this.#layout.chainClasses);
      const radius = pulseRadius(edge.totalZat);
      if (this.#still) {
        this.#placeMark(geometry, colorClass, radius, title, edge.key, nowMs, false);
        continue;
      }
      const group = el("g", { class: `pulse-mark-group ${colorClass}` }, this.#root);
      titled(group, title);
      const halo = el("circle", { r: radius * 1.6, class: "pulse-halo" }, group);
      const core = el("circle", { r: radius * 0.55, class: "pulse-core" }, group);
      this.#travelling.push({
        group,
        geometry,
        head: [halo, core],
        tail: [],
        startedAt: nowMs,
        duration: Math.max(320, TRAVEL_MS / Math.sqrt(this.#speed)),
        radius,
        destination: edge.to,
        colorClass,
      });
    }

    for (const veil of block.veils) {
      this.#countMark(veil.pool, veil.count, block.height, nowMs, true);
    }
    if (block.hubs > 0) {
      this.#countMark("hub", block.hubs, block.height, nowMs, false);
    }
    this.#trim();
  }

  /**
   * A count standing where an amount cannot: at a pool for its shielded movements, at the
   * boundary for the ones whose direction the chain did not settle. Redaction for the veils;
   * plain ink for the hubs, whose amounts are published but whose direction is missing.
   *
   * One live mark per node: a later collapsed block adds to the mark already standing there
   * rather than drawing another on top of it, so glows never stack into a shape that measures
   * nothing. The rect stays 44×12 whatever the count — it is not a size — and the arithmetic
   * goes into the number and the title, which names the range of blocks it stands for.
   */
  #countMark(
    node: PulseEnd,
    count: number,
    height: number | null,
    nowMs: number,
    shielded: boolean,
  ): void {
    const key = String(node);
    const until = nowMs + (this.#still ? MARK_MS : HUB_MS);
    const held = this.#countMarks.get(key);
    // `shielded` guards the merge as well as the key: redaction means "encrypted on-chain" and
    // plain ink means "the direction is missing", and merging one kind's count into the other's
    // mark would state the wrong caveat. A pool is never the hub today, but a later node kind
    // could be.
    if (held !== undefined && held.group.isConnected && held.shielded === shielded) {
      held.count += count;
      held.fromHeight = leastHeight(held.fromHeight, height);
      held.toHeight = greatestHeight(held.toHeight, height);
      held.label.textContent = `×${held.count}`;
      retitled(
        held.group,
        shielded
          ? collapsedVeilTitle(held.count, node, held.fromHeight, held.toHeight)
          : collapsedHubTitle(held.count, held.fromHeight, held.toHeight),
      );
      // The same object `#expiring` holds, so the mark simply lives on rather than being
      // replaced — a replacement would be the stack this exists to remove, one frame later.
      held.entry.until = until;
      return;
    }
    const at =
      node === "hub"
        ? { x: this.#layout.hub.x, y: this.#layout.hub.y }
        : (() => {
            const box = this.#layout.boxes.find((b) => b.key === node);
            return box === undefined ? null : { x: box.x + box.w / 2, y: box.y - 6 };
          })();
    if (at === null) return;
    const group = el(
      "g",
      { class: `pulse-mark-group ${pulseNodeClass(node, this.#layout.chainClasses)}` },
      this.#root,
    );
    titled(
      group,
      shielded
        ? collapsedVeilTitle(count, node, height, height)
        : collapsedHubTitle(count, height, height),
    );
    if (shielded) {
      el(
        "rect",
        {
          x: at.x - 22,
          y: at.y - 6,
          width: 44,
          height: 12,
          rx: 2,
          class: "pulse-veil",
          role: "img",
          "aria-label": "values shielded — encrypted on-chain",
        },
        group,
      );
    } else {
      el("circle", { cx: at.x, cy: at.y, r: 9, class: "pulse-hub-node" }, group);
    }
    const label = el(
      "text",
      {
        x: at.x + 28,
        y: at.y + 4,
        class: `pulse-counter ${pulseNodeClass(node, this.#layout.chainClasses)}`,
      },
      group,
    );
    label.textContent = `×${count}`;
    const entry: Expiring = { node: group, until };
    this.#expiring.push(entry);
    this.#countMarks.set(key, {
      group,
      label,
      count,
      fromHeight: height,
      toHeight: height,
      entry,
      shielded,
    });
  }

  /** Advance everything in flight. Called once per animation frame by the stage. */
  frame(nowMs: number): void {
    if (this.#disposed) return;

    this.#travelling = this.#travelling.filter((p) => {
      const t = (nowMs - p.startedAt) / p.duration;
      if (t >= 1) {
        p.group.remove();
        this.#arrive(p, nowMs);
        return false;
      }
      const at = pointOnEdge(p.geometry, ease(Math.max(0, t)));
      for (const node of p.head) {
        node.setAttribute("cx", String(at.x));
        node.setAttribute("cy", String(at.y));
      }
      p.tail.forEach((node, i) => {
        const trailing = pointOnEdge(p.geometry, ease(Math.max(0, t - 0.035 * (i + 1))));
        node.setAttribute("cx", String(trailing.x));
        node.setAttribute("cy", String(trailing.y));
      });
      return true;
    });

    this.#ripples = this.#ripples.filter((r) => {
      const t = (nowMs - r.startedAt) / RIPPLE_MS;
      if (t >= 1) {
        r.node.remove();
        return false;
      }
      r.node.setAttribute("r", String(r.radius + t * 28));
      r.node.setAttribute("opacity", String(1 - t));
      return true;
    });

    this.#orbits = this.#orbits.filter((v) => {
      if (nowMs >= v.until) {
        v.node.remove();
        return false;
      }
      const t = ((nowMs - v.startedAt) / VEIL_MS) % 1;
      const { x, y, w, h } = v.box;
      const perimeter = 2 * (w + h);
      const d = t * perimeter;
      let px = x;
      let py = y;
      if (d < w) {
        px = x + d;
        py = y;
      } else if (d < w + h) {
        px = x + w;
        py = y + (d - w);
      } else if (d < 2 * w + h) {
        px = x + w - (d - w - h);
        py = y + h;
      } else {
        px = x;
        py = y + h - (d - 2 * w - h);
      }
      const width = Number(v.node.getAttribute("width") ?? 44);
      v.node.setAttribute("x", String(px - width / 2));
      v.node.setAttribute("y", String(py - 6));
      return true;
    });

    this.#expiring = this.#expiring.filter((m) => {
      if (nowMs >= m.until) {
        m.node.remove();
        return false;
      }
      return true;
    });
    for (const [key, held] of this.#counters) {
      if (!held.node.isConnected) this.#counters.delete(key);
    }
    // A count mark that has expired must not go on being added to: its group is out of the
    // document, so the next collapsed block would raise a number nobody can see.
    for (const [key, held] of this.#countMarks) {
      if (!held.group.isConnected) this.#countMarks.delete(key);
    }
  }

  #arrive(p: Travelling, nowMs: number): void {
    const at = pointOnEdge(p.geometry, 1);
    const ripple = el(
      "circle",
      { cx: at.x, cy: at.y, r: p.radius, class: `pulse-ripple ${p.colorClass}` },
      this.#root,
    );
    this.#ripples.push({ node: ripple, startedAt: nowMs, radius: p.radius });
    this.#light(p.destination);
  }

  /** A box lights when value arrives in it — never for a movement no block recorded. */
  #light(node: PulseEnd): void {
    if (node === "hub") return;
    // Attribute selectors need the value escaped, and a `chain:ETH` node carries a colon.
    // `CSS.escape` is absent in some rendering environments, so the value is quoted by hand.
    const selector = `[data-box="${String(node).replace(/["\\]/g, "\\$&")}"]`;
    const shape = this.#stage.querySelector(selector);
    if (shape === null) return;
    shape.classList.add("is-lit");
    const held = this.#lit.get(String(node));
    if (held !== undefined) clearTimeout(held);
    this.#lit.set(
      String(node),
      setTimeout(() => shape.classList.remove("is-lit"), LIT_MS),
    );
  }

  /** Everything goes: a reorg, a mode change, a scrub. Nothing accumulated stays true. */
  clearAll(): void {
    this.#root.replaceChildren();
    this.#pendingRoot.replaceChildren();
    this.#travelling = [];
    this.#ripples = [];
    this.#orbits = [];
    this.#expiring = [];
    this.#counters.clear();
    this.#countMarks.clear();
    this.#pending.clear();
    for (const timer of this.#lit.values()) clearTimeout(timer);
    this.#lit.clear();
    for (const shape of this.#stage.querySelectorAll(".is-lit")) shape.classList.remove("is-lit");
  }

  dispose(): void {
    this.clearAll();
    this.#disposed = true;
  }
}

/**
 * The halving hero's backdrop: a plain receding to a vanishing point behind the clock.
 *
 * Drawn in the same vocabulary as `brand/city.mjs`: the same seeded mulberry32 and `tube()`
 * construction, a wide dim spill under a thin hot core, two strokes rather than an SVG filter.
 * No `id` anywhere, since ids in repeated SVG break by document order.
 *
 * The chain runs at the reader and the halving is the point everything converges on. It
 * carries no axis, no scale and no figure: a backdrop that reads as a chart would be a quantity
 * nobody can check, which is also why it does not draw the real subsidy staircase.
 *
 * Seeded and computed once at module load, so the markup is identical on every render and
 * reviewable in a diff. Nothing here animates.
 */

/** mulberry32 — small, and identical across Node versions. Same generator as the banner. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const r2 = (n: number) => Math.round(n * 10) / 10;

const WIDTH = 1120;
const HEIGHT = 380;
const VP = { x: WIDTH / 2, y: 156 };

/** Scene weight. */
const INTENSITY = 1.75;
const RAILS = 34;
const RUNGS = 13;
const SPIRES = 22;
const SEED = 4;

interface Tube {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  a: number;
}

function tube(x1: number, y1: number, x2: number, y2: number, w: number, a: number): Tube {
  return { x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), w, a };
}

/** Every stroke in the scene, oldest-to-nearest so the near ones paint last. */
function build(): Tube[] {
  const rand = rng(SEED);
  const out: Tube[] = [];

  // The horizon itself.
  out.push(tube(VP.x - 520, VP.y, VP.x + 520, VP.y, 0.8, 0.5 * INTENSITY));

  // Distant towers. Kept low so they read as depth rather than as content.
  for (let i = 0; i < SPIRES; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const off = 60 + rand() * 470;
    const x = VP.x + side * off;
    const h = 16 + rand() * 74 * (1 - off / 620);
    const a = 0.1 + rand() * 0.16;
    out.push(tube(x, VP.y, x, VP.y - h, 0.7 + rand() * 0.8, a * INTENSITY));
  }

  // Rails converging on the vanishing point, faded toward the centre so the clock sits
  // on the quietest part of the scene.
  for (let i = 0; i <= RAILS; i++) {
    const t = i / RAILS;
    const x = lerp(-560, WIDTH + 560, t);
    const edge = Math.abs(t - 0.5) * 2;
    out.push(tube(x, HEIGHT + 30, VP.x, VP.y, 0.75, (0.1 + edge * 0.34) * INTENSITY));
  }

  // Rungs, spaced by perspective so the plain has depth instead of being a fan.
  for (let i = 1; i <= RUNGS; i++) {
    const t = i / (RUNGS + 1);
    const y = lerp(VP.y, HEIGHT + 30, t * t * t);
    out.push(tube(0, y, WIDTH, y, 0.6, (0.08 + t * 0.3) * INTENSITY));
  }
  return out;
}

const TUBES = build();

/**
 * One neon run as three strokes: spill, body, core.
 *
 * Colour comes from `currentColor` against a token class, never a literal — the same
 * mechanism `SupplyBreakdownPanel` uses for its bars, and the reason this file needs no
 * inline `style`.
 */
function NeonTube({ t }: { t: Tube }) {
  const p = { x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, strokeLinecap: "round" as const };
  return (
    <>
      <line
        {...p}
        className="text-green"
        stroke="currentColor"
        strokeWidth={r2(t.w * 3.6)}
        strokeOpacity={r2(0.14 * t.a)}
      />
      <line
        {...p}
        className="text-green"
        stroke="currentColor"
        strokeWidth={r2(t.w * 1.7)}
        strokeOpacity={r2(0.42 * t.a)}
      />
      <line
        {...p}
        className="text-ink-bright"
        stroke="currentColor"
        strokeWidth={r2(t.w)}
        strokeOpacity={r2(0.8 * t.a)}
      />
    </>
  );
}

/** Purely decorative, so it is hidden from assistive technology outright. */
export function HalvingScene() {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
      focusable="false"
    >
      {/* The horizon's bloom. Two flat ellipses rather than a gradient, which would need an id. */}
      <ellipse
        cx={VP.x}
        cy={VP.y}
        rx={360}
        ry={46}
        className="text-green"
        fill="currentColor"
        opacity={r2(0.055 * INTENSITY)}
      />
      <ellipse
        cx={VP.x}
        cy={VP.y}
        rx={150}
        ry={20}
        className="text-ink-bright"
        fill="currentColor"
        opacity={r2(0.05 * INTENSITY)}
      />
      {TUBES.map((t, i) => (
        <NeonTube key={i} t={t} />
      ))}
    </svg>
  );
}

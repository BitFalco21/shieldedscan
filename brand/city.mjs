/**
 * The banner's backdrop: a neon street canyon, drawn rather than photographed.
 *
 * Procedural for two reasons. A stock or generated raster would be an asset nobody can
 * regenerate when the palette moves, and the CSP forbids the site loading third-party
 * imagery anyway — the same reason the donate QR is committed rather than fetched. Drawn,
 * it uses the actual `--green` and near-black of `src/app/styles/tokens.css`, and every line is a
 * `<line>` this repo can re-render.
 *
 * Seeded, so `generate.mjs` is deterministic: an asset generator that emits a different
 * image on every run cannot be reviewed in a diff.
 */

const GREEN = "#2bff64";
const CORE = "#c9ffd8"; // a neon tube's hot centre reads white-green, not green
const VP = { x: 1160, y: 246 }; // vanishing point, right of the copy block

/** mulberry32 — small, and identical across Node versions. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const r2 = (n) => Math.round(n * 10) / 10;

/** The point a fraction `t` of the way from `p` to the vanishing point. */
const toward = (p, t) => ({ x: lerp(p.x, VP.x, t), y: lerp(p.y, VP.y, t) });

/**
 * One neon run: a wide dim stroke for the tube's spill plus a thin hot core.
 * Two strokes rather than an SVG filter — no `id`, and the falloff is explicit.
 */
function tube(x1, y1, x2, y2, { w = 2.1, a = 1 } = {}) {
  const p = `x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}"`;
  return (
    `<line ${p} stroke="${GREEN}" stroke-width="${r2(w * 3.6)}" stroke-opacity="${r2(0.16 * a)}" stroke-linecap="round"/>` +
    `<line ${p} stroke="${GREEN}" stroke-width="${r2(w * 1.7)}" stroke-opacity="${r2(0.5 * a)}" stroke-linecap="round"/>` +
    `<line ${p} stroke="${CORE}" stroke-width="${r2(w)}" stroke-opacity="${r2(0.9 * a)}" stroke-linecap="round"/>`
  );
}

/** A wall of light: strips running from one frame edge toward the vanishing point. */
function wall(edgeX, ys, { near, far, w, a }) {
  return ys
    .map((y, i) => {
      const p = { x: edgeX, y };
      const t0 = near + (i % 3) * 0.012;
      const A = toward(p, t0);
      const B = toward(p, far - (i % 4) * 0.035);
      return tube(A.x, A.y, B.x, B.y, { w, a });
    })
    .join("");
}

/** Storeys: short verticals hung off a wall's strips, which is what gives it scale. */
function ribs(edgeX, ys, tAt, { count, a }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = 0.08 + (i / count) * (tAt - 0.08);
    const a0 = toward({ x: edgeX, y: ys[0] }, t);
    const a1 = toward({ x: edgeX, y: ys[ys.length - 1] }, t);
    const h = (a1.y - a0.y) * 0.16;
    const mid = lerp(a0.y, a1.y, 0.5);
    out.push(tube(a0.x, mid - h, a1.x, mid + h, { w: 1.2, a: a * (1 - t * 0.7) }));
  }
  return out.join("");
}

/** The skyline around the vanishing point: towers, and the reference's thin spires. */
function skyline(rand) {
  let out = "";
  for (let i = 0; i < 26; i++) {
    const x = 860 + rand() * 560;
    const w = 14 + rand() * 46;
    const h = 90 + rand() * 230;
    const top = VP.y + 34 - h;
    const dim = 0.1 + rand() * 0.18;
    out +=
      `<rect x="${r2(x)}" y="${r2(top)}" width="${r2(w)}" height="${r2(h)}" fill="#04140a" fill-opacity=".85"/>` +
      `<line x1="${r2(x)}" y1="${r2(top)}" x2="${r2(x + w)}" y2="${r2(top)}" stroke="${GREEN}" stroke-width="1.4" stroke-opacity="${r2(dim)}"/>`;
    // Window light, sparse — a fully lit tower reads as a bar chart, not a building.
    for (let j = 0; j < 3; j++) {
      if (rand() > 0.55) {
        out += `<rect x="${r2(x + 4 + rand() * (w - 10))}" y="${r2(top + 12 + rand() * (h - 24))}" width="3" height="6" fill="${GREEN}" fill-opacity="${r2(0.12 + rand() * 0.22)}"/>`;
      }
    }
  }
  for (let i = 0; i < 5; i++) {
    const x = 900 + rand() * 480;
    const h = 210 + rand() * 150;
    out += `<path d="M${r2(x)} ${r2(VP.y + 30)} L${r2(x + 9)} ${r2(VP.y + 30 - h)} L${r2(x + 18)} ${r2(VP.y + 30)} Z" fill="#04150b" fill-opacity=".8" stroke="${GREEN}" stroke-width="1" stroke-opacity=".08"/>`;
  }
  return out;
}

/** A vertical marquee, the reference image's one piece of furniture. */
function sign(x, top, text) {
  const cw = 26;
  const h = text.length * cw + 22;
  const letters = text
    .split("")
    .map(
      (ch, i) =>
        `<text x="${x + 15}" y="${top + 34 + i * cw}" fill="${CORE}" fill-opacity=".82" font-size="19" font-family="JBM, monospace" font-weight="700" text-anchor="middle">${ch}</text>`,
    )
    .join("");
  return (
    `<rect x="${x}" y="${top}" width="30" height="${h}" fill="#031007" fill-opacity=".9"/>` +
    tube(x, top, x, top + h, { w: 1.5, a: 0.85 }) +
    tube(x + 30, top, x + 30, top + h, { w: 1.5, a: 0.85 }) +
    tube(x, top, x + 30, top, { w: 1.5, a: 0.85 }) +
    tube(x, top + h, x + 30, top + h, { w: 1.5, a: 0.85 }) +
    letters +
    // The pole it hangs from.
    `<rect x="${x + 13.5}" y="${top + h}" width="3" height="${500 - top - h}" fill="#031007"/>`
  );
}

export function cityHtml(seed = 7, { signTop = 18, fit = "none" } = {}) {
  const rand = rng(seed);

  // Left wall: the long fan. It sits behind the copy, so it runs dim.
  const leftYs = [-70, -10, 44, 92, 134, 172, 320, 360, 404, 452, 508, 566];
  const left =
    wall(0, leftYs, { near: 0.02, far: 0.46, w: 2.4, a: 0.72 }) +
    ribs(0, leftYs, 0.4, { count: 7, a: 0.45 });

  // Right wall: steep and close to camera, so it carries the brightest light.
  const rightYs = [-60, 6, 60, 108, 150, 188, 316, 358, 402, 450, 504, 560];
  const right =
    wall(1500, rightYs, { near: 0.05, far: 0.62, w: 2.6, a: 1 }) +
    ribs(1500, rightYs, 0.5, { count: 6, a: 0.42 });

  // Street: the same convergence on the ground plane, faint — it reads as wet asphalt.
  const street = [700, 820, 1000, 1320, 1460]
    .map((x) => {
      const A = { x, y: 500 };
      const B = toward(A, 0.72);
      return tube(A.x, A.y, B.x, B.y, { w: 1.4, a: 0.22 });
    })
    .join("");

  // Reflections. Wet asphalt is what stops the lower half reading as an empty void, and a
  // smeared vertical under each tube is how a reflection actually behaves.
  const reflections = [1274, 1330, 1386, 1442, 1494]
    .map((x, i) => tube(x, 500, x, 424 - i * 9, { w: 2.2, a: 0.13 }))
    .join("");

  // The kerb where the right wall meets the street.
  const kerbB = toward({ x: 1500, y: 476 }, 0.6);
  const kerb = tube(1500, 476, kerbB.x, kerbB.y, { w: 1.6, a: 0.4 });

  const neon = left + right + street + reflections + kerb + sign(1268, signTop, "SHIELDED");

  return `<div class="city">
  <div class="sky"></div>
  <svg class="scene" viewBox="0 0 1500 500" preserveAspectRatio="${fit}" aria-hidden="true">
    <g opacity=".9">${skyline(rand)}</g>
    <!-- The wall masses: dark faces the light is mounted on. -->
    <path d="M0 -20 L560 96 L560 424 L0 520 Z" fill="#030b06" fill-opacity=".72"/>
    <path d="M1500 -20 L1236 88 L1236 430 L1500 520 Z" fill="#030b06" fill-opacity=".72"/>
    <!-- Bloom first, crisp on top: one geometry, blurred beneath itself. -->
    <g class="bloom">${neon}</g>
    <g>${neon}</g>
  </svg>
  <div class="haze"></div>
  <div class="fog"></div>
  <div class="scrim"></div>
</div>`;
}

export const CITY_CSS = `
  .city { position: absolute; inset: 0; overflow: hidden; }
  .city > * { position: absolute; inset: 0; }
  .sky {
    background:
      radial-gradient(46% 62% at ${(VP.x / 1500) * 100}% ${(VP.y / 500) * 100}%,
        rgba(43,255,100,.20), rgba(43,255,100,.05) 46%, rgba(3,7,4,0) 76%),
      linear-gradient(to bottom, #020402 0%, #04120a 46%, #061a0d 62%, #020703 100%);
  }
  .scene { width: 100%; height: 100%; }
  /* Atmosphere: the tubes' light in the air, not on the glass. */
  .bloom { filter: blur(11px); opacity: .85; }
  .haze {
    background: radial-gradient(38% 52% at ${(VP.x / 1500) * 100}% ${(VP.y / 500) * 100}%,
      rgba(43,255,100,.22), rgba(43,255,100,.06) 44%, rgba(5,8,5,0) 74%);
    mix-blend-mode: screen;
  }
  .fog {
    background: linear-gradient(to top, rgba(5,20,10,.85) 0%, rgba(5,16,9,.35) 16%, rgba(5,8,5,0) 34%);
  }
  /* Legibility. The statement needs a near-black bed, not just a dimmed frame: the
     .crt raster is dark bars cut between the glyphs, and on the homepage's near-black
     background they are invisible — over lit neon they read as a striped panel across
     the words. So the plate is an ellipse under the copy rather than a wash over
     everything, which keeps the canyon visible left, right and below it. */
  .scrim {
    background:
      radial-gradient(56% 68% at 35% 47%, rgba(3,6,4,.95) 0%, rgba(3,6,4,.9) 42%,
        rgba(3,6,4,.55) 68%, rgba(3,6,4,.12) 86%, rgba(3,6,4,0) 100%),
      linear-gradient(96deg, rgba(4,7,4,.5) 0%, rgba(4,7,4,.3) 42%, rgba(4,7,4,0) 72%),
      radial-gradient(120% 130% at 50% 50%, rgba(5,8,5,0) 52%, rgba(2,5,3,.6) 100%);
  }
`;

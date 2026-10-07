/* ---------------------------------------------------------------------------
   Shared drawing kit for the shieldedscan films (trailer.html, crosschain.html).
   One copy on purpose: two canvases drifting apart on what a redaction bar or a
   shield looks like is exactly the duplication this codebase has been bitten by
   before. Films own their scenes and their timeline;
   everything below is vocabulary, not story.
   --------------------------------------------------------------------------- */
"use strict";

const W = 1920,
  H = 1080,
  FPS = 30;
const c = document.getElementById("c");
const ctx = c.getContext("2d", { alpha: false });

const C = {
  bg: "#050805",
  panel: "#0a120a",
  green: "#2bff64",
  greenDim: "#17a344",
  greenFaint: "#0f4d24",
  ink: "#d9ffe4",
  inkBright: "#f2fff5",
  inkDim: "#7fbf93",
  inkFaint: "#5f8f70",
  amber: "#ffb020",
  red: "#ff5252",
  flow: ["#e3b341", "#4c8dff", "#e0459a", "#21c08b", "#9d7bff", "#2ad4d4", "#b6e04a", "#ff7a6b"],
  /* the folded tail is not a chain; a quiet slate keeps it from looking like one */
  flowRest: "#94a3b8",
};

/* ---------------------------------------------------------- utilities ---- */

let seed = 0x2bff64;
function rnd() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 100000) / 100000;
}
function srnd(n) {
  let s = (n * 2654435761) >>> 0;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  return ((s >>> 0) % 100000) / 100000;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** progress of `t` across [a,b], clamped to 0..1 */
const p = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const mix = (a, b, k) => a + (b - a) * k;
const eOutExpo = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
const eOutCubic = (k) => 1 - Math.pow(1 - k, 3);
const eInCubic = (k) => k * k * k;
const eInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const eOutBack = (k) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);

function font(size, weight) {
  return `${weight || 400} ${size}px JBM, monospace`;
}
const commas = (n) => Math.round(n).toLocaleString("en-US");

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Typed-out prefix of `s` starting at `t0`, `cps` characters per second. */
function typed(s, t, t0, cps) {
  const n = Math.floor(clamp((t - t0) * cps, 0, s.length));
  return s.slice(0, n);
}

/* Offscreen scratch buffers: text bloom, glyph raster, persistence. */
function buf(w, h) {
  const b = document.createElement("canvas");
  b.width = w;
  b.height = h;
  return b;
}
const fx = buf(W, H),
  fx2 = buf(W, H),
  prev = buf(W, H);
const fxc = fx.getContext("2d"),
  fx2c = fx2.getContext("2d"),
  prevc = prev.getContext("2d");

/** Draw whatever `paint` renders, plus a phosphor bloom of it. */
function withBloom(paint, radius, strength) {
  fxc.setTransform(1, 0, 0, 1, 0, 0);
  fxc.clearRect(0, 0, W, H);
  paint(fxc);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = strength;
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(fx, 0, 0);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
  ctx.drawImage(fx, 0, 0);
}

/** Text with the site's CRT raster cut into the glyphs (never over the bed). */
function rasterText(g, text, x, y, size, weight, colour, align) {
  fx2c.setTransform(1, 0, 0, 1, 0, 0);
  fx2c.clearRect(0, 0, W, H);
  fx2c.font = font(size, weight);
  fx2c.textAlign = align || "left";
  fx2c.textBaseline = "alphabetic";
  fx2c.fillStyle = colour;
  fx2c.fillText(text, x, y);
  fx2c.globalCompositeOperation = "source-atop";
  const pitch = size * 0.1,
    bar = size * 0.045;
  fx2c.fillStyle = "rgba(5,8,5,0.5)";
  for (let yy = y - size * 1.1; yy < y + size * 0.4; yy += pitch) fx2c.fillRect(0, yy, W, bar);
  fx2c.globalCompositeOperation = "source-over";
  g.drawImage(fx2, 0, 0);
}

/* --------------------------------------------------------- primitives ---- */

function panel(g, x, y, w, h, a) {
  g.save();
  g.globalAlpha = a;
  g.fillStyle = "rgba(10,18,10,0.92)";
  g.fillRect(x, y, w, h);
  g.strokeStyle = rgba(C.green, 0.26);
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  /* corner ticks — the panel chrome, not glow */
  g.strokeStyle = rgba(C.green, 0.5);
  g.lineWidth = 2;
  const k = 14;
  [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ].forEach(([px, py, sx, sy]) => {
    g.beginPath();
    g.moveTo(px + sx * k, py);
    g.lineTo(px, py);
    g.lineTo(px, py + sy * k);
    g.stroke();
  });
  g.restore();
}

function microlabel(g, text, x, y, size, colour, a, align) {
  g.save();
  g.globalAlpha = a;
  g.font = font(size, 700);
  g.letterSpacing = (size * 0.22).toFixed(2) + "px";
  g.textAlign = align || "left";
  g.fillStyle = colour;
  g.fillText(text.toUpperCase(), x, y);
  g.letterSpacing = "0px";
  g.restore();
}

/** The Veil, inline form: a glowing redaction bar. */
function redact(g, x, y, w, h, a, glow) {
  g.save();
  g.globalAlpha = a;
  const grad = g.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, rgba(C.green, 0.24));
  grad.addColorStop(1, rgba(C.green, 0.12));
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.strokeStyle = rgba(C.green, 0.34);
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.fillStyle = rgba(C.green, 0.82);
  g.font = font(h * 0.74, 700);
  g.textBaseline = "middle";
  g.textAlign = "left";
  const gw = g.measureText("▓").width;
  const glyphs = Math.max(1, Math.ceil((w - h * 0.2) / gw));
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillText("▓".repeat(glyphs), x + h * 0.1, y + h * 0.54);
  g.restore();
  if (glow) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = a * glow * 0.5;
    g.filter = "blur(14px)";
    g.fillStyle = rgba(C.green, 0.32);
    g.fillRect(x, y, w, h);
    g.filter = "none";
  }
  g.restore();
}

/** Privacy shield silhouette. fill: 0 outline, .5 half, 1 full. */
function shield(g, x, y, s, fill, a) {
  const path = new Path2D();
  path.moveTo(x, y - s);
  path.bezierCurveTo(
    x + s * 0.62,
    y - s * 0.78,
    x + s * 0.86,
    y - s * 0.74,
    x + s * 0.86,
    y - s * 0.74,
  );
  path.lineTo(x + s * 0.86, y + s * 0.04);
  path.bezierCurveTo(x + s * 0.86, y + s * 0.62, x + s * 0.42, y + s * 0.92, x, y + s);
  path.bezierCurveTo(
    x - s * 0.42,
    y + s * 0.92,
    x - s * 0.86,
    y + s * 0.62,
    x - s * 0.86,
    y + s * 0.04,
  );
  path.lineTo(x - s * 0.86, y - s * 0.74);
  path.bezierCurveTo(x - s * 0.86, y - s * 0.74, x - s * 0.62, y - s * 0.78, x, y - s);
  path.closePath();
  g.save();
  g.globalAlpha = a;
  if (fill > 0) {
    g.save();
    if (fill < 1) {
      g.beginPath();
      g.rect(x - s, y - s * 1.2, s, s * 2.4);
      g.clip();
    }
    g.fillStyle = fill >= 1 ? C.green : C.greenDim;
    g.fill(path);
    g.restore();
  }
  g.strokeStyle = fill >= 1 ? C.green : fill > 0 ? C.greenDim : C.inkDim;
  g.lineWidth = Math.max(1.4, s * 0.13);
  g.stroke(path);
  g.restore();
}

/* Illustrative ledger rows for the opening act — the generic public-ledger
   model, deliberately not presented as Zcash chain records.

   Addresses are drawn from a SMALL POOL and therefore repeat across rows. That
   is the whole point of the act: a transparent ledger's problem is not one
   visible payment, it is the same address turning up again and again until the
   rows join into a person. The tracer in `ledger()` links those repeats. */

/** Lower-third headline on its own bed, with a green rule. */
function headline(g, text, t, tIn, tOut, y) {
  const a = Math.min(p(t, tIn, tIn + 0.42), 1 - p(t, tOut - 0.3, tOut));
  if (a <= 0) return;
  const slide = (1 - eOutExpo(p(t, tIn, tIn + 0.55))) * 26;
  g.save();
  g.globalAlpha = a;
  g.translate(-slide, 0);
  g.fillStyle = "rgba(5,8,5,0.82)";
  g.fillRect(150, y - 62, 1160, 84);
  g.fillStyle = C.green;
  g.fillRect(150, y - 62, 4, 84);
  g.font = font(46, 800);
  g.letterSpacing = "2.4px";
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillStyle = C.inkBright;
  g.fillText(text, 182, y);
  g.letterSpacing = "0px";
  g.restore();
}

function subline(g, text, t, tIn, tOut, y) {
  const a = Math.min(p(t, tIn, tIn + 0.4), 1 - p(t, tOut - 0.3, tOut));
  if (a <= 0) return;
  microlabel(g, text, 182, y, 19, C.inkDim, a * 0.9);
}

/** Slice + chromatic-split tear. `cuts` is [[startSeconds, durationSeconds], …]. */
function glitch(g, t, cuts) {
  for (const [t0, dur] of cuts) {
    const k = p(t, t0, t0 + dur);
    if (k <= 0 || k >= 1) continue;
    const power = Math.sin(k * Math.PI);
    const slices = 9;
    for (let i = 0; i < slices; i++) {
      const sy = Math.floor(srnd(Math.floor(t * FPS) * 31 + i) * H);
      const sh = 10 + srnd(i * 7 + Math.floor(t * FPS)) * 70;
      const dx = (srnd(i * 13 + Math.floor(t * FPS) * 3) - 0.5) * 130 * power;
      g.drawImage(c, 0, sy, W, sh, dx, sy, W, sh);
    }
    /* chromatic split */
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.3 * power;
    g.drawImage(c, -7 * power, 0);
    g.drawImage(c, 7 * power, 0);
    g.restore();
    if (k < 0.18) {
      g.save();
      g.globalCompositeOperation = "lighter";
      g.fillStyle = rgba(C.green, 0.1 * power);
      g.fillRect(0, 0, W, H);
      g.restore();
    }
  }
}

/* grain tiles, precomputed once */
const GRAIN = (() => {
  const tiles = [];
  for (let n = 0; n < 5; n++) {
    const b = buf(480, 270),
      bc = b.getContext("2d");
    const im = bc.createImageData(480, 270);
    for (let i = 0; i < im.data.length; i += 4) {
      const v = 118 + Math.floor(rnd() * 74);
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
      im.data[i + 3] = 255;
    }
    bc.putImageData(im, 0, 0);
    tiles.push(b);
  }
  return tiles;
})();

function postfx(g, t, frame) {
  /* vignette */
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.92);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.62)");
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);

  /* scanlines — drifting, very low contrast */
  g.save();
  g.globalAlpha = 0.055;
  g.fillStyle = "#000";
  const drift = (frame * 0.6) % 4;
  for (let y = -4 + drift; y < H; y += 4) g.fillRect(0, y, W, 2);
  g.restore();

  /* grain */
  g.save();
  g.globalCompositeOperation = "overlay";
  g.globalAlpha = 0.055;
  g.drawImage(GRAIN[frame % GRAIN.length], 0, 0, W, H);
  g.restore();
}

/* ---------------------------------------------------------------- frame --- */

/** A Sankey ribbon: contiguous at the boundary, spread at the node end. */
function ribbon(g, x0, y0, x1, y1, th0, th1, colour, a) {
  const mx = (x0 + x1) / 2;
  g.save();
  g.globalAlpha = a;
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(x0, y0 - th0 / 2);
  g.bezierCurveTo(mx, y0 - th0 / 2, mx, y1 - th1 / 2, x1, y1 - th1 / 2);
  g.lineTo(x1, y1 + th1 / 2);
  g.bezierCurveTo(mx, y1 + th1 / 2, mx, y0 + th0 / 2, x0, y0 + th0 / 2);
  g.closePath();
  g.fill();
  g.restore();
}

/** A chain's real brand mark, scaled into a box of `size` and centred on cx,cy.
    Falls back to a lettermark when the ticker has no entry — a venue can list a
    new chain without warning, and an honest initial beats a wrong logo. */
function chainMark(g, ticker, cx, cy, size, alpha, colourOverride) {
  const m = CHAIN_MARKS[ticker];
  g.save();
  g.globalAlpha = alpha;
  if (!m || !m.d) {
    g.strokeStyle = colourOverride || C.inkDim;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, cy, size / 2, 0, 7);
    g.stroke();
    g.font = font(size * 0.42, 700);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = colourOverride || C.inkDim;
    g.fillText(ticker.slice(0, 3), cx, cy + 1);
    g.restore();
    return;
  }
  const [vx, vy, vw, vh] = m.viewBox.split(/[\s,]+/).map(Number);
  const s = size / Math.max(vw, vh);
  g.translate(cx, cy);
  g.scale(s, s);
  g.translate(-vx - vw / 2, -vy - vh / 2);
  const path = new Path2D(m.d);
  if (m.strokeWidth) {
    g.strokeStyle = colourOverride || m.colour;
    g.lineWidth = m.strokeWidth;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.stroke(path);
  } else {
    g.fillStyle = colourOverride || m.colour;
    g.fill(path, m.fillRule || "nonzero");
  }
  g.restore();
}

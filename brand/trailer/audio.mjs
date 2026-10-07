/* Trailer score, synthesised. Written here rather than licensed so the hits
   land exactly on the cut points in trailer.html (SC), which no stock bed does.
   Sub pulse + drone + risers + impacts; nothing sampled, nothing external. */
import { writeFileSync } from "node:fs";

const SR = 48000;
const FILMS = { crosschain: 23.8, agent: 30.8, trailer: 24.2 };
const FILM = process.argv[2] in FILMS ? process.argv[2] : "trailer";
const DUR = FILMS[FILM];
const N = Math.round(SR * DUR);
const L = new Float64Array(N),
  R = new Float64Array(N);

/* Scene boundaries, mirroring SC in each film's HTML. THESE MUST BE EDITED
   TOGETHER with the film: the impacts are placed on the cuts, and a timeline
   change on one side alone slides every hit off its transition. */
const SCENES = {
  trailer: { B: 2.3, C: 5.6, D: 9.0, E: 12.0, F: 16.2, G: 19.9 },
  crosschain: { B: 2.4, C: 6.8, D: 13.2, F: 16.8, G: 19.6 },
  agent: { B: 2.3, C: 6.8, D: 10.8, E: 15.1, F: 21.6, G: 25.8 },
};
const SC = SCENES[FILM];

let s = 12345;
const rnd = () => {
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  return ((s >>> 0) / 4294967296) * 2 - 1;
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const at = (t) => Math.round(t * SR);

/** one-pole lowpass, state carried by the caller */
function lp(x, st, k) {
  st.v += k * (x - st.v);
  return st.v;
}

/** Additive write with equal-power pan. */
function add(i, v, pan = 0) {
  if (i < 0 || i >= N) return;
  L[i] += v * Math.cos(((pan + 1) * Math.PI) / 4);
  R[i] += v * Math.sin(((pan + 1) * Math.PI) / 4);
}

/* ---- sub kick: pitch-swept sine with an exponential body ---- */
function kick(t0, gain = 1, f0 = 130, f1 = 42, dur = 0.42) {
  const i0 = at(t0),
    n = Math.round(dur * SR);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const f = f1 + (f0 - f1) * Math.exp(-u * 9);
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-u * 5.2) * (1 - Math.exp(-u * 220));
    add(i0 + i, Math.sin(ph) * env * 0.85 * gain);
  }
}

/* ---- low drone: two detuned saw-ish stacks, slowly opening filter ---- */
function drone(t0, t1, root, gain) {
  const i0 = at(t0),
    i1 = at(t1),
    n = i1 - i0;
  const st = [{ v: 0 }, { v: 0 }];
  for (let i = 0; i < n; i++) {
    const t = i / SR,
      u = i / n;
    const env = Math.min(1, t / 1.6) * Math.min(1, (n - i) / (1.4 * SR));
    let v = 0;
    for (let h = 1; h <= 7; h++) {
      v += Math.sin(2 * Math.PI * root * h * t) / (h * 1.5);
      v += Math.sin(2 * Math.PI * root * 1.005 * h * t + 0.7) / (h * 1.8);
    }
    const k = clamp(0.02 + u * 0.05, 0, 1);
    add(i0 + i, lp(v, st[0], k) * env * gain * 0.18, -0.12);
    add(i0 + i, lp(v, st[1], k * 0.92) * env * gain * 0.18, 0.12);
  }
}

/* ---- noise riser: band-passed noise sweeping up into a hit ---- */
function riser(t0, t1, gain = 1) {
  const i0 = at(t0),
    n = at(t1) - i0;
  const st = { v: 0 },
    hp = { v: 0 };
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const x = rnd();
    const k = 0.004 + Math.pow(u, 2.2) * 0.5;
    const band = lp(x, st, k) - lp(lp(x, st, k), hp, 0.0025);
    const env = Math.pow(u, 2.4) * gain * 0.5;
    add(i0 + i, band * env, -0.35 + u * 0.7);
  }
}

/* ---- impact: sub boom + a short bright transient ---- */
function impact(t0, gain = 1) {
  kick(t0, 1.25 * gain, 190, 33, 1.5);
  const i0 = at(t0),
    n = Math.round(1.1 * SR);
  const st = { v: 0 };
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const env = Math.exp(-u * 7.5);
    add(i0 + i, lp(rnd(), st, 0.2) * env * 0.34 * gain, -0.2);
    add(i0 + i, lp(rnd(), st, 0.2) * env * 0.34 * gain, 0.2);
  }
}

/* ---- terminal tick: the sound of a character landing ---- */
function tick(t0, gain = 1, pan = 0) {
  const i0 = at(t0),
    n = Math.round(0.035 * SR);
  const st = { v: 0 };
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const env = Math.exp(-u * 26);
    const tone = Math.sin(2 * Math.PI * 2400 * (i / SR)) * 0.35 + rnd() * 0.65;
    add(i0 + i, lp(tone, st, 0.55) * env * 0.16 * gain, pan);
  }
}

/* ---- closed hat: filtered noise on the offbeat ---- */
function hat(t0, gain = 1) {
  const i0 = at(t0),
    n = Math.round(0.06 * SR);
  const st = { v: 0 },
    st2 = { v: 0 };
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const x = rnd();
    const hi = x - lp(x, st, 0.06);
    add(i0 + i, lp(hi, st2, 0.9) * Math.exp(-u * 18) * 0.09 * gain, 0.25);
  }
}

/* ---- a shimmer bell for the end card ---- */
function bell(t0, f, gain = 1) {
  const i0 = at(t0),
    n = Math.round(3.4 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR,
      u = i / n;
    const env = Math.exp(-u * 3.6) * (1 - Math.exp(-t * 40));
    const v =
      Math.sin(2 * Math.PI * f * t) * 0.6 +
      Math.sin(2 * Math.PI * f * 2.01 * t) * 0.25 +
      Math.sin(2 * Math.PI * f * 3.02 * t) * 0.12;
    add(i0 + i, v * env * 0.1 * gain, Math.sin(t * 0.7) * 0.3);
  }
}

/* =============================== arrangement ============================== */
if (FILM === "trailer") {
  /* the room: a low bed under the whole film */
  drone(0.28, 12.2, 55, 0.55);
  drone(11.6, 20.1, 55, 0.8);
  drone(19.9, DUR, 41.2, 0.9);

  /* power-on */
  kick(0.3, 0.7, 300, 60, 0.5);
  tick(0.34, 1.4);

  /* boot typing */
  for (let k = 0; k < 26; k++) tick(0.5 + k * 0.062, 0.55, -0.3 + (k % 5) * 0.12);

  /* the pulse: 120 bpm from the ledger act, half-time under the veil */
  const beat = 0.5;
  for (let t = SC.B; t < SC.G - 0.1; t += beat) {
    const phase = Math.round((t - SC.B) / beat) % 4;
    const inVeil = t >= SC.D && t < SC.E;
    if (inVeil && phase % 2 === 1) continue; // thin it out under the veil
    kick(t, phase === 0 ? 1.0 : 0.72);
    if (!inVeil) hat(t + beat / 2, t >= SC.E ? 1.0 : 0.6);
    if (t >= SC.E) hat(t + beat * 0.25, 0.45);
  }

  /* act transitions */
  riser(SC.B - 0.9, SC.B, 0.8);
  impact(SC.B, 0.55);

  riser(SC.C - 1.0, SC.C, 1.0);
  impact(SC.C, 1.0); // the shielding wave

  kick(7.5, 0.8, 220, 48, 0.7); // the "zero" card lands
  impact(8.62, 0.5); // it shatters

  riser(SC.D - 0.7, SC.D, 0.7);
  impact(SC.D, 0.75);

  riser(SC.E - 0.8, SC.E, 0.75);
  impact(SC.E, 0.7);

  riser(SC.F - 0.7, SC.F, 0.7);
  impact(SC.F, 0.65);

  /* API typing */
  for (let k = 0; k < 30; k++) tick(SC.F + 0.4 + k * 0.024, 0.5, -0.2 + (k % 4) * 0.1);

  /* the drop into the end card */
  riser(SC.G - 1.2, SC.G, 1.25);
  impact(SC.G, 1.35);
  bell(SC.G + 0.08, 329.63, 1.0); // E4
  bell(SC.G + 0.1, 493.88, 0.55); // B4
  bell(SC.G + 1.35, 659.25, 0.4); // E5, as the URL types

  /* the URL typing */
  for (let k = 0; k < 16; k++) tick(SC.G + 1.28 + k * 0.083, 0.75, 0);
  kick(SC.G + 2.6, 0.6, 150, 40, 0.9);
} else if (FILM === "crosschain") {
  /* the room: a low bed under the whole film */
  drone(0.28, 13.0, 55, 0.6);
  drone(12.4, 21.4, 55, 0.85);
  drone(21.2, DUR, 41.2, 0.9);

  /* the opening crossing: a rise as the value travels, landing on the far bank */
  riser(0.75, 2.05, 0.55);
  kick(0.3, 0.6, 300, 60, 0.5);
  tick(2.05, 1.2);
  kick(2.05, 0.7, 200, 46, 0.6);

  /* the pulse, from the scale act on */
  const beat = 0.5;
  for (let t = SC.B; t < SC.G - 0.1; t += beat) {
    const phase = Math.round((t - SC.B) / beat) % 4;
    const inSankey = t >= SC.C && t < SC.D;
    if (inSankey && phase % 2 === 1) continue; // the diagram gets room to breathe
    kick(t, phase === 0 ? 1.0 : 0.72);
    if (!inSankey) hat(t + beat / 2, t >= SC.D ? 1.0 : 0.6);
    if (t >= SC.D) hat(t + beat * 0.25, 0.45);
  }

  /* the counters landing */
  [SC.B + 0.15, SC.B + 0.35, SC.B + 0.55].forEach((t, i) =>
    kick(t + 0.55, 0.55 + i * 0.1, 170, 44, 0.6),
  );

  /* act transitions */
  riser(SC.B - 0.9, SC.B, 0.8);
  impact(SC.B, 0.55);
  riser(SC.C - 1.0, SC.C, 1.05);
  impact(SC.C, 1.0); // the Sankey opens
  riser(SC.D - 0.8, SC.D, 0.8);
  impact(SC.D, 0.7);
  riser(SC.F - 0.7, SC.F, 0.7);
  impact(SC.F, 0.65);

  /* the ribbons arriving, one tick per chain */
  for (let i = 0; i < 9; i++) tick(SC.C + 0.45 + i * 0.07, 0.5, -0.4 + i * 0.1);
  for (let i = 0; i < 9; i++) tick(SC.C + 0.75 + i * 0.07, 0.5, 0.4 - i * 0.1);
  /* and the net figure landing */
  kick(SC.C + 1.85, 0.9, 200, 40, 0.9);

  /* the transfer rows streaming in */
  for (let i = 0; i < 12; i++) tick(SC.D + 0.35 + i * 0.075, 0.6, -0.25 + (i % 5) * 0.1);

  /* API typing */
  for (let k = 0; k < 34; k++) tick(SC.F + 0.35 + k * 0.022, 0.5, -0.2 + (k % 4) * 0.1);

  /* the drop into the end card */
  riser(SC.G - 1.2, SC.G, 1.25);
  impact(SC.G, 1.35);
  bell(SC.G + 0.08, 329.63, 1.0);
  bell(SC.G + 0.1, 493.88, 0.55);
  bell(SC.G + 1.3, 659.25, 0.4);
  for (let k = 0; k < 28; k++) tick(SC.G + 1.22 + k * 0.066, 0.7, 0);
  kick(SC.G + 2.9, 0.6, 150, 40, 0.9);
} else {
  /* ------------------------------------------------------------- agent ---- */
  /* Five answers, each landing on its own beat. The ticks are the film's own
     mechanics made audible: one per typed character in the cold open, one per
     day in the ranking sweep, one per row as a table builds. */

  /* the room */
  drone(0.26, 11.6, 55, 0.55);
  drone(11.0, 22.0, 55, 0.82);
  drone(21.6, 26.0, 55, 0.6);
  drone(25.8, DUR, 41.2, 0.9);

  /* the question being typed — 35 characters at 58 cps, every other one struck
     so the run reads as typing rather than as noise */
  kick(0.3, 0.65, 300, 60, 0.5);
  for (let k = 0; k < 18; k++) tick(0.5 + k * 0.034, 0.55, -0.3 + (k % 5) * 0.12);
  kick(1.15, 0.5, 210, 46, 0.55); // the question completes and sits there

  /* the pulse: half-time under the ranking sweep, doubling into the payoff */
  const beat = 0.5;
  for (let t = SC.B; t < SC.G - 0.1; t += beat) {
    const phase = Math.round((t - SC.B) / beat) % 4;
    /* air under the ranking sweep, and again under the interface reveal — that
       act is a pull-back and wants to breathe rather than drive */
    const quiet = (t >= SC.C && t < SC.C + 2.0) || t >= SC.F;
    if (quiet && phase % 2 === 1) continue;
    const inSweep = quiet;
    kick(t, phase === 0 ? 1.0 : 0.72);
    if (!inSweep) hat(t + beat / 2, t >= SC.E ? 1.0 : 0.6);
    if (t >= SC.E) hat(t + beat * 0.25, 0.45);
  }

  /* B — the two medians land, shielded first */
  riser(SC.B - 0.9, SC.B, 0.8);
  impact(SC.B, 0.6);
  kick(SC.B + 0.85, 0.85, 200, 44, 0.7);
  kick(SC.B + 1.11, 0.7, 175, 42, 0.65);
  bell(SC.B + 2.1, 493.88, 0.32); // the ratio

  /* C — 232 days sweeping, then the winning day landing */
  riser(SC.C - 0.7, SC.C, 0.7);
  impact(SC.C, 0.7);
  for (let k = 0; k < 30; k++) tick(SC.C + 0.55 + k * 0.03, 0.42, -0.45 + k * 0.03);
  kick(SC.C + 1.75, 1.0, 220, 40, 0.95);
  bell(SC.C + 1.82, 329.63, 0.4);

  /* D — five sources building, then the migration total */
  riser(SC.D - 0.7, SC.D, 0.7);
  impact(SC.D, 0.72);
  for (let i = 0; i < 5; i++) tick(SC.D + 0.95 + i * 0.14, 0.62, -0.2 + i * 0.1);
  kick(SC.D + 2.15, 0.9, 190, 42, 0.8);

  /* E — the payoff: a row per beat, then the total */
  riser(SC.E - 0.8, SC.E, 0.85);
  impact(SC.E, 0.8);
  for (let i = 0; i < 5; i++) {
    kick(SC.E + 0.95 + i * 0.3, 0.6 + i * 0.07, 185, 44, 0.55);
    tick(SC.E + 0.95 + i * 0.3, 0.5, -0.25 + i * 0.12);
  }
  impact(SC.E + 2.75, 0.9); // TOTAL
  bell(SC.E + 2.82, 659.25, 0.45);

  /* F — the pull-back to the interface: one soft landing, then the composer */
  riser(SC.F - 0.7, SC.F, 0.6);
  impact(SC.F, 0.62);
  for (let i = 0; i < 3; i++) tick(SC.F + 0.55 + i * 0.13, 0.45, -0.15 + i * 0.15);
  bell(SC.F + 1.5, 493.88, 0.28);

  /* the drop into the end card */
  riser(SC.G - 1.2, SC.G, 1.25);
  impact(SC.G, 1.35);
  bell(SC.G + 0.08, 329.63, 1.0); // E4
  bell(SC.G + 0.1, 493.88, 0.55); // B4
  bell(SC.G + 1.4, 659.25, 0.4); // E5, as the URL types
  /* the URL typing: 25 characters at 15 cps */
  for (let k = 0; k < 25; k++) tick(SC.G + 1.25 + k * 0.066, 0.72, 0);
  kick(SC.G + 3.1, 0.6, 150, 40, 0.9);
}

/* ============================ master chain =============================== */

/* a short plate: three combs into two allpasses, on a send */
function reverb(buf, mix) {
  const combs = [1687, 1601, 2053, 2251].map((d) => ({
    d,
    buf: new Float64Array(d),
    i: 0,
    g: 0.78,
  }));
  const out = new Float64Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let acc = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      acc += y;
      c.buf[c.i] = buf[i] + y * c.g;
      c.i = (c.i + 1) % c.d;
    }
    out[i] = acc / combs.length;
  }
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i] * (1 - mix) + out[i] * mix;
}
reverb(L, 0.16);
reverb(R, 0.16);

/* gentle high-pass so the sub does not muddy small speakers, then soft clip */
const hpL = { v: 0 },
  hpR = { v: 0 };
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = L[i] - lp(L[i], hpL, 0.0016);
  R[i] = R[i] - lp(R[i], hpR, 0.0016);
  L[i] = Math.tanh(L[i] * 1.05);
  R[i] = Math.tanh(R[i] * 1.05);
  /* fade the last 300 ms so the loop point has no click */
  const tail = Math.min(1, (N - i) / (0.3 * SR));
  L[i] *= tail;
  R[i] *= tail;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.89 / (peak || 1);

/* ---- WAV (16-bit stereo) ---- */
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(clamp(L[i] * norm, -1, 1) * 32767), i * 4);
  data.writeInt16LE(Math.round(clamp(R[i] * norm, -1, 1) * 32767), i * 4 + 2);
}
const head = Buffer.alloc(44);
head.write("RIFF", 0);
head.writeUInt32LE(36 + data.length, 4);
head.write("WAVEfmt ", 8);
head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20);
head.writeUInt16LE(2, 22);
head.writeUInt32LE(SR, 24);
head.writeUInt32LE(SR * 4, 28);
head.writeUInt16LE(4, 32);
head.writeUInt16LE(16, 34);
head.write("data", 36);
head.writeUInt32LE(data.length, 40);

const out = new URL(`./score-${FILM}.wav`, import.meta.url).pathname;
writeFileSync(out, Buffer.concat([head, data]));
console.log(
  `wrote ${out}  ${FILM}  ${DUR.toFixed(1)}s  peak ${peak.toFixed(3)} → norm ${norm.toFixed(3)}`,
);

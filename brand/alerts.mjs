/**
 * The announcement graphic for the automated alerts, 1600x900.
 *
 *   node brand/render-alerts.mjs        # writes shieldedscan-alerts-1600x900.png
 *
 * A generated asset rather than a hand-exported PNG, for the reason `generate.mjs` gives
 * about the avatar and the banner: every colour and every glyph here is quoted from the
 * site's own tokens and from `PrivacyShield`, so if either moves this can be regenerated
 * in one command instead of drifting.
 *
 * It shows what LANDS IN A TIMELINE rather than restating the post's words — the post
 * already lists the three kinds, and an image repeating them adds nothing. What it adds is
 * the visual grammar: the shield at its three fills, the pool tones, and the boundary
 * strip, so a reader recognises an alert when one arrives.
 *
 * NO SAMPLE AMOUNTS. Every figure on it is a THRESHOLD or a schedule — real, stable
 * configuration — because a plausible-looking chain figure on a promotional graphic is
 * indistinguishable from a real one, and this project does not publish those.
 */
const SHIELD = "M12 2.4 L20 5.7 L20 12.2 C20 16.9 12 21.4 12 21.4 C12 21.4 4 16.9 4 12.2 L4 5.7 Z";
const SHIELD_LEFT = "M12 2.4 L4 5.7 L4 12.2 C4 16.9 12 21.4 12 21.4 Z";

/** The boundary strip from `BoundaryCard`, at the size a divider needs. */
function strip({ blocks = 96, block = 12, gap = 2, height = 18, outward = false }) {
  const smooth = (t) => t * t * (3 - 2 * t);
  const rect = (i, o, cls) =>
    `<rect x="${i * (block + gap)}" y="0" width="${block}" height="${height}" rx="2"
       fill="currentColor" fill-opacity="${o.toFixed(3)}" class="${cls}"/>`;
  let plain = "";
  let lit = "";
  for (let i = 0; i < blocks; i += 1) {
    const t = smooth(outward ? 1 - i / (blocks - 1) : i / (blocks - 1));
    plain += rect(i, 1 - t, "");
    lit += rect(i, t, "");
  }
  const w = blocks * (block + gap) - gap;
  return `<svg width="${w}" height="${height}" viewBox="0 0 ${w} ${height}">
    <g class="plain">${plain}</g><g class="lit">${lit}</g></svg>`;
}

/** Two arrows crossing, for the cross-chain row. Drawn, not a glyph a font may lack. */
function crossingSvg(px) {
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 8.5 H17 M13 4.5 L17 8.5 L13 12.5"/>
    <path d="M21 15.5 H7 M11 11.5 L7 15.5 L11 19.5"/></svg>`;
}

/** Three bars: a summary, not a transaction — so it borrows no part of the shield grammar. */
function barsSvg(px) {
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="currentColor">
    <rect x="3" y="13" width="4.4" height="8" rx="1"/>
    <rect x="9.8" y="8" width="4.4" height="13" rx="1"/>
    <rect x="16.6" y="4" width="4.4" height="17" rx="1"/></svg>`;
}

/**
 * An arrow crossing the shield's edge, pointing in or out.
 *
 * Deliberately NOT a full shield for shielding and a half one for unshielding: BOTH are
 * mixed transactions in this site's grammar (`BoundaryCard` draws the same half shield for
 * each), so varying the fill would state a privacy kind that is not what varies. What
 * varies is the DIRECTION, so that is what the mark draws.
 */
function boundarySvg(px, into) {
  const arrow = into
    ? `<path d="M1.5 12 H8.5 M5.6 9 L8.6 12 L5.6 15"/>`
    : `<path d="M8.5 12 H1.5 M4.4 9 L1.4 12 L4.4 15"/>`;
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24">
    <g transform="translate(4 0)">
      <path d="${SHIELD}" fill="none" stroke="currentColor" stroke-width="1.3"/>
      <path d="${SHIELD_LEFT}" fill="currentColor" fill-opacity="0.9"/>
    </g>
    <g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
       stroke-linejoin="round">${arrow}</g></svg>`;
}

/**
 * Real brand silhouettes, EXTRACTED from `brand/trailer/chain-marks.js` — itself generated
 * from `src/components/brand-marks.ts` — plus ZEC and its `.brand-zec` colour.
 *
 * Extracted by evaluating that file, never retyped. The first version of this block was
 * written from memory and every one of the three marks it invented was wrong: SOL's real
 * path is 1,121 characters against the ~450 it guessed, NEAR's brand colour is the
 * lightened `#7a7a7a` rather than a remembered grey, and TRON carries a "0 0 32 32"
 * viewBox that renders as an unrecognisable sliver inside a 24 box. "An inaccurate logo is
 * worse than an honest initial" is this project's own rule, and a mark that LOOKS
 * plausible is exactly how it gets broken. Never a
 * letter in a circle and never a logo from a CDN, for the reasons the site's own
 * `brand-marks.ts` gives: an inaccurate mark is worse than an honest initial, and a
 * third-party image request is a tracking vector the CSP forbids anyway.
 *
 * The five chains are the five this project actually sees the most cross-chain ZEC move
 * against — measured over 180 days, not chosen for looks: ETH 22,606 transfers, SOL
 * 15,403, TRON 10,200, NEAR 8,979, BTC 7,823.
 */
const BRAND = {
  ZEC: {
    viewBox: "0 0 24 24",
    d: "M12 0A12 12 0 0 0 0 12a12.013 12.013 0 0 0 12 12 12 12 0 1 0 0-24zm-1.008 4.418h2.014v2.014l3.275-.002v1.826l-5.08 6.889h5.08v2.423h-3.275v2.006h-2.012v-2.006H7.72v-1.826l5.074-6.888H7.719V6.432h3.273V4.418z",
    colour: "#f3b724",
  },
  ETH: {
    viewBox: "0 0 24 24",
    d: "M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z",
    colour: "#7a7a7a",
  },
  SOL: {
    viewBox: "0 0 24 24",
    d: "m23.8764 18.0313-3.962 4.1393a.9201.9201 0 0 1-.306.2106.9407.9407 0 0 1-.367.0742H.4599a.4689.4689 0 0 1-.2522-.0733.4513.4513 0 0 1-.1696-.1962.4375.4375 0 0 1-.0314-.2545.4438.4438 0 0 1 .117-.2298l3.9649-4.1393a.92.92 0 0 1 .3052-.2102.9407.9407 0 0 1 .3658-.0746H23.54a.4692.4692 0 0 1 .2523.0734.4531.4531 0 0 1 .1697.196.438.438 0 0 1 .0313.2547.4442.4442 0 0 1-.1169.2297zm-3.962-8.3355a.9202.9202 0 0 0-.306-.2106.941.941 0 0 0-.367-.0742H.4599a.4687.4687 0 0 0-.2522.0734.4513.4513 0 0 0-.1696.1961.4376.4376 0 0 0-.0314.2546.444.444 0 0 0 .117.2297l3.9649 4.1394a.9204.9204 0 0 0 .3052.2102c.1154.049.24.0744.3658.0746H23.54a.469.469 0 0 0 .2523-.0734.453.453 0 0 0 .1697-.1961.4382.4382 0 0 0 .0313-.2546.4444.4444 0 0 0-.1169-.2297zM.46 6.7225h18.7815a.9411.9411 0 0 0 .367-.0742.9202.9202 0 0 0 .306-.2106l3.962-4.1394a.4442.4442 0 0 0 .117-.2297.4378.4378 0 0 0-.0314-.2546.453.453 0 0 0-.1697-.196.469.469 0 0 0-.2523-.0734H4.7596a.941.941 0 0 0-.3658.0745.9203.9203 0 0 0-.3052.2102L.1246 5.9687a.4438.4438 0 0 0-.1169.2295.4375.4375 0 0 0 .0312.2544.4512.4512 0 0 0 .1692.196.4689.4689 0 0 0 .2518.0739z",
    colour: "#9945ff",
  },
  TRON: {
    viewBox: "0 0 32 32",
    d: "M16 0c8.837 0 16 7.163 16 16s-7.163 16-16 16S0 24.837 0 16 7.163 0 16 0zM7.5 7.257l7.595 19.112 10.583-12.894-3.746-3.562L7.5 7.257zm16.252 6.977l-7.67 9.344.983-8.133 6.687-1.21zM9.472 9.488l6.633 5.502-1.038 8.58L9.472 9.487zM21.7 11.083l2.208 2.099-6.038 1.093 3.83-3.192zM10.194 8.778l10.402 1.914-4.038 3.364-6.364-5.278z",
    colour: "#ff060a",
  },
  NEAR: {
    viewBox: "0 0 24 24",
    d: "M21.443 0c-.89 0-1.714.46-2.18 1.218l-5.017 7.448a.533.533 0 0 0 .792.7l4.938-4.282a.2.2 0 0 1 .334.151v13.41a.2.2 0 0 1-.354.128L5.03.905A2.555 2.555 0 0 0 3.078 0h-.521A2.557 2.557 0 0 0 0 2.557v18.886a2.557 2.557 0 0 0 4.736 1.338l5.017-7.448a.533.533 0 0 0-.792-.7l-4.938 4.283a.2.2 0 0 1-.333-.152V5.352a.2.2 0 0 1 .354-.128l14.924 17.87c.486.574 1.2.905 1.952.906h.521A2.558 2.558 0 0 0 24 21.445V2.557A2.558 2.558 0 0 0 21.443 0Z",
    colour: "#7a7a7a",
  },
  BTC: {
    viewBox: "0 0 24 24",
    d: "M23.638 14.904c-1.602 6.43-8.113 10.34-14.542 8.736C2.67 22.05-1.244 15.525.362 9.105 1.962 2.67 8.475-1.243 14.9.358c6.43 1.605 10.342 8.115 8.738 14.548v-.002zm-6.35-4.613c.24-1.59-.974-2.45-2.64-3.03l.54-2.153-1.315-.33-.525 2.107c-.345-.087-.705-.167-1.064-.25l.526-2.127-1.32-.33-.54 2.165c-.285-.067-.565-.132-.84-.2l-1.815-.45-.35 1.407s.975.225.955.236c.535.136.63.486.615.766l-1.477 5.92c-.075.166-.24.406-.614.314.015.02-.96-.24-.96-.24l-.66 1.51 1.71.426.93.242-.54 2.19 1.32.327.54-2.17c.36.1.705.19 1.05.273l-.51 2.154 1.32.33.545-2.19c2.24.427 3.93.257 4.64-1.774.57-1.637-.03-2.58-1.217-3.196.854-.193 1.5-.76 1.68-1.93h.01zm-3.01 4.22c-.404 1.64-3.157.75-4.05.53l.72-2.9c.896.23 3.757.67 3.33 2.37zm.41-4.24c-.37 1.49-2.662.735-3.405.55l.654-2.64c.744.18 3.137.524 2.75 2.084v.006z",
    colour: "#f7931a",
  },
};

function brandSvg(ticker, px) {
  const m = BRAND[ticker];
  // The viewBox travels WITH the path. TRON's is "0 0 32 32" where the others are 24 —
  // drawing it in a 24 box crops it to an unrecognisable sliver, which is how this first
  // rendered when the paths were retyped from memory instead of copied.
  return `<svg width="${px}" height="${px}" viewBox="${m.viewBox}" style="color:${m.colour}">
    <path d="${m.d}" fill="currentColor"/></svg>`;
}

/**
 * The four shielded pools as tinted pills, in `POOL_TONE`'s own weights — Ironwood and
 * Orchard full green, Sapling dim, Sprout faint. Ink weight is strength of the
 * cryptography here, not decoration, so this is the site's grammar rather than a palette.
 */
function poolsSvg() {
  const pools = [
    ["IRONWOOD", "var(--green)"],
    ["ORCHARD", "var(--green)"],
    ["SAPLING", "var(--green-dim)"],
    ["SPROUT", "var(--ink-faint)"],
  ];
  return `<span class="pools">${pools
    .map(([n, c]) => `<span class="pool" style="color:${c}">${n}</span>`)
    .join("")}</span>`;
}

const ROWS = [
  {
    mark: barsSvg(58),
    tone: "ink",
    name: "DAILY",
    covers: brandSvg("ZEC", 40),
    what: "Price, all four shielded pools, 24h flow",
  },
  {
    mark: boundarySvg(64, true),
    tone: "green",
    name: "SHIELDING",
    covers: poolsSvg(),
    what: "Value crossing into a shielded pool",
  },
  {
    mark: boundarySvg(64, false),
    tone: "dim",
    name: "UNSHIELDING",
    covers: poolsSvg(),
    what: "Value leaving a shielded pool",
  },
  {
    mark: crossingSvg(60),
    tone: "green",
    name: "CROSS-CHAIN SWAP",
    covers: ["ETH", "SOL", "TRON", "NEAR", "BTC"].map((t) => brandSvg(t, 34)).join(""),
    what: "ZEC moving to and from other chains",
  },
];

export function alertsHtml() {
  const rows = ROWS.map(
    (r) => `
    <div class="row">
      <span class="mark tone-${r.tone}">${r.mark}</span>
      <span class="name">${r.name}</span>
      <span class="what">${r.what}</span>
      <span class="covers">${r.covers}</span>
    </div>`,
  ).join("");

  return `<!doctype html><meta charset="utf-8"><style>
  :root{
    --h:146;
    --bg:oklch(0.128 0.011 var(--h));
    --green:oklch(0.874 0.252 calc(var(--h) + 0.6));
    --green-dim:oklch(0.626 0.175 calc(var(--h) + 2));
    --ink:oklch(0.966 0.053 calc(var(--h) + 5));
    --ink-bright:oklch(0.988 0.019 var(--h));
    --ink-dim:oklch(0.749 0.091 calc(var(--h) + 6));
    --ink-faint:oklch(0.607 0.07 calc(var(--h) + 7));
    --hatch:oklch(0.874 0.252 var(--h) / 0.05);
    --hairline:oklch(0.874 0.252 var(--h) / 0.09);
    --glow:0 0 12px oklch(0.874 0.252 var(--h) / 0.45);
  }
  *{box-sizing:border-box;margin:0}
  body{
    width:1600px;height:900px;padding:64px 72px;
    display:flex;flex-direction:column;justify-content:space-between;
    font-family:"JBM",ui-monospace,monospace;color:var(--ink);
    background:
      radial-gradient(120% 90% at 50% 0%, oklch(0.874 0.252 var(--h) / 0.055), transparent 62%),
      repeating-linear-gradient(0deg, var(--hatch) 0 1px, transparent 1px 44px),
      repeating-linear-gradient(90deg, var(--hatch) 0 1px, transparent 1px 44px), var(--bg);
  }
  .head{display:flex;align-items:baseline;justify-content:space-between}
  .brand{font-size:26px;font-weight:700;color:var(--green)}
  .cursor{display:inline-block;width:.5em;height:1em;background:var(--green);
    vertical-align:-.14em;margin-left:.12em;box-shadow:var(--glow)}
  .micro{font-size:19px;text-transform:uppercase;letter-spacing:.18em;color:var(--ink-dim)}
  h1{font-size:60px;font-weight:800;letter-spacing:.04em;line-height:1;color:var(--green);
     text-shadow:var(--glow)}
  .rows{display:flex;flex-direction:column;gap:26px}
  .row{display:grid;grid-template-columns:92px 400px 1fr 320px;align-items:center;gap:0 24px;
       padding-bottom:26px;border-bottom:1px solid var(--hairline)}
  .row:last-child{border-bottom:0;padding-bottom:0}
  .mark{display:flex}
  .tone-green{color:var(--green)}
  .tone-dim{color:var(--green-dim)}
  .tone-ink{color:var(--ink-dim)}
  .name{font-size:38px;font-weight:800;letter-spacing:.05em;color:var(--ink-bright)}
  .covers{display:flex;align-items:center;gap:14px;justify-content:flex-end}
  .pools{display:flex;gap:8px}
  .pool{font-size:14px;font-weight:700;letter-spacing:.1em;border:1px solid currentColor;
        border-radius:3px;padding:3px 7px}
  .what{font-size:23px;color:var(--ink-dim);white-space:nowrap}
  .foot{display:flex;align-items:flex-end;justify-content:space-between;gap:40px}
  .trust{font-size:23px;color:var(--ink-faint);max-width:1050px;line-height:1.5}
  .trust b{color:var(--ink);font-weight:700}
  .site{font-size:24px;color:var(--green-dim);white-space:nowrap}
  .divider{color:var(--green);margin:2px 0 6px}
  .divider .plain{color:var(--ink-faint)}
  .divider .lit{filter:drop-shadow(0 0 6px oklch(0.874 0.252 var(--h) / 0.5))}
  </style>
  <div class="head">
    <span class="brand">./shieldedscan<i class="cursor"></i></span>
    <span class="micro">Zcash block explorer</span>
  </div>

  <div>
    <h1>AUTOMATED ALERTS</h1>
    <div class="divider">${strip({})}</div>
  </div>

  <div class="rows">${rows}</div>

  <div class="foot">
    <span class="trust">Every figure read from <b>our own Zcash archive node</b>.
      Every alert carries the transaction hash, so you can check it yourself.</span>
    <span class="site">shieldedscan.xyz</span>
  </div>`;
}

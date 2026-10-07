/**
 * Avatar candidates, as functions of pixel size so the glow radii scale with the mark
 * instead of turning into a halo at 48px and a smudge at 400.
 *
 * Geometry is quoted from src/components/PrivacyShield.tsx, so the profile mark and the
 * shield in every table row are literally the same silhouette.
 */

export const BG = "#050805";
export const GREEN = "#2bff64";
export const GREEN_DIM = "#17a344";
export const INK_DIM = "#7fbf93";

const SHIELD = "M12 2.4 L20 5.7 L20 12.2 C20 16.9 12 21.4 12 21.4 C12 21.4 4 16.9 4 12.2 L4 5.7 Z";
const SHIELD_LEFT = "M12 2.4 L4 5.7 L4 12.2 C4 16.9 12 21.4 12 21.4 Z";

/**
 * A chamfered shield — same proportions, no curve. Not the site's silhouette, so it is
 * only a candidate: adopting it would mean the avatar and the privacy shields in every
 * table row stopped being the same shape, which is the one thing the mark had going for it.
 */
const SHIELD_HEX = "M12 2.3 L20.2 6.2 L20.2 12.5 L12 21.5 L3.8 12.5 L3.8 6.2 Z";

/** The same path scaled about the silhouette's optical centre, for rims and inlays. */
const shieldScaled = (path, s, fill, extra = "") =>
  `<path d="${path}" fill="${fill}" transform="translate(${(12 * (1 - s)).toFixed(3)} ${(
    11.6 *
    (1 - s)
  ).toFixed(3)}) scale(${s})" ${extra}/>`;

/**
 * Zcash's own ⓩ, lifted verbatim from the `ZEC` entry in
 * `src/components/brand-marks.ts` — the CC0 simple-icons mark the site already uses to
 * label ZEC in cross-chain rows. That entry draws a disc with the glyph knocked out of
 * it; this is only its second subpath, the glyph, with the relative `m-1.008 4.418`
 * resolved against the original `M12 0` so it stands alone. Its own coordinates are
 * unchanged, which is the point: the alternative is drawing a Z that looks about right,
 * and this file's history says an approximated mark is worse than no mark.
 *
 * Bounding box, needed to place it: x 7.719…16.281, y 4.418…20.850.
 */
const ZCASH_Z =
  "M10.992 4.418h2.014v2.014l3.275-.002v1.826l-5.08 6.889h5.08v2.423h-3.275v2.006h-2.012v-2.006H7.72v-1.826l5.074-6.888H7.719V6.432h3.273V4.418z";

const Z_BOX = { cx: 12, cy: 12.634, h: 16.432 };

/** The ⓩ scaled to `height` 24-units and centred on (12, cy) inside the shield. */
const zcashZ = (fill, height, cy = 12.3) => {
  const s = height / Z_BOX.h;
  return `<path d="${ZCASH_Z}" fill="${fill}" transform="translate(${12 - Z_BOX.cx * s} ${
    cy - Z_BOX.cy * s
  }) scale(${s})"/>`;
};

/* Budgeted glow: a hot core plus two bloom radii, the same falloff .crt-title uses.
   Tuned down from the first pass — at 48px the wider radius was reading as a halo
   around the disc rather than as light coming off the glyph. */
const glow = (s) =>
  `filter: drop-shadow(0 0 ${s * 0.01}px rgba(242,255,245,.45))` +
  ` drop-shadow(0 0 ${s * 0.042}px rgba(43,255,100,.5))` +
  ` drop-shadow(0 0 ${s * 0.11}px rgba(43,255,100,.22));`;

const svgWrap = (s, body, ratio = 0.62) =>
  `<svg viewBox="0 0 24 24" width="${s * ratio}" height="${s * ratio}" style="${glow(s)}">${body}</svg>`;

const shieldSvg = (s, inner, ratio = 0.62) =>
  svgWrap(s, `<path d="${SHIELD}" fill="${GREEN}"/>${inner}`, ratio);

const bars = (rows) =>
  rows
    .map(
      ([x, y, w, h]) =>
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.2" fill="${BG}"/>`,
    )
    .join("");

/** A: the Veil inside the shield — three redaction bars knocked out of the silhouette. */
const veiled3 = (s) =>
  shieldSvg(
    s,
    bars([
      [7.0, 8.6, 9.9, 2.0],
      [7.0, 12.1, 7.3, 2.0],
      [7.0, 15.6, 4.7, 2.0],
    ]),
  );

/** A2: the same idea at two bars — fewer, heavier strokes to survive a 24px favicon. */
const veiled2 = (s) =>
  shieldSvg(
    s,
    bars([
      [6.7, 9.3, 10.6, 2.5],
      [6.7, 13.4, 7.0, 2.5],
    ]),
  );

/** B: the mixed mark, blown up — half the silhouette filled. */
const halfShield = (s) =>
  `<svg viewBox="0 0 24 24" width="${s * 0.62}" height="${s * 0.62}" style="${glow(s)}">
     <path d="${SHIELD_LEFT}" fill="${GREEN}"/>
     <path d="${SHIELD}" fill="none" stroke="${GREEN}" stroke-width="1.7" stroke-linejoin="round"/></svg>`;

/** C: the prompt — chevron plus the blinking block, frozen. */
const promptBlock = (s) =>
  `<svg viewBox="0 0 40 24" width="${s * 0.7}" height="${s * 0.42}" style="${glow(s)}">
     <path d="M7 6.5 L14.5 12 L7 17.5" fill="none" stroke="${GREEN}" stroke-width="2.8"
           stroke-linecap="round" stroke-linejoin="round"/>
     <rect x="20" y="5.6" width="7.4" height="12.8" rx="0.4" fill="${GREEN}"/></svg>`;

/** D: both grammars in one glyph — the prompt caret cut out of the shield. */
const promptShield = (s) =>
  shieldSvg(
    s,
    `<path d="M9.5 8.7 L13.5 12.2 L9.5 15.7" fill="none" stroke="${BG}" stroke-width="2.4"
           stroke-linecap="round" stroke-linejoin="round"/>`,
  );

/** E: the block cursor inside the shield — one redaction, at maximum weight. */
const cursorShield = (s) => shieldSvg(s, bars([[9.6, 8.4, 4.8, 8.0]]));

/* ---------------------------------------------------------------------------
   Z1…Z4 — the shield carrying Zcash's own ⓩ. Green only: the published mark is
   gold, but this is our identity rather than a row identifying ZEC among other
   assets, and the palette is a single accent on near-black.
   --------------------------------------------------------------------------- */

/** Z1: solid shield, the ⓩ knocked out large. Most mass, so the strongest read small. */
const zShieldCut = (s) => shieldSvg(s, zcashZ(BG, 11.4));

/** Z2: the same, ⓩ smaller — more shield around it, calmer at large sizes. */
const zShieldCutSmall = (s) => shieldSvg(s, zcashZ(BG, 9.4));

/** Z3: outlined shield holding a green ⓩ. The Z is a positive shape, not a hole. */
const zShieldOutline = (s) =>
  `<svg viewBox="0 0 24 24" width="${s * 0.62}" height="${s * 0.62}" style="${glow(s)}">
     <path d="${SHIELD}" fill="none" stroke="${GREEN}" stroke-width="1.7" stroke-linejoin="round"/>
     ${zcashZ(GREEN, 10.2, 12.4)}</svg>`;

/** Z4: the ⓩ knocked out, plus one redaction bar — the Veil kept alongside the Z. */
const zShieldVeiled = (s) =>
  shieldSvg(s, `${zcashZ(BG, 9.6, 11.4)}${bars([[7.6, 17.0, 8.8, 1.7]])}`);

/* ---------------------------------------------------------------------------
   Second round. Z1 was rejected as too plain, so these vary the three things
   that were fixed in it: the depth (flat green vs. the palette's two green
   steps), the silhouette (curved vs. chamfered) and the ⓩ's polarity.
   --------------------------------------------------------------------------- */

/** RIM: a plate with a rim — green edge, dark channel, green field, ⓩ knocked out. */
const rimShield = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD}" fill="${GREEN}"/>` +
      shieldScaled(SHIELD, 0.9, BG) +
      shieldScaled(SHIELD, 0.8, GREEN) +
      zcashZ(BG, 9.2, 12.1),
  );

/** DUO: dim field, bright rim, ⓩ knocked out. Depth from the palette's own two greens. */
const duoShield = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD}" fill="${GREEN_DIM}" stroke="${GREEN}" stroke-width="1.5" stroke-linejoin="round"/>` +
      zcashZ(BG, 10.6, 12.2),
  );

/** HEX: the chamfered silhouette, solid, ⓩ knocked out. Sharper, less icon-set. */
const hexShield = (s) =>
  svgWrap(s, `<path d="${SHIELD_HEX}" fill="${GREEN}"/>${zcashZ(BG, 11, 12)}`);

/** COIN: a dark badge behind a heavy green rim, ⓩ bright inside. */
const coinShield = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD}" fill="${BG}" stroke="${GREEN}" stroke-width="2.6" stroke-linejoin="round"/>` +
      zcashZ(GREEN, 9.6, 12.3),
  );

/** LAYER: bright outline, inset dim plate, ⓩ knocked out of the plate. */
const layerShield = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD}" fill="none" stroke="${GREEN}" stroke-width="1.5" stroke-linejoin="round"/>` +
      shieldScaled(SHIELD, 0.82, GREEN) +
      zcashZ(BG, 8.6, 12.1),
  );

/** BOLD: the ⓩ enlarged until its bars nearly meet the silhouette. Maximum graphic. */
const boldShield = (s) => shieldSvg(s, zcashZ(BG, 13.2, 12.3));

/** PLATE: COIN's heavy lit rim over DUO's dim field, ⓩ knocked out. Rim without hollowing. */
const plateShield = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD}" fill="${GREEN_DIM}" stroke="${GREEN}" stroke-width="2.4" stroke-linejoin="round"/>` +
      zcashZ(BG, 10.4, 12.3),
  );

/** COIN2: COIN with more rim and a larger ⓩ — the badge read, pushed as far as it goes. */
const coin2Shield = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD}" fill="${BG}" stroke="${GREEN}" stroke-width="3.1" stroke-linejoin="round"/>` +
      zcashZ(GREEN, 10.4, 12.4),
  );

/* ---------------------------------------------------------------------------
   BOX — a terminal window instead of a shield: thick green rule, black field,
   one glyph inside, from a reference avatar.

   The frame has a constraint the shield does not: X crops an avatar to a
   circle, so a square that bleeds to the edges loses its corners and reads as
   four arcs. Each glyph therefore comes in two framings — `…` bleeding, and
   `…In` inset to 0.70 of the canvas, which is inside the crop circle
   (the largest square inscribed in a circle is its diameter / √2 ≈ 0.707).
   --------------------------------------------------------------------------- */

/** The window itself. `sw` is in 24-box units, so at sw=2 the rule is 1/12 of the side. */
const frame = (sw = 2, rx = 3) =>
  `<rect x="${sw / 2}" y="${sw / 2}" width="${24 - sw}" height="${24 - sw}" rx="${rx}"
         fill="${BG}" stroke="${GREEN}" stroke-width="${sw}"/>`;

/*
 * Inset is the default because the bleeding version was rendered and rejected on evidence:
 * circle-cropped, its corners are gone and the frame reads as four green bands rather than
 * a rectangle. `boxzBleed` is kept only so that stays checkable.
 *
 * 0.92 rather than 1.0 for the bleeding one, because at 1.0 the drop-shadow lands outside
 * the SVG box and the screenshot clips it, which flattens the frame.
 */
const boxed = (s, inner, { bleed = false } = {}) =>
  svgWrap(s, `${frame()}${inner}`, bleed ? 0.92 : 0.7);

/** BOXZ: the window holding Zcash's ⓩ. */
const boxZ = (s) => boxed(s, zcashZ(GREEN, 11.6, 12));
const boxZBleed = (s) => boxed(s, zcashZ(GREEN, 11.6, 12), { bleed: true });

/** BOXCUR: the window holding the block cursor — the logo's own glyph, alone. */
const cursorGlyph = `<rect x="9.7" y="7.2" width="4.6" height="9.6" rx="0.3" fill="${GREEN}"/>`;
const boxCursor = (s) => boxed(s, cursorGlyph);

/** BOXPROMPT: the window holding a prompt — caret plus block, the site's search grammar. */
const promptGlyph =
  `<path d="M6.8 8.6 L10.3 12 L6.8 15.4" fill="none" stroke="${GREEN}" stroke-width="1.9"` +
  ` stroke-linecap="round" stroke-linejoin="round"/>` +
  `<rect x="13.2" y="7.9" width="4.2" height="8.2" rx="0.3" fill="${GREEN}"/>`;
const boxPrompt = (s) => boxed(s, promptGlyph);

/** BOXZCUR: the ⓩ with the block cursor beside it — a terminal with the chain in it. */
const boxZCursor = (s) =>
  boxed(
    s,
    `<g transform="translate(-1.9 0)">${zcashZ(GREEN, 10.8, 12)}</g>` +
      `<rect x="15.1" y="7.6" width="3.4" height="8.8" rx="0.25" fill="${GREEN}"/>`,
  );

/** BOXSHIELD: the window holding the privacy shield, ⓩ knocked out of it. */
const boxShield = (s) =>
  boxed(
    s,
    shieldScaled(SHIELD, 0.76, GREEN) +
      `<g transform="translate(${12 * (1 - 0.76)} ${11.6 * (1 - 0.76)}) scale(0.76)">${zcashZ(
        BG,
        11.4,
        12.3,
      )}</g>`,
  );

/** BOXVEIL: the window holding the Veil — two redaction bars. */
const boxVeil = (s) =>
  boxed(
    s,
    bars([
      [6.6, 9.3, 10.8, 2.4],
      [6.6, 13.2, 7.2, 2.4],
    ]).replaceAll(`fill="${BG}"`, `fill="${GREEN}"`),
  );

/* ---------------------------------------------------------------------------
   BOXS — the window holding an S, built the way the banner's signage is built.

   The ⓩ is Electric Coin Company's trademark, and
   using it to *label* ZEC in a table row (descriptive use, which is what
   `brand-marks.ts` does) is a different act from making it our own avatar,
   where it reads as affiliation. An S is the site's own initial and asks
   nobody's permission.

   The S is a neon tube, not a typeface: three concentric strokes — spill, body,
   hot core — which is exactly `tube()` in `city.mjs`. That also survives the
   flat `shieldedscan-mark.svg` export, where the CSS glow filter is dropped: the
   letter still looks like neon because the neon is in the geometry.
   --------------------------------------------------------------------------- */

/*
 * A real neon tube's core reads near-white, and at avatar size that is a problem rather
 * than realism: the letter stops reading green, which is the one thing the brief asked
 * for. So the core is a pale *green* and stays narrow, and the green body carries the
 * weight. `CORE_HOT` is the literal city.mjs value, kept for comparison.
 */
const CORE_HOT = "#c9ffd8";
const CORE = "#8dffb0";

const neonPath = (d, w, { linejoin = "round", core = CORE, coreScale = 0.8, alpha = 1 } = {}) => {
  const common = `d="${d}" fill="none" stroke-linecap="round" stroke-linejoin="${linejoin}"`;
  const o = (v) => (v * alpha).toFixed(3);
  return (
    `<path ${common} stroke="${GREEN}" stroke-width="${w * 2.5}" stroke-opacity="${o(0.18)}"/>` +
    `<path ${common} stroke="${GREEN}" stroke-width="${w * 1.5}" stroke-opacity="${o(0.78)}"/>` +
    `<path ${common} stroke="${core}" stroke-width="${w * coreScale}" stroke-opacity="${o(0.95)}"/>`
  );
};

/** A tube bent into an S. Two reversed arcs, open ends — how a real sign is bent. */
const S_CURVE =
  "M16.2 8.7 C16.2 6.95 14.3 6.2 12 6.2 C9.7 6.2 7.8 7.05 7.8 8.95" +
  " C7.8 10.65 9.45 11.45 12 11.95 C14.55 12.45 16.35 13.25 16.35 15.05" +
  " C16.35 16.95 14.4 17.8 12 17.8 C9.6 17.8 7.65 17.0 7.65 15.3";

/** The same letter cut from straight runs and 45° bends — the banner's angular neon. */
const S_ANGLE = "M16.3 7.5 H9.5 L7.7 9.3 V10.5 L9.5 12.3 H14.5 L16.3 14.1 V15.5 L14.5 17.3 H7.7";

/** BOXS: the window and the tube S — narrower tube, so the counters stay open. */
const boxS = (s) => boxed(s, neonPath(S_CURVE, 2.05));

/** BOXSHOT: the same letter with city.mjs's near-white core, for comparison. */
const boxSHot = (s) => boxed(s, neonPath(S_CURVE, 2.3, { core: CORE_HOT, coreScale: 1 }));

/** BOXSANG: the angular cut, mitred like signage rather than bent like glass. */
const boxSAngle = (s) => boxed(s, neonPath(S_ANGLE, 2.1, { linejoin: "miter" }));

/** BOXSTHIN: a thinner tube still — closest to real signage, most fragile at 24px. */
const boxSThin = (s) => boxed(s, neonPath(S_CURVE, 1.6));

/* ---------------------------------------------------------------------------
   SHS — the shield back as the container, holding the S, in place of the
   rectangular window.

   The shield tapers to a point, so it holds far less letter than a square of
   the same width: an S sized for the window overflows the lower flanks. Each
   variant therefore sizes and lifts the letter for the silhouette rather than
   dropping the box's glyph into it unchanged.
   --------------------------------------------------------------------------- */

/** The S sized and placed for a container: `h` in 24-box units, centred on (12, cy). */
const sGlyph = (h, cy, { w = 2.6, angular = false, core = CORE, stroke = null } = {}) => {
  const src = angular ? S_ANGLE : S_CURVE;
  const k = h / 11.6;
  const t = `translate(${12 - 12 * k} ${cy - 12 * k}) scale(${k})`;
  const body = stroke
    ? // A single stroke in the field colour: the letter as a knockout, not as a tube.
      `<path d="${src}" fill="none" stroke="${stroke}" stroke-width="${w}"` +
      ` stroke-linecap="round" stroke-linejoin="${angular ? "miter" : "round"}"/>`
    : neonPath(src, w, { linejoin: angular ? "miter" : "round", core });
  return `<g transform="${t}">${body}</g>`;
};

const shieldRule = (fill, sw) =>
  `<path d="${SHIELD}" fill="${fill}" stroke="${GREEN}" stroke-width="${sw}" stroke-linejoin="round"/>`;

/** SHS: the shield as a lit rule over a dark field, with the tube S inside. */
const shS = (s) => svgWrap(s, shieldRule(BG, 2.4) + sGlyph(9, 11.2), 0.66);

/** SHSTHIN: a lighter rule, so the letter carries more of the mark. */
const shSThin = (s) => svgWrap(s, shieldRule(BG, 1.9) + sGlyph(9.5, 11.25, { w: 2.5 }), 0.66);

/** SHSANG: the same, with the angular S — mitred like the banner's signage. */
const shSAngle = (s) => svgWrap(s, shieldRule(BG, 2.4) + sGlyph(9, 11.2, { angular: true }), 0.66);

/** SHSCUT: solid green shield, the S knocked out of it. Most mass, best at 24px. */
const shSCut = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD}" fill="${GREEN}"/>${sGlyph(9.6, 11.3, { w: 3, stroke: BG })}`,
    0.66,
  );

/** SHSDUO: dim field, lit rule, S knocked out — the palette's two greens for depth. */
const shSDuo = (s) =>
  svgWrap(s, shieldRule(GREEN_DIM, 2.2) + sGlyph(9, 11.15, { w: 2.8, stroke: BG }), 0.66);

/* ---------------------------------------------------------------------------
   BXSH — the rectangular window with the shield inside it, no letter.

   Two nested containers is a real risk (it is why `boxshield` lost when it also
   held a ⓩ), so the shield here carries nothing: frame and silhouette, two
   shapes, and the shield's solid mass is what has to read at 48px.
   --------------------------------------------------------------------------- */

/** The shield scaled about its own bbox centre (12, 11.9) and centred in the field. */
const shieldIn = (k, body) =>
  `<g transform="translate(${(12 - 12 * k).toFixed(3)} ${(12 - 11.9 * k).toFixed(3)}) scale(${k})">${body}</g>`;

const solidShield = `<path d="${SHIELD}" fill="${GREEN}"/>`;

/** BXSH: window, solid shield. */
const bxSh = (s) => boxed(s, shieldIn(0.78, solidShield));

/** BXSHBIG: the same, filling more of the field — mass over margin. */
const bxShBig = (s) => boxed(s, shieldIn(0.88, solidShield));

/** BXSHOUT: window, outlined shield. Lighter, and two rules can read as noise. */
const bxShOut = (s) =>
  boxed(
    s,
    shieldIn(
      0.74,
      `<path d="${SHIELD}" fill="none" stroke="${GREEN}" stroke-width="${(2.2 / 0.74).toFixed(2)}" stroke-linejoin="round"/>`,
    ),
  );

/** BXSHDUO: window, shield in the palette's two greens — dim field, lit rim. */
const bxShDuo = (s) =>
  boxed(
    s,
    shieldIn(
      0.78,
      `<path d="${SHIELD}" fill="${GREEN_DIM}" stroke="${GREEN}" stroke-width="${(1.9 / 0.78).toFixed(2)}" stroke-linejoin="round"/>`,
    ),
  );

/** BXSHNEON: window, the shield bent as a neon tube — the banner's signage, as a shape. */
const bxShNeon = (s) =>
  boxed(s, shieldIn(0.74, neonPath(SHIELD, 2.4 / 0.74, { linejoin: "round" })));

/* ---------------------------------------------------------------------------
   The canyon marks. Everything above looks assembled, and that names a real
   failure mode. Every mark so far was primitives assembled (rounded rect +
   shield + glyph), and a shield in a rounded square is the icon every security
   product ships. The banner works because it has a subject — a phosphor readout
   in a neon canyon — so these take the avatar into that same world instead of
   the icon-set one.

   Shared construction: one-point perspective, drawn with the banner's own
   `tube()` grammar (spill / body / core), receding to a hot centre. Nothing
   bleeds to a corner, because X crops to a circle — a rectangle's corners sit
   at h·√2, so the outermost ring is held at half-size 8.4 of the 24-box.
   --------------------------------------------------------------------------- */

/** A rounded rectangle centred on the vanishing point, `h` half-size in 24-box units. */
const ring = (h, w, a) =>
  neonPath(
    `M${12 - h + h * 0.18} ${12 - h} H${12 + h - h * 0.18} Q${12 + h} ${12 - h} ${12 + h} ${12 - h + h * 0.18}` +
      ` V${12 + h - h * 0.18} Q${12 + h} ${12 + h} ${12 + h - h * 0.18} ${12 + h}` +
      ` H${12 - h + h * 0.18} Q${12 - h} ${12 + h} ${12 - h} ${12 + h - h * 0.18}` +
      ` V${12 - h + h * 0.18} Q${12 - h} ${12 - h} ${12 - h + h * 0.18} ${12 - h} Z`,
    w,
    { alpha: a },
  );

/** The corner runs that make the rings read as one corridor rather than four frames. */
const corners = (from, to, w, a) =>
  [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
    .map(([sx, sy]) =>
      neonPath(`M${12 + sx * from} ${12 + sy * from} L${12 + sx * to} ${12 + sy * to}`, w, {
        alpha: a,
      }),
    )
    .join("");

/**
 * The corridor itself. Rings recede and dim; the far end is the brightest thing in the
 * mark, which is both what the banner does at its vanishing point and what makes this
 * read at 24px — by then the rings have merged and only the hot centre survives.
 */
const corridor = () =>
  ring(8.4, 1.15, 0.5) +
  ring(5.2, 0.95, 0.72) +
  ring(3.0, 0.75, 0.9) +
  corners(8.4, 3.0, 0.7, 0.45) +
  `<circle cx="12" cy="12" r="2.1" fill="${GREEN}" fill-opacity=".9"/>` +
  `<circle cx="12" cy="12" r="3.4" fill="${GREEN}" fill-opacity=".22"/>` +
  `<circle cx="12" cy="12" r="1.1" fill="${CORE}" fill-opacity=".95"/>`;

/** CANYON: the corridor alone, fading out at the edges the way the banner's fog does. */
const canyon = (s) => svgWrap(s, corridor(), 0.96);

/**
 * Everything outside `inner` painted back to the background — a matte, so a silhouette can
 * be a window onto the scene. `fill-rule="evenodd"` rather than a `clipPath`, because a
 * clip needs an `id` and this file renders every mark several times on one sheet: shared
 * ids there are the exact bug `PrivacyShield.tsx` documents.
 */
const matteOutside = (inner) =>
  `<path d="M0 0 H24 V24 H0 Z ${inner}" fill-rule="evenodd" fill="${BG}"/>`;

/**
 * APERTURE: the privacy shield as a window onto the corridor. The one mark here with an
 * argument in it — you are looking at the chain *through* the shield — rather than a shield
 * sitting next to something.
 */
const aperture = (s) =>
  svgWrap(
    s,
    `<g transform="translate(${12 - 12 * 1.02} ${12 - 12 * 1.02}) scale(1.02)">${corridor()}</g>` +
      matteOutside(SHIELD) +
      `<path d="${SHIELD}" fill="none" stroke="${GREEN}" stroke-width="1.5" stroke-linejoin="round"/>`,
    0.74,
  );

/** APERTUREHEAVY: the same, with a rule thick enough to hold the silhouette at 24px. */
const apertureHeavy = (s) =>
  svgWrap(
    s,
    `<g transform="translate(${12 - 12 * 1.02} ${12 - 12 * 1.02}) scale(1.02)">${corridor()}</g>` +
      matteOutside(SHIELD) +
      `<path d="${SHIELD}" fill="none" stroke="${GREEN}" stroke-width="2.4" stroke-linejoin="round"/>`,
    0.74,
  );

/**
 * PHOSPHOR: the other thing the banner is — a tube. Dark glass, the raster that `.crt-title`
 * cuts into the homepage hero, and one live block cursor on it.
 */
const phosphor = (s) => {
  const raster = Array.from({ length: 9 }, (_, i) => 5.6 + i * 1.45)
    .map(
      (y) => `<rect x="3.4" y="${y}" width="17.2" height=".62" fill="${BG}" fill-opacity=".55"/>`,
    )
    .join("");
  return svgWrap(
    s,
    `<rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2.4" fill="#07200f"/>` +
      `<rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2.4" fill="${GREEN}" fill-opacity=".1"/>` +
      `<rect x="9.9" y="9.2" width="4.2" height="5.6" rx=".3" fill="${GREEN}"/>` +
      `<rect x="9.9" y="9.2" width="4.2" height="5.6" rx=".3" fill="${CORE}" fill-opacity=".45"/>` +
      raster +
      `<rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2.4" fill="none" stroke="${GREEN}" stroke-width="1.5"/>`,
    0.92,
  );
};

/* ---------------------------------------------------------------------------
   The phosphor shields. Second answer to the same verdict, after the corridor
   marks above were rendered and rejected on their own evidence: concentric
   rings are symmetric, so they read as a target rather than as depth, and a
   scene does not survive 48px anyway.

   What survives 48px is silhouette. So the shield stays, and the banner's feel
   arrives as *treatment* instead: the shield is drawn as phosphor light —
   scanlines of it — which is the one move this design system already owns
   (`.crt-title` cuts a raster into the homepage hero).
   --------------------------------------------------------------------------- */

/**
 * Half-width of the shield silhouette at height `y`, so a row of light can be drawn to the
 * edges without a clip path. Piecewise, following `SHIELD`: the shoulders splay to the full
 * 8 units by y=5.7, hold to y=12.2, then taper to the point at 21.4. The taper approximates
 * the cubic with an exponent — within a tenth of a unit across the range, and a scanline
 * ending a tenth short of the edge is invisible where a clip-path `id` collision is not.
 */
const shieldHalfWidth = (y) => {
  if (y <= 2.4 || y >= 21.4) return 0;
  if (y < 5.7) return (8 * (y - 2.4)) / 3.3;
  if (y <= 12.2) return 8;
  return 8 * (1 - Math.pow((y - 12.2) / 9.2, 1.6));
};

/** Rows of light across the silhouette, from `y0` down, at `pitch`. */
const shieldRows = (pitch, thickness, paint) => {
  const out = [];
  for (let y = 3.4; y < 21.2; y += pitch) {
    const hw = shieldHalfWidth(y + thickness / 2) - 0.25;
    if (hw <= 0.5) continue;
    out.push(paint(12 - hw, y, hw * 2, thickness, (y - 3.4) / 17.8));
  }
  return out.join("");
};

/**
 * SCANSHIELD: a solid shield with the raster cut into it — the homepage hero's treatment,
 * at mark scale. The cut widens down the silhouette, so the top reads as solid light and
 * the point dissolves, which is where the glow already falls off.
 */
const scanShield = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD}" fill="${GREEN}"/>` +
      shieldRows(
        1.55,
        0.62,
        (x, y, w, h, t) =>
          `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${(h + t * 0.5).toFixed(2)}" fill="${BG}" fill-opacity="${(0.55 + t * 0.4).toFixed(2)}"/>`,
      ),
    0.66,
  );

/**
 * BARSHIELD: the inverse — the shield built *from* rows of light on darkness, brightest at
 * the shoulders and falling to the point. Closest to the banner's wall of tubes.
 */
const barShield = (s) =>
  svgWrap(
    s,
    shieldRows(
      1.7,
      1.0,
      (x, y, w, h, t) =>
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h}" rx="0.35" fill="${GREEN}" fill-opacity="${(1 - t * 0.55).toFixed(2)}"/>`,
    ) +
      `<path d="${SHIELD}" fill="none" stroke="${GREEN}" stroke-width="1.4" stroke-linejoin="round"/>`,
    0.66,
  );

/** TUBESHIELD: the silhouette as a single bent neon tube — the banner's marquee, as a mark. */
const tubeShield = (s) => svgWrap(s, neonPath(SHIELD, 2.2, { linejoin: "round" }), 0.68);

/** TUBESHIELDLIT: the same tube over a lit interior — the glass holds a little light. */
const tubeShieldLit = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD}" fill="${GREEN}" fill-opacity=".12"/>` +
      neonPath(SHIELD, 2.2, { linejoin: "round" }),
    0.68,
  );

/** TUBESHIELDHEAVY: a fatter tube, for whether the mark holds at a 24px favicon. */
const tubeShieldHeavy = (s) => svgWrap(s, neonPath(SHIELD, 2.9, { linejoin: "round" }), 0.68);

/* ---------------------------------------------------------------------------
   Cypherpunk round: an eye, and a shield with
   more of the idiom in it. Both drawn with the banner's tube grammar.

   Worth recording about the eye: the all-seeing eye is the *surveillance*
   emblem, so on a privacy explorer it can read as the thing the site exists to
   resist. `eyeveil` answers that rather than ignoring it — the eye is redacted,
   which is this site's own grammar for "encrypted on-chain, hidden by design".
   --------------------------------------------------------------------------- */

/*
 * The eye is a true lens: two circular arcs of radius R whose centres sit ±d from the
 * middle. Solving for a lens 16.8 wide and 10.4 tall gives d = 4.185, R = 9.385 — which
 * matters because it also yields the exact half-width at any height, so rows of light can
 * be laid inside it without a clip path, the same trick `shieldHalfWidth` does.
 */
const EYE = { cx: 12, cy: 12, halfW: 8.4, halfH: 5.2, d: 4.185, r: 9.385 };
const EYE_PATH =
  `M${EYE.cx - EYE.halfW} ${EYE.cy} A${EYE.r} ${EYE.r} 0 0 1 ${EYE.cx + EYE.halfW} ${EYE.cy}` +
  ` A${EYE.r} ${EYE.r} 0 0 1 ${EYE.cx - EYE.halfW} ${EYE.cy} Z`;
const eyeHalfWidth = (y) => {
  const v = EYE.r * EYE.r - Math.pow(Math.abs(y - EYE.cy) + EYE.d, 2);
  return v <= 0 ? 0 : Math.sqrt(v);
};

/** EYETUBE: the lens, iris and pupil, all bent from tube. */
const eyeTube = (s) =>
  svgWrap(
    s,
    neonPath(EYE_PATH, 1.9) +
      neonPath(`M12 8.6 A3.4 3.4 0 1 1 11.99 8.6 Z`, 1.5, { alpha: 0.9 }) +
      `<circle cx="12" cy="12" r="1.5" fill="${GREEN}"/>` +
      `<circle cx="12" cy="12" r="0.7" fill="${CORE}"/>`,
    0.92,
  );

/** EYEAPERTURE: the iris as a camera stop — six blades, which is the cypherpunk reading. */
const eyeAperture = (s) => {
  const blades = Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3;
    const b = a + Math.PI / 3;
    const R = 3.5;
    return (
      `M${(12 + R * Math.cos(a)).toFixed(2)} ${(12 + R * Math.sin(a)).toFixed(2)}` +
      ` L${(12 + R * Math.cos(b)).toFixed(2)} ${(12 + R * Math.sin(b)).toFixed(2)}`
    );
  })
    .map((d, i) => neonPath(d, 1.15, { linejoin: "miter", alpha: 0.6 + (i % 2) * 0.3 }))
    .join("");
  return svgWrap(
    s,
    neonPath(EYE_PATH, 1.9) + blades + `<circle cx="12" cy="12" r="1.3" fill="${GREEN}"/>`,
    0.92,
  );
};

/** Rows of light laid inside an arbitrary half-width function. */
const rowsInside = (halfWidth, y0, y1, pitch, thickness, paint) => {
  const out = [];
  for (let y = y0; y < y1; y += pitch) {
    const hw = halfWidth(y + thickness / 2) - 0.3;
    if (hw <= 0.4) continue;
    out.push(paint(12 - hw, y, hw * 2, thickness, (y - y0) / (y1 - y0)));
  }
  return out.join("");
};

/** EYESCAN: the lens as a phosphor readout, with the pupil dark. */
const eyeScan = (s) =>
  svgWrap(
    s,
    rowsInside(
      eyeHalfWidth,
      6.9,
      17.1,
      1.35,
      0.82,
      (x, y, w, h, t) =>
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h}" rx="0.3" fill="${GREEN}" fill-opacity="${(0.95 - Math.abs(t - 0.5) * 0.7).toFixed(2)}"/>`,
    ) +
      `<circle cx="12" cy="12" r="2.5" fill="${BG}"/>` +
      `<circle cx="12" cy="12" r="1.2" fill="${GREEN}"/>` +
      neonPath(EYE_PATH, 1.5, { alpha: 0.9 }),
    0.92,
  );

/** EYEVEIL: the eye with the Veil across it — an eye you cannot look into. */
const eyeVeil = (s) =>
  svgWrap(
    s,
    neonPath(EYE_PATH, 1.9) +
      neonPath(`M12 8.6 A3.4 3.4 0 1 1 11.99 8.6 Z`, 1.4, { alpha: 0.75 }) +
      `<circle cx="12" cy="12" r="1.4" fill="${GREEN}" fill-opacity=".8"/>` +
      // The bar sits *inside* the lens, not across it: overhanging the outline read as a
      // strike-through — "cancelled" — where a redaction has to read as "withheld".
      `<rect x="4.9" y="10.35" width="14.2" height="3.3" rx="0.3" fill="${BG}"/>` +
      `<rect x="5.5" y="10.75" width="13" height="2.5" rx="0.3" fill="${GREEN}"/>` +
      `<rect x="5.5" y="10.75" width="13" height="2.5" rx="0.3" fill="${CORE}" fill-opacity=".28"/>`,
    0.92,
  );

/** CIRCUITSHIELD: the silhouette with three traces and their vias. Kept to three: at 48px
 *  a dense board becomes hatching, and hatching is not a mark. */
const circuitShield = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD}" fill="${GREEN}" fill-opacity=".1"/>` +
      neonPath(SHIELD, 1.9) +
      neonPath("M12 6.4 V9.2 L14.8 12 V15", 1.1, { linejoin: "miter", alpha: 0.85 }) +
      neonPath("M8.2 8.6 H10.4 L12 10.2", 1.1, { linejoin: "miter", alpha: 0.7 }) +
      neonPath("M15.6 8.8 L13.6 10.8", 1.1, { linejoin: "miter", alpha: 0.7 }) +
      [
        [12, 6.4],
        [14.8, 15],
        [8.2, 8.6],
        [15.6, 8.8],
      ]
        .map(
          ([x, y]) =>
            `<circle cx="${x}" cy="${y}" r="0.95" fill="${BG}" stroke="${GREEN}" stroke-width="0.8"/>`,
        )
        .join(""),
    0.68,
  );

/** GLYPHSHIELD: the Veil inside the silhouette — rows of ciphertext, lengths varying. */
const glyphShield = (s) => {
  const widths = [0.86, 0.62, 0.94, 0.55, 0.78, 0.45, 0.7, 0.38];
  let i = 0;
  return svgWrap(
    s,
    `<path d="${SHIELD}" fill="${GREEN}" fill-opacity=".12"/>` +
      rowsInside(shieldHalfWidth, 5.6, 19.4, 1.75, 1.05, (x, y, w, h) => {
        const frac = widths[i++ % widths.length];
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(w * frac).toFixed(2)}" height="${h}" rx="0.35" fill="${GREEN}" fill-opacity=".92"/>`;
      }) +
      neonPath(SHIELD, 1.7),
    0.68,
  );
};

/** FACETSHIELD: the chamfered silhouette with an internal bevel — hard-edged, no curve. */
const facetShield = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD_HEX}" fill="${GREEN}" fill-opacity=".12"/>` +
      neonPath(SHIELD_HEX, 2.1, { linejoin: "miter" }) +
      neonPath("M6.6 8.2 L12 11.2 L17.4 8.2", 1.3, { linejoin: "miter", alpha: 0.8 }) +
      neonPath("M6.6 12.4 L12 15.4 L17.4 12.4", 1.3, { linejoin: "miter", alpha: 0.55 }),
    0.68,
  );

/** KEYSHIELD: an aperture in the silhouette — a shield you look through, not at. */
const keyShield = (s) =>
  svgWrap(
    s,
    `<path d="${SHIELD}" fill="${GREEN}"/>` +
      `<circle cx="12" cy="10.6" r="2.6" fill="${BG}"/>` +
      `<path d="M10.5 12.4 L13.5 12.4 L12.8 17.2 L11.2 17.2 Z" fill="${BG}"/>`,
    0.68,
  );

/* ---------------------------------------------------------------------------
   WM — the reference avatar's own composition: the window, the `./` path
   prefix, and the wordmark wrapped onto two rows.

   The honest caveat, which the rendered 48px and 24px cells in
   `mark-candidates.png` show better than prose: the reference works because
   `./c` is three glyphs. "./shieldedscan" is fourteen, and fourteen characters
   inside a 48px timeline avatar cannot resolve — the width of the longest row
   sets the type size, and the type size is then a fraction of a pixel per stem.
   It reads at the ~133px of a profile-page header and on anything larger.
   --------------------------------------------------------------------------- */

const MONO_ADVANCE = 0.6; // JetBrains Mono, em per character

const textRow = (t, x, y, fs, anchor, fill, weight = 700) =>
  `<text x="${x}" y="${y.toFixed(2)}" font-family="'JetBrains Mono', JBM, ui-monospace, monospace"` +
  ` font-size="${fs.toFixed(2)}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${t}</text>`;

/**
 * Two rows inside the window. `fs` is derived from the *longest* row so the block fills the
 * field's width — the field is 20 units across, less padding, and a row of n characters is
 * n · 0.6 · fs wide.
 */
const wordmarkBox = (
  rows,
  { pad = 1.1, centred = false, cursor = false, dimSecond = false } = {},
) => {
  // The cursor only extends the row it sits on — adding it to every row's length shrinks
  // the type for a width nothing occupies.
  const longest = Math.max(
    ...rows.map((r, i) => r.length + (cursor && i === rows.length - 1 ? 1 : 0)),
  );
  const fs = (20 - pad * 2) / (longest * MONO_ADVANCE);
  const lead = fs * 1.22;
  // Centre the two-row block on the field: cap height is ~0.73em for this face.
  const firstBaseline = 12 - lead / 2 + fs * 0.73 * 0.5;
  const x = centred ? 12 : 2 + pad;
  const anchor = centred ? "middle" : "start";
  const body = rows
    .map((r, i) =>
      textRow(r, x, firstBaseline + i * lead, fs, anchor, i && dimSecond ? GREEN_DIM : GREEN),
    )
    .join("");
  const block = cursor
    ? `<rect x="${(x + rows[rows.length - 1].length * MONO_ADVANCE * fs + fs * 0.06).toFixed(2)}"` +
      ` y="${(firstBaseline + (rows.length - 1) * lead - fs * 0.72).toFixed(2)}"` +
      ` width="${(fs * MONO_ADVANCE * 0.86).toFixed(2)}" height="${(fs * 0.78).toFixed(2)}" fill="${GREEN}"/>`
    : "";
  return `${body}${block}`;
};

/** WM: the wordmark wrapped at the word, left-aligned, with the logo's block cursor. */
const wmTwoRow = (s) => boxed(s, wordmarkBox(["./shielded", "scan"], { cursor: true }));

/** WMC: the same, centred and without the cursor — a logotype rather than a terminal line. */
const wmCentred = (s) => boxed(s, wordmarkBox(["./shielded", "scan"], { centred: true }));

/** WMDIM: the second row in green-dim, so "scan" reads as the qualifier it is. */
const wmDim = (s) =>
  boxed(s, wordmarkBox(["./shielded", "scan"], { cursor: true, dimSecond: true }));

/**
 * WMEVEN: split at seven and seven instead of at the word. The longest row is what sets the
 * type size, so this is the largest the wordmark can be inside the frame — at the cost of
 * breaking the word where nobody would read a break.
 */
const wmEven = (s) => boxed(s, wordmarkBox(["./shiel", "dedscan"], { pad: 0.9 }));

export const MARKS = {
  wm: { label: "WM — window + ./shielded / scan + cursor", render: wmTwoRow },
  wmc: { label: "WMC — the same, centred, no cursor", render: wmCentred },
  wmdim: { label: "WMDIM — second row in green-dim", render: wmDim },
  wmeven: { label: "WMEVEN — split 7/7, largest possible type", render: wmEven },
  eyetube: { label: "EYETUBE — the lens in neon", render: eyeTube },
  eyeaperture: { label: "EYEAPERTURE — iris as a camera stop", render: eyeAperture },
  eyescan: { label: "EYESCAN — the lens as a phosphor readout", render: eyeScan },
  eyeveil: { label: "EYEVEIL — the eye, redacted", render: eyeVeil },
  circuitshield: { label: "CIRCUITSHIELD — traces and vias", render: circuitShield },
  glyphshield: { label: "GLYPHSHIELD — ciphertext inside the silhouette", render: glyphShield },
  facetshield: { label: "FACETSHIELD — chamfered, bevelled", render: facetShield },
  keyshield: { label: "KEYSHIELD — an aperture through the shield", render: keyShield },
  scanshield: { label: "SCANSHIELD — solid shield, raster cut in", render: scanShield },
  barshield: { label: "BARSHIELD — shield built from rows of light", render: barShield },
  tubeshield: { label: "TUBESHIELD — silhouette as one neon tube", render: tubeShield },
  tubeshieldlit: { label: "TUBESHIELDLIT — neon tube over a lit interior", render: tubeShieldLit },
  tubeshieldheavy: { label: "TUBESHIELDHEAVY — fatter tube", render: tubeShieldHeavy },
  aperture: { label: "APERTURE — the shield as a window onto the corridor", render: aperture },
  apertureheavy: { label: "APERTUREHEAVY — the same, heavier rule", render: apertureHeavy },
  canyon: { label: "CANYON — the corridor alone", render: canyon },
  phosphor: { label: "PHOSPHOR — a tube, raster and cursor", render: phosphor },
  bxsh: { label: "BXSH — window + solid shield", render: bxSh },
  bxshbig: { label: "BXSHBIG — window + larger solid shield", render: bxShBig },
  bxshduo: { label: "BXSHDUO — window + two-green shield", render: bxShDuo },
  bxshout: { label: "BXSHOUT — window + outlined shield", render: bxShOut },
  bxshneon: { label: "BXSHNEON — window + neon-tube shield", render: bxShNeon },
  shs: { label: "SHS — shield rule + tube S", render: shS },
  shsthin: { label: "SHSTHIN — lighter rule, larger S", render: shSThin },
  shsang: { label: "SHSANG — shield rule + angular S", render: shSAngle },
  shscut: { label: "SHSCUT — solid shield, S knocked out", render: shSCut },
  shsduo: { label: "SHSDUO — dim field, lit rule, S knocked out", render: shSDuo },
  boxs: { label: "BOXS — window + tube S", render: boxS },
  boxsthin: { label: "BOXSTHIN — window + thinner tube S", render: boxSThin },
  boxsang: { label: "BOXSANG — window + angular S", render: boxSAngle },
  boxshot: { label: "BOXSHOT — tube S, near-white core (rejected)", render: boxSHot },
  boxz: { label: "BOXZ — window + ⓩ", render: boxZ },
  boxzcur: { label: "BOXZCUR — window + ⓩ + block cursor", render: boxZCursor },
  boxcur: { label: "BOXCUR — window + block cursor", render: boxCursor },
  boxprompt: { label: "BOXPROMPT — window + prompt", render: boxPrompt },
  boxshield: { label: "BOXSHIELD — window + shielded ⓩ", render: boxShield },
  boxveil: { label: "BOXVEIL — window + the Veil", render: boxVeil },
  boxzBleed: { label: "BOXZ-BLEED — corners lost to X's circle crop", render: boxZBleed },
  rim: { label: "RIM — plate with a rim", render: rimShield },
  duo: { label: "DUO — dim field, bright rim", render: duoShield },
  hex: { label: "HEX — chamfered silhouette", render: hexShield },
  coin: { label: "COIN — dark badge, heavy rim", render: coinShield },
  layer: { label: "LAYER — outline + inset plate", render: layerShield },
  bold: { label: "BOLD — oversized ⓩ", render: boldShield },
  plate: { label: "PLATE — lit rim, dim field", render: plateShield },
  coin2: { label: "COIN2 — heavier badge", render: coin2Shield },
  z1: { label: "Z1 — shield, ⓩ knocked out", render: zShieldCut },
  z2: { label: "Z2 — shield, smaller ⓩ", render: zShieldCutSmall },
  z3: { label: "Z3 — outlined shield, green ⓩ", render: zShieldOutline },
  z4: { label: "Z4 — ⓩ over a redaction bar", render: zShieldVeiled },
  a: { label: "A — veiled shield (3 bars)", render: veiled3 },
  a2: { label: "A2 — veiled shield (2 bars)", render: veiled2 },
  d: { label: "D — prompt shield", render: promptShield },
  e: { label: "E — cursor shield", render: cursorShield },
  b: { label: "B — half shield (mixed)", render: halfShield },
  c: { label: "C — prompt block", render: promptBlock },
};

/** A full-bleed square avatar. X crops to a circle, so nothing lives near a corner. */
export function avatarHtml(key, size) {
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:${BG};}
    .frame{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;
           background:radial-gradient(circle at 50% 47%, rgba(43,255,100,.09), rgba(5,8,5,0) 64%), ${BG};}
  </style><div class="frame">${MARKS[key].render(size)}</div>`;
}

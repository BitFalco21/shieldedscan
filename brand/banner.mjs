/**
 * The X / Twitter header, 1500x500.
 *
 * The homepage statement hero over a drawn neon street canyon (`city.mjs`). The copy sits
 * on the left because X overlays the profile picture on the header's bottom-left and the
 * canyon's depth belongs where nothing is written.
 */
import { cityHtml, CITY_CSS } from "./city.mjs";

/**
 * X does not show all 500 rows of a 1500x500 header: on the profile it crops vertically,
 * centred. Measured off a real rendered profile, roughly the middle half survives — enough
 * to cut the top of the marquee and the bottom of the statement.
 *
 * `safe: true` therefore lays the same scene out inside that band: the copy block is
 * centred on y=250 rather than hung from a top offset, the statement drops to 76px so its
 * descender clears the fold, and the marquee is lowered to sit wholly inside it. Everything
 * outside SAFE_TOP…SAFE_BOTTOM is treated as bleed — atmosphere only, nothing to read.
 */
export const SAFE_TOP = 120;
export const SAFE_BOTTOM = 380;

export function bannerHtml(seed = 7, { showUrl = true, safe = false } = {}) {
  // 8 characters at the marquee's 26px pitch plus its frame; placed to end on SAFE_BOTTOM.
  const signTop = safe ? SAFE_BOTTOM - (8 * 26 + 22) : 18;
  return `<!doctype html>
<meta charset="utf-8" />
<title>./shieldedscan — header</title>
<style>
  /* JetBrains Mono is injected by generate.mjs from public/fonts as a base64 @font-face,
     so this file has no external dependency and renders identically anywhere. */

  /* Phosphor tokens, copied from src/app/styles/tokens.css. */
  :root {
    --bg: #050805;
    --green: #2bff64;
    --green-dim: #17a344;
    --ink: #d9ffe4;
    --ink-dim: #7fbf93;
  }
  html, body { margin: 0; padding: 0; }
  body { width: 1500px; height: 500px; overflow: hidden; font-family: "JBM", monospace; }
  .stage { position: relative; width: 1500px; height: 500px; background: var(--bg); }
${CITY_CSS}
  /* Centred on the safe band rather than hung from the top, so the block cannot drift
     into the fold when a line is added or removed. */
  .copy { position: absolute; left: 96px; ${
    safe
      ? `top: ${(SAFE_TOP + SAFE_BOTTOM) / 2}px; transform: translateY(-50%);`
      : `top: ${showUrl ? 118 : 137}px;`
  } }

  .brand {
    display: flex; align-items: baseline; gap: 3px;
    font-size: 23px; font-weight: 700; letter-spacing: .04em; color: var(--green);
    text-shadow: 0 0 10px rgba(43,255,100,.45);
  }
  .cursor {
    display: inline-block; width: .6em; height: 1.05em; background: var(--green);
    box-shadow: 0 0 10px rgba(43,255,100,.6);
  }

  /* The homepage <h1> treatment: bloom plus a raster cut into the glyphs. The one place
     scanlines are allowed is the statement hero — this is that hero, off-site. */
  /* inline-block, so the raster overlay covers the glyphs and not the block
     width — over a lit background the overhang read as a stray striped panel. */
  .crt {
    position: relative; display: inline-block; margin: 22px 0 0; font-size: ${safe ? 76 : 86}px; line-height: .95;
    font-weight: 800; letter-spacing: .07em; color: var(--green);
    text-shadow:
      0 0 1px rgba(242,255,245,.4),
      0 0 14px rgba(43,255,100,.55),
      0 0 42px rgba(43,255,100,.26);
  }
  .crt::after {
    /* The right inset trims the trailing letter-space: without it the raster
       overhangs the last glyph and, over a lit background, reads as a stray panel. */
    content: ""; position: absolute; inset: -.06em .075em -.06em 0; pointer-events: none;
    background: repeating-linear-gradient(to bottom,
      transparent 0 .055em, rgba(5,8,5,.45) .055em .1em);
  }

  /* Over a lit background these two lines need their own floor of darkness, or the
     letter-spaced small type starts competing with the neon behind it. */
  .sub {
    margin-top: 26px; font-size: 15px; letter-spacing: .215em; color: var(--ink-dim);
    text-transform: uppercase; text-shadow: 0 0 12px rgba(2,5,3,.95), 0 0 4px rgba(2,5,3,1);
  }
  .url {
    margin-top: 22px; font-size: 15px; letter-spacing: .16em; color: var(--green-dim);
    text-shadow: 0 0 12px rgba(2,5,3,.95);
  }
</style>

<div class="stage">
${cityHtml(seed, { signTop })}
  <div class="copy">
    <div class="brand">./shieldedscan<span class="cursor"></span></div>
    <h1 class="crt">PRIVACY IS NORMAL</h1>
    <div class="sub">A ZCASH BLOCK EXPLORER &nbsp;·&nbsp; SHIELDED POOLS &nbsp;·&nbsp; CROSS-CHAIN FLOWS</div>
    ${showUrl ? '<div class="url">shieldedscan.xyz</div>' : ""}
  </div>
</div>
`;
}

/**
 * The LinkedIn company cover, 2256x382 (2x LinkedIn's 1128x191).
 *
 * A separate canvas rather than a crop of the X header, because LinkedIn differs in both
 * ways that matter, measured off a real rendered page:
 *
 *  - the cover is ~5.6:1, not 3:1, so a 1500x500 image loses roughly half its height;
 *  - the logo tile is overlaid at x 3.6…18.8%, from y 50.7% to the bottom edge — higher and
 *    proportionally far larger than X's avatar. That is what clipped the bottom of "PRIV":
 *    the statement started at x 6.4% and reached y 57.6%, straight through the tile.
 *
 * So the copy starts right of the tile instead of above it, and the scene is `slice`-fitted
 * so its perspective is scaled rather than stretched — a `none` fit would flatten the
 * canyon's convergence and squash the marquee's letters.
 */
export const LINKEDIN = { w: 2256, h: 382, logoRightPct: 20, logoTopPct: 48 };

export function linkedInCoverHtml(seed = 7) {
  const { w, h } = LINKEDIN;
  return `<!doctype html>
<meta charset="utf-8" />
<title>./shieldedscan — LinkedIn cover</title>
<style>
  :root {
    --bg: #050805;
    --green: #2bff64;
    --green-dim: #17a344;
    --ink-dim: #7fbf93;
  }
  html, body { margin: 0; padding: 0; }
  body { width: ${w}px; height: ${h}px; overflow: hidden; font-family: "JBM", monospace; }
  .stage { position: relative; width: ${w}px; height: ${h}px; background: var(--bg); }
${CITY_CSS}
  /* Clear of the logo tile, which owns the bottom-left ${LINKEDIN.logoRightPct}% x
     ${100 - LINKEDIN.logoTopPct}%. Centred vertically on the cover. */
  .copy {
    position: absolute; left: 520px; top: 50%; transform: translateY(-50%);
  }
  .brand {
    display: flex; align-items: baseline; gap: 4px;
    font-size: 30px; font-weight: 700; letter-spacing: .04em; color: var(--green);
    text-shadow: 0 0 12px rgba(43,255,100,.45);
  }
  .cursor {
    display: inline-block; width: .6em; height: 1.05em; background: var(--green);
    box-shadow: 0 0 12px rgba(43,255,100,.6);
  }
  .crt {
    position: relative; display: inline-block; margin: 24px 0 0; font-size: 104px;
    line-height: .95; font-weight: 800; letter-spacing: .07em; color: var(--green);
    text-shadow:
      0 0 1px rgba(242,255,245,.4),
      0 0 16px rgba(43,255,100,.55),
      0 0 48px rgba(43,255,100,.26);
  }
  .crt::after {
    content: ""; position: absolute; inset: -.06em .075em -.06em 0; pointer-events: none;
    background: repeating-linear-gradient(to bottom,
      transparent 0 .055em, rgba(5,8,5,.45) .055em .1em);
  }
  .sub {
    margin-top: 28px; font-size: 18px; letter-spacing: .215em; color: var(--ink-dim);
    text-transform: uppercase; text-shadow: 0 0 14px rgba(2,5,3,.95), 0 0 4px rgba(2,5,3,1);
  }
</style>

<div class="stage">
${cityHtml(seed, { signTop: 140, fit: "xMidYMid slice" })}
  <div class="copy">
    <div class="brand">./shieldedscan<span class="cursor"></span></div>
    <h1 class="crt">PRIVACY IS NORMAL</h1>
    <div class="sub">A ZCASH BLOCK EXPLORER &nbsp;·&nbsp; SHIELDED POOLS &nbsp;·&nbsp; CROSS-CHAIN FLOWS</div>
  </div>
</div>
`;
}

/**
 * The share card, 1200x630.
 *
 * What a link to this site renders as on X, Slack, Discord, iMessage and a search result's
 * rich preview. Before this, `layout.tsx` pointed `openGraph.images` at the 512x512 avatar
 * under `summary_large_image`, so every one of those surfaces stretched a square wordmark
 * into a 1.91:1 frame — the wordmark unreadable, most of the card the avatar's own bloom.
 *
 * 1200x630 is X's and Slack's recommended size and the one both crop least. It is a
 * DIFFERENT canvas from the X header rather than a crop of it, for the reason LinkedIn's
 * cover is: 1.91:1 against the header's 3:1 leaves the copy block a third more height, so
 * the statement can run larger and the description gets its own line.
 *
 * Two backdrops, because the site has two answers and they are worth comparing on a real
 * card: `city` is the drawn canyon the X header uses; `photo` is the homepage's own
 * photograph, so the card and the page a visitor lands on look like the same site.
 *
 * `photoDataUri` is passed in rather than read here: this module stays free of the
 * filesystem so it can be rendered from a string anywhere, exactly as `bannerHtml` is.
 */
export const OG = { w: 1200, h: 630 };

export function ogCardHtml(seed = 7, { backdrop = "photo", photoDataUri = "" } = {}) {
  const { w, h } = OG;
  if (backdrop === "photo" && !photoDataUri) {
    throw new Error("ogCardHtml: the photo backdrop needs photoDataUri");
  }
  return `<!doctype html>
<meta charset="utf-8" />
<title>./shieldedscan — share card</title>
<style>
  /* Phosphor tokens, copied from src/app/styles/tokens.css. */
  :root {
    --bg: #050805;
    --green: #2bff64;
    --green-dim: #17a344;
    --ink: #d9ffe4;
    --ink-dim: #7fbf93;
  }
  html, body { margin: 0; padding: 0; }
  body { width: ${w}px; height: ${h}px; overflow: hidden; font-family: "JBM", monospace; }
  .stage { position: relative; width: ${w}px; height: ${h}px; background: var(--bg); overflow: hidden; }
${CITY_CSS}
  /* The drawn scene is authored at 1500x500 and this canvas is taller in proportion, so it
     is slice-fitted: the perspective scales and the sides are cropped, where a 'none' fit
     would stretch the canyon's convergence flat. Anchored right, which is where the scene's
     brightest wall and the marquee are — and the side the copy does not use. */
  .city .scene { width: 100%; height: 100%; }

  /* The homepage's own treatment: object-cover anchored to the BOTTOM so the wet street
     stays under the copy, and the grade from .hero-city-grade — a pool of near-black
     behind the statement, because .crt-title cuts DARK scanlines between its glyphs and
     over lit windows that reads as a striped panel. */
  .plate { position: absolute; inset: 0; }
  .plate img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 100%; display: block; }
  .grade {
    position: absolute; inset: 0;
    background:
      radial-gradient(72% 46% at 34% 34%, rgba(5,8,5,.9) 0 38%, rgba(5,8,5,.56) 68%, rgba(5,8,5,0) 100%),
      linear-gradient(to bottom, rgba(5,8,5,.34) 0%, rgba(5,8,5,.14) 34%, rgba(5,8,5,.46) 72%, rgba(5,8,5,.72) 100%);
  }

  /* Left-aligned, matching the homepage hero and the header. Centred vertically on the
     card: some clients crop a few rows top and bottom, and a block hung from the top edge
     is the one that loses its first line. */
  .copy { position: absolute; left: 84px; top: 50%; transform: translateY(-50%); }

  .brand {
    display: flex; align-items: baseline; gap: 4px;
    font-size: 30px; font-weight: 700; letter-spacing: .04em; color: var(--green);
    text-shadow: 0 0 12px rgba(43,255,100,.45);
  }
  .cursor {
    display: inline-block; width: .6em; height: 1.05em; background: var(--green);
    box-shadow: 0 0 12px rgba(43,255,100,.6);
  }

  /* The homepage <h1>: bloom plus a raster cut into the glyphs. inline-block so the
     overlay covers the glyphs and not the block width. */
  .crt {
    position: relative; display: inline-block; margin: 26px 0 0; font-size: 82px;
    line-height: .95; font-weight: 800; letter-spacing: .07em; color: var(--green);
    text-shadow:
      0 0 1px rgba(242,255,245,.4),
      0 0 16px rgba(43,255,100,.55),
      0 0 48px rgba(43,255,100,.26);
  }
  .crt::after {
    content: ""; position: absolute; inset: -.06em .075em -.06em 0; pointer-events: none;
    background: repeating-linear-gradient(to bottom,
      transparent 0 .055em, rgba(5,8,5,.45) .055em .1em);
  }

  /* The card's own sentence, and it is the SAME sentence as the page's meta description
     (siteDescription in src/app/layout.tsx) — a preview whose image and text state
     different things about the site is one fact answered in two places. */
  .sub {
    margin-top: 28px; font-size: 18px; line-height: 1.6; letter-spacing: .12em;
    color: var(--ink-dim); text-transform: uppercase; white-space: nowrap;
    text-shadow: 0 0 12px rgba(2,5,3,.95), 0 0 4px rgba(2,5,3,1);
  }
  .url {
    margin-top: 26px; font-size: 17px; letter-spacing: .16em; color: var(--green-dim);
    text-shadow: 0 0 12px rgba(2,5,3,.95);
  }
</style>

<div class="stage">
${
  backdrop === "photo"
    ? `  <div class="plate"><img src="${photoDataUri}" alt="" /></div>
  <div class="grade"></div>`
    : cityHtml(seed, { signTop: 150, fit: "xMaxYMid slice" })
}
  <div class="copy">
    <div class="brand">./shieldedscan<span class="cursor"></span></div>
    <h1 class="crt">PRIVACY IS NORMAL</h1>
    <div class="sub">SHIELDED POOLS &nbsp;·&nbsp; CROSS-CHAIN FLOWS &nbsp;·&nbsp; NETWORK ANALYTICS</div>
    <div class="url">shieldedscan.xyz</div>
  </div>
</div>
`;
}

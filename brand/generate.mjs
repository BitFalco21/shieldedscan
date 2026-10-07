/**
 * Regenerates the social assets in this directory.
 *
 *   node brand/generate.mjs               # the shipped pair
 *   MARK=plate node brand/generate.mjs    # another mark — see mark-candidates.png
 *   SEED=11 node brand/generate.mjs       # another roll of the banner's skyline
 *
 * Why a script and not four PNGs someone once exported: the mark's geometry is quoted from
 * `src/components/PrivacyShield.tsx` and the banner's treatment from `.crt-title` in
 * `src/app/styles/components.css`. When either changes, the profile picture should change with it,
 * and that is only true if regenerating is one command. The same reason `server/Caddyfile`
 * and `scripts/generate-donate-qr.mjs` live in the repo.
 *
 * Renders through the project's own Playwright Chromium and the self-hosted JetBrains Mono
 * in `public/fonts/`, embedded as base64 — so no network request, and the type is the
 * site's type rather than a fallback that happens to be installed.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { MARKS, avatarHtml } from "./marks.mjs";
import {
  bannerHtml,
  linkedInCoverHtml,
  ogCardHtml,
  LINKEDIN,
  OG,
  SAFE_TOP,
  SAFE_BOTTOM,
} from "./banner.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(DIR, "..");
const MARK = process.env.MARK ?? "wm";

if (!MARKS[MARK]) {
  console.error(`unknown MARK "${MARK}" — options: ${Object.keys(MARKS).join(", ")}`);
  process.exit(1);
}

const fontCss = [
  ["JetBrainsMono-Regular.woff2", 400],
  ["JetBrainsMono-Bold.woff2", 700],
  ["JetBrainsMono-ExtraBold.woff2", 800],
]
  .map(([file, weight]) => {
    const b64 = fs.readFileSync(path.join(ROOT, "public/fonts", file)).toString("base64");
    return `@font-face{font-family:"JBM";font-weight:${weight};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
  })
  .join("\n");

const browser = await chromium.launch();

async function shoot({ html, url, width, height, out, fullPage = false }) {
  const page = await browser.newPage({ viewport: { width, height } });
  if (url) await page.goto(url, { waitUntil: "load" });
  else await page.setContent(html, { waitUntil: "load" });
  await page.addStyleTag({ content: fontCss });
  // Layout must settle on the real face before the shot: measured in the fallback face,
  // every letter-spaced line lands a few pixels short. Same trap as the e2e layout suite.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(DIR, out), fullPage });
  await page.close();
}

// X's recommended profile picture is 400x400; the 1000 master exists to re-export from.
for (const size of [400, 1000]) {
  await shoot({
    html: avatarHtml(MARK, size),
    width: size,
    height: size,
    out: `shieldedscan-avatar-${size}.png`,
  });
}

// A second mark, exported ready to upload, so two directions can be tried on the real
// profile without running anything. `ALT_MARK=` (empty) skips it.
const ALT = process.env.ALT_MARK ?? "glyphshield";
if (ALT) {
  if (!MARKS[ALT]) {
    console.error(`unknown ALT_MARK "${ALT}"`);
    process.exit(1);
  }
  await shoot({
    html: avatarHtml(ALT, 400),
    width: 400,
    height: 400,
    out: "shieldedscan-avatar-alt-400.png",
  });
}

// X's recommended header is 1500x500. Keep the bottom-left ~230x100 clear: the profile
// picture is overlaid there. `mockup-x-profile.png` is the check, not a deliverable.
// Rendered from the string rather than from a written-out banner.html: a generated HTML
// file in the tree fails `prettier --check` on every run, which CI runs repo-wide. Set
// DEBUG_HTML=1 to drop a copy under the scratch name for poking at in a browser.
const banner = bannerHtml(Number(process.env.SEED ?? 7));
if (process.env.DEBUG_HTML) fs.writeFileSync(path.join(DIR, "banner.debug.html"), banner);
await shoot({
  html: banner,
  width: 1500,
  height: 500,
  out: "shieldedscan-banner-1500x500.png",
});

// A second header with no domain on it: X already shows the URL in the bio, and some
// surfaces (a pinned post, a conference slide) read better without it. Same scene.
await shoot({
  html: bannerHtml(Number(process.env.SEED ?? 7), { showUrl: false }),
  width: 1500,
  height: 500,
  out: "shieldedscan-banner-1500x500-no-url.png",
});

// A third cut laid out for X's vertical crop: everything readable inside SAFE_TOP…
// SAFE_BOTTOM, so the statement and the marquee both survive the fold.
await shoot({
  html: bannerHtml(Number(process.env.SEED ?? 7), { showUrl: false, safe: true }),
  width: 1500,
  height: 500,
  out: "shieldedscan-banner-1500x500-safe.png",
});

// The check for it: the same image with the band drawn on, and the crop X actually shows.
// A safe area nobody has looked through is just a comment.
{
  const safe = fs
    .readFileSync(path.join(DIR, "shieldedscan-banner-1500x500-safe.png"))
    .toString("base64");
  const pct = (v) => `${(v / 5).toFixed(1)}%`;
  await shoot({
    html: `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;background:#000;font-family:"JBM",monospace;color:#7fbf93;}
      .wrap{padding:20px;display:flex;flex-direction:column;gap:18px;}
      h2{margin:0;font-size:11px;letter-spacing:.18em;color:#2bff64;text-transform:uppercase;}
      .full{position:relative;width:1000px;}
      .full img{display:block;width:1000px;}
      .band{position:absolute;left:0;right:0;border-top:1px dashed rgba(255,176,32,.9);
            border-bottom:1px dashed rgba(255,176,32,.9);}
      .lbl{position:absolute;right:6px;top:2px;font-size:10px;color:#ffb020;letter-spacing:.12em;}
      /* Pixel offsets, not percentages: a percentage margin-top resolves against the
         container's WIDTH, so -24% slid the image 240px instead of the 80px that 120 of
         500 rows comes to at this scale. */
      .crop{width:1000px;overflow:hidden;position:relative;}
      .crop img{display:block;width:1000px;margin-top:${((-SAFE_TOP / 500) * (1000 / 3)).toFixed(1)}px;}
    </style><div class="wrap">
      <h2>full 1500×500 — dashed band is what X keeps</h2>
      <div class="full"><img src="data:image/png;base64,${safe}" alt="">
        <div class="band" style="top:${pct(SAFE_TOP)};height:${pct(SAFE_BOTTOM - SAFE_TOP)}">
          <span class="lbl">safe area</span></div>
      </div>
      <h2>cropped to the band — what a visitor sees</h2>
      <div class="crop" style="height:${(((SAFE_BOTTOM - SAFE_TOP) / 500) * (1000 / 3)).toFixed(0)}px">
        <img src="data:image/png;base64,${safe}" alt=""></div>
    </div>`,
    width: 1040,
    height: 700,
    fullPage: true,
    out: "mockup-banner-crop.png",
  });
}

// LinkedIn's company cover, plus its own overlay check: the logo tile there is higher and
// proportionally much larger than X's avatar, which is what clipped "PRIV".
await shoot({
  html: linkedInCoverHtml(Number(process.env.SEED ?? 7)),
  width: LINKEDIN.w,
  height: LINKEDIN.h,
  out: "shieldedscan-linkedin-2256x382.png",
});
{
  const cover = fs
    .readFileSync(path.join(DIR, "shieldedscan-linkedin-2256x382.png"))
    .toString("base64");
  // Displayed geometry measured off a real rendered company page.
  const W = 1210;
  const H = Math.round((W * LINKEDIN.h) / LINKEDIN.w);
  const avatar = fs.readFileSync(path.join(DIR, "shieldedscan-avatar-400.png")).toString("base64");
  await shoot({
    html: `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;background:#1b1f23;font-family:"JBM",monospace;color:#7fbf93;}
      .wrap{padding:20px;}
      h2{margin:0 0 12px;font-size:11px;letter-spacing:.18em;color:#2bff64;text-transform:uppercase;}
      .page{position:relative;width:${W}px;background:#000;}
      .page img{display:block;width:${W}px;}
      /* The logo tile, at the measured 3.6…18.8% x 50.7%…bottom. */
      .logo{position:absolute;left:3.6%;top:50.7%;width:15.2%;aspect-ratio:1;
            background:#000;border:6px solid #1b1f23;box-sizing:border-box;overflow:hidden;}
      .logo img{width:100%;height:100%;display:block;}
      .name{padding:118px 0 0 4px;color:#e8e8e8;font-size:26px;font-weight:800;}
    </style><div class="wrap">
      <h2>LinkedIn company page — logo tile at its measured position</h2>
      <div class="page"><img src="data:image/png;base64,${cover}" alt="">
        <div class="logo"><img src="data:image/png;base64,${avatar}" alt=""></div>
      </div>
      <div class="name">ShieldedScan</div>
    </div>`,
    width: W + 40,
    height: H + 220,
    fullPage: true,
    out: "mockup-linkedin.png",
  });
}

// The share card, 1200x630 — what a link to the site renders as on X, Slack and the rest.
// Both backdrops are exported so they can be compared on a real card; the one the site
// serves is copied to public/og.png below.
{
  // The homepage's own plate, embedded so the card has no external dependency. The 2560
  // cut, not the 1280: it is downscaled into a 1200-wide frame, and starting from the
  // sharper master is what keeps the neon from going soft.
  const photo = fs.readFileSync(path.join(ROOT, "public/hero-city/city-2560.webp"));
  const photoDataUri = `data:image/webp;base64,${photo.toString("base64")}`;
  const seed = Number(process.env.SEED ?? 7);

  for (const backdrop of ["photo", "city"]) {
    await shoot({
      html: ogCardHtml(seed, { backdrop, photoDataUri }),
      width: OG.w,
      height: OG.h,
      out: `shieldedscan-og-${backdrop}-1200x630.png`,
    });
  }

  // The shipped card. OG_BACKDROP picks which of the two the site serves; it is written
  // straight into public/ because `layout.tsx` references it by path and a deliverable
  // nothing serves is not a deliverable.
  const shipped = process.env.OG_BACKDROP ?? "photo";
  fs.copyFileSync(
    path.join(DIR, `shieldedscan-og-${shipped}-1200x630.png`),
    path.join(ROOT, "public/og.png"),
  );
}

// The mark alone, flat and unglowed — for a favicon, an OG image, or a README.
const inner = MARKS[MARK].render(24)
  .replace(/^<svg[^>]*>/, "")
  .replace(/<\/svg>$/, "")
  .trim();
fs.writeFileSync(
  path.join(DIR, "shieldedscan-mark.svg"),
  // 512, not 24. The geometry is a 24-unit viewBox, but this file is DOWNLOADED and opened
  // on its own, where width/height are the intrinsic size — at 24 it rendered as a
  // thumbnail barely larger than a favicon. The viewBox still drives the drawing, so it
  // scales losslessly, and anywhere the site embeds it the <img> attributes win anyway.
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512" role="img" aria-label="shieldedscan">\n${inner}\n</svg>\n`,
);

// Every candidate, circle-cropped at the sizes X actually uses. Committed rather than
// thrown away: a mark is chosen by comparing it against the ones that lost, and 48px is
// where most of them lose. 24px is here because the same mark may become the favicon.
const cell = (key, s) =>
  `<div class="c"><div class="crop" style="width:${s}px;height:${s}px">` +
  `<div class="frame" style="width:${s}px;height:${s}px">${MARKS[key].render(s)}</div>` +
  `</div><span>${s}px</span></div>`;
await shoot({
  html: `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#000;font-family:"JBM",monospace;color:#7fbf93;}
    .wrap{padding:26px 34px;display:flex;flex-direction:column;gap:22px;}
    h2{color:#d9ffe4;font-size:12px;letter-spacing:.14em;margin:0 0 10px;text-transform:uppercase;}
    .row{border-top:1px solid rgba(43,255,100,.14);padding-top:14px;}
    .cells{display:flex;align-items:flex-end;gap:30px;}
    .c{display:flex;flex-direction:column;align-items:center;gap:7px;}
    .c span{font-size:9px;color:#5f8f70;}
    .crop{border-radius:50%;overflow:hidden;flex:none;box-shadow:0 0 0 1px rgba(43,255,100,.2);}
    .frame{display:flex;align-items:center;justify-content:center;
      background:radial-gradient(circle at 50% 47%, rgba(43,255,100,.09), rgba(5,8,5,0) 64%), #050805;}
    .on{color:#2bff64;}
  </style><div class="wrap">${Object.keys(MARKS)
    .map(
      (k) =>
        `<div class="row"><h2 class="${k === MARK ? "on" : ""}">${k}${
          k === MARK ? " — shipped" : ""
        } · ${MARKS[k].label}</h2><div class="cells">${[200, 96, 48, 24]
          .map((s) => cell(k, s))
          .join("")}</div></div>`,
    )
    .join("")}</div>`,
  width: 560,
  height: 400,
  fullPage: true,
  out: "mark-candidates.png",
});

// Proof that the header survives X's own chrome: the avatar overlay must not cover copy.
const b64 = (f) => fs.readFileSync(path.join(DIR, f)).toString("base64");
await shoot({
  html: `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#000;font-family:"JBM",monospace;}
    .hdr{position:relative;width:1100px;}
    .hdr>img{display:block;width:1100px;height:366.6px;}
    .av{position:absolute;left:24px;bottom:-56px;width:134px;height:134px;border-radius:50%;
        border:4px solid #000;box-sizing:border-box;overflow:hidden;}
    .av img{width:100%;height:100%;display:block;}
    .below{padding:78px 26px 34px;color:#d9ffe4;}
    .name{font-size:23px;font-weight:800;}
    .handle{margin-top:3px;font-size:15px;color:#5f8f70;}
    .bio{margin-top:13px;font-size:15px;color:#7fbf93;line-height:1.5;}
  </style>
  <div class="hdr"><img src="data:image/png;base64,${b64("shieldedscan-banner-1500x500.png")}" alt="">
    <div class="av"><img src="data:image/png;base64,${b64("shieldedscan-avatar-400.png")}" alt=""></div>
  </div>
  <div class="below"><div class="name">./shieldedscan</div><div class="handle">@shieldedscan</div>
    <div class="bio">A Zcash block explorer. Shielded pools, cross-chain flows, a keyless public API.<br>shieldedscan.xyz</div>
  </div>`,
  width: 1100,
  height: 620,
  out: "mockup-x-profile.png",
});

await browser.close();

for (const f of fs
  .readdirSync(DIR)
  .filter((f) => /\.(png|svg)$/.test(f))
  .sort()) {
  console.log(`${f}  ${(fs.statSync(path.join(DIR, f)).size / 1024).toFixed(0)} KB`);
}

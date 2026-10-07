/**
 * The site icon, generated from the brand avatar.
 *
 * The source is `brand/shieldedscan-avatar-400.png`, the social profile picture, so the browser
 * tab, the search result and the social profile share one identity.
 *
 * At 16px a fourteen-character wordmark cannot resolve: what survives is the neon frame, not the
 * words. `brand/favicon-legibility.png` is a contact sheet at 16/32/48/64 so that trade-off can
 * be judged by looking.
 *
 * Run: `node brand/favicon.mjs` — writes into `src/app/` and `public/`.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(DIR, "..");
const SOURCE = path.join(DIR, "shieldedscan-avatar-400.png");

/** Rasterise the source at `size`, square, with its own background. */
async function render(browser, size, out) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const data = fs.readFileSync(SOURCE).toString("base64");
  await page.setContent(
    `<body style="margin:0">
       <img src="data:image/png;base64,${data}"
            style="width:${size}px;height:${size}px;display:block" />
     </body>`,
  );
  await page.screenshot({ path: out });
  await page.close();
}

/** A contact sheet: the icon at the sizes browsers and Google actually use. */
async function legibilitySheet(browser, out) {
  const data = fs.readFileSync(SOURCE).toString("base64");
  const sizes = [16, 32, 48, 64, 128];
  const page = await browser.newPage({ viewport: { width: 340, height: 190 } });
  await page.setContent(
    `<body style="margin:0;background:#fff;font:11px ui-monospace,monospace;color:#333">
       <div style="display:flex;align-items:flex-end;gap:18px;padding:20px">
         ${sizes
           .map(
             (s) =>
               `<figure style="margin:0;text-align:center">
                  <img src="data:image/png;base64,${data}" style="width:${s}px;height:${s}px;display:block" />
                  <figcaption style="margin-top:6px">${s}px</figcaption>
                </figure>`,
           )
           .join("")}
       </div>
     </body>`,
  );
  await page.screenshot({ path: out });
  await page.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await chromium.launch();
  // Next App Router file conventions: these names ARE the <link> tags, so the markup and
  // the file can never disagree.
  await render(browser, 32, path.join(ROOT, "src/app/icon.png"));
  await render(browser, 180, path.join(ROOT, "src/app/apple-icon.png"));
  // Raster copies for consumers that will not take the app-router files: Google asks for a
  // square favicon that is a multiple of 48, and an Organization logo must be raster.
  await render(browser, 192, path.join(ROOT, "public/icon-192.png"));
  await render(browser, 512, path.join(ROOT, "public/icon-512.png"));
  await legibilitySheet(browser, path.join(DIR, "favicon-legibility.png"));
  await browser.close();
  console.log(
    "wrote src/app/icon.png, src/app/apple-icon.png, public/icon-192.png, public/icon-512.png, brand/favicon-legibility.png",
  );
}

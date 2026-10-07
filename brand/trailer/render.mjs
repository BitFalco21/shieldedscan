/* Frame-by-frame capture of trailer.html through headless Chromium.
   Sequential by design: the renderer keeps a phosphor-persistence buffer, so
   frame N depends on frame N-1. */
import { chromium } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";

const dir = new URL("./", import.meta.url).pathname;
const outDir = dir + (process.env.FRAMES_DIR || "frames");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--force-color-profile=srgb", "--disable-lcd-text"],
});
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
page.on("console", (m) => {
  if (m.type() === "error") console.error("PAGE ERROR:", m.text());
});
page.on("pageerror", (e) => console.error("PAGE EXCEPTION:", e.message));

await page.goto(pathToFileURL(dir + (process.env.FILM || "trailer.html")).href);
await page.evaluate(() => window.__ready);
const meta = await page.evaluate(() => window.__meta);
console.log("meta", meta);

const canvas = page.locator("canvas");
const t0 = Date.now();
for (let i = 0; i < meta.frames; i++) {
  await page.evaluate((n) => window.__frame(n), i);
  await canvas.screenshot({ path: `${outDir}/f${String(i).padStart(5, "0")}.png` });
  if (i % 60 === 0) {
    const rate = (i + 1) / ((Date.now() - t0) / 1000);
    console.log(`frame ${i}/${meta.frames}  ${rate.toFixed(1)} fps`);
  }
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await browser.close();

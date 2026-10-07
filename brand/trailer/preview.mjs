/* Contact sheet: step every frame (persistence is sequential) but only save
   the seconds given on the command line. */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const dir = new URL("./", import.meta.url).pathname;
const outDir = dir + "preview";
mkdirSync(outDir, { recursive: true });

const wanted = (
  process.argv.slice(2).length
    ? process.argv.slice(2)
    : "1.2 3.4 5.0 6.4 8.2 9.8 11.2 13.0 15.0 17.0 18.8 20.6 22.0 23.6".split(" ")
).map(Number);

const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
page.on("pageerror", (e) => console.error("PAGE EXCEPTION:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.error("PAGE ERROR:", m.text());
});

await page.goto(pathToFileURL(dir + (process.env.FILM || "trailer.html")).href);
await page.evaluate(() => window.__ready);
const meta = await page.evaluate(() => window.__meta);
const targets = new Set(wanted.map((s) => Math.round(s * meta.FPS)));
const canvas = page.locator("canvas");

for (let i = 0; i < meta.frames; i++) {
  await page.evaluate((n) => window.__frame(n), i);
  if (targets.has(i)) {
    await canvas.screenshot({ path: `${outDir}/t${(i / meta.FPS).toFixed(2)}.png` });
    console.log("saved", (i / meta.FPS).toFixed(2) + "s");
  }
}
await browser.close();

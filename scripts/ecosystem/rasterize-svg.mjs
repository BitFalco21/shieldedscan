// Render one SVG icon to a transparent PNG with the Chromium Playwright already installs.
// Called by fetch-logos.py for sites that publish only an SVG icon: a browser engine renders
// an SVG faithfully where an image library cannot, so the icon is the site's own, not a guess.
//
//   node scripts/ecosystem/rasterize-svg.mjs <svg-url> <out.png>
import { chromium } from "@playwright/test";

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: rasterize-svg.mjs <svg-url> <out.png>");
  process.exit(2);
}

const SIZE = 128;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  const res = await page.request.get(url, { timeout: 12_000 });
  if (!res.ok()) throw new Error(`${url} answered ${res.status()}`);
  const svg = (await res.body()).toString("base64");
  await page.setContent(
    `<html><body style="margin:0;background:transparent">` +
      `<img id="i" src="data:image/svg+xml;base64,${svg}" style="width:${SIZE}px;height:${SIZE}px;object-fit:contain">` +
      `</body></html>`,
  );
  await page.locator("#i").evaluate((img) => img.decode());
  await page.locator("#i").screenshot({ path: out, omitBackground: true });
} finally {
  await browser.close();
}
